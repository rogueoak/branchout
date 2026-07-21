// Public surface of the Sketchy game package (spec 0063).

export {
  sketchyPlugin,
  createSketchyGame,
  stageForRound,
  SKETCHY_GAME_ID,
  DRAW_WINDOW_MS,
  DECOY_WINDOW_MS,
  GUESS_WINDOW_MS,
  CORRECT_POINTS,
  FOOL_POINTS,
  type SketchyOption,
  type Stage,
  type Sketch,
} from './sketchy';
export {
  validateConfig,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_ADVANCE_AFTER_SECONDS,
  MIN_ADVANCE_AFTER_SECONDS,
  MAX_ADVANCE_AFTER_SECONDS,
  type SketchyConfig,
  type ResolvedSketchyConfig,
} from './config';
export {
  loadSeedBank,
  validateSeedBank,
  CATEGORIES,
  type SketchySeed,
  type SketchyCategory,
} from './seeds';
export {
  CANVAS_SIZE,
  MAX_STROKES,
  MAX_POINTS_PER_STROKE,
  MAX_TOTAL_POINTS,
  emptySketch,
  isDrawn,
  serializeSketch,
  parseSketch,
  type Stroke,
} from './strokes';
export { normalizeAnswer, sameAnswer } from './matching';
