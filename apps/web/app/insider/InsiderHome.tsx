// Client boundary: like LandingContent, this composes canopy Twigs (Card) whose module-scope
// createContext cannot prerender from a Server Component (see docs/overview/learnings.md, Theming).
// The async session read stays in the parent Server Component (page.tsx).
'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { Viewer } from '../../lib/session';
import type { Surface } from '../../lib/surface';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';
import { GameCard } from '../../components/game/GameCard';
import { GAME_CATALOG, getGameCard, type GameCardData } from '../../lib/games/catalog';

// The games available to try on the insider surface (spec 0043): every catalog entry marked
// insider-only, resolved to the one unified card shape (spec 0065) so the insider cards render exactly
// like the main-site teaser and the /games index and cannot drift. Each card carries the "Insiders"
// badge (top-right), the game's hero + tags, a "Play now" button, and a "Details" link to the game's
// page. A friendly empty state stands in when no test games are live.
const INSIDER_GAMES = GAME_CATALOG.filter((game) => game.visibility === 'insider')
  .map((game) => getGameCard(game.slug))
  // Explicit type-predicate guard (matches app/games/page.tsx) so the list narrows to GameCardData.
  .filter((game): game is GameCardData => game !== undefined);

export function InsiderHome({ viewer, surface }: { viewer: Viewer; surface: Surface }) {
  // This surface lives on the insider subdomain, where middleware rewrites every path into the
  // /insider tree - so the shared nav/footer's apex links (/games, /privacy, ...) must cross back to
  // the apex or they 404. `surface.linkOrigin` (the host-derived apex origin, feedback 0029) is that
  // cross-origin; the game cards' own play links stay relative so play stays on this surface.
  const apexOrigin = surface.linkOrigin;
  return (
    // Same shell as the main surfaces (flex column, shared footer pinned via mt-auto) so the
    // insider app inherits the site look and feel. The "Insider" badge in the nav marks the
    // surface (spec 0035).
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <TopNav viewer={viewer} label="Insider" linkOrigin={apexOrigin || undefined} insider />

      <section
        aria-labelledby="insider-heading"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 sm:py-16"
      >
        {/* One centered welcome that carries the insider identity and the invitation (feedback 0030),
            good at 360px: the heading and message are centered, the message capped to a readable
            measure and centered in the column. */}
        <h1 id="insider-heading" className="text-h2 text-text text-center">
          Branch Out Games for Insiders
        </h1>
        <p className="text-body text-text-muted mt-2 mx-auto max-w-xl text-center">
          Welcome. Here you will find unreleased games still in testing. Give them a while, then
          tell us what breaks - your feedback shapes what ships.
        </p>

        {INSIDER_GAMES.length === 0 ? (
          // Empty state: no test games are live yet. Reads as intentional, not broken.
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>No test games yet</CardTitle>
              <CardDescription>
                Nothing to try right now. When a game opens for testing, it shows up here - check
                back soon.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {INSIDER_GAMES.map((game) => (
              // The one unified game card (spec 0065). "Play now" is the RELATIVE room-create deep
              // link (feedback 0029) so play stays on the insider surface (rewritten into
              // /insider/rooms). Details is OFF here: it links to /games/<slug>, which has no route on
              // the insider host and notFound()s on the apex (getCatalogEntry is public-only). The
              // insider per-game page arrives in spec 0030, which will re-enable Details on this
              // surface. The "Insiders" badge shows top-right (game.insider is true for every entry).
              <GameCard key={game.slug} game={game} showDetails={false} />
            ))}
          </div>
        )}
      </section>

      <Footer linkOrigin={apexOrigin} />
    </div>
  );
}
