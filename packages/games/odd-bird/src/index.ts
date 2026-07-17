// Public surface of the Odd Bird game package.

export {
  oddBirdPlugin,
  createOddBirdGame,
  ODD_BIRD_GAME_ID,
  QUESTION_WINDOW_MS,
  FLUSH_WINDOW_MS,
  FLOCK_WIN_POINTS,
  SURVIVE_POINTS,
  GUESS_POINTS,
  ROOST_GUESS_PREFIX,
  type PrivateCard,
  type RoostOption,
} from './odd-bird';
export {
  validateConfig,
  MIN_CATEGORIES,
  MAX_CATEGORIES,
  RANDOM,
  type OddBirdConfig,
  type ResolvedOddBirdConfig,
} from './config';
export {
  loadRoostBank,
  validateRoostBank,
  CATEGORIES,
  MAX_PLAYERS,
  MIN_PERCHES,
  type OddBirdRoost,
  type OddBirdCategory,
} from './roosts';
