// Client boundary: canopy ships its Twigs (Card) without a `use client` directive, and Card calls
// `React.createContext` at module scope - imported into a Server Component it fails to prerender
// (see docs/overview/learnings.md, Theming). The consumer owns the boundary, so this file declares
// it. The async session read stays in the parent Server Component (page.tsx).
'use client';

import { Badge, buttonVariants } from '@rogueoak/canopy';
import {
  FEATURED_GAME_CATALOG,
  PUBLIC_GAME_CATALOG,
  getGameCard,
  startGameHref,
} from '../lib/games/catalog';
import type { Viewer } from '../lib/session';
import { Footer } from './Footer';
import { GameCard } from './game/GameCard';
import { HomeHeroCarousel, type HomeHeroSlide } from './home/HomeHeroCarousel';
import { TopNav } from './TopNav';

interface LandingContentProps {
  viewer: Viewer;
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

export function LandingContent({ viewer }: LandingContentProps) {
  // Signed-in "Play now" points at /games so the player picks a game before creating a room (spec
  // 0046); the signed-out "Sign up free" still goes to /signup.
  const primaryCta = viewer.signedIn
    ? { label: 'Play now', href: '/games' }
    : { label: 'Sign up free', href: '/signup' };

  // One slide per FEATURED game (spec 0073) - the curated carousel subset, not every public game, so
  // the hero stays a spotlight as the roster grows (Reversi and Checkers stay public + playable on the
  // teaser grid and /games below, just off the carousel). Sourced from the shared catalog reader so the
  // slides never drift from the cards. Each slide carries both hero shapes: the portrait (3:4) for
  // phones and the wide (16:9) hero for md+. A featured game always ships a portrait, but we fall back
  // to its wide hero defensively so a new featured game can never render an empty portrait slide.
  const heroSlides: HomeHeroSlide[] = FEATURED_GAME_CATALOG.flatMap((entry) => {
    const game = getGameCard(entry.slug);
    if (!game) return [];
    return [
      {
        slug: game.slug,
        name: game.name,
        artPortrait: game.heroPortrait ?? game.hero,
        artLandscape: game.hero,
      },
    ];
  });

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
        {/* The hero carousel rotates through a portrait card per public game (spec 0067); the tagline
            below reads as its caption. */}
        {heroSlides.length > 0 && <HomeHeroCarousel slides={heroSlides} />}
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
          {/* One unified game card per public game (spec 0065): hero, mark + title, badge + tags, a
              brief summary, a "Play now" button, and a "Details" link to the feature page. The card
              data comes from the shared catalog reader so the teaser never drifts from the /games
              index, the insider hub, or the room picker. Play routes an anonymous visitor through
              signup first (startGameHref), a signed-in one straight into the room deep link. */}
          {PUBLIC_GAME_CATALOG.map((entry) => {
            const game = getGameCard(entry.slug);
            if (!game) return null;
            return (
              <GameCard
                key={game.slug}
                game={game}
                playHref={startGameHref(game.slug, viewer.signedIn)}
              />
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
