// Public surface of the Whispergrove game package (spec 0062 - a two-team word-grid deduction game).

export {
  createWhispergroveGame,
  whispergrovePlugin,
  validateConfig,
  standingsFor,
  assignSeats,
  whispererOf,
  otherTeam,
  dealKey,
  pickWords,
  parseMove,
  WHISPERGROVE_GAME_ID,
  GRID_SIZE,
  START_TEAM_LEAVES,
  OTHER_TEAM_LEAVES,
  SAPLING_LEAVES,
  DEADWOOD_LEAVES,
  type WhispergroveConfig,
} from './whispergrove';
export {
  loadWordBank,
  validateWordCategory,
  isSingleToken,
  CATEGORIES,
  type WhispergroveCategory,
  type WordEntry,
} from './words';
export { defaultConfig } from './config';
export type {
  Team,
  LeafRole,
  SeatRole,
  PublicLeaf,
  Whisper,
  WhispergroveSim,
  WhispergrovePhase,
  WhispergroveEndReason,
  SeatAssignment,
  WhispererSecret,
  WhispergroveMove,
} from './types';
