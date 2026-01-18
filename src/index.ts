export { VotifierClient, sendVote } from './client.js';

export type {
  Vote,
  VotifierConfig,
  V1Config,
  V2Config,
  VotifierProtocol,
  VoteResult,
  VoteSuccess,
  VoteFailure,
  VoteErrorType,
  V2ServerResponse,
  SendVoteOptions,
} from './types.js';

export {
  VotifierError,
  ConnectionError,
  ProtocolError,
  CryptoError,
  ConfigError,
  VoteRejectedError,
  TimeoutError,
} from './errors.js';

export { V1Protocol } from './protocols/v1.js';
export { V2Protocol } from './protocols/v2.js';
