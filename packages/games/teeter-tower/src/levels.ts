// Levels and world constants, ported from the prototype (../prototypes/teeter-tower/game.js).
// World coordinates: y increases downward; the tower grows up (toward smaller y).

import type { Skin } from './types';

export const VIEW_W = 820;
export const VIEW_H = 620;
/** y of the platform's top surface. */
export const GROUND_TOP = 540;
export const PLATFORM_W = 480;
export const PLATFORM_H = 60;
export const CENTER_X = VIEW_W / 2; // 410
/** Pieces that fall past this world-y are culled (lost off the bottom). */
export const DEATH_Y = GROUND_TOP + 260;

// Grip and fall tuning, ported verbatim from the prototype. Matter's friction saturates near 1.0,
// so stability comes from stable piece shapes + soft landings, not big numbers here.
export const PIECE_FRICTION = 1.0;
export const PIECE_FRICTION_STATIC = 6;
export const PIECE_FRICTION_AIR = 0.03;
export const PIECE_DENSITY = 0.0016;
/** Caps drop velocity so a piece can't slam the tower off center. */
export const MAX_FALL_SPEED = 9;

/** The default horizontal drop half-range beyond the platform's own half-width (px each side). */
export const DROP_EDGE_MARGIN = 90;
/** The horizontal half-range (from center) a drop position may occupy on the DEFAULT platform. */
export const DROP_HALF_RANGE = PLATFORM_W / 2 + DROP_EDGE_MARGIN;
/** Spawn height above the platform top for a freshly spun piece. */
export const SPAWN_Y = 100;

/** Side-wall geometry for a walled (level 1) platform: short, thin, high-friction curbs. */
export const WALL_THICKNESS = 18;
export const WALL_HEIGHT = 70;

/**
 * Level 1's near-full-width platform (px). Wider than the default PLATFORM_W (480) and close to the
 * VIEW_W (820) frame, so the warm-up gives pieces room to land; it also drives the drop-x clamp and the
 * side-wall placement for the walled level.
 */
export const WIDE_PLATFORM_W = 760;

/**
 * A level definition: target height (px above the platform), piece budget, optional pendulum, and the
 * platform config (its width + whether it has side walls). Level 1 is a wide, walled warm-up so pieces
 * do not slide off; levels 2/3 keep the narrower open platform.
 */
export interface Level {
  name: string;
  target: number;
  pieces: number;
  pendulum: boolean;
  /** The platform's width (px). Level 1 is near-full-width; levels 2/3 use PLATFORM_W. */
  platformWidth: number;
  /** Whether the platform has short static side walls (level 1 only). */
  walls: boolean;
}

export const LEVELS: readonly Level[] = [
  // Level 1's target is 450 (feedback 0023: 25% lower than the old 600) for an easier warm-up, on a
  // near-full-width walled platform so pieces do not slide off the edges. Levels 2/3 keep the narrower
  // open platform and the prototype's 620 target.
  {
    name: 'Warm-up',
    target: 450,
    pieces: 11,
    pendulum: false,
    platformWidth: WIDE_PLATFORM_W,
    walls: true,
  },
  {
    name: 'Reach for the sky',
    target: 620,
    pieces: 20,
    pendulum: false,
    platformWidth: PLATFORM_W,
    walls: false,
  },
  {
    name: 'The Pendulum',
    target: 620,
    pieces: 22,
    pendulum: true,
    platformWidth: PLATFORM_W,
    walls: false,
  },
];

/** The horizontal drop half-range for a level's platform: half its width plus the edge margin. */
export function dropHalfRangeForWidth(platformWidth: number): number {
  return platformWidth / 2 + DROP_EDGE_MARGIN;
}

/** The level for a given level index, clamped to the last level. */
export function levelAt(index: number): Level {
  const level = LEVELS[Math.min(index, LEVELS.length - 1)];
  // LEVELS is non-empty; narrow for noUncheckedIndexedAccess.
  return level as Level;
}

/**
 * Total pieces across every level - the engine's total round count. NOTE: v1 has no fail state on
 * purpose. Each level's `pieces` budget is NOT enforced as an "out of pieces" loss - a level ends
 * only on reaching its target - so this is simply the fixed round count the game plays through. An
 * out-of-pieces / retry lose path (the prototype has one) is a deliberate follow-up.
 */
export const TOTAL_ROUNDS = LEVELS.reduce((sum, level) => sum + level.pieces, 0);

export const PALETTE: readonly Skin[] = [
  { fill: '#ef476f', stroke: '#b52c4d' },
  { fill: '#ffd166', stroke: '#c9a12b' },
  { fill: '#06d6a0', stroke: '#049e77' },
  { fill: '#118ab2', stroke: '#0b6484' },
  { fill: '#f78c6b', stroke: '#c96545' },
  { fill: '#c77dff', stroke: '#9247d6' },
];
