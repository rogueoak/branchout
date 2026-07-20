import { describe, expect, it } from 'vitest';
import { reversiGameUi, REVERSI_ROUNDS } from './index';
import { GAME_UI_LIST, gamesForViewer, getGameUi, isPublicGame } from '../registry';
import { GAME_CATEGORIES, GAME_TAGS, getLibraryEntry } from '../library';
import { GAME_CATALOG, PUBLIC_GAME_CATALOG } from '../catalog';

describe('reversiGameUi module', () => {
  it('is registered and insider-only', () => {
    expect(getGameUi('reversi')).toBe(reversiGameUi);
    expect(reversiGameUi.visibility).toBe('insider');
    expect(isPublicGame(reversiGameUi)).toBe(false);
  });

  it('is a single-surface game (the board viewer is the whole interactive surface)', () => {
    expect(reversiGameUi.singleSurface).toBe(true);
    expect(typeof reversiGameUi.Remote).toBe('function');
  });

  it('has a brand mark, tagline, and one-line summary', () => {
    expect(reversiGameUi.icon).toContain('<svg');
    // The single family gold root is on the mark.
    expect(reversiGameUi.icon).toContain('#d2a463');
    expect(reversiGameUi.tagline.length).toBeGreaterThan(0);
    expect(reversiGameUi.summary.length).toBeGreaterThan(40);
  });

  it('defaults hints on, always validates, and runs one open-ended game', () => {
    expect(reversiGameUi.defaultConfig()).toEqual({ showAvailableMoves: true });
    expect(reversiGameUi.validateConfig({})).toEqual({ ok: true });
    expect(reversiGameUi.roundsOf({})).toBe(REVERSI_ROUNDS);
  });

  it('exposes an AdvancedConfigPanel for the lobby advanced-settings slot', () => {
    // Registered on the module so the shared Lobby renders it in the collapsed "Advanced settings"
    // accordion (spec 0068) - the "See available moves" toggle lives there, not in the standard panel.
    expect(typeof reversiGameUi.AdvancedConfigPanel).toBe('function');
  });
});

describe('reversi catalog + library entries', () => {
  it('has a marketing catalog entry (satisfies the fail-loud completeness check)', () => {
    // The entry is in the full catalog (so the registry<->catalog completeness check holds)...
    const entry = GAME_CATALOG.find((e) => e.slug === 'reversi');
    expect(entry?.badge.label).toBe('Insider');
    expect(entry?.howToPlay).toHaveLength(3);
    // ...but excluded from the PUBLIC catalog (it is insider-only).
    expect(PUBLIC_GAME_CATALOG.some((e) => e.slug === 'reversi')).toBe(false);
  });

  it('has a library entry with valid taxonomy keys and real rules', () => {
    const entry = getLibraryEntry('reversi');
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
  it('gamesForViewer(true) includes Reversi; (false) excludes it', () => {
    expect(gamesForViewer(true).map((m) => m.id)).toContain('reversi');
    expect(gamesForViewer(false).map((m) => m.id)).not.toContain('reversi');
  });

  it('reversi is one of the registered games', () => {
    expect(GAME_UI_LIST.map((m) => m.id)).toContain('reversi');
  });
});
