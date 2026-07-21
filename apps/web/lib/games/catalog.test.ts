import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../site';
import { GAME_UI_LIST } from './registry';
import {
  FEATURED_GAME_CATALOG,
  GAME_CATALOG,
  PUBLIC_GAME_CATALOG,
  absoluteUrl,
  featurePath,
  gameFeatureMetadata,
  gameJsonLd,
  getCatalogEntry,
  getFeatureEntry,
  getGameCard,
  insiderFeatureMetadata,
  playHref,
  startGameHref,
} from './catalog';

describe('game catalog', () => {
  it('has a complete entry for every registered game, keyed by the registry id', () => {
    expect(GAME_CATALOG.map((g) => g.slug).sort()).toEqual(GAME_UI_LIST.map((m) => m.id).sort());
    for (const game of GAME_CATALOG) {
      expect(game.slug).toBeTruthy();
      expect(game.name).toBeTruthy();
      expect(game.tagline).toBeTruthy();
      expect(game.summary).toBeTruthy();
      expect(game.description.length).toBeGreaterThan(40);
      expect(game.howToPlay.length).toBe(3);
      expect(game.categories.length).toBeGreaterThan(0);
      expect(game.shareImage).toMatch(/^\/share-.*\.png$/);
      expect(game.icon).toContain('<svg');
      expect(game.badge.label).toBeTruthy();
      expect(game.seoTitle).toContain('Branch Out');
      expect(game.seoDescription.length).toBeGreaterThan(40);
    }
  });

  it('gives every public game a portrait hero for the home carousel (spec 0067)', () => {
    // The carousel force-fits each slide into an aspect-[3/4] box, so a public game that forgot its
    // portrait art would render a distorted wide hero. Assert every public slug resolves a real
    // 600x800 portrait so a missing one fails loudly here instead of silently on the home page.
    for (const entry of PUBLIC_GAME_CATALOG) {
      const card = getGameCard(entry.slug);
      expect(card?.heroPortrait, `public game ${entry.slug} is missing a portrait hero`).toContain(
        'viewBox="0 0 600 800"',
      );
    }
  });

  it('resolves a known slug and returns undefined for an unknown one', () => {
    expect(getCatalogEntry('trivia')?.name).toBe('Trivia');
    expect(getCatalogEntry('liar-liar')?.slug).toBe('liar-liar');
    expect(getCatalogEntry('nope')).toBeUndefined();
    expect(getCatalogEntry(null)).toBeUndefined();
  });

  it('builds the play deep link and feature path from the slug', () => {
    expect(playHref('trivia')).toBe('/rooms?game=trivia');
    expect(playHref('liar-liar')).toBe('/rooms?game=liar-liar');
    expect(featurePath('trivia')).toBe('/games/trivia');
  });

  it('makes absolute URLs against the site origin', () => {
    expect(absoluteUrl('/games/trivia')).toBe(`${SITE_URL}/games/trivia`);
  });

  it('routes the Start CTA by auth: signed-in straight to play, anonymous through signup', () => {
    // A signed-in visitor can host, so go straight to the room deep link.
    expect(startGameHref('trivia', true)).toBe('/rooms?game=trivia');
    // An anonymous visitor goes to signup first, carrying the game as a validated internal `next`.
    expect(startGameHref('trivia', false)).toBe('/signup?next=%2Frooms%3Fgame%3Dtrivia');
  });
});

describe('getFeatureEntry (surface-aware resolution, spec 0030)', () => {
  it('resolves a public game on both the apex and the insider surface', () => {
    expect(getFeatureEntry('trivia', { insider: false })?.name).toBe('Trivia');
    expect(getFeatureEntry('trivia', { insider: true })?.name).toBe('Trivia');
  });

  it('resolves an insider game ONLY on the insider surface (404s on the apex)', () => {
    // teeter-tower is insider-only; it must not exist publicly but renders behind the insider gate.
    expect(getFeatureEntry('teeter-tower', { insider: false })).toBeUndefined();
    expect(getFeatureEntry('teeter-tower', { insider: true })?.visibility).toBe('insider');
  });

  it('resolves Lone Leaf publicly now that it is promoted (spec 0073)', () => {
    // Lone Leaf graduated from insider to public: it resolves on the apex like any public game.
    expect(getFeatureEntry('lone-leaf', { insider: false })?.visibility).toBe('public');
    expect(getCatalogEntry('lone-leaf')?.name).toBe('Lone Leaf');
  });

  it('returns undefined for an unknown slug on either surface, and never weakens getCatalogEntry', () => {
    expect(getFeatureEntry('nope', { insider: true })).toBeUndefined();
    // The public-only guarantee is unchanged: getCatalogEntry never resolves an insider game.
    expect(getCatalogEntry('teeter-tower')).toBeUndefined();
  });
});

describe('FEATURED_GAME_CATALOG (curated home hero carousel, spec 0073)', () => {
  it('features Trivia, Liar Liar, and Lone Leaf - the curated carousel subset', () => {
    expect(FEATURED_GAME_CATALOG.map((g) => g.slug)).toEqual(['trivia', 'liar-liar', 'lone-leaf']);
  });

  it('excludes public-but-not-featured games (Reversi, Checkers stay off the carousel)', () => {
    const slugs = FEATURED_GAME_CATALOG.map((g) => g.slug);
    expect(slugs).not.toContain('reversi');
    expect(slugs).not.toContain('checkers');
    // But they are still public: they remain on the /games index and keep their feature pages.
    expect(PUBLIC_GAME_CATALOG.map((g) => g.slug)).toEqual(
      expect.arrayContaining(['reversi', 'checkers']),
    );
  });

  it('is a subset of the public catalog (only a public game can be featured)', () => {
    const publicSlugs = new Set(PUBLIC_GAME_CATALOG.map((g) => g.slug));
    for (const game of FEATURED_GAME_CATALOG) {
      expect(publicSlugs.has(game.slug)).toBe(true);
      expect(game.featured).toBe(true);
    }
  });

  it('never features an insider game (guards the "public.filter" derivation directly)', () => {
    // The subset test above only bites if an insider game actually set featured: true (none does).
    // These assert the invariant at its source instead: every FEATURED entry is public visibility,
    // so a regression that derived FEATURED from GAME_CATALOG (the full list) instead of
    // PUBLIC_GAME_CATALOG would fail here even before any insider game opts in.
    for (const game of FEATURED_GAME_CATALOG) {
      expect(game.visibility).toBe('public');
    }
    expect(GAME_CATALOG.filter((g) => g.visibility === 'insider').some((g) => g.featured)).toBe(
      false,
    );
  });
});

describe('insiderFeatureMetadata (SEO only where public, spec 0030)', () => {
  it('is noindex/nofollow with a title/description but NO canonical or share card', () => {
    const entry = getFeatureEntry('teeter-tower', { insider: true })!;
    const meta = insiderFeatureMetadata(entry);
    expect(String(meta.title)).toContain('Teeter Tower');
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
  });
});

describe('gameFeatureMetadata', () => {
  it('sets a unique title, description, canonical, and OG/Twitter share card per game', () => {
    const meta = gameFeatureMetadata(getCatalogEntry('trivia')!);
    expect(meta.title).toContain('Trivia');
    expect(String(meta.description)).toContain('Trivia');
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/games/trivia`);
    const ogImages = meta.openGraph?.images as { url: string }[];
    expect(ogImages[0].url).toBe(`${SITE_URL}/share-trivia.png`);
    expect((meta.twitter as { card?: string }).card).toBe('summary_large_image');
  });

  it('differs between games (built from the passed-in resolved entry)', () => {
    // Takes the already-resolved public entry (single-resolve, review #139), so the slug is resolved
    // once by the caller; unknown-slug resolution is getCatalogEntry's job, tested above.
    expect(gameFeatureMetadata(getCatalogEntry('trivia')!).title).not.toBe(
      gameFeatureMetadata(getCatalogEntry('liar-liar')!).title,
    );
  });
});

describe('gameJsonLd', () => {
  it('emits schema.org VideoGame structured data with absolute URLs and a free offer', () => {
    const ld = gameJsonLd(getCatalogEntry('liar-liar')!);
    expect(ld['@type']).toBe('VideoGame');
    expect(ld.name).toBe('Liar Liar');
    expect(ld.url).toBe(`${SITE_URL}/games/liar-liar`);
    expect(ld.image).toBe(`${SITE_URL}/share-liarliar.png`);
    expect((ld.offers as { price: string }).price).toBe('0');
  });
});
