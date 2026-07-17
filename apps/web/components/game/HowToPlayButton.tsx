'use client';

// The single "How to play" control (spec 0051) for every surface that needs one: the insider index
// (where the whole card is a play link, so this sits as a SIBLING - never nested in the card's <a> -
// keeping the card one interactive element) and the in-game GameStage toolbar. Both do the same
// getGameRules + GAME_CATALOG lookup, the same null-guard, and open the same `Sheet` with the game's
// `RulesContent`, so they are one component parameterized by the button `variant` and its `label`.
// Insider games have no public feature page, so this is their only rules surface on the listing page.

import { Button } from '@rogueoak/canopy';
import { useState } from 'react';
import { GAME_CATALOG } from '../../lib/games/catalog';
import { getGameRules } from '../../lib/games/library';
import { HelpIcon } from './icons';
import { RulesContent } from './RulesContent';
import { Sheet } from './Sheet';

interface HowToPlayButtonProps {
  /** The game id (== registry id / slug). */
  game: string;
  /**
   * The button style. `outline` is the single rules affordance used on BOTH surfaces (the insider
   * card and the in-game toolbar) so the same control reads the same everywhere.
   */
  variant?: 'ghost' | 'outline';
  /**
   * The visible + accessible button label. Defaults to a game-specific `How to play ${name}` (good
   * for a list of cards where several triggers share the "How to play" text); the in-game toolbar
   * passes a plain "How to play" since there is only one.
   */
  label?: string;
}

export function HowToPlayButton({ game, variant = 'outline', label }: HowToPlayButtonProps) {
  const [open, setOpen] = useState(false);
  const rules = getGameRules(game);
  const entry = GAME_CATALOG.find((e) => e.slug === game);
  // No rules for this id (an unknown game) - render nothing rather than an empty sheet.
  if (!rules || !entry) return null;

  const buttonLabel = label ?? `How to play ${entry.name}`;

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={`How to play ${entry.name}`}
      trigger={
        <Button type="button" variant={variant} size="sm" aria-label={buttonLabel}>
          <HelpIcon />
          <span>How to play</span>
        </Button>
      }
    >
      <RulesContent name={entry.name} rules={rules} howToPlay={entry.howToPlay} />
    </Sheet>
  );
}
