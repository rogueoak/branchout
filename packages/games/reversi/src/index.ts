// Public surface of the Reversi game package (spec 0054 - the first board game, live model).

export {
  createReversiGame,
  reversiPlugin,
  validateConfig,
  REVERSI_GAME_ID,
  type ReversiConfig,
} from './reversi';

// The reusable board harness (Grid, compass rays, Turns/assignSeats) now lives in its OWN shared
// package, @branchout/game-board, so Checkers and Chess depend on the harness directly rather than on
// this Reversi package. Reversi consumes those primitives internally (see rules.ts / reversi.ts) but
// no longer re-exports them - a sibling game imports them from @branchout/game-board.

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
