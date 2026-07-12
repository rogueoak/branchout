import { describe, expect, it } from 'vitest';
import { CENTER_X, DROP_HALF_RANGE, GROUND_TOP, PLATFORM_W, VIEW_H, VIEW_W } from './render';
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
