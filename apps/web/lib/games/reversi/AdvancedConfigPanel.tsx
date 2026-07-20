'use client';

// Reversi's ADVANCED host config (WS8-config), rendered into the lobby's collapsed "Advanced settings"
// slot (spec 0068) via the game module's `AdvancedConfigPanel`, exactly like trivia's. Same controlled
// `GameConfigPanelProps` contract as the standard panel; the accordion supplies the "Advanced settings"
// heading, so this renders only the controls. The one control is the "See available moves" toggle - ON
// by default - built on canopy's Switch Seed rather than a hand-rolled control, so the
// role="switch"/aria-checked semantics and token styling come for free. Mobile-first, legible at 360px.

import { Label, Switch } from '@rogueoak/canopy';
import type { ReversiHostConfig } from './config';
import type { GameConfigPanelProps } from '../registry';

export function ReversiAdvancedConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as ReversiHostConfig;
  // Default ON: only an explicit false hides the hints, so an older/empty config keeps them on.
  const showAvailableMoves = config?.showAvailableMoves !== false;
  const set = (next: Partial<ReversiHostConfig>) => onChange({ ...config, ...next });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="reversi-show-available-moves">See available moves</Label>
          <p className="text-body-sm text-text-muted">
            Highlight the squares each player can place on. Turn this off for a tougher game where
            you spot your own moves.
          </p>
        </div>
        <Switch
          id="reversi-show-available-moves"
          checked={showAvailableMoves}
          disabled={disabled}
          onCheckedChange={(checked) => set({ showAvailableMoves: checked })}
          className="shrink-0"
        />
      </div>
    </div>
  );
}
