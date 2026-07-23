import { describe, expect, it } from 'vitest';
import { checkersGameUi, CHECKERS_ROUNDS } from './index';
import { GAME_UI_LIST, gamesForViewer, getGameUi, isPublicGame } from '../registry';
import { GAME_CATEGORIES, GAME_TAGS, getLibraryEntry } from '../library';
import { GAME_CATALOG, PUBLIC_GAME_CATALOG } from '../catalog';

describe('checkersGameUi module', () => {
  it('is registered and public (WS14: graduated from insider)', () => {
    expect(getGameUi('checkers')).toBe(checkersGameUi);
    expect(checkersGameUi.visibility).toBe('public');
    expect(isPublicGame(checkersGameUi)).toBe(true);
  });

  it('is a single-surface game (the board viewer is the whole interactive surface)', () => {
    expect(checkersGameUi.singleSurface).toBe(true);
    expect(typeof checkersGameUi.Remote).toBe('function');
  });

  it('has a brand mark, tagline, and one-line summary', () => {
    expect(checkersGameUi.icon).toContain('<svg');
    // The gold crown from the Classic Red skin (spec 0075) is on the mark.
    expect(checkersGameUi.icon).toContain('#e8c15a');
    expect(checkersGameUi.tagline.length).toBeGreaterThan(0);
    expect(checkersGameUi.summary.length).toBeGreaterThan(40);
  });

  it('defaults hints on, always validates, and runs one open-ended game', () => {
    expect(checkersGameUi.defaultConfig()).toEqual({ showAvailableMoves: true });
    expect(checkersGameUi.validateConfig({})).toEqual({ ok: true });
    expect(checkersGameUi.roundsOf({})).toBe(CHECKERS_ROUNDS);
  });

  it('exposes an AdvancedConfigPanel for the lobby advanced-settings slot', () => {
    // Registered on the module so the shared Lobby renders it in the collapsed "Advanced settings"
    // accordion (spec 0068) - the "See available moves" toggle lives there, not in the standard panel.
    expect(typeof checkersGameUi.AdvancedConfigPanel).toBe('function');
  });
});

describe('checkers catalog + library entries', () => {
  it('has a marketing catalog entry that is also in the PUBLIC catalog (WS14)', () => {
    // The entry is in the full catalog (so the registry<->catalog completeness check holds)...
    const entry = GAME_CATALOG.find((e) => e.slug === 'checkers');
    expect(entry?.badge.label).toBe('New');
    expect(entry?.howToPlay).toHaveLength(3);
    // ...and now that Checkers is public it is also carried on the PUBLIC catalog (the /games index,
    // the feature pages, the home carousel, and the sitemap enumerate this list).
    expect(PUBLIC_GAME_CATALOG.some((e) => e.slug === 'checkers')).toBe(true);
  });

  it('has a library entry with valid taxonomy keys and real rules', () => {
    const entry = getLibraryEntry('checkers');
    expect(entry).toBeDefined();
    // Categories/tags are controlled-vocabulary keys.
    for (const c of entry!.categories) expect(GAME_CATEGORIES[c]).toBeDefined();
    for (const t of entry!.tags) expect(GAME_TAGS[t]).toBeDefined();
    expect(entry!.categories).toContain('classic');
    expect(entry!.tags).toContain('two-player');
    expect(entry!.rules.objective.length).toBeGreaterThan(10);
    expect(entry!.rules.sections.length).toBeGreaterThanOrEqual(3);
  });
});

describe('public visibility filtering (WS14)', () => {
  it('gamesForViewer includes Checkers for both public and insider viewers', () => {
    expect(gamesForViewer(true).map((m) => m.id)).toContain('checkers');
    expect(gamesForViewer(false).map((m) => m.id)).toContain('checkers');
  });

  it('checkers is one of the registered games', () => {
    expect(GAME_UI_LIST.map((m) => m.id)).toContain('checkers');
  });
});
