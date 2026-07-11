// Client boundary: canopy ships its Twigs (Card) without a `use client` directive, and Card calls
// `React.createContext` at module scope - imported into a Server Component it fails to prerender
// (see docs/overview/learnings.md, Theming). The consumer owns the boundary, so this file declares
// it. The async session read stays in the parent Server Component (page.tsx).
'use client';

import { Badge, buttonVariants } from '@rogueoak/canopy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import { liarLiarSvg } from '@branchout/brand/liarliar';
import { triviaSvg } from '@branchout/brand/trivia';
import type { Viewer } from '../lib/session';
import { Footer } from './Footer';
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

// The games teaser. Each card is a link into the play path (signup when anonymous, rooms when
// signed in). Keep this a plain list so adding a game is adding an entry, matching the pluggable
// game architecture behind it.
const GAMES = [
  {
    name: 'Trivia',
    icon: triviaSvg,
    badge: 'Featured',
    badgeVariant: 'info' as const,
    description: '1,600 questions across 8 categories. Rounds are fast; scores settle the debate.',
    detail: 'Nature, Food, Animals, Science, People, Places, Things, History',
  },
  {
    name: 'Liar Liar',
    icon: liarLiarSvg,
    badge: 'New',
    badgeVariant: 'success' as const,
    description:
      'Bluff your friends: write a convincing fake answer to a wild-but-true clue, then pick the real one hidden among all the fakes.',
    detail: 'Famous People, Places, Events, Sports, Food, Nature, Animals, Things',
  },
];

export function LandingContent({ viewer }: LandingContentProps) {
  const primaryCta = viewer.signedIn
    ? { label: 'Play now', href: '/rooms' }
    : { label: 'Sign up free', href: '/signup' };

  return (
    <div className="bg-bg text-text">
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
          {/* Each card is a link into the play path: an anonymous visitor lands on signup, a
              signed-in one on the rooms home to start a game. The whole card is the target so it
              is an easy tap on a phone. */}
          {GAMES.map((game) => (
            <a
              key={game.name}
              href={primaryCta.href}
              aria-label={`Play ${game.name} - start a game`}
              className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  {/* Icon and title sit on one row: the game mark leads, the name beside it. The
                      mark is a build-time SVG string from the brand package (not user input),
                      inlined the same way the Wordmark renders the app icon. It carries its own
                      dark tile, so the wrapper just rounds it; aria-hidden because the card title
                      and the link's aria-label already name the game. */}
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="inline-block h-12 w-12 shrink-0 overflow-hidden rounded-xl [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: game.icon }}
                    />
                    <CardTitle asChild>
                      <h3>{game.name}</h3>
                    </CardTitle>
                  </div>
                  <Badge variant={game.badgeVariant} className="mt-1 w-fit">
                    {game.badge}
                  </Badge>
                  <CardDescription>{game.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-body-sm text-text-muted">{game.detail}</p>
                  <p className="text-body-sm mt-4 flex items-center gap-1.5 font-medium text-primary">
                    Start a game
                    <ArrowRightIcon />
                  </p>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
        <p className="mt-6 text-body-sm text-text-muted">More games on the way.</p>
      </section>

      {/* Shared footer with the Privacy and Terms links (spec 0031). */}
      <Footer />
    </div>
  );
}
