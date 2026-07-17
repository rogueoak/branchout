// Public surface of the Nightleaf game package (spec 0060 - cooperative live ascending-number game).

export {
  createNightleafGame,
  nightleafPlugin,
  validateConfig,
  NIGHTLEAF_GAME_ID,
  type ResolvedNightleafConfig,
} from './nightleaf';
export {
  MIN_TIERS,
  MAX_TIERS,
  DEFAULT_TIERS,
  MIN_BUDS,
  MAX_BUDS,
  DEFAULT_BUDS,
  MIN_FIREFLIES,
  MAX_FIREFLIES,
  DEFAULT_FIREFLIES,
  MAX_LEAF,
  type NightleafConfig,
} from './config';
export { dealTier, drawDistinct, ascending } from './deal';
export { createRng, deriveSeed, type SeededRng } from './rng';
export type {
  HandSummary,
  NightleafHand,
  NightleafMove,
  NightleafPhase,
  NightleafSim,
} from './types';
