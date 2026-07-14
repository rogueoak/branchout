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
import { INSIDER_GAME_UI_LIST } from '../../lib/games/registry';
import { playHref } from '../../lib/games/catalog';

// The games available to try on the insider surface (spec 0043): every registry module marked
// insider-only. The reusable GameCard renders the game's mark so the card matches the room picker;
// a friendly empty state stands in when no test games are live.
const INSIDER_GAMES = INSIDER_GAME_UI_LIST;

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
      <TopNav viewer={viewer} label="Insider" linkOrigin={apexOrigin || undefined} />

      <section
        aria-labelledby="insider-heading"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 sm:py-16"
      >
        <h1 id="insider-heading" className="text-h2 text-text">
          Insider
        </h1>
        <p className="text-body text-text-muted mt-2 max-w-xl">
          Early access to games we are still building. Try them out and tell us what breaks - your
          feedback shapes what ships.
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
              // The whole card links to the room-create deep link for the game, so an insider starts
              // a room in one tap. The link is RELATIVE (feedback 0029): the insider host now hosts
              // the room flow (rewritten into /insider/rooms), so play stays on the insider surface
              // instead of bouncing to the apex.
              <a
                key={game.id}
                href={playHref(game.id)}
                aria-label={`Start a room to test ${game.name}`}
                className="rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <GameCard game={game} />
              </a>
            ))}
          </div>
        )}
      </section>

      <Footer linkOrigin={apexOrigin} />
    </div>
  );
}
