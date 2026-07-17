// The reusable board harness (spec 0054). Reversi is the FIRST board game on the platform; Checkers
// and Chess will follow, so the generic, game-agnostic board machinery lives here - deliberately
// separate from Reversi's rules (reversi.ts). Anything a square-grid, two-player, turn-based board
// game needs is here; anything about DISCS and FLIPPING is not.
//
// What this module owns (all pure + fully serializable - no in-process world, so a live board module
// has no `disposeLive`):
//   - A `Grid<T>` value type: a square board of cells, addressable by {row,col}, that round-trips
//     through scratch as a flat array (JSON-safe).
//   - Coordinate helpers: bounds checks, index<->coord conversion, and the eight compass directions
//     (the ray-walk primitive both Reversi's flips and a future queen/rook slide are built on).
//   - Turn management: a two-player seat model that maps engine `SessionPlayer`s to board sides and
//     tracks whose turn it is, with a helper to resolve the active player id.
// A board GAME layers its rules (legal-move generation, applying a move, end/scoring) on top by
// reading/writing a `Grid` and asking `Turns` whose turn it is.

import type { SessionPlayer } from '@branchout/game-sdk';

/** A coordinate on the board: `row` (0 = top) and `col` (0 = left). */
export interface Coord {
  row: number;
  col: number;
}

/**
 * One of the eight compass steps (row/col deltas). The ray-walk primitive every straight-line board
 * rule is built on: Reversi brackets discs along these; a future rook slides along the four
 * orthogonals; a bishop along the four diagonals; a queen along all eight.
 */
export interface Step {
  dr: number;
  dc: number;
}

/** The four orthogonal steps (N, S, E, W). */
export const ORTHOGONAL: readonly Step[] = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

/** The four diagonal steps (NE, NW, SE, SW). */
export const DIAGONAL: readonly Step[] = [
  { dr: -1, dc: 1 },
  { dr: -1, dc: -1 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: -1 },
];

/** All eight compass steps (the orthogonals + the diagonals). Reversi brackets along every one. */
export const ALL_DIRECTIONS: readonly Step[] = [...ORTHOGONAL, ...DIAGONAL];

/**
 * A square board of `size` x `size` cells of type `T`, stored row-major. Immutable-friendly: `set`
 * returns a shallow-copied grid so a rules layer can build a candidate board without mutating the
 * live one. The backing array is a plain `T[]`, so a grid serializes to scratch as `{ size, cells }`
 * and rebuilds with {@link gridFromCells} - no class instance survives the JSON round-trip.
 */
export class Grid<T> {
  readonly size: number;
  private readonly cells: T[];

  constructor(size: number, cells: T[]) {
    if (cells.length !== size * size) {
      throw new Error(`grid expects ${size * size} cells for size ${size}, got ${cells.length}`);
    }
    this.size = size;
    this.cells = cells;
  }

  /** True when `{row,col}` is on the board. */
  inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.size && col >= 0 && col < this.size;
  }

  /** The cell at `{row,col}`; throws if off-board (callers guard with {@link inBounds}). */
  at(row: number, col: number): T {
    if (!this.inBounds(row, col)) throw new Error(`(${row},${col}) is off the ${this.size} board`);
    return this.cells[row * this.size + col] as T;
  }

  /** A shallow copy with `{row,col}` set to `value` - the live grid is never mutated. */
  set(row: number, col: number, value: T): Grid<T> {
    if (!this.inBounds(row, col)) throw new Error(`(${row},${col}) is off the ${this.size} board`);
    const next = this.cells.slice();
    next[row * this.size + col] = value;
    return new Grid(this.size, next);
  }

  /** The flat, row-major cell array (a copy) - the serializable form persisted in scratch. */
  toCells(): T[] {
    return this.cells.slice();
  }

  /** Visit every cell with its coordinate, top-left to bottom-right. */
  forEach(fn: (value: T, coord: Coord) => void): void {
    for (let row = 0; row < this.size; row += 1) {
      for (let col = 0; col < this.size; col += 1) {
        fn(this.cells[row * this.size + col] as T, { row, col });
      }
    }
  }

  /** Count the cells that satisfy `predicate` (e.g. discs of one color). */
  count(predicate: (value: T) => boolean): number {
    let n = 0;
    for (const cell of this.cells) if (predicate(cell)) n += 1;
    return n;
  }
}

/** Rebuild a {@link Grid} from its serialized `{ size, cells }` form (read back from scratch). */
export function gridFromCells<T>(size: number, cells: T[]): Grid<T> {
  return new Grid(size, cells);
}

/**
 * Build a fresh `size` x `size` grid filled with `empty`. A rules layer then `set`s the starting
 * position (Reversi's four center discs).
 */
export function emptyGrid<T>(size: number, empty: T): Grid<T> {
  return new Grid(
    size,
    Array.from({ length: size * size }, () => empty),
  );
}

/**
 * The two seats of a two-player board game. `0` is the first side to move (Reversi: Violet); `1` is
 * the second (Amber). A board game maps its own color enum onto these two seats.
 */
export type Seat = 0 | 1;

/** Flip a seat to the other side. */
export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/**
 * Turn management for a two-player board game: which engine players hold seat 0 and seat 1, and whose
 * turn it is. Seats are assigned deterministically by roster order at configure time (seat 0 = first
 * player), so a reconnect resolves the same sides. Serializes to scratch as `{ seats, turn }`.
 *
 * The active PLAYER id is resolved against the live roster each call (not stored), so it survives a
 * player list that reorders on reconnect - the seat->player binding is the source of truth.
 */
export class Turns {
  /** playerId per seat: `seats[0]` holds seat 0, `seats[1]` holds seat 1. */
  readonly seats: readonly [string, string];
  /** Whose seat is to move now. */
  readonly turn: Seat;

  constructor(seats: readonly [string, string], turn: Seat) {
    this.seats = seats;
    this.turn = turn;
  }

  /** The playerId of the seat to move, or '' if that seat is unfilled. */
  activePlayer(): string {
    return this.seats[this.turn] ?? '';
  }

  /** The seat a given playerId holds, or null if they hold neither seat. */
  seatOf(player: string): Seat | null {
    if (this.seats[0] === player) return 0;
    if (this.seats[1] === player) return 1;
    return null;
  }

  /** A copy with the turn passed to the other seat (a normal move or a forced pass both advance it). */
  advance(): Turns {
    return new Turns(this.seats, otherSeat(this.turn));
  }

  /** A copy with the turn set to a specific seat (used when only one side has a legal move). */
  withTurn(turn: Seat): Turns {
    return new Turns(this.seats, turn);
  }
}

/**
 * Assign the two board seats from the session roster, deterministically by roster order: the first
 * player is seat 0, the second is seat 1. A missing second player leaves seat 1 as '' (the game
 * cannot start a real turn until both seats are filled, but the harness stays well-defined). Seat 0
 * always moves first.
 */
export function assignSeats(players: readonly SessionPlayer[]): Turns {
  const first = players[0]?.player ?? '';
  const second = players[1]?.player ?? '';
  return new Turns([first, second], 0);
}
