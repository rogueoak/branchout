'use client';

// The in-game help sheet (spec 0051): the always-reachable rules for the game in play. A HelpButton
// (a "?" glyph, aria-label "How to play") opens a `Sheet` holding the game's `RulesContent`. It reads
// the game's rules from the library and its quick-start steps from the marketing catalog by id, so
// insider games (which have no public feature page) still surface their rules mid-game. Opening the
// sheet is pure client UI over the existing `game` id - it never pauses or mutates game state.

import { Button } from '@rogueoak/canopy';
import { useState } from 'react';
import { GAME_CATALOG } from '../../lib/games/catalog';
import { getGameRules } from '../../lib/games/library';
import { HelpIcon } from './icons';
import { RulesContent } from './RulesContent';
import { Sheet } from './Sheet';

interface HelpSheetProps {
  /** The selected game id (== registry id / slug). */
  game: string;
}

export function HelpSheet({ game }: HelpSheetProps) {
  const [open, setOpen] = useState(false);
  const rules = getGameRules(game);
  const entry = GAME_CATALOG.find((e) => e.slug === game);
  // No rules for this id (an unknown game) - render nothing rather than an empty sheet.
  if (!rules || !entry) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={`How to play ${entry.name}`}
      trigger={
        <Button type="button" variant="outline" size="sm" aria-label="How to play">
          <HelpIcon />
          <span>How to play</span>
        </Button>
      }
    >
      <RulesContent name={entry.name} rules={rules} howToPlay={entry.howToPlay} />
    </Sheet>
  );
}
