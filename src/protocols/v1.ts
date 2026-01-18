import * as crypto from 'node:crypto';
import * as net from 'node:net';
import type { Vote } from '../types.js';
import { CryptoError, ConnectionError, TimeoutError } from '../errors.js';

/**
 * V1 Protocol: Connect → Send RSA-encrypted vote → Close
 * Message format: "VOTE\n<service>\n<user>\n<addr>\n<timestamp>\n"
 * Encryption: RSA with PKCS#1 v1.5 padding
 */
export class V1Protocol {
  private readonly publicKey: crypto.KeyObject;

  constructor(publicKeyInput: string) {
    try {
      const normalizedKey = this.normalizePublicKey(publicKeyInput);
      this.publicKey = crypto.createPublicKey(normalizedKey);
    } catch (error) {
      throw new CryptoError(
        'Invalid RSA public key format',
        error instanceof Error ? error : undefined
      );
    }
  }

  async sendVote(
    host: string,
    port: number,
    timeout: number,
    vote: Vote
  ): Promise<void> {
    const message = this.formatVoteMessage(vote);
    const encrypted = this.encryptMessage(message);

    await this.sendEncryptedVote(host, port, timeout, encrypted);
  }

  private formatVoteMessage(vote: Vote): string {
    return [
      'VOTE',
      vote.serviceName,
      vote.username,
      vote.address,
      vote.timestamp.toString(),
      '',
    ].join('\n');
  }

  private encryptMessage(message: string): Buffer {
    try {
      return crypto.publicEncrypt(
        {
          key: this.publicKey,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(message, 'utf8')
      );
    } catch (error) {
      throw new CryptoError(
        'Failed to encrypt vote message',
        error instanceof Error ? error : undefined
      );
    }
  }

  private async sendEncryptedVote(
    host: string,
    port: number,
    timeout: number,
    data: Buffer
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
      };

      const socket = net.createConnection({ host, port }, () => {
        socket.write(data, (err) => {
          if (err) {
            if (!resolved) {
              resolved = true;
              cleanup();
              socket.destroy();
              reject(new ConnectionError('Failed to send vote data', true, err));
            }
            return;
          }
          // V1 is fire-and-forget: once data is written, we're done
          resolved = true;
          cleanup();
          socket.end();
          resolve();
        });
      });

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new TimeoutError('V1 vote send', timeout, false));
        }
      }, timeout);

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new ConnectionError(`Connection failed: ${err.message}`, false, err));
        }
      });
    });
  }

  private normalizePublicKey(input: string): string {
    if (input.includes('-----BEGIN')) {
      return input;
    }

    // Base64 keys may have spaces instead of +
    let cleaned = input.replace(/ /g, '+');
    cleaned = cleaned.replace(/[\r\n]/g, '');

    const lines: string[] = [];
    for (let i = 0; i < cleaned.length; i += 64) {
      lines.push(cleaned.slice(i, i + 64));
    }

    return [
      '-----BEGIN PUBLIC KEY-----',
      ...lines,
      '-----END PUBLIC KEY-----',
    ].join('\n');
  }
}
