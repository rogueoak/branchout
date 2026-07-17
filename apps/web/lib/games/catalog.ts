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
import { GAME_UI_LIST, getGameUi, isPublicGame, type GameUiModule } from './registry';

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
  // Lone Leaf is insider-only (spec 0057): the entry exists so the build-time "every registered game
  // needs marketing copy" check passes, but PUBLIC_GAME_CATALOG excludes it, so it never appears on
  // the public /games index, feature pages, or sitemap. Its share card reuses the trivia placeholder
  // (no public raster is generated for an insider game).
  'lone-leaf': {
    description:
      'Lone Leaf is a cooperative single-clue word game for phones. One player is the Seeker and ' +
      'must guess a hidden seed word they cannot see; everyone else writes a single one-word clue. ' +
      'Matching clues wilt and vanish before the Seeker looks - so think alike, but not too alike. ' +
      'The Seeker takes one guess, and the whole grove shares the result. Still in testing.',
    howToPlay: [
      {
        title: 'Deal the seed',
        body: 'One player is the Seeker and never sees the seed; everyone else sees it on their phone.',
      },
      {
        title: 'Write one leaf',
        body: 'Each non-Seeker writes a single one-word clue for the seed. Matching clues wilt away.',
      },
      {
        title: 'Guess together',
        body: 'The Seeker guesses from the surviving unique clues; a correct guess scores for everyone.',
      },
    ],
    categories: ['Nature', 'Everyday', 'Places', 'Food', 'Animals', 'Feelings'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Lone Leaf',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Lone Leaf - a cooperative single-clue word game | Branch Out Games',
    seoDescription:
      'Lone Leaf is a phone-first cooperative word game in insider testing. Give the Seeker a ' +
      'single one-word clue - but matching clues wilt away - and guess the hidden seed together.',
  },
  // Teeter Tower is insider-only (spec 0043): the entry exists so the build-time "every registered
  // game needs marketing copy" check passes, but the PUBLIC_GAME_CATALOG below excludes it, so it
  // never appears on the public /games index, the feature pages, or the sitemap. Its share card is a
  // placeholder (no public raster is generated for an insider game); it satisfies the shape check and
  // is never surfaced publicly.
  'teeter-tower': {
    description:
      'Teeter Tower is a physics stacking game for phones. Spin a wobbly, googly-eyed piece, lock ' +
      'its angle, and drop it onto the tower. Reach the target line across three levels - a warm-up, ' +
      'a taller climb, and a swinging pendulum - without toppling the stack. Still in testing.',
    howToPlay: [
      {
        title: 'Spin and lock',
        body: 'A googly-eyed piece spins on the board. Tap to lock the angle you want it to drop at.',
      },
      {
        title: 'Aim the drop',
        body: 'Drag to line the piece up over the tower, then drop it and watch it settle.',
      },
      {
        title: 'Reach the line',
        body: 'Stack piece on piece to reach the target line and clear the level for more points.',
      },
    ],
    categories: ['Physics', 'Stacking', 'Skill'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Teeter Tower',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Teeter Tower - a physics stacking game | Branch Out Games',
    seoDescription:
      'Teeter Tower is a phone-first physics stacking game in insider testing. Spin a googly-eyed ' +
      'piece, lock its angle, and drop it to build toward the target line across three levels.',
  },
  // Reversi is insider-only (spec 0054): the entry exists so the build-time "every registered game
  // needs marketing copy" check passes, but PUBLIC_GAME_CATALOG below excludes it, so it never
  // appears on the public /games index, the feature pages, or the sitemap. Its share card is a
  // placeholder (no public raster is generated for an insider game); it satisfies the shape check.
  reversi: {
    description:
      'Reversi is the classic disc-flip strategy game for two, built for phones. Place a Violet or ' +
      "Amber disc to bracket a straight line of your opponent's discs and flip them all to your " +
      'color. Corners and edges win games. When neither side can move, the most discs takes it.',
    howToPlay: [
      {
        title: 'Bracket a line',
        body: 'On your turn, place a disc so it traps one or more of the other color in a straight line ending on your disc.',
      },
      {
        title: 'Flip the discs',
        body: 'Every trapped disc between your two flips to your color, in any of the eight directions at once.',
      },
      {
        title: 'Own the board',
        body: 'Must move if you can, else pass. When neither side can move, the most discs of your color wins.',
      },
    ],
    categories: ['Classic', 'Strategy', 'Two-player'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Reversi',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Reversi - the classic disc-flip strategy game | Branch Out Games',
    seoDescription:
      'Reversi is a phone-first two-player disc-flip strategy game in insider testing. Bracket a ' +
      "line of your opponent's discs to flip them; the most discs of your color wins.",
  },
  // Checkers is insider-only (spec 0055): like Reversi, the entry exists so the build-time "every
  // registered game needs marketing copy" check passes, but PUBLIC_GAME_CATALOG below excludes it, so
  // it never appears on the public /games index, the feature pages, or the sitemap. Its share card is
  // a placeholder (no public raster is generated for an insider game); it satisfies the shape check.
  checkers: {
    description:
      'Checkers (English draughts) is the classic strategy game for two, built for phones. Move your ' +
      'Violet or Amber pieces diagonally forward, jump an opponent to capture, and chain multi-jumps ' +
      'in one turn. Reach the far row to crown a King that moves both ways. Capture every piece, or ' +
      'leave your opponent no move, to win.',
    howToPlay: [
      {
        title: 'Move and jump',
        body: 'Slide a piece one square diagonally forward, or jump over a touching opponent into the empty square beyond to capture it.',
      },
      {
        title: 'Chain and crown',
        body: 'If a jump is open you must take it, and a landed piece keeps jumping. Reach the far row to crown a King that moves and jumps both ways.',
      },
      {
        title: 'Clear the board',
        body: 'Capture all of your opponent pieces, or block their last move, to win the game.',
      },
    ],
    categories: ['Classic', 'Strategy', 'Two-player'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Checkers',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Checkers - the classic draughts strategy game | Branch Out Games',
    seoDescription:
      'Checkers (English draughts) is a phone-first two-player strategy game in insider testing. Jump ' +
      'to capture, chain multi-jumps, and crown a King; capture every piece to win.',
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
  /** Whether this game is public (surfaced on marketing pages) or insider-only (spec 0043). */
  visibility: 'public' | 'insider';
}

function toEntry(module: GameUiModule): GameCatalogEntry {
  const marketing = MARKETING[module.id];
  if (!marketing) {
    // Fail loudly: a registered game with no marketing copy would otherwise ship a broken feature
    // page and sitemap entry. Adding a game must add its catalog entry (even an insider game, so the
    // shape stays complete; PUBLIC_GAME_CATALOG then filters it out of the public surfaces).
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
    visibility: module.visibility ?? 'public',
    ...marketing,
  };
}

/**
 * Every registered game's catalog entry, in display order - including insider games (so the
 * build-time registry<->catalog completeness check holds). Public marketing surfaces must use
 * {@link PUBLIC_GAME_CATALOG} instead, which excludes insider-only games.
 */
export const GAME_CATALOG: readonly GameCatalogEntry[] = GAME_UI_LIST.map(toEntry);

/**
 * The public marketing catalog: only games visible to everyone (spec 0043). The /games index, the
 * feature pages, and the sitemap enumerate THIS list so an insider-only game never appears publicly.
 */
export const PUBLIC_GAME_CATALOG: readonly GameCatalogEntry[] =
  GAME_UI_LIST.filter(isPublicGame).map(toEntry);

/**
 * Resolve a PUBLIC catalog entry by slug, or undefined for an unknown or insider-only game. Public
 * surfaces (the feature page, its metadata/JSON-LD) use this so an insider game deep-linked by slug
 * 404s instead of rendering a public page.
 */
export function getCatalogEntry(slug: string | undefined | null): GameCatalogEntry | undefined {
  const module = getGameUi(slug);
  if (!module || !isPublicGame(module)) return undefined;
  return toEntry(module);
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
