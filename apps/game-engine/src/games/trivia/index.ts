// Public surface of the Trivia game module (spec 0008).

export {
  createTriviaGame,
  triviaPlugin,
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
  isValidDifficultyBound,
  isValidDifficultyRange,
  MIN_DIFFICULTY,
  MAX_DIFFICULTY,
  DEFAULT_DIFFICULTY_MIN,
  DEFAULT_DIFFICULTY_MAX,
} from './difficulty';
export { indexQuestions, pickQuestion, RANDOM_CATEGORY, type QuestionIndex } from './selection';
export {
  loadQuestionBank,
  validateQuestionBank,
  CATEGORIES,
  DIFFICULTY_MIN,
  DIFFICULTY_MAX,
  type TriviaQuestion,
} from './question-bank';
