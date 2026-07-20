// Public surface of the Lone Leaf game package (spec 0057).

export {
  loneLeafPlugin,
  createLoneLeafGame,
  seekerForRound,
  wiltLeaves,
  LONE_LEAF_GAME_ID,
  BANK_POINTS,
  type LeafResult,
} from './lone-leaf';
export {
  validateConfig,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  MIN_CATEGORIES,
  MAX_CATEGORIES,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_ADVANCE_AFTER_SECONDS,
  MIN_ADVANCE_AFTER_SECONDS,
  MAX_ADVANCE_AFTER_SECONDS,
  DEFAULT_CLUE_SECONDS,
  DEFAULT_GUESS_SECONDS,
  MIN_ROUND_SECONDS,
  MAX_ROUND_SECONDS,
  RANDOM,
  type LoneLeafConfig,
  type ResolvedLoneLeafConfig,
} from './config';
export {
  loadSeedBank,
  validateSeedBank,
  CATEGORIES,
  type LoneLeafSeed,
  type LoneLeafCategory,
} from './seeds';
export { normalizeLeaf, stemLeaf, leafKey, sameLeaf, isSingleWord } from './matching';
