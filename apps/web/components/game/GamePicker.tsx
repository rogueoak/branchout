'use client';

// The game picker (spec 0029): a grid of detail cards, one per registered game, shown in the
// create-flow's pick step and the in-room change-game flow. Presentational and game-agnostic - it
// reads GAME_UI_LIST so adding a game is adding a registry entry, no picker edit.

import { GAME_UI_LIST } from '../../lib/games/registry';
import { GameCard } from './GameCard';

interface GamePickerProps {
  /** The currently selected game id, marked in the grid. */
  selected?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function GamePicker({ selected, onSelect, disabled }: GamePickerProps) {
  return (
    <div role="group" aria-label="Choose a game" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {GAME_UI_LIST.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onSelect={onSelect}
          selected={game.id === selected}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
