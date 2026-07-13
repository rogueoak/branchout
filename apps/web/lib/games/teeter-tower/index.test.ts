import { describe, expect, it } from 'vitest';
import { teeterTowerGameUi, TEETER_TOTAL_ROUNDS } from './index';
import {
  GAME_UI_LIST,
  INSIDER_GAME_UI_LIST,
  gamesForViewer,
  getGameUi,
  isPublicGame,
} from '../registry';

describe('teeterTowerGameUi module', () => {
  it('is registered and insider-only', () => {
    expect(getGameUi('teeter-tower')).toBe(teeterTowerGameUi);
    expect(teeterTowerGameUi.visibility).toBe('insider');
    expect(isPublicGame(teeterTowerGameUi)).toBe(false);
  });

  it('is a single-surface game (the viewer is the whole interactive surface)', () => {
    expect(teeterTowerGameUi.singleSurface).toBe(true);
    // The Remote is an unused null no-op for a single-surface game, but still a valid component.
    expect(typeof teeterTowerGameUi.Remote).toBe('function');
  });

  it('has a brand mark, tagline, and one-line summary', () => {
    expect(teeterTowerGameUi.icon).toContain('<svg');
    expect(teeterTowerGameUi.tagline.length).toBeGreaterThan(0);
    expect(teeterTowerGameUi.summary.length).toBeGreaterThan(40);
  });

  it('defaults an empty config, always validates, and runs the engine round count', () => {
    expect(teeterTowerGameUi.defaultConfig()).toEqual({});
    expect(teeterTowerGameUi.validateConfig({})).toEqual({ ok: true });
    expect(teeterTowerGameUi.validateConfig(undefined)).toEqual({ ok: true });
    expect(teeterTowerGameUi.roundsOf({})).toBe(TEETER_TOTAL_ROUNDS);
    // 11 + 20 + 22 across the three levels.
    expect(TEETER_TOTAL_ROUNDS).toBe(53);
  });
});

describe('insider visibility filtering (spec 0043)', () => {
  it('gamesForViewer(true) includes Teeter; (false) excludes it', () => {
    const insiderIds = gamesForViewer(true).map((m) => m.id);
    const publicIds = gamesForViewer(false).map((m) => m.id);
    expect(insiderIds).toContain('teeter-tower');
    expect(publicIds).not.toContain('teeter-tower');
    // Public games (trivia, liar-liar) are visible to everyone.
    expect(publicIds).toContain('trivia');
    expect(insiderIds).toContain('trivia');
  });

  it('an insider sees at least as many games as a non-insider', () => {
    expect(gamesForViewer(true).length).toBeGreaterThanOrEqual(gamesForViewer(false).length);
    // Every game the non-insider sees is public.
    expect(gamesForViewer(false).every(isPublicGame)).toBe(true);
  });

  it('INSIDER_GAME_UI_LIST is exactly the insider-only games', () => {
    expect(INSIDER_GAME_UI_LIST.map((m) => m.id)).toContain('teeter-tower');
    expect(INSIDER_GAME_UI_LIST.every((m) => !isPublicGame(m))).toBe(true);
    // Together they partition the full list.
    expect(gamesForViewer(false).length + INSIDER_GAME_UI_LIST.length).toBe(GAME_UI_LIST.length);
  });
});
