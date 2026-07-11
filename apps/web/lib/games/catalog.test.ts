import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../site';
import { GAME_UI_LIST } from './registry';
import {
  GAME_CATALOG,
  absoluteUrl,
  featurePath,
  gameFeatureMetadata,
  gameJsonLd,
  getCatalogEntry,
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

describe('gameFeatureMetadata', () => {
  it('sets a unique title, description, canonical, and OG/Twitter share card per game', () => {
    const meta = gameFeatureMetadata('trivia')!;
    expect(meta.title).toContain('Trivia');
    expect(String(meta.description)).toContain('Trivia');
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/games/trivia`);
    const ogImages = meta.openGraph?.images as { url: string }[];
    expect(ogImages[0].url).toBe(`${SITE_URL}/share-trivia.png`);
    expect((meta.twitter as { card?: string }).card).toBe('summary_large_image');
  });

  it('differs between games and is undefined for an unknown slug', () => {
    expect(gameFeatureMetadata('trivia')!.title).not.toBe(gameFeatureMetadata('liar-liar')!.title);
    expect(gameFeatureMetadata('nope')).toBeUndefined();
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
