// Public surface of the Teeter Tower game package (spec 0044 - live physics).

export {
  createTeeterTowerGame,
  teeterTowerPlugin,
  validateConfig,
  TEETER_TOWER_GAME_ID,
  type TeeterConfig,
} from './teeter-tower';
export { LEVELS, levelAt, TOTAL_ROUNDS, type Level } from './levels';
export {
  makePiece,
  pieceForIndex,
  createWorld,
  stepWorld,
  addPieceToWorld,
  evaluatePlacement,
  requiredDropHeight,
  overlapsScene,
  worldHeight,
  heightToScore,
  toBodyPayloads,
  toStoredBodies,
  toPiecePayload,
  storedPieceFrom,
  clampDropX,
  clampDropY,
  MAX_PLACED_BODIES,
  heldBodyAt,
  STEP_MS,
  SUBSTEPS_PER_TICK,
  type LiveWorld,
  type StoredBody,
  type StoredPiece,
} from './physics';
export { createRng, deriveSeed, type SeededRng } from './rng';
export type { Vec2, Eye, Skin, Body, Piece, TeeterMove, TeeterSim } from './types';
