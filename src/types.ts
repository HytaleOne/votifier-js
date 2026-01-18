export interface Vote {
  username: string;
  /** IP address of the voter (use "127.0.0.1" if unknown) */
  address: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  serviceName: string;
  /** Player UUID with dashes (optional) */
  uuid?: string;
}

export type VotifierProtocol = 'v1' | 'v2';

export interface BaseConfig {
  host: string;
  /** Default: 8192 */
  port?: number;
  /** Timeout in milliseconds. Default: 5000 */
  timeout?: number;
}

export interface V1Config extends BaseConfig {
  protocol: 'v1';
  /** RSA public key (PEM or base64) */
  publicKey: string;
}

export interface V2Config extends BaseConfig {
  protocol: 'v2';
  /** Shared secret token */
  token: string;
}

export type VotifierConfig = V1Config | V2Config;

export interface VoteSuccess {
  success: true;
  protocol: VotifierProtocol;
  /** Time taken in milliseconds */
  duration: number;
}

export type VoteErrorType =
  | 'offline'     // Server not reachable - safe to retry
  | 'uncertain'   // Vote may have been received - retry with caution
  | 'rejected'    // Server rejected the vote - don't retry
  | 'protocol'    // Invalid response - don't retry (server misconfigured)
  | 'unknown';    // Unexpected error - you decide

export interface VoteFailure {
  success: false;
  errorType: VoteErrorType;
  message: string;
  error: Error;
}

export type VoteResult = VoteSuccess | VoteFailure;

export interface V2ServerResponse {
  status: 'ok' | 'error';
  cause?: string;
  error?: string;
}

export interface VoteWithChallenge extends Vote {
  challenge: string;
}

export interface ResolvedConfig {
  host: string;
  port: number;
  timeout: number;
}

export interface SendVoteOptions {
  server: VotifierConfig;
  vote: Vote;
}
