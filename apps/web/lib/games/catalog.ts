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
import { GAME_HERO } from './heroes';
import { getLibraryMeta, type LibraryChip } from './library';
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
  // Zinger is insider-only (spec 0053): the entry exists so the build-time "every registered game
  // needs marketing copy" check passes, but PUBLIC_GAME_CATALOG excludes it, so it never appears on
  // the public /games index, the feature pages, or the sitemap. Its share card is a placeholder (no
  // public raster is generated for an insider game); it satisfies the shape check and is never
  // surfaced publicly.
  zinger: {
    description:
      'Zinger is a funny-answer party game for phones. Everyone answers a silly setup with a short ' +
      'zinger, then two answers are pitted head to head in a face-off and the room votes on the ' +
      'funnier one. Win votes to score, land a clean sweep for a bonus. Still in testing.',
    howToPlay: [
      {
        title: 'Answer the setup',
        body: 'A short, silly setup appears. Type your funniest zinger before the timer runs out.',
      },
      {
        title: 'Watch the face-off',
        body: 'Two zingers are pitted head to head, with the authors hidden until the vote closes.',
      },
      {
        title: 'Vote and score',
        body: 'Everyone who did not write either votes for the funnier zinger; the winner scores.',
      },
    ],
    categories: ['Party', 'Word', 'Wit'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Zinger',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Zinger - a funny-answer party game | Branch Out Games',
    seoDescription:
      'Zinger is a phone-first funny-answer party game in insider testing. Answer a silly setup, ' +
      'watch two zingers face off, and vote on whose landed hardest.',
  },
  // Brambles is insider-only (spec 0043): the entry exists so the build-time completeness check
  // passes; PUBLIC_GAME_CATALOG excludes it so it never surfaces publicly. Share card is a placeholder.
  brambles: {
    description:
      'Brambles is a two-team word game for phones. Each turn, one grove is on the clock: their ' +
      'Guide gets a hidden target word (the bloom) and five forbidden words (the thorns) and types ' +
      'clues, while the grove races to guess the bloom. Say a thorn and the card wilts. Most blooms ' +
      'across the sprints wins. Still in testing.',
    howToPlay: [
      {
        title: 'Guide the grove',
        body: 'Your grove Guide sees a hidden bloom and its thorns, and types clues without saying any of them.',
      },
      {
        title: 'Guess the bloom',
        body: 'The rest of the grove types guesses. A correct guess scores a bloom and draws the next card.',
      },
      {
        title: 'Dodge the thorns',
        body: 'Touch a thorn or the bloom in a clue and the card wilts. Score the most blooms to win.',
      },
    ],
    categories: ['Word', 'Teams', 'Party'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Brambles',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Brambles - a two-team forbidden-words game | Branch Out Games',
    seoDescription:
      'Brambles is a phone-first, two-team word game in insider testing. Your grove Guide describes a ' +
      'hidden bloom while dodging forbidden thorns, and your grove races to guess it.',
  },
  nightleaf: {
    description:
      'Nightleaf is a cooperative, silent card climb for phones. Everyone holds a hidden hand of ' +
      'numbered leaves and must play them onto one shared pile in strictly ascending order - with no ' +
      'talking about the numbers. Play out of turn and the grove loses a bud. Clear every tier to ' +
      'win. Still in testing.',
    howToPlay: [
      {
        title: 'Hold your leaves',
        body: 'You get a secret hand of numbered leaves. No one may say or hint at their numbers.',
      },
      {
        title: 'Play in order',
        body: 'Together, play every leaf onto the shared trunk lowest-first. A leaf out of order costs a bud.',
      },
      {
        title: 'Climb the tiers',
        body: 'Clear a tier to deal a bigger hand. Clear the final tier before the buds run out to win.',
      },
    ],
    categories: ['Co-op', 'Party', 'Memory'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Nightleaf',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Nightleaf - a cooperative silent card game | Branch Out Games',
    seoDescription:
      'Nightleaf is a phone-first cooperative card game in insider testing. Play a hidden hand of ' +
      'numbered leaves onto a shared pile in ascending order, in total silence, without losing a bud.',
  },
  // Sketchy is insider-only (spec 0063), so this entry exists only to satisfy the completeness check;
  // PUBLIC_GAME_CATALOG excludes it from the public /games index, feature pages, and sitemap. Its
  // share card is a placeholder (no public raster for an insider game).
  sketchy: {
    description:
      'Sketchy is a draw-and-guess party game for phones. Everyone gets a secret seed and draws it, ' +
      'then writes fake prompts (decoys) for each sketch. Pick out the real seed hidden among the ' +
      'decoys - and score every time your decoy fools someone. Still in testing.',
    howToPlay: [
      {
        title: 'Draw your seed',
        body: 'You get a secret prompt only you can see. Draw it on your phone before the timer ends.',
      },
      {
        title: 'Write a decoy',
        body: 'For every other sketch, write a fake prompt convincing enough to fool the room.',
      },
      {
        title: 'Find the true seed',
        body: 'Pick the real prompt from the decoys; guessing right and fooling players both score.',
      },
    ],
    categories: ['Drawing', 'Bluffing', 'Party'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Sketchy',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Sketchy - a draw-and-guess party game | Branch Out Games',
    seoDescription:
      'Sketchy is a phone-first draw-and-guess party game in insider testing. Draw your secret seed, ' +
      'write decoys for other sketches, and pick the real prompt hidden among the fakes.',
  },
  // Whispergrove is insider-only (spec 0062): the entry exists so the build-time "every registered
  // game needs marketing copy" check passes, but PUBLIC_GAME_CATALOG below excludes it, so it never
  // appears on the public /games index, the feature pages, or the sitemap. Its share card is a
  // placeholder (no public raster is generated for an insider game); it satisfies the shape check.
  whispergrove: {
    description:
      'Whispergrove is a two-team word-grid game for phones. Twenty-five leaves fill a grove; a ' +
      'secret key marks nine for one grove, eight for the other, seven saplings, and one Deadwood. ' +
      'Each grove has one Whisperer who alone sees the key and gives a one-word whisper plus a ' +
      'number; their grove taps leaves to link them. First grove to reveal all its leaves wins - ' +
      'but tap the Deadwood and your grove falls. Still in testing.',
    howToPlay: [
      {
        title: 'Deal the grove',
        body: 'Two groves form. Each grove picks one Whisperer, who alone sees the secret key on the 25-leaf grove.',
      },
      {
        title: 'Whisper a link',
        body: 'On your grove turn the Whisperer gives one word and a number, hinting how many leaves it links.',
      },
      {
        title: 'Tap and race',
        body: 'Your grove taps leaves. Link all yours first to win - but never wake the Deadwood.',
      },
    ],
    categories: ['Word', 'Teams', 'Deduction'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Whispergrove',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Whispergrove - a two-team word-grid game | Branch Out Games',
    seoDescription:
      'Whispergrove is a phone-first two-team word-grid game in insider testing. A Whisperer who ' +
      'alone sees the secret key gives one-word whispers; your grove taps leaves to link them first.',
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
  // Chess is insider-only (spec 0056): the entry exists so the build-time "every registered game needs
  // marketing copy" check passes, but PUBLIC_GAME_CATALOG below excludes it, so it never appears on the
  // public /games index, the feature pages, or the sitemap. Its share card is a placeholder (no public
  // raster is generated for an insider game); it satisfies the shape check.
  chess: {
    description:
      'Chess is the classic game of strategy for two, built for phones. Full standard rules - ' +
      'castling, en passant, and pawn promotion - with every legal move enforced by the server, ' +
      'including check, checkmate, and stalemate. Violet and Amber armies on a warm wood board.',
    howToPlay: [
      {
        title: 'Move a piece',
        body: 'Tap one of your pieces to select it; its legal squares light up. Tap a highlighted square to move there.',
      },
      {
        title: 'Use the special moves',
        body: 'Castle your king to safety, capture en passant, and promote a pawn that reaches the far rank - the board offers them when they are legal.',
      },
      {
        title: 'Deliver checkmate',
        body: 'Attack the enemy king so it cannot escape, block, or be defended. Stalemate or bare kings draw the game.',
      },
    ],
    categories: ['Classic', 'Strategy', 'Two-player'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Chess',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Chess - the classic strategy board game | Branch Out Games',
    seoDescription:
      'Chess is a phone-first two-player strategy game in insider testing. Full standard rules with ' +
      'castling, en passant, promotion, and checkmate, every move enforced by the server.',
  },
  'odd-bird': {
    description:
      'Odd Bird is a hidden-role deduction party game for phones. Everyone shares a secret roost ' +
      'and a distinct perch at it - except one odd bird, who knows only that they are the odd bird. ' +
      'Ask each other pointed questions out loud, expose the odd bird with the flush vote, and never ' +
      'give the roost away. Still in insider testing.',
    howToPlay: [
      {
        title: 'Check your card',
        body: 'Everyone gets the same roost and a secret perch on their own phone - except one odd bird.',
      },
      {
        title: 'Question the flock',
        body: 'Take turns asking pointed questions out loud. Answers must fit the roost without naming it.',
      },
      {
        title: 'Call the flush',
        body: 'Vote on who the odd bird is. The flock wins by flushing them; the odd bird wins by hiding or naming the roost.',
      },
    ],
    categories: ['Deduction', 'Party', 'Hidden role'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Odd Bird',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Odd Bird - a hidden-role deduction game | Branch Out Games',
    seoDescription:
      'Odd Bird is a phone-first hidden-role deduction party game in insider testing. Everyone shares ' +
      'a secret roost and role except one odd bird - ask questions, flush them out, and keep the ' +
      'roost hidden.',
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
  // Same Branch is insider-only (spec 0058): the entry exists so the build-time "every registered
  // game needs marketing copy" check passes, but PUBLIC_GAME_CATALOG excludes it. Its share card is a
  // placeholder (no public raster is generated for an insider game).
  'same-branch': {
    description:
      'Same Branch is a spectrum-guessing party game for phones. Each round one player - the Reader - ' +
      'sees a hidden spot (the bud) on a branch that runs between two opposites, and gives a one-line ' +
      'hunch. The grove moves the sap line to guess where the bud is, scoring by how close they land. ' +
      'Still in testing.',
    howToPlay: [
      {
        title: 'Read the bud',
        body: 'The Reader alone sees the hidden bud on the branch and gives a one-line hunch that fits it.',
      },
      {
        title: 'Move the sap line',
        body: 'Everyone else drags the sap line to where they think the bud sits between the two ends.',
      },
      {
        title: 'Score by closeness',
        body: 'Reveal the bud and score each guess - a bullseye is worth the most, a wild miss nothing.',
      },
    ],
    categories: ['Party', 'Deduction', 'Wit'],
    shareImage: '/share-trivia.png',
    shareAlt: 'Branch Out Same Branch',
    badge: { label: 'Insider', variant: 'primary' },
    seoTitle: 'Same Branch - a spectrum-guessing party game | Branch Out Games',
    seoDescription:
      'Same Branch is a phone-first spectrum-guessing party game in insider testing. One Reader gives ' +
      'a one-line hunch for a hidden spot on a branch; the grove guesses how close they can land.',
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

/**
 * Resolve a feature-page entry by slug for a given SURFACE (spec 0030). A public game resolves on
 * both the apex and the insider surface; an insider-only game (spec 0043) resolves ONLY when the
 * request is on the insider surface, and is undefined on the apex - so an insider slug still 404s
 * publicly (it must never exist on the public site) but renders behind the insider gate. This is the
 * surface-aware path the feature page uses; it does NOT weaken {@link getCatalogEntry}'s public-only
 * guarantee (the SEO/JSON-LD/sitemap helpers stay public-only).
 *
 * LOAD-BEARING INVARIANT: `surface.insider` is trustworthy only because `middleware.ts` decides it
 * from the request HOST (the insider subdomain), not from anything a client can spoof, and rewrites
 * every insider-host `/games/*` request into the gated `/insider` tree that auth-walls non-insiders.
 * An insider game therefore resolves here ONLY behind that gate. A future middleware/matcher change
 * that stopped host-gating `/games/*` would silently let an insider slug resolve on the apex - keep
 * the host rewrite and the insider layout gate in lockstep with this branch.
 */
export function getFeatureEntry(
  slug: string | undefined | null,
  surface: { insider: boolean },
): GameCatalogEntry | undefined {
  const module = getGameUi(slug);
  if (!module) return undefined;
  if (!isPublicGame(module) && !surface.insider) return undefined;
  return toEntry(module);
}

// Client/server module hygiene (spec 0065 review): the client `GameCard` imports the card-facing
// exports below (`GameCardData`, `GameBadge`, `featurePath`, `playHref`, `startGameHref`) from this
// module, which ALSO holds the SEO-heavy `MARKETING` copy and `gameJsonLd`/`gameFeatureMetadata`. The
// pure helpers and types are trivially tree-shakeable, so `GameCard` (which imports only those) pulls
// no marketing copy into the client bundle. A clean split into a client-only module was considered and
// deliberately NOT done: `getGameCard` sources a game's card badge from `MARKETING` (via `toEntry`), so
// resolving card data is inherently a catalog concern - and `getGameCard` is already imported by client
// components (LandingContent, GamePicker, Lobby), which pull `MARKETING` in regardless. Extracting only
// the pure helpers would be cosmetic churn without removing that dependency. Left as-is on tree-shaking.
/**
 * The single display shape the unified game card consumes (spec 0065): the registry basics (name,
 * mark, one-line summary), the catalog badge, the library tags, the hero art, and the insider flag -
 * merged here so every surface does ONE lookup instead of three. Adding a game stays "a module + a
 * catalog entry + a library entry"; the card never reaches into three data layers itself.
 */
export interface GameCardData {
  slug: string;
  name: string;
  summary: string;
  /** The game's on-theme mark as an inline SVG string (from the registry / brand package). */
  icon: string;
  /** The wide 16:9 hero as an inline SVG string, or the mark when the game ships no hero. */
  hero: string;
  /** The card badge (label + canopy variant), e.g. `Featured`, `New`, or `Insider`. */
  badge: GameBadge;
  /** The game's library tags, resolved to display labels, for the card's chip row. */
  tags: LibraryChip[];
  /** Whether this game is insider-only (spec 0043) - drives the extra top-right "Insiders" badge. */
  insider: boolean;
}

/**
 * Resolve a game's card data by slug (== registry id), or undefined for an unknown game. Merges the
 * registry module, its marketing badge, its library tags, and its hero art into the one shape the card
 * reads. Works for public AND insider games (the insider landing lists insider-only entries), so it
 * uses the full registry, not the public catalog.
 */
export function getGameCard(slug: string | undefined | null): GameCardData | undefined {
  const module = getGameUi(slug);
  if (!module) return undefined;
  const entry = toEntry(module);
  const meta = getLibraryMeta(module.id);
  return {
    slug: module.id,
    name: module.name,
    summary: module.summary,
    icon: module.icon,
    hero: GAME_HERO[module.id] ?? module.icon,
    badge: entry.badge,
    tags: meta?.tags ?? [],
    insider: entry.visibility === 'insider',
  };
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

/** The Next.js metadata for a PUBLIC feature page: unique title/description, canonical, and
 *  OG/Twitter reusing the game's share card. Takes the already-resolved public entry (like
 *  `insiderFeatureMetadata`/`gameJsonLd`), so the caller resolves the slug once - passing an insider
 *  entry here would emit an indexable public share card, so only call it for a `visibility: 'public'`
 *  entry (the feature page branches on that before calling). */
export function gameFeatureMetadata(entry: GameCatalogEntry): Metadata {
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

/**
 * The metadata for an INSIDER feature page (spec 0030): a plain title + description marked
 * `noindex, nofollow`, with NO canonical, OG/Twitter share card, or JSON-LD. The insider surface is
 * gated (the layout auth-walls it), so a crawler never reaches these pages - and they must never be
 * indexed or leak the game even if one did. Only public games carry the full SEO block above.
 */
export function insiderFeatureMetadata(entry: GameCatalogEntry): Metadata {
  return {
    title: entry.seoTitle,
    description: entry.seoDescription,
    robots: { index: false, follow: false },
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
