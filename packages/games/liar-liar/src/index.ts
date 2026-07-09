// Public surface of the Liar Liar game package (spec 0021).

export {
  liarLiarPlugin,
  createLiarLiarGame,
  LIAR_LIAR_GAME_ID,
  SUBMIT_WINDOW_MS,
  GUESS_WINDOW_MS,
  CORRECT_POINTS,
  FOOL_POINTS,
  type LiarLiarOption,
} from './liar-liar';
export {
  validateConfig,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  MIN_CATEGORIES,
  MAX_CATEGORIES,
  RANDOM,
  type LiarLiarConfig,
  type ResolvedLiarLiarConfig,
} from './config';
export {
  loadClueBank,
  validateClueBank,
  CATEGORIES,
  type LiarLiarClue,
  type LiarLiarCategory,
} from './clues';
export { normalizeAnswer, sameAnswer } from './matching';
