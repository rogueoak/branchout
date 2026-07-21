import { describe, expect, it } from 'vitest';
import { loneLeafGameUi } from './index';
import { GAME_UI_LIST, gamesForViewer, getGameUi, isPublicGame } from '../registry';
import { GAME_CATEGORIES, GAME_TAGS, getLibraryEntry } from '../library';
import { FEATURED_GAME_CATALOG, GAME_CATALOG, PUBLIC_GAME_CATALOG } from '../catalog';

describe('loneLeafGameUi module', () => {
  it('is registered and public (spec 0073: graduated from insider)', () => {
    expect(getGameUi('lone-leaf')).toBe(loneLeafGameUi);
    // No explicit visibility now means public (the default), same as Trivia and Liar Liar.
    expect(loneLeafGameUi.visibility).toBeUndefined();
    expect(isPublicGame(loneLeafGameUi)).toBe(true);
  });

  it('has a brand mark with the family gold root, a tagline, and a one-line summary', () => {
    expect(loneLeafGameUi.icon).toContain('<svg');
    // The single family gold root is on the mark.
    expect(loneLeafGameUi.icon).toContain('#d2a463');
    expect(loneLeafGameUi.tagline.length).toBeGreaterThan(0);
    expect(loneLeafGameUi.summary.length).toBeGreaterThan(40);
  });
});

describe('lone leaf catalog + library entries', () => {
  it('has a marketing catalog entry that is also in the PUBLIC and FEATURED catalogs (spec 0073)', () => {
    // The entry is in the full catalog (so the registry<->catalog completeness check holds)...
    const entry = GAME_CATALOG.find((e) => e.slug === 'lone-leaf');
    expect(entry?.howToPlay).toHaveLength(3);
    expect(entry?.featured).toBe(true);
    // ...it is public (the /games index, the feature page, and the sitemap enumerate this list)...
    expect(PUBLIC_GAME_CATALOG.some((e) => e.slug === 'lone-leaf')).toBe(true);
    // ...and it is featured, so it leads the curated home hero carousel.
    expect(FEATURED_GAME_CATALOG.some((e) => e.slug === 'lone-leaf')).toBe(true);
  });

  it('no longer carries the insider "Still in testing" framing in its marketing copy', () => {
    const entry = GAME_CATALOG.find((e) => e.slug === 'lone-leaf');
    expect(entry?.description).not.toMatch(/still in testing/i);
    expect(entry?.seoDescription).not.toMatch(/insider testing/i);
  });

  it('has a library entry with valid taxonomy keys and real rules', () => {
    const entry = getLibraryEntry('lone-leaf');
    expect(entry).toBeDefined();
    for (const c of entry!.categories) expect(GAME_CATEGORIES[c]).toBeDefined();
    for (const t of entry!.tags) expect(GAME_TAGS[t]).toBeDefined();
    expect(entry!.rules.objective.length).toBeGreaterThan(10);
    expect(entry!.rules.sections.length).toBeGreaterThanOrEqual(3);
  });
});

describe('public visibility filtering (spec 0073)', () => {
  it('gamesForViewer includes Lone Leaf for both public and insider viewers', () => {
    expect(gamesForViewer(true).map((m) => m.id)).toContain('lone-leaf');
    expect(gamesForViewer(false).map((m) => m.id)).toContain('lone-leaf');
  });

  it('lone leaf is one of the registered games', () => {
    expect(GAME_UI_LIST.map((m) => m.id)).toContain('lone-leaf');
  });
});
