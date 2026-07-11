import { buttonVariants } from '@rogueoak/canopy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TopNav } from '../../../components/TopNav';
import {
  gameFeatureMetadata,
  gameJsonLd,
  getCatalogEntry,
  startGameHref,
} from '../../../lib/games/catalog';
import { getViewer } from '../../../lib/session';

// A per-game feature page (spec 0030): an unauthenticated, server-rendered landing page that sells
// the game (overview, how a round plays, categories) with strong SEO and a clear "Start a game" CTA
// deep-linking into the room flow (`?game=<slug>`, spec 0029). The nav renders the viewer server-side
// (spec 0028), matching the home page. `generateMetadata` sets the per-game SEO + OG; a JSON-LD
// VideoGame block adds structured data for rich results.

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Render per-request (SSR), not a static prerender. The shared nav reads the viewer (spec 0028), so
// the signed-in state must resolve per request - exactly like the home page and the /games index; a
// static prerender would bake in the signed-out nav and show "Sign up / Log in" to a signed-in
// visitor. SEO is unaffected: the server returns full HTML + the per-game metadata/JSON-LD to a
// crawler, and the sitemap (app/sitemap.ts) enumerates every feature route from the catalog. (We do
// not use `generateStaticParams` here for that reason; `getViewer`'s cookie read makes the route
// dynamic regardless.)

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return gameFeatureMetadata(slug) ?? { title: 'Game not found - Branch Out Games' };
}

export default async function GameFeaturePage({ params }: PageProps) {
  const { slug } = await params;
  const entry = getCatalogEntry(slug);
  if (!entry) notFound();
  const viewer = await getViewer();
  // Auth-aware CTA: signed-in -> straight into the room deep link; anonymous -> signup first,
  // preserving the game (a first-timer must not hit the "hosting needs an account" wall).
  const startHref = startGameHref(entry.slug, viewer.signedIn);

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* JSON-LD structured data (schema.org VideoGame) for rich results. The value is built from the
          catalog (not user input), so dangerouslySetInnerHTML is safe. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(gameJsonLd(entry)) }}
      />
      <TopNav viewer={viewer} />

      {/* Hero */}
      <section
        aria-labelledby="game-heading"
        className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-20"
      >
        {/* The mark is a build-time SVG string from the brand package (not user input), inlined like
            the Wordmark icon; aria-hidden because the heading names the game. */}
        <span
          aria-hidden="true"
          className="inline-block h-20 w-20 shrink-0 overflow-hidden rounded-2xl [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: entry.icon }}
        />
        <h1 id="game-heading" className="text-display text-text break-words">
          {entry.name}
        </h1>
        <p className="text-body text-text-muted max-w-xl">{entry.tagline}</p>
        <p className="text-body text-text-muted max-w-xl">{entry.description}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href={startHref} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Start a game
          </a>
          <a href="/games" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Browse all games
          </a>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h2 id="how-heading" className="text-h2 mb-10 text-center text-text">
          How to play
        </h2>
        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-3" role="list">
          {entry.howToPlay.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-3">
              <span className="text-h3 font-bold text-primary">{i + 1}</span>
              <h3 className="text-h4 text-text">{step.title}</h3>
              <p className="text-body-sm text-text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Categories */}
      <section aria-labelledby="cats-heading" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h2 id="cats-heading" className="text-h4 mb-4 text-text">
          Categories
        </h2>
        <ul className="flex flex-wrap gap-2" role="list">
          {entry.categories.map((category) => (
            <li
              key={category}
              className="text-body-sm rounded-full bg-surface-raised px-3 py-1 text-text-muted"
            >
              {category}
            </li>
          ))}
        </ul>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
        <h2 className="text-h2 text-text">Ready to play {entry.name}?</h2>
        <a href={startHref} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          Start a game
        </a>
      </section>

      <footer className="mx-auto max-w-5xl border-t border-border px-4 py-8 sm:px-6">
        <p className="text-body-sm text-text-muted">Branch Out Games - where game night grows.</p>
      </footer>
    </div>
  );
}
