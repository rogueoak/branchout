// Client boundary: like LandingContent, this composes canopy Twigs (Card) whose module-scope
// createContext cannot prerender from a Server Component (see docs/overview/learnings.md, Theming).
// The async session read stays in the parent Server Component (page.tsx).
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { Viewer } from '../../lib/session';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';
import { INSIDER_GAME_UI_LIST } from '../../lib/games/registry';
import { playHref } from '../../lib/games/catalog';

// The games available to try on the insider surface (spec 0043): every registry module marked
// insider-only. Each card links to the apex room-create deep link for that game, so an insider can
// start a solo room in one tap. Falls back to a friendly empty state when no test games are live.
const INSIDER_GAMES: { slug: string; name: string; summary: string; tagline: string }[] =
  INSIDER_GAME_UI_LIST.map((module) => ({
    slug: module.id,
    name: module.name,
    summary: module.summary,
    tagline: module.tagline,
  }));

export function InsiderHome({ viewer }: { viewer: Viewer }) {
  // The apex origin. The shared nav/footer link to apex pages (/games, /privacy, ...), but this
  // surface lives on the insider subdomain where middleware rewrites every path into the /insider
  // tree - so those links must cross back to the apex or they 404. Falls back to relative when the
  // origin is unset (local dev on one host). (spec 0035)
  const apexOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  return (
    // Same shell as the main surfaces (flex column, shared footer pinned via mt-auto) so the
    // insider app inherits the site look and feel. The "Insider" badge in the nav marks the
    // surface (spec 0035).
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <TopNav viewer={viewer} label="Insider" linkOrigin={apexOrigin} />

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
              // The whole card links to the apex room-create deep link for the game, so an insider
              // starts a solo room in one tap. The deep link crosses back to the apex origin (this
              // surface lives on the insider subdomain), reusing the apexOrigin pattern above.
              <a
                key={game.slug}
                href={`${apexOrigin}${playHref(game.slug)}`}
                aria-label={`Start a room to test ${game.name}`}
                className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Card className="h-full transition-colors hover:border-primary">
                  <CardHeader>
                    <CardTitle>{game.name}</CardTitle>
                    <CardDescription>{game.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-body-sm text-text-muted">{game.summary}</p>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        )}
      </section>

      <Footer linkOrigin={apexOrigin} />
    </div>
  );
}
