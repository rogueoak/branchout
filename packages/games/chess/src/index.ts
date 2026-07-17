// Public surface of the Chess game package (spec 0056 - the third board game, live model). It reuses
// the shared board harness (@branchout/game-board) proven by Reversi and Checkers; the chess-specific
// rules (full legal-move generation, check/checkmate/stalemate, castling/en passant/promotion) live in
// rules.ts.

export {
  createChessGame,
  chessPlugin,
  validateConfig,
  CHESS_GAME_ID,
  type ChessConfig,
} from './chess';

// Chess's rules (pure, exhaustively unit-tested).
export {
  BOARD_SIZE,
  startingPosition,
  pseudoMovesFrom,
  legalMovesFrom,
  allLegalMoves,
  hasLegalMove,
  isLegalMove,
  applyMove,
  isSquareAttacked,
  isInCheck,
  isCheckmate,
  isStalemate,
  isInsufficientMaterial,
  resultOf,
  findKing,
  colorOf,
  seatOfColor,
  otherColor,
  cellColor,
  cellType,
  piece,
  fullCastling,
  pawnDir,
  sameSquare,
  type Cell,
  type Color,
  type PieceType,
  type PromotionType,
  type Move,
  type Position,
  type CastlingRights,
  type Result,
} from './rules';

export type { ChessMove, ChessSim, Outcome, EndReason, Square } from './types';
