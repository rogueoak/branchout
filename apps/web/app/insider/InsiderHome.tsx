// Client boundary: like LandingContent, this composes canopy Twigs (Card) whose module-scope
// createContext cannot prerender from a Server Component (see docs/overview/learnings.md, Theming).
// The async session read stays in the parent Server Component (page.tsx).
'use client';

import { buttonVariants } from '@rogueoak/canopy';
import { Card, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { Viewer } from '../../lib/session';
import type { Surface } from '../../lib/surface';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';
import { GameListCard } from '../../components/game/GameListCard';
import { HowToPlayButton } from '../../components/game/HowToPlayButton';
import { GAME_CATALOG, playHref } from '../../lib/games/catalog';

// The games available to try on the insider surface (spec 0043): every catalog entry marked
// insider-only. These are the full marketing entries (badge, summary, mark) so the insider cards
// render the same shared GameListCard - badge + hero art - as the main-site teaser and cannot drift.
// Insider games ship no wide hero of their own, so the card falls back to the game mark (below); a
// friendly empty state stands in when no test games are live.
const INSIDER_GAMES = GAME_CATALOG.filter((game) => game.visibility === 'insider');

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
              // The shared game card (same as the main-site teaser: badge + hero art) with its
              // controls INSIDE the card body. The card itself is NOT a link - the "Play now" button
              // is the link and "How to play" is its own button, so there is no interactive-in-
              // interactive a11y violation (no <a>/<button> nested in a card link). Insider games ship
              // no wide hero, so the card leads with the game mark instead.
              <GameListCard
                key={game.slug}
                game={game}
                hero={game.icon}
                footer={
                  // The two controls. DOM order: "Play now" first, so on mobile it STACKS ON TOP
                  // (flex-col default) with "How to play" below it. From sm up, sm:flex-row-reverse
                  // lays them in a row and flips the order, landing "Play now" on the RIGHT and "How
                  // to play" on the left. sm:items-center aligns them on the shared baseline.
                  <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
                    {/* Play now: the RELATIVE room-create deep link (feedback 0029) so play stays on
                        the insider surface (rewritten into /insider/rooms), not bounced to the apex.
                        A real <a> (the card is no longer the link), styled with the primary button
                        recipe - the card's PRIMARY affordance. */}
                    <a
                      href={playHref(game.slug)}
                      aria-label={`Play ${game.name} now`}
                      className={buttonVariants({ variant: 'primary', size: 'sm' })}
                    >
                      Play now
                    </a>
                    {/* How to play: its own button that opens the game's rules sheet (spec 0051) -
                        insider games have no public feature page, so this is their only rules surface.
                        Text-only here (showIcon={false}); the in-game GameStage toolbar keeps its icon. */}
                    <HowToPlayButton game={game.slug} showIcon={false} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>

      <Footer linkOrigin={apexOrigin} />
    </div>
  );
}
