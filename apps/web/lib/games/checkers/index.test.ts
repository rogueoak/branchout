import { describe, expect, it } from 'vitest';
import { checkersGameUi, CHECKERS_ROUNDS } from './index';
import { GAME_UI_LIST, gamesForViewer, getGameUi, isPublicGame } from '../registry';
import { GAME_CATEGORIES, GAME_TAGS, getLibraryEntry } from '../library';
import { GAME_CATALOG, PUBLIC_GAME_CATALOG } from '../catalog';

describe('checkersGameUi module', () => {
  it('is registered and insider-only', () => {
    expect(getGameUi('checkers')).toBe(checkersGameUi);
    expect(checkersGameUi.visibility).toBe('insider');
    expect(isPublicGame(checkersGameUi)).toBe(false);
  });

  it('is a single-surface game (the board viewer is the whole interactive surface)', () => {
    expect(checkersGameUi.singleSurface).toBe(true);
    expect(typeof checkersGameUi.Remote).toBe('function');
  });

  it('has a brand mark, tagline, and one-line summary', () => {
    expect(checkersGameUi.icon).toContain('<svg');
    // The single family gold root is on the mark.
    expect(checkersGameUi.icon).toContain('#d2a463');
    expect(checkersGameUi.tagline.length).toBeGreaterThan(0);
    expect(checkersGameUi.summary.length).toBeGreaterThan(40);
  });

  it('defaults an empty config, always validates, and runs one open-ended game', () => {
    expect(checkersGameUi.defaultConfig()).toEqual({});
    expect(checkersGameUi.validateConfig({})).toEqual({ ok: true });
    expect(checkersGameUi.roundsOf({})).toBe(CHECKERS_ROUNDS);
  });
});

describe('checkers catalog + library entries', () => {
  it('has a marketing catalog entry (satisfies the fail-loud completeness check)', () => {
    // The entry is in the full catalog (so the registry<->catalog completeness check holds)...
    const entry = GAME_CATALOG.find((e) => e.slug === 'checkers');
    expect(entry?.badge.label).toBe('Insider');
    expect(entry?.howToPlay).toHaveLength(3);
    // ...but excluded from the PUBLIC catalog (it is insider-only).
    expect(PUBLIC_GAME_CATALOG.some((e) => e.slug === 'checkers')).toBe(false);
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

describe('insider visibility filtering', () => {
  it('gamesForViewer(true) includes Checkers; (false) excludes it', () => {
    expect(gamesForViewer(true).map((m) => m.id)).toContain('checkers');
    expect(gamesForViewer(false).map((m) => m.id)).not.toContain('checkers');
  });

  it('checkers is one of the registered games', () => {
    expect(GAME_UI_LIST.map((m) => m.id)).toContain('checkers');
  });
});
