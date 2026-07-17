import { describe, expect, it } from 'vitest';
import { GAME_UI_LIST } from './registry';
import {
  GAME_CATEGORIES,
  GAME_TAGS,
  categoriesInUse,
  getGameRules,
  getLibraryMeta,
  searchLibrary,
  toLibrary,
  type GameCategory,
  type GameTag,
  type SearchableGame,
} from './library';

const CATEGORY_KEYS = new Set(Object.keys(GAME_CATEGORIES) as GameCategory[]);
const TAG_KEYS = new Set(Object.keys(GAME_TAGS) as GameTag[]);

describe('library completeness + vocabulary validity', () => {
  it('has a library entry for every registered game', () => {
    for (const module of GAME_UI_LIST) {
      // toLibrary throws (fail-loud) if a registered game has no entry.
      expect(() => toLibrary(module)).not.toThrow();
    }
  });

  it('only declares categories and tags that are in the vocabulary', () => {
    for (const module of GAME_UI_LIST) {
      const entry = toLibrary(module);
      expect(entry.categories.length, `${module.id} needs a category`).toBeGreaterThan(0);
      for (const category of entry.categories) {
        expect(CATEGORY_KEYS.has(category), `${module.id}: unknown category ${category}`).toBe(
          true,
        );
      }
      for (const tag of entry.tags) {
        expect(TAG_KEYS.has(tag), `${module.id}: unknown tag ${tag}`).toBe(true);
      }
    }
  });

  it('gives every game an objective and at least one rules section', () => {
    for (const module of GAME_UI_LIST) {
      const rules = getGameRules(module.id);
      expect(rules, `${module.id} needs rules`).toBeDefined();
      expect(rules?.objective.length ?? 0).toBeGreaterThan(0);
      expect(rules?.sections.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('backfills the three shipped games', () => {
    for (const slug of ['trivia', 'liar-liar', 'teeter-tower']) {
      expect(getLibraryMeta(slug)).toBeDefined();
      expect(getGameRules(slug)).toBeDefined();
    }
  });
});

const GAMES: SearchableGame[] = [
  { slug: 'trivia', name: 'Trivia', summary: 'A fast free-text trivia party game.' },
  {
    slug: 'liar-liar',
    name: 'Liar Liar',
    summary: 'A bluffing party game in the Fibbage tradition.',
  },
  { slug: 'teeter-tower', name: 'Teeter Tower', summary: 'A physics stacking game for phones.' },
];

describe('searchLibrary', () => {
  it('matches on a game name (case-insensitive)', () => {
    expect(searchLibrary(GAMES, 'trivia')).toContain('trivia');
    expect(searchLibrary(GAMES, 'TEETER')).toEqual(['teeter-tower']);
  });

  it('matches on a tag label', () => {
    // "Bluffing" is a tag on liar-liar (not in its name/summary keyword directly as the tag label).
    expect(searchLibrary(GAMES, 'bluffing')).toContain('liar-liar');
  });

  it('filters by category', () => {
    const strategy = searchLibrary(GAMES, '', { category: 'strategy' });
    expect(strategy).toEqual(['teeter-tower']);
    const party = searchLibrary(GAMES, '', { category: 'party' });
    expect(party).toEqual(expect.arrayContaining(['trivia', 'liar-liar']));
    expect(party).not.toContain('teeter-tower');
  });

  it('returns no matches for a query that hits nothing', () => {
    expect(searchLibrary(GAMES, 'zzzznotathing')).toEqual([]);
  });

  it('combines a query and a category filter', () => {
    expect(searchLibrary(GAMES, 'liar', { category: 'party' })).toEqual(['liar-liar']);
    expect(searchLibrary(GAMES, 'liar', { category: 'strategy' })).toEqual([]);
  });
});

describe('categoriesInUse', () => {
  it('lists only categories some game declares, in vocabulary order', () => {
    const used = categoriesInUse(GAMES).map((c) => c.slug);
    expect(used).toContain('party');
    expect(used).toContain('strategy');
    // No game here declares "classic".
    expect(used).not.toContain('classic');
    // Vocabulary order: party (2nd key) before strategy (6th key).
    expect(used.indexOf('party')).toBeLessThan(used.indexOf('strategy'));
  });
});

describe('getLibraryMeta', () => {
  it('resolves category and tag keys to display labels', () => {
    const meta = getLibraryMeta('trivia');
    expect(meta?.categories[0]).toEqual({ slug: 'party', label: 'Party' });
    expect(meta?.tags.map((t) => t.label)).toContain('Trivia');
  });

  it('returns undefined for an unknown game', () => {
    expect(getLibraryMeta('does-not-exist')).toBeUndefined();
  });
});
