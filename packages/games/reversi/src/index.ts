// Public surface of the Reversi game package (spec 0054 - the first board game, live model).

export {
  createReversiGame,
  reversiPlugin,
  validateConfig,
  REVERSI_GAME_ID,
  type ReversiConfig,
} from './reversi';

// The reusable board harness (Checkers and Chess build on these; re-exported so a sibling game can
// import them from the family's first package or lift them to a shared package later).
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

// Reversi's rules (pure, unit-tested).
export {
  BOARD_SIZE,
  startingBoard,
  flipsFor,
  isLegalMove,
  legalMoves,
  hasLegalMove,
  applyMove,
  scoreOf,
  isGameOver,
  winnerOf,
  discOf,
  seatOf,
  type Cell,
  type Score,
} from './rules';

export type { ReversiMove, ReversiSim, Outcome } from './types';
