// Public surface of the Same Branch game package.

export {
  sameBranchPlugin,
  createSameBranchGame,
  readerFor,
  SAME_BRANCH_GAME_ID,
  MOVE_WINDOW_MS,
  type SameBranchGuess,
} from './same-branch';
export {
  validateConfig,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  MIN_CATEGORIES,
  MAX_CATEGORIES,
  RANDOM,
  MODES,
  DEFAULT_MODE,
  type SameBranchConfig,
  type ResolvedSameBranchConfig,
  type SameBranchMode,
} from './config';
export {
  loadSpectrumBank,
  validateSpectrumBank,
  CATEGORIES,
  type Spectrum,
  type SpectrumCategory,
} from './spectrums';
export {
  scoreGuess,
  bandLabel,
  clampToBranch,
  BRANCH_MIN,
  BRANCH_MAX,
  BULLSEYE_POINTS,
  BULLSEYE_RADIUS,
  NEAR_POINTS,
  NEAR_RADIUS,
  FAR_POINTS,
  FAR_RADIUS,
  MISS_POINTS,
} from './scoring';
