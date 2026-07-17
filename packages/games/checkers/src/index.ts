// Public surface of the Checkers game package (spec 0055 - the second board game, live model, reusing
// the shared @branchout/game-board harness Reversi established).

export {
  createCheckersGame,
  checkersPlugin,
  validateConfig,
  CHECKERS_GAME_ID,
  type CheckersConfig,
} from './checkers';

// The reusable board harness (Grid, compass rays, Turns/assignSeats) lives in @branchout/game-board;
// Checkers depends on it directly (see rules.ts / checkers.ts) and does not re-export it.

// Checkers's rules (pure, unit-tested).
export {
  BOARD_SIZE,
  PIECES_PER_SIDE,
  startingBoard,
  isDarkSquare,
  colorOf,
  forwardSteps,
  stepsFor,
  crownRow,
  captureHopsFrom,
  stepMovesFrom,
  seatHasCapture,
  jumpPathsFrom,
  legalMoves,
  hasLegalMove,
  isLegalMove,
  movesEqual,
  applyMove,
  scoreOf,
  isGameOverFor,
  winnerOf,
  type Cell,
  type Piece,
  type Move,
  type Score,
} from './rules';

export type { CheckersMove, CheckersSim, Outcome, WireCell } from './types';
