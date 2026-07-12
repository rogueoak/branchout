// Client boundary: like LandingContent, this composes canopy Twigs (Card) whose module-scope
// createContext cannot prerender from a Server Component (see docs/overview/learnings.md, Theming).
// The async session read stays in the parent Server Component (page.tsx).
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { Viewer } from '../../lib/session';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';

// The games available to try on the insiders surface. Empty for now: test games are added here by
// later specs. Kept as a named list so the page renders the same grid the main site uses once it
// fills in.
const INSIDER_GAMES: { slug: string; name: string; summary: string }[] = [];

export function InsidersHome({ viewer }: { viewer: Viewer }) {
  return (
    // Same shell as the main surfaces (flex column, shared footer pinned via mt-auto) so the
    // insiders app inherits the site look and feel. The "Insiders" badge in the nav marks the
    // surface (spec 0035).
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <TopNav viewer={viewer} label="Insiders" />

      <section
        aria-labelledby="insiders-heading"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 sm:py-16"
      >
        <h1 id="insiders-heading" className="text-h2 text-text">
          Insiders
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

      <Footer />
    </div>
  );
}
