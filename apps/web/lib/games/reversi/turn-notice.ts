// Pure state -> presentation helpers for the Reversi Viewer's two live affordances (WS8a): the
// piece-flip animation and the turn-start popup. Kept out of the React component so both are trivially
// unit-testable and driven ONLY by the authoritative sim (the board deltas + the turn/pass fields),
// never guessed. The Viewer wires these into its canvas draw loop and its popup timer.

import type { Cell } from './protocol';

/**
 * The board indices whose disc FLIPPED between two snapshots: a square that held one disc color and now
 * holds the other. An empty -> disc change is a fresh PLACEMENT (the mover's new disc), not a flip, so
 * it is excluded; only an existing disc that changed color animates the rotateY flip. Length-mismatched
 * or absent snapshots yield no flips (the caller renders instantly).
 */
export function detectFlips(prev: readonly Cell[], next: readonly Cell[]): number[] {
  if (prev.length !== next.length) return [];
  const flipped: number[] = [];
  for (let i = 0; i < next.length; i += 1) {
    const before = prev[i];
    const after = next[i];
    if (before !== after && before !== 'empty' && after !== 'empty') {
      flipped.push(i);
    }
  }
  return flipped;
}

/** Inputs the turn-start popup copy is derived from - all read straight off the sim + local identity. */
export interface TurnPopupInput {
  /** True when the local player holds the turn now (sim.activePlayer === me). */
  isActive: boolean;
  /** True when the last turn transition was a forced pass (sim.passed). */
  passed: boolean;
  /** The other (non-active) player's display name, for the "they were skipped" phrasing. */
  otherName: string;
}

/**
 * The brief on-board popup copy for the start of a turn, or null when nothing should pop. Driven by the
 * authoritative turn + pass state, phrased from the local player's vantage:
 *   - I hold the turn after the other side was skipped -> "<other> has no moves, your turn".
 *   - I hold the turn normally                          -> "Your turn".
 *   - I do NOT hold the turn and a pass just happened   -> "You have no moves, turn skipped" (I was
 *     the one skipped; in a 2-player game the non-active side on a pass is always the skipped side).
 *   - I do NOT hold the turn on a normal move           -> null (it is simply the opponent's turn).
 */
export function turnPopupMessage(input: TurnPopupInput): string | null {
  const { isActive, passed, otherName } = input;
  if (isActive && passed) return `${otherName} has no moves, your turn`;
  if (isActive) return 'Your turn';
  if (passed) return 'You have no moves, turn skipped';
  return null;
}
