'use client';

// Checkers's ADVANCED host config (spec 0071), rendered into the lobby's collapsed "Advanced settings"
// slot (spec 0068) via the game module's `AdvancedConfigPanel`, exactly like Reversi's and trivia's.
// Same controlled `GameConfigPanelProps` contract as the standard panel; the accordion supplies the
// "Advanced settings" heading, so this renders only the controls. The one control is the "See
// available moves" toggle - ON by default - built on canopy's Switch so the role="switch"/aria-checked
// semantics and token styling come for free. Mobile-first, legible at 360px.

import { Label, Switch } from '@rogueoak/canopy';
import type { CheckersHostConfig } from './config';
import type { GameConfigPanelProps } from '../registry';

export function CheckersAdvancedConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as CheckersHostConfig;
  // Default ON: only an explicit false hides the hints, so an older/empty config keeps them on.
  const showAvailableMoves = config?.showAvailableMoves !== false;
  const set = (next: Partial<CheckersHostConfig>) => onChange({ ...config, ...next });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="checkers-show-available-moves">See available moves</Label>
          <p className="text-body-sm text-text-muted">
            Highlight which pieces can move and where they can land. Turn this off for a tougher
            game where you spot your own moves.
          </p>
        </div>
        <Switch
          id="checkers-show-available-moves"
          checked={showAvailableMoves}
          disabled={disabled}
          onCheckedChange={(checked) => set({ showAvailableMoves: checked })}
          className="shrink-0"
        />
      </div>
    </div>
  );
}
