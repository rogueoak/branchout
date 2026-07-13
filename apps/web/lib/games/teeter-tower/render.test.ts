import { describe, expect, it } from 'vitest';
import {
  CENTER_X,
  DROP_HALF_RANGE,
  GROUND_TOP,
  PLATFORM_W,
  VIEW_H,
  VIEW_W,
  levelView,
  visibleLeftX,
} from './render';
import { TEETER_TOTAL_ROUNDS } from './index';

// The browser is a pure renderer that mirrors the engine's world constants by hand (the web bundle
// deliberately does NOT depend on the headless physics package @branchout/game-teeter-tower - see the
// note in index.ts). This guard pins the mirrored constants to the engine's source-of-truth values so
// a drift is caught here instead of as a subtly wrong on-screen coordinate space.
//
// Source of truth: packages/games/teeter-tower/src/levels.ts (world constants) and TOTAL_ROUNDS.
describe('render world constants mirror the engine (packages/games/teeter-tower/src/levels.ts)', () => {
  it('matches the engine VIEW/GROUND/CENTER/platform constants', () => {
    expect(VIEW_W).toBe(820);
    expect(VIEW_H).toBe(620);
    expect(GROUND_TOP).toBe(540);
    expect(PLATFORM_W).toBe(480);
    expect(CENTER_X).toBe(410); // VIEW_W / 2
    expect(DROP_HALF_RANGE).toBe(PLATFORM_W / 2 + 90); // 330
  });

  it('matches the engine TOTAL_ROUNDS (11 + 20 + 22 piece budgets)', () => {
    expect(TEETER_TOTAL_ROUNDS).toBe(53);
  });
});

// The renderer fits the CURRENT LEVEL's height (platform -> above the target line) into the canvas,
// centered horizontally at a uniform scale, so the tower fills the vertical space with no camera pan.
// These pin the mapping the draw loop and pointer mapping share, keeping the coordinate space consistent.
describe('fit-level view mapping', () => {
  it('maps the top edge to screen 0 and the bottom edge to the canvas height', () => {
    const v = levelView(390, 700, 600);
    expect(v.top * v.scale + v.originY).toBeCloseTo(0);
    expect(v.bottom * v.scale + v.originY).toBeCloseTo(700);
  });

  it('centers the world horizontally (world CENTER_X -> canvas mid)', () => {
    const v = levelView(390, 700, 600);
    expect(CENTER_X * v.scale + v.originX).toBeCloseTo(390 / 2);
  });

  it('scales the level UP as the canvas gets taller (fills the vertical space)', () => {
    const short = levelView(390, 400, 600);
    const tall = levelView(390, 800, 600);
    expect(tall.scale).toBeGreaterThan(short.scale);
  });

  it('visibleLeftX is the world x at the left canvas edge', () => {
    const v = levelView(390, 700, 600);
    expect(visibleLeftX(v) * v.scale + v.originX).toBeCloseTo(0);
  });
});
