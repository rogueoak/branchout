// Public surface of the Zinger game package (spec 0053).

export {
  zingerPlugin,
  createZingerGame,
  ZINGER_GAME_ID,
  ANSWER_WINDOW_MS,
  VOTE_WINDOW_MS,
  POINTS_PER_VOTE,
  CLEAN_SWEEP_BONUS,
  MIN_SWEEP_VOTERS,
  type ZingerOption,
} from './zinger';
export {
  validateConfig,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  type ZingerConfig,
  type ResolvedZingerConfig,
} from './config';
export { loadPromptBank, validatePromptBank, PROMPTS_FILE, type ZingerPrompt } from './prompts';
