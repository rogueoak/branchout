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

/** The horizontal half-range (from center) a drop position may occupy. */
export const DROP_HALF_RANGE = PLATFORM_W / 2 + 90;
/** Spawn height above the platform top for a freshly spun piece. */
export const SPAWN_Y = 100;

/** A level definition: target height (px above the platform), piece budget, optional pendulum. */
export interface Level {
  name: string;
  target: number;
  pieces: number;
  pendulum: boolean;
}

export const LEVELS: readonly Level[] = [
  { name: 'Warm-up', target: 300, pieces: 11, pendulum: false },
  { name: 'Reach for the sky', target: 620, pieces: 20, pendulum: false },
  { name: 'The Pendulum', target: 620, pieces: 22, pendulum: true },
];

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
