// Client boundary: like LandingContent, this composes canopy Twigs (Card) whose module-scope
// createContext cannot prerender from a Server Component (see docs/overview/learnings.md, Theming).
// The async session read stays in the parent Server Component (page.tsx).
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { Viewer } from '../../lib/session';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';

// The games available to try on the insider surface. Empty for now: test games are added here by
// later specs. Kept as a named list so the page renders the same grid the main site uses once it
// fills in.
const INSIDER_GAMES: { slug: string; name: string; summary: string }[] = [];

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
              <Card key={game.slug} className="h-full">
                <CardHeader>
                  <CardTitle>{game.name}</CardTitle>
                  <CardDescription>{game.summary}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            ))}
          </div>
        )}
      </section>

      <Footer linkOrigin={apexOrigin} />
    </div>
  );
}
