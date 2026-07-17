import { describe, expect, it } from 'vitest';
import { nightleafGameUi } from './index';
import { DEFAULT_TIERS } from './config';
import { gamesForViewer, getGameUi, INSIDER_GAME_UI_LIST, isPublicGame } from '../registry';

describe('nightleafGameUi module', () => {
  it('is registered and insider-only', () => {
    expect(getGameUi('nightleaf')).toBe(nightleafGameUi);
    expect(nightleafGameUi.visibility).toBe('insider');
    expect(isPublicGame(nightleafGameUi)).toBe(false);
  });

  it('is a multi-surface game (a shared viewer plus a private per-player remote)', () => {
    // NOT single-surface: each player has a secret hand shown on their own Remote controller.
    expect(nightleafGameUi.singleSurface).toBeFalsy();
    expect(typeof nightleafGameUi.Viewer).toBe('function');
    expect(typeof nightleafGameUi.Remote).toBe('function');
  });

  it('has a brand mark, tagline, and one-line summary', () => {
    expect(nightleafGameUi.icon).toContain('<svg');
    // The single gold root the whole family carries.
    expect(nightleafGameUi.icon).toContain('#d2a463');
    expect(nightleafGameUi.tagline.length).toBeGreaterThan(0);
    expect(nightleafGameUi.summary.length).toBeGreaterThan(40);
  });

  it('defaults + validates config and derives the round count from tiers', () => {
    expect(nightleafGameUi.defaultConfig()).toEqual({ tiers: 4, buds: 3, fireflies: 1 });
    expect(nightleafGameUi.validateConfig({ tiers: 4, buds: 3, fireflies: 1 })).toEqual({
      ok: true,
    });
    expect(nightleafGameUi.validateConfig({ tiers: 0, buds: 3, fireflies: 1 }).ok).toBe(false);
    expect(nightleafGameUi.roundsOf({ tiers: 6, buds: 3, fireflies: 1 })).toBe(6);
    expect(nightleafGameUi.roundsOf(undefined)).toBe(DEFAULT_TIERS);
  });
});

describe('insider visibility filtering (spec 0043)', () => {
  it('an insider sees Nightleaf; a non-insider does not', () => {
    const insiderIds = gamesForViewer(true).map((m) => m.id);
    const publicIds = gamesForViewer(false).map((m) => m.id);
    expect(insiderIds).toContain('nightleaf');
    expect(publicIds).not.toContain('nightleaf');
  });

  it('Nightleaf is in the insider-only list', () => {
    expect(INSIDER_GAME_UI_LIST.map((m) => m.id)).toContain('nightleaf');
  });
});
