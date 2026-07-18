import type { Metadata } from 'next';
import { ComingSoonBanner } from '../../components/ComingSoonBanner';
import { TopNav } from '../../components/TopNav';
import { GamesBrowser } from '../../components/game/GamesBrowser';
import { PUBLIC_GAME_CATALOG, getGameCard, type GameCardData } from '../../lib/games/catalog';
import { getViewer } from '../../lib/session';

// The games index (spec 0030, extended by spec 0051): an unauthenticated, server-rendered list of
// every public game, each card linking to that game's feature page (learn first, then play). A thin
// Server Component feeds the client `GamesBrowser` the catalog + each game's category/tag chips, so
// the list keeps SSR + the top-nav viewer read while gaining a client search box and category filter.
// SEO is preserved: the full list is server-rendered in the initial HTML; the browser only narrows it.

export const metadata: Metadata = {
  title: 'Games - Branch Out Games',
  description:
    'Browse the party games you can play on Branch Out - fast, phone-first, and free. Start a room, ' +
    'share the code, and play with whoever joins.',
  alternates: { canonical: '/games' },
};

export default async function GamesIndexPage() {
  const viewer = await getViewer();

  // Build the browser's game list on the server: one resolved card shape per public game (spec 0065),
  // merging the registry basics, the catalog badge, the library tags, and the hero art. Every public
  // game resolves (the completeness checks hold), so the filter drops any stray undefined defensively.
  const games: GameCardData[] = PUBLIC_GAME_CATALOG.map((game) => getGameCard(game.slug)).filter(
    (game): game is GameCardData => game !== undefined,
  );

  return (
    <div className="min-h-screen bg-bg text-text">
      <TopNav viewer={viewer} />

      <section aria-labelledby="games-heading" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <header className="mb-10 flex flex-col gap-3 text-center">
          <h1 id="games-heading" className="text-display text-text">
            Games
          </h1>
          <p className="text-body text-text-muted mx-auto max-w-xl">
            Fast, phone-first party games. Search or filter, pick one to learn how it plays, then
            start a room.
          </p>
        </header>

        <ComingSoonBanner />

        <GamesBrowser games={games} signedIn={viewer.signedIn} />
      </section>
    </div>
  );
}
