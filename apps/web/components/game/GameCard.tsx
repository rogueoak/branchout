'use client';

// The one game card (spec 0065): a single configurable component that renders a game the same way on
// every surface - the home teaser, the /games index, the insider landing, and the lobby/room picker.
// It replaces the old bespoke `GameCard`, the shared `GameListCard`, and the two inline card renders,
// so the surfaces can never drift again. Modelled on the insider landing card (the best prior
// version): a 16:9 hero, the game mark + title inline, a badge under the title, a brief
// description, and a configurable Play/Details row. Library tags stay in `GameCardData` (they still
// feed the /games search and the game page) but are NOT rendered on the card - a row of tag pills read
// as clutter here, so the card keeps only the single badge. Canopy Twigs (Card) call React.createContext at
// module scope (see docs/overview/learnings.md, Theming), so the consumer owns this 'use client'
// boundary.
//
// Two shapes, never both: a selectable card (the picker) is a single pressable control
// (`aria-pressed`, selection ring) with no inner links; a listing card carries two independent actions
// (Play, Details). When `onSelect` is set the card IS the control and both affordances are off - so
// there is never a link nested inside a link (the "card as a link" learning).

import { Badge, buttonVariants } from '@rogueoak/canopy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { ReactNode } from 'react';
import { featurePath, playHref, type GameBadge, type GameCardData } from '../../lib/games/catalog';

interface GameCardProps {
  /** The resolved display data - one lookup per surface (see `getGameCard` in catalog.ts). */
  game: GameCardData;
  /** Render the "Play now" button (default true). Off in the lobby/picker. */
  showPlay?: boolean;
  /** Render the "Details" link to the game's page (default true). Off in the lobby/picker. */
  showDetails?: boolean;
  /** The "Play now" target. Defaults to the room deep link `playHref(slug)`; a public surface can
   *  pass `startGameHref(slug, signedIn)` so an anonymous visitor lands on signup first. */
  playHref?: string;
  /** When set, the whole card is a pressable control that picks this game (the picker / change-game
   *  flow). Mutually exclusive with the Play/Details affordances - both are forced off. */
  onSelect?: (slug: string) => void;
  /** Marks the currently selected card in the picker (a ring, not a second primary button). */
  selected?: boolean;
  disabled?: boolean;
  /** Override the badge shown in the badge/tags row (defaults to the catalog badge). */
  badge?: GameBadge;
  /** When neither affordance shows and no `onSelect` is set, make the whole card a link to `href`. */
  href?: string;
}

export function GameCard({
  game,
  showPlay = true,
  showDetails = true,
  playHref: playHrefProp,
  onSelect,
  selected,
  disabled,
  badge,
  href,
}: GameCardProps) {
  const selectable = Boolean(onSelect);
  // Buttons vs. selectable, never both: a pressable card carries no inner links.
  const renderPlay = showPlay && !selectable;
  const renderDetails = showDetails && !selectable;
  const hasFooter = renderPlay || renderDetails;

  const cardBadge = badge ?? game.badge;

  // The Play/Details controls, pinned to the card's bottom so cards of differing summary length keep
  // their controls aligned across a grid. Hoisted so the card JSX carries no inline ternary.
  let footer: ReactNode = null;
  if (hasFooter) {
    let playControl: ReactNode = null;
    if (renderPlay) {
      playControl = (
        // Primary CTA: a full-width one-tap target on a phone (mobile-first non-negotiable), auto
        // width from sm up so it does not stretch across a wide card. Details stays secondary.
        <a
          href={playHrefProp ?? playHref(game.slug)}
          aria-label={`Play ${game.name} now`}
          className={`${buttonVariants({ variant: 'primary', size: 'sm' })} w-full sm:w-auto`}
        >
          Play now
        </a>
      );
    }
    let detailsControl: ReactNode = null;
    if (renderDetails) {
      detailsControl = (
        <a
          href={featurePath(game.slug)}
          aria-label={`Details about ${game.name}`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Details
        </a>
      );
    }
    footer = (
      // Stack on a phone (Play on top), inline from sm up. Both controls are full-tap-target buttons.
      <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row sm:items-center">
        {playControl}
        {detailsControl}
      </div>
    );
  }

  // The Insiders badge sits top-right beside the title, in addition to the normal badge/tags row.
  let insidersBadge: ReactNode = null;
  if (game.insider) {
    insidersBadge = (
      <Badge variant="primary" className="shrink-0">
        Insiders
      </Badge>
    );
  }

  // The catalog badge in the badge/tags row. Suppressed on an insider game (whose catalog badge is
  // always `Insider`) because the top-right "Insiders" badge already conveys that - two near-identical
  // pills otherwise. An explicit `badge` override (a caller intentionally relabelling the row) still shows.
  let rowBadge: ReactNode = null;
  if (badge !== undefined || !game.insider) {
    rowBadge = <Badge variant={cardBadge.variant}>{cardBadge.label}</Badge>;
  }

  const body = (
    <Card
      className={`flex h-full flex-col overflow-hidden text-left transition-colors ${
        selected
          ? 'border-primary ring-2 ring-primary'
          : selectable || href
            ? 'hover:border-primary'
            : ''
      }`}
    >
      {/* The wide 16:9 hero: a build-time SVG string from the brand package (not user input), inlined
          like the game mark. The box owns its own sizing; block + h-full + w-full on the SVG stops any
          intrinsic width leaking past the card and overflowing the 360px viewport. A game with no hero
          falls back to its mark (resolved in getGameCard). aria-hidden because the title names the game. */}
      <div
        aria-hidden="true"
        className="aspect-[16/9] w-full overflow-hidden bg-[#0d0a15] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: game.hero }}
      />
      <CardHeader>
        {/* The mark + title on one row, with the Insiders badge pinned right. min-w-0 + break-words so
            a long name cannot overflow the phone. The mark is a build-time SVG string (not user input),
            inlined the same way the Wordmark renders the app icon. aria-hidden because the title names
            the game. */}
        <div className="flex items-start justify-between gap-3">
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
          {insidersBadge}
        </div>
        {/* The badge row, directly under the title. Tags are intentionally NOT shown on the card -
            they stay in GameCardData for the /games search and the game page, but a row of tag pills
            reads as clutter here. Omitted for an insider game, whose duplicate catalog badge is
            suppressed (the top-right "Insiders" badge already conveys it). */}
        {rowBadge ? <div className="flex flex-wrap items-center gap-2">{rowBadge}</div> : null}
        <CardDescription>{game.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{footer}</CardContent>
    </Card>
  );

  // A selectable card is a single pressable control (the picker / change-game flow).
  if (selectable) {
    return (
      <button
        type="button"
        onClick={() => onSelect?.(game.slug)}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={`Pick ${game.name}`}
        // A minimal clickable reset - NOT buttonVariants(): the button recipe sets `white-space:
        // nowrap` (inherited), which forced the card's summary onto one line and overflowed the phone
        // viewport (the mobile-smoke e2e caught it). The card owns its own hover/selected styling, so
        // this wrapper just needs full width, left text, and a focus ring.
        className="block w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      >
        {body}
      </button>
    );
  }

  // With no affordances and an `href`, the whole card is a single link (home/`/games` "learn more"
  // folds into this). The footer is off in this case, so there is no link nested in a link.
  if (href && !hasFooter) {
    return (
      <a
        href={href}
        aria-label={`Details about ${game.name}`}
        className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {body}
      </a>
    );
  }

  return body;
}
