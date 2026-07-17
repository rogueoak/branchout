import { describe, expect, it } from 'vitest';
import { chessGameUi, CHESS_ROUNDS } from './index';
import { GAME_UI_LIST, gamesForViewer, getGameUi, isPublicGame } from '../registry';
import { GAME_CATEGORIES, GAME_TAGS, getLibraryEntry } from '../library';
import { GAME_CATALOG, PUBLIC_GAME_CATALOG } from '../catalog';

describe('chessGameUi module', () => {
  it('is registered and insider-only', () => {
    expect(getGameUi('chess')).toBe(chessGameUi);
    expect(chessGameUi.visibility).toBe('insider');
    expect(isPublicGame(chessGameUi)).toBe(false);
  });

  it('is a single-surface game (the board viewer is the whole interactive surface)', () => {
    expect(chessGameUi.singleSurface).toBe(true);
    expect(typeof chessGameUi.Remote).toBe('function');
  });

  it('has a brand mark carrying the gold root, a tagline, and a one-line summary', () => {
    expect(chessGameUi.icon).toContain('<svg');
    expect(chessGameUi.icon).toContain('#d2a463');
    expect(chessGameUi.tagline.length).toBeGreaterThan(0);
    expect(chessGameUi.summary.length).toBeGreaterThan(40);
  });

  it('defaults an empty config, always validates, and runs one open-ended game', () => {
    expect(chessGameUi.defaultConfig()).toEqual({});
    expect(chessGameUi.validateConfig({})).toEqual({ ok: true });
    expect(chessGameUi.roundsOf({})).toBe(CHESS_ROUNDS);
  });
});

describe('chess catalog + library entries', () => {
  it('has a marketing catalog entry (satisfies the fail-loud completeness check)', () => {
    const entry = GAME_CATALOG.find((e) => e.slug === 'chess');
    expect(entry?.badge.label).toBe('Insider');
    expect(entry?.howToPlay).toHaveLength(3);
    // ...but excluded from the PUBLIC catalog (it is insider-only).
    expect(PUBLIC_GAME_CATALOG.some((e) => e.slug === 'chess')).toBe(false);
  });

  it('has a library entry with valid taxonomy keys and real rules', () => {
    const entry = getLibraryEntry('chess');
    expect(entry).toBeDefined();
    for (const c of entry!.categories) expect(GAME_CATEGORIES[c]).toBeDefined();
    for (const t of entry!.tags) expect(GAME_TAGS[t]).toBeDefined();
    expect(entry!.categories).toContain('classic');
    expect(entry!.tags).toContain('two-player');
    expect(entry!.rules.objective.toLowerCase()).toContain('checkmate');
    expect(entry!.rules.sections.length).toBeGreaterThanOrEqual(3);
  });
});

describe('insider visibility filtering', () => {
  it('gamesForViewer(true) includes Chess; (false) excludes it', () => {
    expect(gamesForViewer(true).map((m) => m.id)).toContain('chess');
    expect(gamesForViewer(false).map((m) => m.id)).not.toContain('chess');
  });

  it('chess is one of the registered games', () => {
    expect(GAME_UI_LIST.map((m) => m.id)).toContain('chess');
  });
});
