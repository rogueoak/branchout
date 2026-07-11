import type { Metadata } from 'next';
import { TopNav } from '../../components/TopNav';
import { GAME_CATALOG, featurePath } from '../../lib/games/catalog';
import { getViewer } from '../../lib/session';

// The games index (spec 0030): an unauthenticated, server-rendered list of every game, each card
// linking to that game's feature page (learn first, then play). SEO-friendly and the target of the
// top nav's "Games" link (spec 0028). Cards are plain markup (no canopy twigs) so this stays a
// Server Component; the nav is the only client boundary and renders the viewer server-side.

export const metadata: Metadata = {
  title: 'Games - Branch Out Games',
  description:
    'Browse the party games you can play on Branch Out - fast, phone-first, and free. Start a room, ' +
    'share the code, and play with whoever joins.',
  alternates: { canonical: '/games' },
};

export default async function GamesIndexPage() {
  const viewer = await getViewer();

  return (
    <div className="min-h-screen bg-bg text-text">
      <TopNav viewer={viewer} />

      <section aria-labelledby="games-heading" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <header className="mb-10 flex flex-col gap-3 text-center">
          <h1 id="games-heading" className="text-display text-text">
            Games
          </h1>
          <p className="text-body text-text-muted mx-auto max-w-xl">
            Fast, phone-first party games. Pick one to learn how it plays, then start a room.
          </p>
        </header>

        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2" role="list">
          {GAME_CATALOG.map((game) => (
            <li key={game.slug}>
              {/* A descriptive accessible name per card - the visible "Learn more" text repeats across
                  cards (an a11y anti-pattern), so the link is labelled by the game it opens. */}
              <a
                href={featurePath(game.slug)}
                aria-label={`Learn about ${game.name}`}
                className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-block h-12 w-12 shrink-0 overflow-hidden rounded-xl [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: game.icon }}
                  />
                  <h2 className="text-h4 text-text break-words">{game.name}</h2>
                </div>
                <p className="text-body-sm text-text-muted">{game.summary}</p>
                <span className="text-body-sm mt-auto font-medium text-primary">Learn more</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
