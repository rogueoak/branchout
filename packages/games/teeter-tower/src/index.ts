// Public surface of the Teeter Tower game package (spec 0043).

export {
  createTeeterTowerGame,
  teeterTowerPlugin,
  validateConfig,
  TEETER_TOWER_GAME_ID,
  DISPUTE_WINDOW_MS,
  type TeeterConfig,
} from './teeter-tower';
export { LEVELS, TOTAL_ROUNDS, type Level } from './levels';
export {
  makePiece,
  simulateDrop,
  buildWorld,
  evaluatePlacement,
  requiredDropHeight,
  overlapsScene,
  towerHeight,
  storedTowerHeight,
  heightToScore,
  toBodyPayloads,
  STEP_MS,
  TRACK_EVERY,
  MAX_STEPS,
  CALM_SPEED,
  CALM_STEPS,
  type StoredBody,
} from './physics';
export { createRng, deriveSeed, type SeededRng } from './rng';
export type {
  Vec2,
  Eye,
  Skin,
  Body,
  Piece,
  Frame,
  TeeterPrompt,
  TeeterMove,
  TeeterReveal,
} from './types';
