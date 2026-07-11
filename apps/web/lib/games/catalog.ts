// The per-game marketing catalog (spec 0030): the single source for the SEO feature pages, the
// `/games` index, and (via the shared fields) the home teaser and the room picker card (spec 0029).
// Marketing copy lives here; the display basics (name, tagline, one-line summary, mark) come from the
// game's registry module, so a game is still "a module + one catalog entry" and the two never drift.
//
// The `slug` is the game's registry id (`trivia`, `liar-liar`) - the same value the `?game=<slug>`
// deep link and the `/games/[slug]` route use (documented in overview/architecture.md). Pure data +
// pure helpers, so it is trivially unit-testable and safe to import from a Server Component.

import type { Metadata } from 'next';
import { SITE_URL } from '../site';
import { GAME_UI_LIST, getGameUi, type GameUiModule } from './registry';

/** One how-to-play step shown on a feature page. */
export interface HowToStep {
  title: string;
  body: string;
}

/** A short badge for a game card (matches canopy Badge variants used on the home teaser). */
export interface GameBadge {
  label: string;
  variant: 'info' | 'success' | 'primary' | 'neutral';
}

/** The marketing copy for one game - merged with its registry module into a {@link GameCatalogEntry}. */
interface GameMarketing {
  /** A longer paragraph than the registry `summary` - what the game is and why it is fun. */
  description: string;
  /** Three steps that explain a round. */
  howToPlay: HowToStep[];
  /** The game's content categories (shown as chips; also the SEO keyword surface). */
  categories: string[];
  /** The pre-rendered Open Graph share card in public/ (spec 0025). Held here per slug so the
   *  `liar-liar` slug maps to `/share-liarliar.png` without depending on the join-flow's card keys. */
  shareImage: string;
  /** Alt text for the share card (ASCII, Trellis language rules). */
  shareAlt: string;
  /** A card badge for the `/games` index and the home teaser. */
  badge: GameBadge;
  /** SEO title + meta description for the feature page. */
  seoTitle: string;
  seoDescription: string;
}

// Keyed by slug (== registry id). Adding a game means adding its registry module AND one entry here;
// the build fails loudly (see below) if a registered game has no marketing copy.
const MARKETING: Record<string, GameMarketing> = {
  trivia: {
    description:
      'Branch Out Trivia is a fast, free-text trivia party game built for phones. 1,600 questions ' +
      'across eight categories, a 60-second round timer, and a quick group vote to settle the close ' +
      'calls - so the debate ends on the scoreboard, not in an argument.',
    howToPlay: [
      {
        title: 'Start a room',
        body: 'Host a room, pick your categories and round count, and share the join code.',
      },
      {
        title: 'Answer in your own words',
        body: 'Everyone types a free-text answer before the timer runs out - no multiple choice.',
      },
      {
        title: 'Reveal, vote, and score',
        body: 'Answers reveal together; a close call goes to a group vote, and points settle it.',
      },
    ],
    categories: ['Nature', 'Food', 'Animals', 'Science', 'People', 'Places', 'Things', 'History'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Trivia',
    badge: { label: 'Featured', variant: 'info' },
    seoTitle: 'Trivia - a fast free-text party game | Branch Out Games',
    seoDescription:
      'Play Branch Out Trivia free in your browser: 1,600 questions across 8 categories, free-text ' +
      'answers, and a group vote for the close calls. Start a room and share the code - no app.',
  },
  'liar-liar': {
    description:
      'Liar Liar is an online bluffing party game in the Fibbage tradition. Everyone gets a ' +
      'wild-but-true clue and writes a convincing fake answer, then tries to spot the real one ' +
      'hidden among all the lies. Fool your friends for points; find the truth to win the round.',
    howToPlay: [
      {
        title: 'Read the clue',
        body: 'A wild-but-true clue appears with the answer blanked out for everyone to see.',
      },
      {
        title: 'Write a convincing lie',
        body: 'Invent a fake answer good enough to fool the room before the timer ends.',
      },
      {
        title: 'Find the truth',
        body: 'Everyone picks from the fakes plus the real answer; fooling players and finding the truth both score.',
      },
    ],
    categories: [
      'Famous People',
      'Places',
      'Events',
      'Sports',
      'Food',
      'Nature',
      'Animals',
      'Things',
    ],
    shareImage: '/share-liarliar.png',
    shareAlt: 'Branch Out Liar Liar',
    badge: { label: 'New', variant: 'success' },
    seoTitle: 'Liar Liar - an online bluffing party game | Branch Out Games',
    seoDescription:
      'Play Liar Liar free in your browser: a Fibbage-style bluffing game. Write a fake answer to a ' +
      'wild-but-true clue, then pick the real one hidden among the lies. Start a room - no app.',
  },
};

/** A game's full marketing + display data - the registry basics plus the catalog copy. */
export interface GameCatalogEntry extends GameMarketing {
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  /** The game's on-theme mark as an inline SVG string (from the registry / brand package). */
  icon: string;
}

function toEntry(module: GameUiModule): GameCatalogEntry {
  const marketing = MARKETING[module.id];
  if (!marketing) {
    // Fail loudly: a registered game with no marketing copy would otherwise ship a broken feature
    // page and sitemap entry. Adding a game must add its catalog entry.
    throw new Error(
      `No marketing catalog entry for game "${module.id}" - add one to lib/games/catalog.ts`,
    );
  }
  return {
    slug: module.id,
    name: module.name,
    tagline: module.tagline,
    summary: module.summary,
    icon: module.icon,
    ...marketing,
  };
}

/** Every game's catalog entry, in the registry's display order. */
export const GAME_CATALOG: readonly GameCatalogEntry[] = GAME_UI_LIST.map(toEntry);

/** Resolve a catalog entry by slug, or undefined for an unknown game. */
export function getCatalogEntry(slug: string | undefined | null): GameCatalogEntry | undefined {
  const module = getGameUi(slug);
  return module ? toEntry(module) : undefined;
}

/** The feature page path for a game. */
export function featurePath(slug: string): string {
  return `/games/${slug}`;
}

/** The "Start a game" deep link into the room flow, which skips the pick step (spec 0029). */
export function playHref(slug: string): string {
  return `/rooms?game=${encodeURIComponent(slug)}`;
}

/**
 * The feature-page "Start a game" CTA target. A signed-in visitor goes straight to the room deep
 * link; an anonymous visitor (who cannot host yet) goes to signup first, carrying the intended game
 * as a validated internal `next` so the preselection survives the round-trip - otherwise the biggest
 * marketing CTA drops a first-timer on the "hosting needs an account" wall and loses the game.
 */
export function startGameHref(slug: string, signedIn: boolean): string {
  const play = playHref(slug);
  return signedIn ? play : `/signup?next=${encodeURIComponent(play)}`;
}

/** Absolute URL for a site path, using the public origin (crawlers need absolute URLs). */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

/** The Next.js metadata for a feature page: unique title/description, canonical, and OG/Twitter
 *  reusing the game's share card. Returns undefined for an unknown slug (the page then 404s). */
export function gameFeatureMetadata(slug: string): Metadata | undefined {
  const entry = getCatalogEntry(slug);
  if (!entry) return undefined;
  const url = absoluteUrl(featurePath(entry.slug));
  return {
    title: entry.seoTitle,
    description: entry.seoDescription,
    alternates: { canonical: url },
    openGraph: {
      title: entry.seoTitle,
      description: entry.seoDescription,
      url,
      // Absolute image URL, matching `canonical` and the JSON-LD image - one convention (crawlers
      // and some unfurlers want absolute, not metadataBase-relative).
      images: [
        { url: absoluteUrl(entry.shareImage), width: 1200, height: 630, alt: entry.shareAlt },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: entry.seoTitle,
      description: entry.seoDescription,
      images: [absoluteUrl(entry.shareImage)],
    },
  };
}

/** The JSON-LD (schema.org VideoGame) structured data for a feature page. Absolute URLs throughout. */
export function gameJsonLd(entry: GameCatalogEntry): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: entry.name,
    description: entry.description,
    url: absoluteUrl(featurePath(entry.slug)),
    image: absoluteUrl(entry.shareImage),
    genre: [...entry.categories.slice(0, 3), 'Party game'],
    gamePlatform: 'Web browser',
    playMode: 'MultiPlayer',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'Branch Out Games' },
  };
}
