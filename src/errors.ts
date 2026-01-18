export class VotifierError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'VotifierError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ConnectionError extends VotifierError {
  constructor(
    message: string,
    public readonly dataSent: boolean = false,
    cause?: Error
  ) {
    super(message, 'CONNECTION_ERROR', cause);
    this.name = 'ConnectionError';
  }
}

export class ProtocolError extends VotifierError {
  constructor(message: string, cause?: Error) {
    super(message, 'PROTOCOL_ERROR', cause);
    this.name = 'ProtocolError';
  }
}

export class CryptoError extends VotifierError {
  constructor(message: string, cause?: Error) {
    super(message, 'CRYPTO_ERROR', cause);
    this.name = 'CryptoError';
  }
}

export class ConfigError extends VotifierError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class VoteRejectedError extends VotifierError {
  constructor(
    message: string,
    public readonly serverResponse?: string
  ) {
    super(message, 'VOTE_REJECTED');
    this.name = 'VoteRejectedError';
  }
}

export class TimeoutError extends VotifierError {
  constructor(
    operation: string,
    timeoutMs: number,
    public readonly dataSent: boolean = false
  ) {
    super(
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      'TIMEOUT_ERROR'
    );
    this.name = 'TimeoutError';
  }
}
