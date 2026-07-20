// Public surface of the Trivia game module (spec 0008).

export {
  createTriviaGame,
  triviaPlugin,
  validateConfig,
  TRIVIA_GAME_ID,
  CONFIGURABLE_CATEGORIES,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_ADVANCE_AFTER_SECONDS,
  MIN_ADVANCE_AFTER_SECONDS,
  MAX_ADVANCE_AFTER_SECONDS,
  DEFAULT_TIME_LIMIT_SECONDS,
  MIN_TIME_LIMIT_SECONDS,
  MAX_TIME_LIMIT_SECONDS,
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
