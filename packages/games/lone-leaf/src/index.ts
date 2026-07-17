// Public surface of the Lone Leaf game package (spec 0057).

export {
  loneLeafPlugin,
  createLoneLeafGame,
  seekerForRound,
  wiltLeaves,
  LONE_LEAF_GAME_ID,
  SUBMIT_WINDOW_MS,
  GUESS_WINDOW_MS,
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
