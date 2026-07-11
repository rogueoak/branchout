'use client';

// Client boundary: renders canopy Twigs (Card), which call React.createContext at module scope (see
// docs/overview/learnings.md, Theming) - the consumer owns the 'use client' boundary.

import { buttonVariants } from '@rogueoak/canopy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@rogueoak/canopy/twigs';
import type { GameUiModule } from '../../lib/games/registry';

interface GameCardProps {
  game: GameUiModule;
  /** When set, the whole card is a button that picks this game (the picker / change-game flow). */
  onSelect?: (id: string) => void;
  /** Marks the currently selected game in the picker (a ring, not a second primary button). */
  selected?: boolean;
  disabled?: boolean;
}

/**
 * A game's detail card (spec 0029): the mark, name, tagline, and one-line summary - so a host
 * chooses a game knowing what it is, not from a bare title. Used in the first-pick step, the
 * change-game flow, and (read-only) as the selected-game summary in the lobby.
 */
export function GameCard({ game, onSelect, selected, disabled }: GameCardProps) {
  const body = (
    <Card
      className={`h-full text-left transition-colors ${
        selected ? 'border-primary ring-2 ring-primary' : onSelect ? 'hover:border-primary' : ''
      }`}
    >
      <CardHeader>
        <div className="flex items-center gap-3">
          {/* The mark is a build-time SVG string from the brand package (not user input), inlined the
              same way the Wordmark renders the app icon; it carries its own dark tile. aria-hidden
              because the card title names the game. */}
          <span
            aria-hidden="true"
            className="inline-block h-12 w-12 shrink-0 overflow-hidden rounded-xl [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: game.icon }}
          />
          <CardTitle asChild>
            <h3>{game.name}</h3>
          </CardTitle>
        </div>
        <CardDescription>{game.tagline}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-body-sm text-text-muted">{game.summary}</p>
      </CardContent>
    </Card>
  );

  if (!onSelect) return body;

  return (
    <button
      type="button"
      onClick={() => onSelect(game.id)}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Pick ${game.name}`}
      className={`${buttonVariants({ variant: 'ghost' })} block h-auto w-full whitespace-normal rounded-xl p-0 disabled:opacity-60`}
    >
      {body}
    </button>
  );
}
