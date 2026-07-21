'use client';

// The lobby palette picker (spec 0063, Sketchy palettes). Each player claims a reserved 3-color
// palette to draw with; a palette taken by another player is disabled and labelled with who holds
// it, so no two players can share one. The caller (RoomClient) owns the claim action and the
// server-authoritative reservation; this is presentational. Mobile-first (CLAUDE.md rule 1): a
// two-column grid at ~360px that scales up, each swatch a large tap target.

import { PLAYER_PALETTES } from '@branchout/protocol';

export interface PalettePickerProps {
  /** The palette id the local player currently holds, if any. */
  myPaletteId?: string;
  /**
   * Who holds each palette: palette id -> the holder's display name. Built from the roster. A
   * palette absent here is free; one whose holder is the local player is "yours".
   */
  claimedBy: Record<string, string>;
  /** Claim a palette. The server reserves it; a lost race falls back to another (handled upstream). */
  onClaim: (paletteId: string) => void;
  /** Disable all claims (while a claim is in flight or the game is starting). */
  disabled?: boolean;
}

export function PalettePicker({ myPaletteId, claimedBy, onClaim, disabled }: PalettePickerProps) {
  return (
    <ul
      role="group"
      aria-label="Choose your palette"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {PLAYER_PALETTES.map((palette) => {
        const holder = claimedBy[palette.id];
        const mine = myPaletteId === palette.id;
        // Taken by someone ELSE (a holder that is not me): not selectable.
        const takenByOther = holder !== undefined && !mine;
        const selectable = !disabled && !takenByOther && !mine;
        const status = mine ? 'Yours' : takenByOther ? `Taken by ${holder}` : 'Free';
        return (
          <li key={palette.id}>
            <button
              type="button"
              aria-pressed={mine}
              aria-label={`${palette.name} palette - ${status}`}
              disabled={!selectable}
              onClick={() => onClaim(palette.id)}
              className={`flex w-full flex-col gap-1.5 rounded-lg border-2 p-2 text-left transition-colors ${
                mine
                  ? 'border-primary bg-surface-raised'
                  : takenByOther
                    ? 'cursor-not-allowed border-border opacity-45'
                    : 'border-border hover:border-text'
              }`}
            >
              <span className="flex gap-1" aria-hidden>
                {palette.colors.map((color) => (
                  <span
                    key={color}
                    className="h-6 w-6 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="flex flex-col">
                <span className="text-body-sm font-medium text-text">{palette.name}</span>
                <span
                  className={`text-caption ${mine ? 'text-primary' : 'text-text-subtle'}`}
                  role={mine ? 'status' : undefined}
                >
                  {mine ? 'Yours' : takenByOther ? `Taken - ${holder}` : 'Tap to claim'}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
