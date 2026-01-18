import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import {
  VotifierClient,
  sendVote,
  V1Protocol,
  V2Protocol,
  ConnectionError,
  ProtocolError,
  CryptoError,
  TimeoutError,
} from '../src/index.js';
import type { Vote } from '../src/index.js';

// Test RSA key pair for V1 testing
const TEST_KEY_PAIR = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const TEST_TOKEN = 'test-secret-token';

const mockVote: Vote = {
  username: 'TestPlayer',
  serviceName: 'TestService',
  address: '127.0.0.1',
  timestamp: 1704067200000,
};

describe('V1Protocol', () => {
  describe('constructor', () => {
    it('should accept a valid PEM public key', () => {
      expect(() => new V1Protocol(TEST_KEY_PAIR.publicKey)).not.toThrow();
    });

    it('should accept a base64-encoded public key', () => {
      // Extract base64 content from PEM
      const base64Key = TEST_KEY_PAIR.publicKey
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .replace(/\s/g, '');
      expect(() => new V1Protocol(base64Key)).not.toThrow();
    });

    it('should throw CryptoError for invalid key', () => {
      expect(() => new V1Protocol('invalid-key')).toThrow(CryptoError);
    });
  });

  describe('sendVote', () => {
    let server: net.Server;
    let serverPort: number;
    let receivedData: Buffer | null = null;

    beforeAll(async () => {
      server = net.createServer((socket) => {
        socket.on('data', (data) => {
          receivedData = data;
          socket.end();
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(() => {
      server.close();
    });

    it('should send encrypted vote data', async () => {
      receivedData = null;
      const protocol = new V1Protocol(TEST_KEY_PAIR.publicKey);

      await protocol.sendVote('127.0.0.1', serverPort, 5000, mockVote);

      // Wait for server to process the data
      await new Promise((r) => setTimeout(r, 10));

      expect(receivedData).not.toBeNull();
      // RSA 2048-bit key produces 256 byte encrypted output
      expect(receivedData!.length).toBe(256);
      // Verify it's binary encrypted data (not plaintext)
      expect(receivedData!.toString('utf8')).not.toContain('VOTE');
    });

    it('should throw ConnectionError for unreachable host', async () => {
      const protocol = new V1Protocol(TEST_KEY_PAIR.publicKey);

      await expect(
        protocol.sendVote('127.0.0.1', 59999, 1000, mockVote)
      ).rejects.toThrow(ConnectionError);
    });

    it('should succeed even if server does not respond (fire-and-forget)', async () => {
      // V1 is fire-and-forget: success once data is written
      const slowServer = net.createServer(() => {
        // Server accepts but never responds
      });

      await new Promise<void>((resolve) => {
        slowServer.listen(0, '127.0.0.1', resolve);
      });
      const slowPort = (slowServer.address() as net.AddressInfo).port;

      const protocol = new V1Protocol(TEST_KEY_PAIR.publicKey);

      // Should succeed because V1 doesn't wait for response
      await expect(
        protocol.sendVote('127.0.0.1', slowPort, 100, mockVote)
      ).resolves.toBeUndefined();

      slowServer.close();
    });
  });
});

describe('V2Protocol', () => {
  describe('constructor', () => {
    it('should accept a valid token', () => {
      expect(() => new V2Protocol(TEST_TOKEN)).not.toThrow();
    });
  });

  describe('sendVote', () => {
    let server: net.Server;
    let serverPort: number;

    beforeAll(async () => {
      server = net.createServer((socket) => {
        // Generate and send challenge
        const challenge = crypto.randomBytes(16).toString('hex');
        socket.write(`VOTIFIER 2 ${challenge}\n`);

        socket.on('data', (data) => {
          // Parse the framed message
          const magic = data.readUInt16BE(0);
          const length = data.readUInt16BE(2);
          const messageJson = data.subarray(4, 4 + length).toString('utf8');

          expect(magic).toBe(0x733a);

          const message = JSON.parse(messageJson);
          const payload = JSON.parse(message.payload);

          // Verify the signature
          const hmac = crypto.createHmac('sha256', TEST_TOKEN);
          hmac.update(message.payload);
          const expectedSig = hmac.digest('base64');

          if (message.signature === expectedSig && payload.challenge === challenge) {
            socket.write(JSON.stringify({ status: 'ok' }));
          } else {
            socket.write(JSON.stringify({ status: 'error', cause: 'Invalid signature or challenge' }));
          }
          socket.end();
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(() => {
      server.close();
    });

    it('should complete challenge-response handshake', async () => {
      const protocol = new V2Protocol(TEST_TOKEN);
      const result = await protocol.sendVote('127.0.0.1', serverPort, 5000, mockVote);

      expect(result.status).toBe('ok');
    });

    it('should throw ProtocolError for invalid challenge format', async () => {
      const badServer = net.createServer((socket) => {
        socket.write('INVALID CHALLENGE\n');
        socket.end();
      });

      await new Promise<void>((resolve) => {
        badServer.listen(0, '127.0.0.1', resolve);
      });
      const badPort = (badServer.address() as net.AddressInfo).port;

      const protocol = new V2Protocol(TEST_TOKEN);

      await expect(
        protocol.sendVote('127.0.0.1', badPort, 5000, mockVote)
      ).rejects.toThrow(ProtocolError);

      badServer.close();
    });

    it('should throw ConnectionError for unreachable host', async () => {
      const protocol = new V2Protocol(TEST_TOKEN);

      await expect(
        protocol.sendVote('127.0.0.1', 59999, 1000, mockVote)
      ).rejects.toThrow(ConnectionError);
    });
  });
});

describe('VotifierClient', () => {
  describe('V1 client', () => {
    let server: net.Server;
    let serverPort: number;

    beforeAll(async () => {
      server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.end();
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(() => {
      server.close();
    });

    it('should send vote using V1 protocol', async () => {
      const client = new VotifierClient({
        protocol: 'v1',
        host: '127.0.0.1',
        port: serverPort,
        publicKey: TEST_KEY_PAIR.publicKey,
      });

      const result = await client.sendVote(mockVote);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.protocol).toBe('v1');
        expect(result.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return failure with errorType for unreachable host', async () => {
      const client = new VotifierClient({
        protocol: 'v1',
        host: '127.0.0.1',
        port: 59999,
        timeout: 1000,
        publicKey: TEST_KEY_PAIR.publicKey,
      });

      const result = await client.sendVote(mockVote);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('offline');
        expect(result.message).toBeDefined();
      }
    });

    it('should throw CryptoError for invalid key (programming error)', () => {
      expect(() => new VotifierClient({
        protocol: 'v1',
        host: '127.0.0.1',
        port: 8192,
        publicKey: 'invalid-key',
      })).toThrow(CryptoError);
    });

    it('should use default port when not specified', () => {
      const client = new VotifierClient({
        protocol: 'v1',
        host: 'example.com',
        publicKey: TEST_KEY_PAIR.publicKey,
      });

      expect(client).toBeInstanceOf(VotifierClient);
    });
  });

  describe('V2 client', () => {
    let server: net.Server;
    let serverPort: number;

    beforeAll(async () => {
      server = net.createServer((socket) => {
        const challenge = crypto.randomBytes(16).toString('hex');
        socket.write(`VOTIFIER 2 ${challenge}\n`);

        socket.on('data', () => {
          socket.write(JSON.stringify({ status: 'ok' }));
          socket.end();
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(() => {
      server.close();
    });

    it('should send vote using V2 protocol', async () => {
      const client = new VotifierClient({
        protocol: 'v2',
        host: '127.0.0.1',
        port: serverPort,
        token: TEST_TOKEN,
      });

      const result = await client.sendVote(mockVote);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.protocol).toBe('v2');
        expect(result.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return failure with errorType for unreachable host', async () => {
      const client = new VotifierClient({
        protocol: 'v2',
        host: '127.0.0.1',
        port: 59999,
        timeout: 1000,
        token: TEST_TOKEN,
      });

      const result = await client.sendVote(mockVote);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('offline');
        expect(result.message).toBeDefined();
      }
    });

    it('should send multiple votes and collect results', async () => {
      const client = new VotifierClient({
        protocol: 'v2',
        host: '127.0.0.1',
        port: serverPort,
        token: TEST_TOKEN,
      });

      const votes = [
        { ...mockVote, username: 'Player1' },
        { ...mockVote, username: 'Player2' },
      ];

      const results = await client.sendVotes(votes);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});

describe('sendVote static function', () => {
  describe('V1 protocol', () => {
    let server: net.Server;
    let serverPort: number;

    beforeAll(async () => {
      server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.end();
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(() => {
      server.close();
    });

    it('should send vote using V1 protocol', async () => {
      const result = await sendVote({
        server: {
          protocol: 'v1',
          host: '127.0.0.1',
          port: serverPort,
          publicKey: TEST_KEY_PAIR.publicKey,
        },
        vote: mockVote,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.protocol).toBe('v1');
      }
    });

    it('should return failure with errorType for unreachable host', async () => {
      const result = await sendVote({
        server: {
          protocol: 'v1',
          host: '127.0.0.1',
          port: 59999,
          timeout: 1000,
          publicKey: TEST_KEY_PAIR.publicKey,
        },
        vote: mockVote,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('offline');
        expect(result.message).toBeDefined();
      }
    });

    it('should throw CryptoError for invalid key (programming error)', async () => {
      await expect(sendVote({
        server: {
          protocol: 'v1',
          host: '127.0.0.1',
          port: serverPort,
          publicKey: 'invalid-key',
        },
        vote: mockVote,
      })).rejects.toThrow(CryptoError);
    });
  });

  describe('V2 protocol', () => {
    let server: net.Server;
    let serverPort: number;

    beforeAll(async () => {
      server = net.createServer((socket) => {
        const challenge = crypto.randomBytes(16).toString('hex');
        socket.write(`VOTIFIER 2 ${challenge}\n`);

        socket.on('data', () => {
          socket.write(JSON.stringify({ status: 'ok' }));
          socket.end();
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(() => {
      server.close();
    });

    it('should send vote using V2 protocol', async () => {
      const result = await sendVote({
        server: {
          protocol: 'v2',
          host: '127.0.0.1',
          port: serverPort,
          token: TEST_TOKEN,
        },
        vote: mockVote,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.protocol).toBe('v2');
      }
    });

    it('should return failure with errorType for unreachable host', async () => {
      const result = await sendVote({
        server: {
          protocol: 'v2',
          host: '127.0.0.1',
          port: 59999,
          timeout: 1000,
          token: TEST_TOKEN,
        },
        vote: mockVote,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('offline');
        expect(result.message).toBeDefined();
      }
    });

    it('should work with server list iteration pattern', async () => {
      const servers = [
        { protocol: 'v2' as const, host: '127.0.0.1', port: serverPort, token: TEST_TOKEN },
        { protocol: 'v2' as const, host: '127.0.0.1', port: serverPort, token: TEST_TOKEN },
      ];

      const results = await Promise.all(
        servers.map((server) => sendVote({ server, vote: mockVote }))
      );

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should handle mixed success/failure in server list', async () => {
      const servers = [
        { protocol: 'v2' as const, host: '127.0.0.1', port: serverPort, token: TEST_TOKEN },
        { protocol: 'v2' as const, host: '127.0.0.1', port: 59999, timeout: 500, token: TEST_TOKEN },
        { protocol: 'v2' as const, host: '127.0.0.1', port: serverPort, token: TEST_TOKEN },
      ];

      const results = await Promise.all(
        servers.map((server) => sendVote({ server, vote: mockVote }))
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.success).toBe(false);
      if (results[1] && !results[1].success) {
        expect(results[1].errorType).toBe('offline');
      }
      expect(results[2]?.success).toBe(true);
    });
  });
});

describe('Error classes', () => {
  it('should have correct error codes', () => {
    expect(new ConnectionError('test').code).toBe('CONNECTION_ERROR');
    expect(new ProtocolError('test').code).toBe('PROTOCOL_ERROR');
    expect(new CryptoError('test').code).toBe('CRYPTO_ERROR');
    expect(new TimeoutError('test', 1000).code).toBe('TIMEOUT_ERROR');
  });

  it('should preserve cause error', () => {
    const cause = new Error('original');
    const error = new ConnectionError('wrapped', false, cause);
    expect(error.cause).toBe(cause);
  });
});
