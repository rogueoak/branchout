// Client boundary: canopy ships its Twigs (Card) without a `use client` directive, and Card calls
// `React.createContext` at module scope - imported into a Server Component it fails to prerender
// (see docs/overview/learnings.md, Theming). The consumer owns the boundary, so this file declares
// it. The async session read stays in the parent Server Component (page.tsx).
'use client';

import { Badge, buttonVariants } from '@rogueoak/canopy';
import { heroLiarLiarSvg } from '@branchout/brand/hero-liarliar';
import { heroTriviaSvg } from '@branchout/brand/hero-trivia';
import { PUBLIC_GAME_CATALOG, featurePath, playHref } from '../lib/games/catalog';
import type { Viewer } from '../lib/session';
import { Footer } from './Footer';
import { GameListCard } from './game/GameListCard';
import { TopNav } from './TopNav';

interface LandingContentProps {
  viewer: Viewer;
}

/**
 * A right-pointing arrow, drawn as an SVG so the "Start a game" affordance is a real icon rather
 * than an ASCII "->". Canopy does not export a general-purpose arrow, so we inline it the same way
 * FinalResults draws its star; `currentColor` lets it inherit the link's primary colour.
 */
function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-4"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

// The wide hero illustration for each game teaser card, keyed by the catalog slug (spec 0046). Build-
// time SVG strings from the brand package (not user input), inlined the same way the game marks are.
// A slug with no hero (e.g. a future game) falls back to the game mark below, so the card still leads
// with art (the shared GameListCard always renders a hero box).
const GAME_HERO: Record<string, string> = {
  trivia: heroTriviaSvg,
  'liar-liar': heroLiarLiarSvg,
};

// How it works: three steps from join code to playing.
const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Make a room',
    body: 'Pick a game and start a room as the host. You get a short join code.',
  },
  {
    step: '2',
    title: 'Share the code',
    body: 'Anyone with the code can join - no account needed.',
  },
  {
    step: '3',
    title: 'Play together',
    body: 'Play, earn stars, and run another game when you are done.',
  },
];

export function LandingContent({ viewer }: LandingContentProps) {
  // Signed-in "Play now" points at /games so the player picks a game before creating a room (spec
  // 0046); the signed-out "Sign up free" still goes to /signup.
  const primaryCta = viewer.signedIn
    ? { label: 'Play now', href: '/games' }
    : { label: 'Sign up free', href: '/signup' };

  return (
    // flex min-h-screen flex-col so the shared Footer's `mt-auto` pins to the bottom the same way it
    // does on /rooms and /join - one consistent footer contract across surfaces (spec 0031 review).
    <div className="flex min-h-screen flex-col bg-bg text-text">
      {/* The shared top nav (spec 0028) replaces the old bespoke header. The hero below already owns
          the primary "Sign up free" CTA, so the nav's Sign up is de-emphasized (outline) here to keep
          one primary per view. */}
      <TopNav viewer={viewer} signupVariant="outline" />

      {/* Hero */}
      <section
        aria-labelledby="hero-heading"
        className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24"
      >
        <h1 id="hero-heading" className="text-display text-text">
          where game night grows
        </h1>
        <p className="text-body text-text-muted max-w-xl">
          Start a room, share the code, and play games with whoever joins. No setup. No fuss.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href={primaryCta.href} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            {primaryCta.label}
          </a>
          <a href="#games" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Browse games
          </a>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <h2 id="how-heading" className="text-h2 mb-10 text-center text-text">
          How it works
        </h2>
        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-3" role="list">
          {HOW_IT_WORKS.map(({ step, title, body }) => (
            <li key={step} className="flex flex-col gap-3">
              <Badge variant="primary" className="w-fit">
                {step}
              </Badge>
              <h3 className="text-h4 text-text">{title}</h3>
              <p className="text-body-sm text-text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Games teaser */}
      <section
        id="games"
        aria-labelledby="games-heading"
        className="mx-auto max-w-5xl px-4 py-16 sm:px-6"
      >
        <h2 id="games-heading" className="text-h2 mb-10 text-center text-text">
          What you can play
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {/* Each card links to the game's feature page (learn first); the feature page carries the
              "Start a game" CTA into the play path (spec 0030). The whole card is the tap target, and
              the marketing data comes from the shared catalog so the teaser never drifts from the
              feature page or the room picker. */}
          {PUBLIC_GAME_CATALOG.map((game) => {
            // The hero: the game's wide illustration, or its mark as a fallback so the card still
            // leads with art (the shared GameListCard always renders a hero box). Public games ship a
            // hero today; the fallback covers a future public game before its hero lands.
            const hero = GAME_HERO[game.slug] ?? game.icon;
            // A signed-in player who already knows the game gets a "Play" shortcut below the card that
            // skips the learn hop straight into the room deep link. Hoisted (no inline JSX ternary).
            let playShortcut = null;
            if (viewer.signedIn) {
              playShortcut = (
                <a
                  href={playHref(game.slug)}
                  aria-label={`Play ${game.name} now`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Play now
                </a>
              );
            }
            return (
              // The whole card links to the feature page (learn first). The signed-in "Play" link is a
              // SIBLING of the card link (not nested) so the markup stays valid.
              <div key={game.slug} className="flex flex-col gap-2">
                <a
                  href={featurePath(game.slug)}
                  aria-label={`Learn about ${game.name}`}
                  className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <GameListCard
                    game={game}
                    hero={hero}
                    className="transition-colors hover:border-primary"
                  >
                    <p className="text-body-sm text-text-muted">{game.categories.join(', ')}</p>
                    <p className="text-body-sm mt-4 flex items-center gap-1.5 font-medium text-primary">
                      Learn more
                      <ArrowRightIcon />
                    </p>
                  </GameListCard>
                </a>
                {playShortcut}
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-body-sm text-text-muted">More games on the way.</p>
      </section>

      {/* Shared footer with the Privacy and Terms links (spec 0031). */}
      <Footer />
    </div>
  );
}
