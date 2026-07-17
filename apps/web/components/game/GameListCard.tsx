'use client';

// The shared game listing card (spec 0046, extracted): the visual card used on BOTH the home teaser
// (LandingContent) and the insider hub (InsiderHome) so the two can never drift. It renders the wide
// hero illustration, the game mark + name, the catalog badge, and the one-line summary; the caller
// supplies the footer controls (the "Play now" / "How to play" affordances) so each surface keeps its
// own linking + a11y contract. Canopy Twigs (Card) call React.createContext at module scope (see
// docs/overview/learnings.md, Theming), so the consumer owns this 'use client' boundary.

import { Badge } from '@rogueoak/canopy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { ReactNode } from 'react';
import type { GameBadge } from '../../lib/games/catalog';

/** The display data one card needs - a subset of the catalog entry, so any list can build it. */
export interface GameListCardData {
  slug: string;
  name: string;
  summary: string;
  /** The game's on-theme mark as an inline SVG string (from the registry / brand package). */
  icon: string;
  /** The card badge (label + canopy variant), e.g. `Featured`, `New`, or `Insider`. */
  badge: GameBadge;
}

interface GameListCardProps {
  game: GameListCardData;
  /**
   * The wide hero illustration as an inline SVG string (a `hero-*` brand export). When a game has no
   * hero of its own (every insider game today), pass the game mark instead so the card still leads
   * with art - the same mark the header shows, scaled to fill the 16:9 hero box.
   */
  hero: string;
  /** Optional body content below the summary (e.g. category chips + a "Learn more" affordance). */
  children?: ReactNode;
  /** Controls rendered inside the card body (a footer): the "Play now" and "How to play" affordances. */
  footer?: ReactNode;
  /** Extra classes on the Card (the whole-card link on the home teaser adds its hover lift here). */
  className?: string;
}

/**
 * A game's listing card: hero art, mark + name, badge, and summary, with a caller-supplied footer for
 * the play/rules controls. Purely presentational - it carries no link and no interactivity of its own,
 * so a caller can wrap it in a link (home teaser) or place its own link controls in the footer
 * (insider hub) without nesting interactive elements.
 */
export function GameListCard({ game, hero, children, footer, className }: GameListCardProps) {
  const cardClassName = `flex h-full flex-col overflow-hidden ${className ?? ''}`.trim();
  // Hoisted so the JSX carries no inline ternary (conventions.md): render the footer wrapper only
  // when a caller supplies controls, and bottom-align it within the card body.
  let footerBlock: ReactNode = null;
  if (footer) {
    footerBlock = <div className="mt-auto pt-4">{footer}</div>;
  }
  return (
    <Card className={cardClassName}>
      {/* Wide hero illustration (spec 0046): a build-time SVG string from the brand package (not user
          input), inlined like the game mark. The 16:9 box scales the art down cleanly on a phone;
          block + w-full on the SVG stops any intrinsic width leaking past the card and overflowing the
          360px viewport. aria-hidden because the card title names the game. */}
      <div
        aria-hidden="true"
        className="aspect-[16/9] w-full overflow-hidden bg-[#0d0a15] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: hero }}
      />
      <CardHeader>
        {/* Icon and title on one row: the game mark leads, the name beside it. The mark is a
            build-time SVG string from the brand package (not user input), inlined the same way the
            Wordmark renders the app icon. min-w-0 + break-words so a long name cannot overflow the
            phone. aria-hidden because the card title names the game. */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-block h-12 w-12 shrink-0 overflow-hidden rounded-xl [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: game.icon }}
          />
          <CardTitle asChild>
            <h3 className="break-words">{game.name}</h3>
          </CardTitle>
        </div>
        <Badge variant={game.badge.variant} className="mt-1 w-fit">
          {game.badge.label}
        </Badge>
        <CardDescription>{game.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {children}
        {/* The controls area (Play / How to play): pinned to the card's bottom (mt-auto) so cards of
            differing summary length keep their controls aligned across the grid. */}
        {footerBlock}
      </CardContent>
    </Card>
  );
}
