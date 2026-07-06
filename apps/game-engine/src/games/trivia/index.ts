// Public surface of the Trivia game module (spec 0008).

export {
  createTriviaGame,
  validateConfig,
  TRIVIA_GAME_ID,
  CONFIGURABLE_CATEGORIES,
  DISPUTE_WINDOW_MS,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  type TriviaConfig,
  type ResolvedTriviaConfig,
} from './trivia';
export { normalizeAnswer, isCorrectAnswer, levenshtein, FUZZY_MIN_LENGTH } from './matching';
export {
  blendWeights,
  sampleTier,
  isValidDifficulty,
  tiersByProximity,
  TIERS,
  MIN_DIFFICULTY,
  MAX_DIFFICULTY,
  DEFAULT_DIFFICULTY,
} from './difficulty';
export { indexQuestions, pickQuestion, RANDOM_CATEGORY, type QuestionIndex } from './selection';
