import * as crypto from 'node:crypto';
import * as net from 'node:net';
import type { Vote, V2ServerResponse } from '../types.js';
import {
  CryptoError,
  ConnectionError,
  ProtocolError,
  VoteRejectedError,
  TimeoutError,
} from '../errors.js';

/** Magic bytes "s:" (0x733a) */
const MAGIC_HEADER = 0x733a;

/**
 * V2 Protocol: Challenge-response with HMAC-SHA256 signing
 * 1. Receive challenge: "VOTIFIER 2 <challenge>\n"
 * 2. Send framed message: magic(2) + length(2) + JSON{payload, signature}
 * 3. Receive JSON response: { status: "ok" | "error" }
 */
export class V2Protocol {
  private readonly token: Buffer;

  constructor(token: string) {
    this.token = Buffer.from(token, 'utf8');
  }

  async sendVote(
    host: string,
    port: number,
    timeout: number,
    vote: Vote
  ): Promise<V2ServerResponse> {
    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;
      let resolved = false;
      let voteSent = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
      };

      const socket = net.createConnection({ host, port });

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new TimeoutError('V2 vote send', timeout, voteSent));
        }
      }, timeout);

      let buffer = Buffer.alloc(0);
      let challengeReceived = false;

      socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);

        if (!challengeReceived) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex !== -1) {
            const challengeLine = buffer.subarray(0, newlineIndex).toString('utf8');
            buffer = buffer.subarray(newlineIndex + 1);

            try {
              const challenge = this.parseChallenge(challengeLine);
              challengeReceived = true;

              const frame = this.buildVoteFrame(vote, challenge);
              socket.write(frame, (err) => {
                if (err) {
                  if (!resolved) {
                    resolved = true;
                    cleanup();
                    socket.destroy();
                    reject(new ConnectionError('Failed to send vote', true, err));
                  }
                  return;
                }
                voteSent = true;
              });
            } catch (err) {
              resolved = true;
              cleanup();
              socket.destroy();
              reject(err);
            }
          }
        } else {
          try {
            const responseText = buffer.toString('utf8').trim();
            if (responseText) {
              const response = JSON.parse(responseText) as V2ServerResponse;
              resolved = true;
              cleanup();
              socket.end();

              if (response.status === 'ok') {
                resolve(response);
              } else {
                reject(
                  new VoteRejectedError(
                    response.cause || response.error || 'Vote rejected by server',
                    responseText
                  )
                );
              }
            }
          } catch {
            // Incomplete JSON, wait for more data
          }
        }
      });

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new ConnectionError(`Connection failed: ${err.message}`, voteSent, err));
        }
      });

      socket.on('close', () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new ProtocolError('Connection closed before response received'));
        }
      });
    });
  }

  private parseChallenge(line: string): string {
    const parts = line.split(' ');
    if (parts.length < 3) {
      throw new ProtocolError(
        `Invalid V2 challenge format: "${line}". Expected "VOTIFIER 2 <challenge>"`
      );
    }
    return parts.slice(2).join(' ');
  }

  private buildVoteFrame(vote: Vote, challenge: string): Buffer {
    const votePayload: Record<string, string | number> = {
      username: vote.username,
      address: vote.address,
      timestamp: vote.timestamp,
      serviceName: vote.serviceName,
      challenge,
    };
    if (vote.uuid) {
      votePayload.uuid = vote.uuid;
    }
    const voteJson = JSON.stringify(votePayload);

    const signature = this.signPayload(voteJson);

    const message = {
      payload: voteJson,
      signature: signature.toString('base64'),
    };
    const messageJson = JSON.stringify(message);
    const messageBytes = Buffer.from(messageJson, 'utf8');

    const frame = Buffer.alloc(4 + messageBytes.length);
    frame.writeUInt16BE(MAGIC_HEADER, 0);
    frame.writeUInt16BE(messageBytes.length, 2);
    messageBytes.copy(frame, 4);

    return frame;
  }

  private signPayload(payload: string): Buffer {
    try {
      const hmac = crypto.createHmac('sha256', this.token);
      hmac.update(payload);
      return hmac.digest();
    } catch (error) {
      throw new CryptoError(
        'Failed to sign vote payload',
        error instanceof Error ? error : undefined
      );
    }
  }
}
