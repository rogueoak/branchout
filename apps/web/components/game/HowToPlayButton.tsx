'use client';

// A standalone "How to play" control (spec 0051) for a listing surface where the whole card is a
// play link (the insider index): a separate button - NOT nested in the card's <a> - that opens a
// `Sheet` with the game's `RulesContent`. This keeps the card one interactive element (no interactive-
// in-interactive) while still surfacing rules for insider games, which have no public feature page.

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
}

export function HowToPlayButton({ game }: HowToPlayButtonProps) {
  const [open, setOpen] = useState(false);
  const rules = getGameRules(game);
  const entry = GAME_CATALOG.find((e) => e.slug === game);
  if (!rules || !entry) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={`How to play ${entry.name}`}
      trigger={
        <Button type="button" variant="ghost" size="sm" aria-label={`How to play ${entry.name}`}>
          <HelpIcon />
          <span>How to play</span>
        </Button>
      }
    >
      <RulesContent name={entry.name} rules={rules} howToPlay={entry.howToPlay} />
    </Sheet>
  );
}
