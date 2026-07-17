// Public surface of the game-agnostic board harness (spec 0054). Reversi is the first consumer;
// Checkers and Chess reuse the exact same primitives from THIS package, never from a sibling game.

export {
  Grid,
  gridFromCells,
  emptyGrid,
  Turns,
  assignSeats,
  otherSeat,
  ORTHOGONAL,
  DIAGONAL,
  ALL_DIRECTIONS,
  type Coord,
  type Step,
  type Seat,
} from './board';
