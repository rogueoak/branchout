// Pure state -> presentation helpers for the Checkers Viewer's two live affordances (spec 0071): the
// piece move/capture/crown animation and the turn-start popup. Kept out of the React component so both
// are trivially unit-testable and driven ONLY by the authoritative sim (the board deltas between two
// snapshots + the legal-move list), never guessed. The Viewer wires these into its canvas draw loop
// and its popup timer.

import type { CheckersSim, Color, WireCell } from './protocol';

/** The color of a wire cell, or null for an empty square. */
function colorOf(cell: WireCell): Color | null {
  if (cell === 'empty') return null;
  return cell.startsWith('violet') ? 'violet' : 'amber';
}

/** Whether a wire cell is a crowned king. */
function isKing(cell: WireCell): boolean {
  return cell === 'violet-king' || cell === 'amber-king';
}

/** A captured (jumped) piece the animation fades out: its board index, color, and rank. */
export interface CapturedPiece {
  index: number;
  color: Color;
  king: boolean;
}

/**
 * The single in-flight move an animation frame renders: the piece SLIDES from `from` to `to`, any
 * `captures` FADE out, and if `crowned` the landed piece grows its King ring. One move at a time (a
 * checkers turn is one move, however many hops it chains); a new snapshot replaces it.
 */
export interface MoveAnim {
  /** The source board index the moved piece left. */
  from: number;
  /** The destination board index the moved piece landed on. */
  to: number;
  /** The moved piece's color. */
  color: Color;
  /** Whether the landed piece is a King (its final rendered rank). */
  king: boolean;
  /** Whether this move crowned a man (a man that reached the far row) - drives the crown grow-in. */
  crowned: boolean;
  /** The opponent pieces this move jumped, to fade out where they stood. */
  captures: CapturedPiece[];
}

/**
 * The move between two board snapshots, classified into a slide, its captures, and any crowning - or
 * null when the delta is not a single checkers move (identical boards, a mismatched length, or the
 * opening prompt with no prior board), in which case the caller renders instantly. The removed squares
 * are split by color: the one matching the mover (the color that landed on `to`) is the SOURCE; the
 * opposite-color removed squares are the CAPTURES. The crown is read straight off the landing cell.
 */
export function diffMove(prev: readonly WireCell[], next: readonly WireCell[]): MoveAnim | null {
  if (prev.length !== next.length) return null;
  const added: number[] = []; // was empty, now holds a piece (the landing square)
  const removed: number[] = []; // held a piece, now empty (the source + any captures)
  for (let i = 0; i < next.length; i += 1) {
    const before = prev[i];
    const after = next[i];
    if (before === after) continue;
    const beforeEmpty = before === 'empty';
    const afterEmpty = after === 'empty';
    if (beforeEmpty && !afterEmpty) added.push(i);
    else if (!beforeEmpty && afterEmpty) removed.push(i);
    // A piece -> different-piece change in place is not part of a normal move; ignore it.
  }
  // A checkers move lands on exactly one square; anything else is not a single move we animate.
  if (added.length !== 1) return null;
  const to = added[0]!;
  const destColor = colorOf(next[to]!);
  if (!destColor) return null;

  let from = -1;
  const captures: CapturedPiece[] = [];
  for (const index of removed) {
    const color = colorOf(prev[index]!);
    if (!color) continue;
    if (color === destColor && from === -1) from = index;
    else captures.push({ index, color, king: isKing(prev[index]!) });
  }
  if (from === -1) return null;

  const king = isKing(next[to]!);
  // Crowned: the piece landed as a King but left its source as a man (a fresh crowning this move).
  const crowned = king && !isKing(prev[from]!);
  return { from, to, color: destColor, king, crowned, captures };
}

/**
 * The polyline a move animates ALONG: the ordered board indices the moved piece passes through - the
 * source, each intermediate landing of a multi-jump, and the final square - plus the captures ordered to
 * match each hop. A plain step or a SINGLE jump is a straight line `[from, to]` (a lone jumped piece sits
 * exactly at that segment's midpoint, so the straight slide already glides over it - unchanged).
 *
 * A multi-jump is reconstructed from the capture set: each hop goes over a diagonally adjacent captured
 * piece to the square two diagonals on, so starting at `from` we greedily hop over whichever remaining
 * capture is adjacent, appending the landing beyond it, until the captures are consumed. If the chain
 * cannot be fully reconstructed (malformed data) it falls back to the straight `[from, to]` line with the
 * original captures, so the piece is never mis-routed.
 */
export function jumpPath(
  anim: MoveAnim,
  size: number,
): { points: number[]; captures: CapturedPiece[] } {
  const straight = { points: [anim.from, anim.to], captures: anim.captures };
  // 0 captures (a step) or 1 capture (a single jump) is already a correct straight glide.
  if (anim.captures.length <= 1) return straight;

  const rc = (index: number): { row: number; col: number } => ({
    row: Math.floor(index / size),
    col: index % size,
  });
  const remaining = anim.captures.slice();
  const points = [anim.from];
  const ordered: CapturedPiece[] = [];
  let cur = rc(anim.from);

  while (remaining.length > 0) {
    const i = remaining.findIndex((cap) => {
      const c = rc(cap.index);
      return Math.abs(c.row - cur.row) === 1 && Math.abs(c.col - cur.col) === 1;
    });
    if (i === -1) break;
    const cap = remaining.splice(i, 1)[0]!;
    const c = rc(cap.index);
    const landing = { row: cur.row + 2 * (c.row - cur.row), col: cur.col + 2 * (c.col - cur.col) };
    points.push(landing.row * size + landing.col);
    ordered.push(cap);
    cur = landing;
  }

  // Only trust a fully reconstructed chain that consumed every capture and ended on the landing square.
  if (remaining.length > 0 || points[points.length - 1] !== anim.to) return straight;
  return { points, captures: ordered };
}

/** Inputs the turn-start popup copy is derived from - both read straight off the sim + local identity. */
export interface TurnPopupInput {
  /** True when the local player holds the turn now (sim.activePlayer === me). */
  isActive: boolean;
  /** True when a capture is available, so the forced-capture rule means the active player must jump. */
  mustCapture: boolean;
}

/**
 * The brief on-board popup copy for the start of a turn, or null when nothing should pop. Checkers has
 * no forced pass - a side with no legal move loses and the game ends - so the only popup is for the
 * player who now holds the turn. It calls out the forced capture when one is available (a signature
 * checkers rule), otherwise a plain "Your turn". The waiting player gets nothing.
 */
export function turnPopupMessage(input: TurnPopupInput): string | null {
  if (!input.isActive) return null;
  return input.mustCapture ? 'Your turn - you must jump' : 'Your turn';
}

/**
 * Whether the side to move has a mandatory capture available. Under checkers' forced-capture rule, if
 * ANY legal move is a jump then EVERY legal move is a jump, so a single jump in the legal list means
 * the player must capture. A jump's first hop lands two squares away (a plain step lands one), so the
 * row delta of the first path square distinguishes them. Pure over the streamed legal list.
 */
export function hasMandatoryCapture(sim: CheckersSim | null): boolean {
  if (!sim) return false;
  return sim.legal.some((move) => {
    const first = move.path[0];
    return first != null && Math.abs(first.row - move.from.row) >= 2;
  });
}
