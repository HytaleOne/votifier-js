import type { Vote, VotifierConfig, VoteResult, VoteFailure, ResolvedConfig, SendVoteOptions } from './types.js';
import { V1Protocol } from './protocols/v1.js';
import { V2Protocol } from './protocols/v2.js';
import { ConnectionError, TimeoutError, ProtocolError, VoteRejectedError } from './errors.js';

const DEFAULTS = {
  port: 8192,
  timeout: 5000,
} as const;

function toFailure(error: unknown): VoteFailure {
  if (error instanceof ConnectionError) {
    return {
      success: false,
      errorType: error.dataSent ? 'uncertain' : 'offline',
      message: error.message,
      error,
    };
  }
  if (error instanceof TimeoutError) {
    return {
      success: false,
      errorType: error.dataSent ? 'uncertain' : 'offline',
      message: error.message,
      error,
    };
  }
  if (error instanceof ProtocolError) {
    return { success: false, errorType: 'protocol', message: error.message, error };
  }
  if (error instanceof VoteRejectedError) {
    return { success: false, errorType: 'rejected', message: error.message, error };
  }
  const err = error instanceof Error ? error : new Error(String(error));
  return { success: false, errorType: 'unknown', message: err.message, error: err };
}

/**
 * Votifier client for sending votes to a server.
 *
 * @example
 * const client = new VotifierClient({
 *   protocol: 'v2',
 *   host: 'minecraft.example.com',
 *   port: 8192,
 *   token: 'your-secret-token',
 * });
 *
 * const result = await client.sendVote({
 *   username: 'PlayerName',
 *   serviceName: 'MyVotingSite',
 *   address: '127.0.0.1',
 *   timestamp: Date.now(),
 * });
 *
 * @throws {CryptoError} If the public key is invalid (V1 only)
 */
export class VotifierClient {
  private readonly config: ResolvedConfig;
  private readonly protocol: V1Protocol | V2Protocol;
  private readonly protocolVersion: 'v1' | 'v2';

  constructor(config: VotifierConfig) {
    this.config = this.resolveConfig(config);
    this.protocolVersion = config.protocol;

    if (config.protocol === 'v1') {
      this.protocol = new V1Protocol(config.publicKey);
    } else {
      this.protocol = new V2Protocol(config.token);
    }
  }

  async sendVote(vote: Vote): Promise<VoteResult> {
    const startTime = Date.now();

    try {
      await this.protocol.sendVote(
        this.config.host,
        this.config.port,
        this.config.timeout,
        vote
      );

      return {
        success: true,
        protocol: this.protocolVersion,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return toFailure(error);
    }
  }

  async sendVotes(votes: Vote[]): Promise<VoteResult[]> {
    const results: VoteResult[] = [];
    for (const vote of votes) {
      results.push(await this.sendVote(vote));
    }
    return results;
  }

  private resolveConfig(config: VotifierConfig): ResolvedConfig {
    return {
      host: config.host,
      port: config.port ?? DEFAULTS.port,
      timeout: config.timeout ?? DEFAULTS.timeout,
    };
  }
}

/**
 * Send a vote to a server (one-off, no client instance needed).
 *
 * @example
 * const result = await sendVote({
 *   server: {
 *     protocol: 'v2',
 *     host: 'minecraft.example.com',
 *     port: 8192,
 *     token: 'your-secret-token',
 *   },
 *   vote: {
 *     username: 'PlayerName',
 *     serviceName: 'MyVotingSite',
 *     address: '127.0.0.1',
 *     timestamp: Date.now(),
 *   },
 * });
 *
 * @throws {CryptoError} If the public key is invalid (V1 only)
 */
export async function sendVote(options: SendVoteOptions): Promise<VoteResult> {
  const { server, vote } = options;
  const startTime = Date.now();

  const config: ResolvedConfig = {
    host: server.host,
    port: server.port ?? DEFAULTS.port,
    timeout: server.timeout ?? DEFAULTS.timeout,
  };

  let protocol: V1Protocol | V2Protocol;
  if (server.protocol === 'v1') {
    protocol = new V1Protocol(server.publicKey);
  } else {
    protocol = new V2Protocol(server.token);
  }

  try {
    await protocol.sendVote(config.host, config.port, config.timeout, vote);

    return {
      success: true,
      protocol: server.protocol,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return toFailure(error);
  }
}
