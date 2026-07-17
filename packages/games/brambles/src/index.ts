// Public entry for the Brambles game package (spec 0061): the plugin the engine registers, plus the
// types and helpers the web UI and tests share.

export {
  bramblesPlugin,
  createBramblesGame,
  BRAMBLES_GAME_ID,
  TICK_MS,
  TEAM_NAMES,
} from './brambles';
export {
  validateConfig,
  DEFAULT_SPRINTS,
  DEFAULT_SPRINT_SECONDS,
  MIN_SPRINTS,
  MAX_SPRINTS,
  MIN_SPRINT_SECONDS,
  MAX_SPRINT_SECONDS,
  type BramblesConfig,
  type ResolvedBramblesConfig,
} from './config';
export {
  loadCardBank,
  validateCardBank,
  CATEGORIES,
  THORNS_PER_CARD,
  type BramblesCard,
  type BramblesCategory,
} from './cards';
export {
  assignTeams,
  activeTeamForSprint,
  guideOf,
  teamStandings,
  teamScoreEvents,
  type TeamId,
  type TeamAssignment,
} from './teams';
export {
  findPrick,
  isGuessMatch,
  normalize,
  tokenize,
  stem,
  sameStem,
  editDistance,
} from './matching';
export type {
  BramblesMove,
  BramblesSim,
  BramblesSecret,
  BramblesLogEntry,
  TeamIndex,
} from './types';
