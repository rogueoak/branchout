// Chess rules tests (spec 0056) - the correctness-heaviest suite on the platform. These are pure,
// deterministic tests over rules.ts: per-piece movement, pinned pieces, castling (legal + each illegal
// condition), en passant (including the one-move window), promotion, check, checkmate (mate-in-one),
// stalemate, insufficient material, and legal/illegal discrimination. Positions are built from an ASCII
// board picture so each case is readable and self-checking.

import { describe, expect, it } from 'vitest';
import { gridFromCells, type Coord } from '@branchout/game-board';
import {
  allLegalMoves,
  applyMove,
  BOARD_SIZE,
  findKing,
  fullCastling,
  hasLegalMove,
  isCheckmate,
  isInCheck,
  isInsufficientMaterial,
  isLegalMove,
  isSquareAttacked,
  isStalemate,
  legalMovesFrom,
  piece,
  pseudoMovesFrom,
  resultOf,
  startingPosition,
  type CastlingRights,
  type Cell,
  type Color,
  type Move,
  type Position,
  type PromotionType,
} from './rules';

// --- test helpers -----------------------------------------------------------------------------------

/**
 * Build a board from eight ASCII rows (row 0 first = Black's back rank). A '.' is empty; a letter is a
 * piece - uppercase = White, lowercase = Black - using the standard letters (P N B R Q K), so 'K' is a
 * white king and 'q' a black queen. This mirrors how a chess diagram reads top-to-bottom.
 */
function boardFrom(rows: string[]): Cell[] {
  if (rows.length !== BOARD_SIZE) throw new Error(`need ${BOARD_SIZE} rows, got ${rows.length}`);
  const cells: Cell[] = [];
  for (const row of rows) {
    const chars = row.replace(/\s/g, '');
    if (chars.length !== BOARD_SIZE) throw new Error(`row "${row}" is not ${BOARD_SIZE} wide`);
    for (const ch of chars) {
      if (ch === '.') {
        cells.push('empty');
        continue;
      }
      const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
      cells.push(piece(color, ch.toUpperCase() as never));
    }
  }
  return cells;
}

/** A position from an ASCII board plus overrides (turn/castling/en-passant). */
function pos(rows: string[], overrides: Partial<Position> = {}): Position {
  return {
    board: gridFromCells<Cell>(BOARD_SIZE, boardFrom(rows)),
    turn: 'w',
    castling: { wK: false, wQ: false, bK: false, bQ: false },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
    ...overrides,
  };
}

/** Algebraic 'e4' -> {row,col}. Files a-h -> col 0-7; ranks 1-8 -> row 7-0 (rank 8 is row 0). */
function sq(alg: string): Coord {
  const col = alg.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(alg[1]);
  const row = BOARD_SIZE - rank;
  return { row, col };
}

/** The set of destination squares (as 'e4' strings) for a piece's legal moves. */
function destsFrom(position: Position, alg: string): Set<string> {
  const from = sq(alg);
  const files = 'abcdefgh';
  return new Set(
    legalMovesFrom(position, from.row, from.col).map(
      (m) => `${files[m.to.col]}${BOARD_SIZE - m.to.row}`,
    ),
  );
}

function mv(from: string, to: string, promotion?: PromotionType): Move {
  return promotion ? { from: sq(from), to: sq(to), promotion } : { from: sq(from), to: sq(to) };
}

const EMPTY_ROW = '........';

// --- starting position ------------------------------------------------------------------------------

describe('startingPosition', () => {
  it('places the standard armies with White to move and full castling', () => {
    const p = startingPosition();
    expect(p.turn).toBe('w');
    expect(p.castling).toEqual(fullCastling());
    expect(p.enPassant).toBeNull();
    // White king on e1 (row 7, col 4), black king on e8 (row 0, col 4).
    expect(p.board.at(7, 4)).toBe('wK');
    expect(p.board.at(0, 4)).toBe('bK');
    // A rank of pawns each.
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      expect(p.board.at(6, c)).toBe('wP');
      expect(p.board.at(1, c)).toBe('bP');
    }
  });

  it('gives White exactly 20 legal opening moves (16 pawn + 4 knight)', () => {
    expect(allLegalMoves(startingPosition())).toHaveLength(20);
  });
});

// --- per-piece movement -----------------------------------------------------------------------------

describe('per-piece movement (pseudo + legal on an open board)', () => {
  it('a knight in the center reaches all eight squares', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...N....', // white knight d5 (row 3, col 3)
      EMPTY_ROW,
      EMPTY_ROW,
      '....K...', // white king e2, out of the way
      '.......k', // black king h1, out of the way
    ]);
    // Knight on d5 -> the eight L-moves.
    expect(destsFrom(p, 'd5')).toEqual(new Set(['b6', 'f6', 'b4', 'f4', 'c7', 'e7', 'c3', 'e3']));
  });

  it('a bishop slides both diagonals until blocked', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...B....',
      EMPTY_ROW,
      EMPTY_ROW,
      '....K...',
      'k.......',
    ]);
    const dests = destsFrom(p, 'd5');
    // A full open diagonal reach from d5.
    expect(dests).toContain('a8');
    expect(dests).toContain('h1');
    expect(dests).toContain('a2');
    expect(dests).toContain('g8');
  });

  it('a rook slides both files/ranks and stops on a capture', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      '...p....', // black pawn on d6 blocks the rook going up (capturable)
      '...R....',
      EMPTY_ROW,
      EMPTY_ROW,
      '....K...',
      'k.......',
    ]);
    const dests = destsFrom(p, 'd5');
    expect(dests).toContain('d6'); // capture the pawn
    expect(dests).not.toContain('d7'); // cannot slide past it
    expect(dests).toContain('a5'); // full rank left
    expect(dests).toContain('h5'); // full rank right
    expect(dests).toContain('d1'); // down the file
  });

  it('a queen is the rook + bishop union', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...Q....',
      EMPTY_ROW,
      EMPTY_ROW,
      '....K...',
      'k.......',
    ]);
    const dests = destsFrom(p, 'd5');
    expect(dests).toContain('d8'); // rook-like
    expect(dests).toContain('a8'); // bishop-like
    expect(dests).toContain('h1'); // bishop-like
    expect(dests).toContain('a5'); // rook-like
  });

  it('a king steps one square in all directions (open)', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...K....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      'k.......',
    ]);
    expect(destsFrom(p, 'd5')).toEqual(new Set(['c6', 'd6', 'e6', 'c5', 'e5', 'c4', 'd4', 'e4']));
  });

  it('a pawn advances one, or two from its home rank, and captures diagonally', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..p.p...', // black pawns on c4 and e4 are capture targets for a white pawn on d2? no...
      EMPTY_ROW,
      '...P....', // white pawn on d2 (row 6, col 3)
      'k...K...',
    ]);
    // From the home rank d2, a white pawn moves to d3 or d4.
    const dests = destsFrom(p, 'd2');
    expect(dests).toContain('d3');
    expect(dests).toContain('d4');
    expect(dests).not.toContain('d5');
  });

  it('a pawn cannot advance through a blocker', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...p....', // black pawn on d3 directly ahead of the white d2 pawn
      '...P....',
      'k...K...',
    ]);
    expect(destsFrom(p, 'd2').size).toBe(0);
  });

  it('a pawn captures a diagonal enemy but not straight ahead', () => {
    const p = pos([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..p.p...', // black pawns on c3 (col2) and e3 (col4), row 5
      '...P....', // white pawn d2 (row6 col3)
      'k...K...',
    ]);
    const dests = destsFrom(p, 'd2');
    expect(dests).toContain('c3'); // capture left
    expect(dests).toContain('e3'); // capture right
    expect(dests).toContain('d3'); // single advance
    expect(dests).toContain('d4'); // double advance from the home rank
  });
});

// --- pinned pieces ----------------------------------------------------------------------------------

describe('pinned pieces (the king-safety filter)', () => {
  it('a piece absolutely pinned to its king cannot move off the pin line', () => {
    // White king e1, white bishop e2, black rook e8: the bishop is pinned on the e-file.
    const p = pos([
      '....r...', // black rook e8 (row0 col4)
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '....B...', // white bishop e2 (row6 col4)
      '....K..k', // white king e1 (row7 col4), black king h1 out of the way
    ]);
    // The bishop on e2 cannot move at all (any bishop move leaves the king on the open e-file).
    expect(destsFrom(p, 'e2').size).toBe(0);
  });

  it('a pinned rook may still move ALONG the pin line', () => {
    // White king e1, white rook e4, black rook e8: the white rook is pinned but can slide on the e-file.
    const p = pos([
      '....r...', // black rook e8
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '....R...', // white rook e4 (row4 col4)
      EMPTY_ROW,
      EMPTY_ROW,
      '....K..k', // white king e1
    ]);
    const dests = destsFrom(p, 'e4');
    // It may move up/down the file (including capturing the pinning rook), but never off it.
    expect(dests).toContain('e8'); // capture the pinner
    expect(dests).toContain('e5');
    expect(dests).toContain('e3');
    expect(dests).not.toContain('d4'); // off the pin line is illegal
    expect(dests).not.toContain('f4');
  });
});

// --- attack + check ---------------------------------------------------------------------------------

describe('attack detection + check', () => {
  it('isSquareAttacked sees pawn, knight, sliding, and king attacks', () => {
    // e4 is row 4, col 4. A black knight on d6 attacks e4; a black bishop on a8 attacks e4 along the
    // long diagonal; a black pawn on d5 attacks e4 (black pawns attack toward larger rows).
    const knightBoard = gridFromCells<Cell>(
      BOARD_SIZE,
      boardFrom([
        'k.......',
        EMPTY_ROW,
        '...n....', // black knight d6 (row2 col3) attacks e4
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '.......K',
      ]),
    );
    expect(isSquareAttacked(knightBoard, 4, 4, 'b')).toBe(true);
    expect(isSquareAttacked(knightBoard, 4, 4, 'w')).toBe(false);

    const pawnBoard = gridFromCells<Cell>(
      BOARD_SIZE,
      boardFrom([
        'k.......',
        EMPTY_ROW,
        EMPTY_ROW,
        '...p....',
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '.......K',
      ]),
    );
    // Black pawn d5 (row3 col3) attacks c4 and e4.
    expect(isSquareAttacked(pawnBoard, 4, 4, 'b')).toBe(true);

    const bishopBoard = gridFromCells<Cell>(
      BOARD_SIZE,
      boardFrom([
        'b......K',
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        'k.......',
      ]),
    );
    // Black bishop a8 (row0 col0) attacks e4 (row4 col4) along the clear a8-h1 diagonal.
    expect(isSquareAttacked(bishopBoard, 4, 4, 'b')).toBe(true);
  });

  it('isInCheck is true when the king square is attacked', () => {
    const p = pos([
      '....r...', // black rook e8 checks the white king on e1 down the open file
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '....K..k',
    ]);
    expect(isInCheck(p.board, 'w')).toBe(true);
    expect(isInCheck(p.board, 'b')).toBe(false);
  });

  it('when in check, only check-evading moves are legal', () => {
    // White king e1 in check from a black rook e8; white also has a rook on a2 that can block on e2.
    const p = pos([
      '....r...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      'R.......', // white rook a2 (row6 col0) can block on e2
      '....K..k',
    ]);
    const moves = allLegalMoves(p);
    // Every legal move must leave the king safe: either the king steps off the e-file, or the rook
    // blocks/captures on the e-file. No move may leave the king on e1 in check.
    for (const m of moves) {
      const after = applyMove(p, m);
      expect(isInCheck(after.board, 'w')).toBe(false);
    }
    // The blocking move Ra2-e2 is among the legal moves.
    const files = 'abcdefgh';
    const asStr = moves.map(
      (m) =>
        `${files[m.from.col]}${BOARD_SIZE - m.from.row}${files[m.to.col]}${BOARD_SIZE - m.to.row}`,
    );
    expect(asStr).toContain('a2e2');
  });

  it('findKing locates each king', () => {
    const p = startingPosition();
    expect(findKing(p.board, 'w')).toEqual({ row: 7, col: 4 });
    expect(findKing(p.board, 'b')).toEqual({ row: 0, col: 4 });
  });
});

// --- castling ---------------------------------------------------------------------------------------

describe('castling', () => {
  /** A bare-bones castling test position: white king e1, rooks a1/h1, black king e8, plus overrides. */
  function castlePos(rows: string[], castling: Partial<CastlingRights> = {}): Position {
    return pos(rows, {
      turn: 'w',
      castling: { wK: true, wQ: true, bK: false, bQ: false, ...castling },
    });
  }

  const CLEAR_BACK = 'R...K..R'; // a1 rook, e1 king, h1 rook; b1..d1 and f1..g1 empty

  it('offers both castles when the path is clear and rights are held', () => {
    const p = castlePos([
      '....k...', // black king e8
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      CLEAR_BACK,
    ]);
    const dests = destsFrom(p, 'e1');
    expect(dests).toContain('g1'); // kingside O-O
    expect(dests).toContain('c1'); // queenside O-O-O
  });

  it('applying kingside castling moves the king to g1 and the rook to f1', () => {
    const p = castlePos([
      '....k...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      CLEAR_BACK,
    ]);
    const after = applyMove(p, mv('e1', 'g1'));
    expect(after.board.at(7, 6)).toBe('wK'); // king on g1
    expect(after.board.at(7, 5)).toBe('wR'); // rook on f1
    expect(after.board.at(7, 7)).toBe('empty'); // h1 vacated
    expect(after.castling.wK).toBe(false); // rights spent
    expect(after.castling.wQ).toBe(false);
  });

  it('applying queenside castling moves the king to c1 and the rook to d1', () => {
    const p = castlePos([
      '....k...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      CLEAR_BACK,
    ]);
    const after = applyMove(p, mv('e1', 'c1'));
    expect(after.board.at(7, 2)).toBe('wK'); // king on c1
    expect(after.board.at(7, 3)).toBe('wR'); // rook on d1
    expect(after.board.at(7, 0)).toBe('empty'); // a1 vacated
  });

  it('ILLEGAL: cannot castle without the right (king or that rook has moved)', () => {
    const p = castlePos(
      ['....k...', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, CLEAR_BACK],
      { wK: false, wQ: false },
    );
    const dests = destsFrom(p, 'e1');
    expect(dests).not.toContain('g1');
    expect(dests).not.toContain('c1');
  });

  it('ILLEGAL: cannot castle when a square between king and rook is occupied', () => {
    // A knight on g1 blocks the kingside path; a bishop on b1 blocks the queenside path.
    const p = castlePos([
      '....k...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      'RB..K.NR', // b1 bishop, g1 knight in the way
    ]);
    const dests = destsFrom(p, 'e1');
    expect(dests).not.toContain('g1');
    expect(dests).not.toContain('c1');
  });

  it('ILLEGAL: cannot castle OUT of check', () => {
    // A black rook on e8 checks the white king on e1; castling is forbidden while in check.
    const p = castlePos([
      '....r...', // black rook e8 gives check
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      CLEAR_BACK,
    ]);
    const dests = destsFrom(p, 'e1');
    expect(dests).not.toContain('g1');
    expect(dests).not.toContain('c1');
  });

  it('ILLEGAL: cannot castle THROUGH an attacked square', () => {
    // A black rook on f8 attacks f1, the kingside pass-through square: O-O is forbidden. Queenside is
    // still fine (the d1/c1 squares are not attacked).
    const p = castlePos([
      '.....r..', // black rook f8 (col5) attacks f1
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      CLEAR_BACK,
    ]);
    const dests = destsFrom(p, 'e1');
    expect(dests).not.toContain('g1'); // through-check on f1
    expect(dests).toContain('c1'); // queenside unaffected
  });

  it('ILLEGAL: cannot castle INTO an attacked square', () => {
    // A black rook on g8 attacks g1, the kingside landing square: O-O is forbidden.
    const p = castlePos([
      '......r.', // black rook g8 (col6) attacks g1
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      CLEAR_BACK,
    ]);
    const dests = destsFrom(p, 'e1');
    expect(dests).not.toContain('g1');
  });

  it('a king move forfeits both castling rights; a rook move forfeits its side', () => {
    const p = castlePos([
      '....k...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      CLEAR_BACK,
    ]);
    // Move the h1 rook one square: kingside right is lost, queenside kept.
    const afterRook = applyMove(p, mv('h1', 'g1'));
    expect(afterRook.castling.wK).toBe(false);
    expect(afterRook.castling.wQ).toBe(true);
    // Move the king: both lost.
    const afterKing = applyMove(p, mv('e1', 'e2'));
    expect(afterKing.castling.wK).toBe(false);
    expect(afterKing.castling.wQ).toBe(false);
  });
});

// --- en passant -------------------------------------------------------------------------------------

describe('en passant', () => {
  it('a double pawn push sets the en-passant target on the skipped square', () => {
    const p = pos(
      [
        '....k...',
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '....P...', // white pawn e2 (row6 col4)
        '....K...',
      ],
      { turn: 'w' },
    );
    const after = applyMove(p, mv('e2', 'e4'));
    // The skipped square is e3 (row5 col4).
    expect(after.enPassant).toEqual({ row: 5, col: 4 });
  });

  it('a pawn may capture en passant into the target square, removing the passed pawn', () => {
    // White pawn e5, black pawn just pushed d7-d5, so en-passant target is d6. White plays exd6 e.p.
    const p = pos(
      [
        '....k...',
        EMPTY_ROW,
        EMPTY_ROW,
        '...pP...', // black pawn d5 (row3 col3), white pawn e5 (row3 col4)
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '....K...',
      ],
      { turn: 'w', enPassant: { row: 2, col: 3 } }, // d6 target (row2 col3)
    );
    // The en-passant capture e5xd6 is legal.
    expect(isLegalMove(p, mv('e5', 'd6'))).toBe(true);
    const after = applyMove(p, mv('e5', 'd6'));
    expect(after.board.at(2, 3)).toBe('wP'); // white pawn now on d6
    expect(after.board.at(3, 3)).toBe('empty'); // the captured black pawn on d5 is gone
    expect(after.board.at(3, 4)).toBe('empty'); // e5 vacated
  });

  it('the en-passant window is ONE move only (no target -> not legal)', () => {
    // Same geometry but WITHOUT the en-passant target set (the window has passed): exd6 is not legal.
    const p = pos(
      ['....k...', EMPTY_ROW, EMPTY_ROW, '...pP...', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, '....K...'],
      { turn: 'w', enPassant: null },
    );
    expect(isLegalMove(p, mv('e5', 'd6'))).toBe(false);
  });

  it('en passant that would expose the king to check is illegal', () => {
    // White king e5, white pawn f5, black pawn g5 (just pushed g7-g5 -> ep target g6), black rook a5.
    // Capturing f5xg6 e.p. would remove BOTH the g5 pawn and leave the e5-a5 rank open, exposing the
    // king to the a5 rook - so it is illegal despite being geometrically available.
    const p = pos(
      [
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        'r...KPp.', // a5 black rook (col0), e5 white king (col4), f5 white pawn (col5), g5 black pawn (col6)
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '.......k', // black king h1 out of the way
      ],
      { turn: 'w', enPassant: { row: 2, col: 6 } }, // g6 target (row2 col6)
    );
    // The rank is K on e5, pawn on f5, black pawn on g5; removing f5 (moves away) and g5 (ep-captured)
    // opens the e5-rook line -> illegal.
    expect(isLegalMove(p, mv('f5', 'g6'))).toBe(false);
  });
});

// --- promotion --------------------------------------------------------------------------------------

describe('promotion', () => {
  it('a pawn reaching the last rank offers all four promotions', () => {
    const p = pos(
      [
        EMPTY_ROW, // e8 empty so the pawn can advance to it
        '....P...', // white pawn e7 (row1 col4)
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        'k...K...',
      ],
      { turn: 'w' },
    );
    const moves = legalMovesFrom(p, 1, 4);
    const promos = moves.map((m) => m.promotion).sort();
    expect(promos).toEqual(['B', 'N', 'Q', 'R']);
  });

  it('applying a promotion replaces the pawn with the chosen piece', () => {
    const p = pos(
      [EMPTY_ROW, '....P...', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, 'k...K...'],
      { turn: 'w' },
    );
    const afterQ = applyMove(p, mv('e7', 'e8', 'Q'));
    expect(afterQ.board.at(0, 4)).toBe('wQ');
    const afterN = applyMove(p, mv('e7', 'e8', 'N'));
    expect(afterN.board.at(0, 4)).toBe('wN');
  });

  it('a promotion move and an underpromotion are distinct legal moves', () => {
    const p = pos(
      [EMPTY_ROW, '....P...', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, 'k...K...'],
      { turn: 'w' },
    );
    expect(isLegalMove(p, mv('e7', 'e8', 'Q'))).toBe(true);
    expect(isLegalMove(p, mv('e7', 'e8', 'N'))).toBe(true);
    // A promotion move MUST name a promotion; a bare from/to without one does not match a candidate.
    expect(isLegalMove(p, mv('e7', 'e8'))).toBe(false);
  });
});

// --- checkmate + stalemate --------------------------------------------------------------------------

describe('checkmate (mate-in-one positions)', () => {
  it('back-rank mate: a rook delivers mate the king cannot escape', () => {
    // Black king g8 boxed by its own pawns f7/g7/h7; White rook slides to e8 for back-rank mate.
    const p = pos(
      [
        '....R.k.', // after Re8: white rook e8 (col4), black king g8 (col6)
        '.....ppp', // black pawns f7 g7 h7 (cols5,6,7)
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '....K...', // white king e1
      ],
      { turn: 'b' }, // it is Black to move and Black is mated
    );
    expect(isInCheck(p.board, 'b')).toBe(true);
    expect(hasLegalMove(p)).toBe(false);
    expect(isCheckmate(p)).toBe(true);
    expect(resultOf(p)).toBe('white');
  });

  it('a checkmate delivered by applying the mating move is detected', () => {
    // The position BEFORE the mating move: white rook on e1, ready to swing to e8. Black king g8 boxed.
    const before = pos(
      [
        '......k.', // black king g8
        '.....ppp', // f7 g7 h7
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '....R.K.', // white rook e1 (col4), white king g1 (col6)
      ],
      { turn: 'w' },
    );
    expect(isLegalMove(before, mv('e1', 'e8'))).toBe(true);
    const after = applyMove(before, mv('e1', 'e8'));
    // Now it is Black to move, in check, with no escape -> mate; White has won.
    expect(isCheckmate(after)).toBe(true);
    expect(resultOf(after)).toBe('white');
  });

  it("the fool's mate is a checkmate", () => {
    // After 1.f3 e5 2.g4 Qh4#: the black queen on h4 mates the white king on e1.
    const p = pos(
      [
        'rnb.kbnr', // black back rank minus the queen (she is on h4)
        'pppp.ppp', // black pawns, e-pawn advanced
        EMPTY_ROW,
        '....p...', // black pawn e5
        '......Pq', // white g-pawn on g4 (col6), black queen h4 (col7)
        '.....P..', // white f-pawn on f3 (col5)
        'PPPPP..P', // white pawns a2-e2, h2 (f2/g2 advanced)
        'RNBQKBNR', // white back rank intact
      ],
      { turn: 'w' }, // White is to move and is mated
    );
    expect(isCheckmate(p)).toBe(true);
    expect(resultOf(p)).toBe('black');
  });
});

describe('stalemate', () => {
  it('the classic K+Q vs K stalemate is a draw, not a mate', () => {
    // Black king a8 (row0 col0); White queen on c7 (row1 col2) takes every escape but does NOT check;
    // White king c6 supports. Black is to move with no legal move -> stalemate.
    const p = pos(
      [
        'k.......', // black king a8
        '..Q.....', // white queen c7 (col2)
        '..K.....', // white king c6 (col2)
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
      ],
      { turn: 'b' },
    );
    expect(isInCheck(p.board, 'b')).toBe(false);
    expect(hasLegalMove(p)).toBe(false);
    expect(isStalemate(p)).toBe(true);
    expect(isCheckmate(p)).toBe(false);
    expect(resultOf(p)).toBe('draw');
  });
});

// --- insufficient material --------------------------------------------------------------------------

describe('insufficient material', () => {
  /** Two bare kings plus any extra pieces given as 'square:code' (e.g. 'c4:wB'). */
  function bareKings(extra: string[] = []): Position {
    const rows = [
      'k.......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '.......K',
    ];
    const cells = boardFrom(rows);
    for (const e of extra) {
      const [alg, ch] = e.split(':') as [string, string];
      const s = sq(alg);
      cells[s.row * BOARD_SIZE + s.col] = ch as Cell;
    }
    return {
      board: gridFromCells<Cell>(BOARD_SIZE, cells),
      turn: 'w',
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
      halfmove: 0,
      fullmove: 1,
    };
  }

  it('K vs K is insufficient', () => {
    expect(isInsufficientMaterial(bareKings())).toBe(true);
  });

  it('K + one minor vs K is insufficient (bishop or knight)', () => {
    expect(isInsufficientMaterial(bareKings(['c1:wB']))).toBe(true);
    expect(isInsufficientMaterial(bareKings(['c1:wN']))).toBe(true);
  });

  it('K+B vs K+B with same-colored bishops is insufficient', () => {
    // Two bishops both on light squares (a2 and c4 are both light).
    expect(isInsufficientMaterial(bareKings(['a2:wB', 'c4:bB']))).toBe(true);
  });

  it('K+B vs K+B with opposite-colored bishops is sufficient (a mate can arise)', () => {
    // a2 is light, b4 is dark -> opposite colors -> not a dead draw.
    expect(isInsufficientMaterial(bareKings(['a2:wB', 'b4:bB']))).toBe(false);
  });

  it('any pawn/rook/queen is sufficient', () => {
    expect(isInsufficientMaterial(bareKings(['c4:wP']))).toBe(false);
    expect(isInsufficientMaterial(bareKings(['c4:wR']))).toBe(false);
    expect(isInsufficientMaterial(bareKings(['c4:wQ']))).toBe(false);
  });

  it('two knights (same side) is treated as sufficient', () => {
    expect(isInsufficientMaterial(bareKings(['c4:wN', 'e4:wN']))).toBe(false);
  });
});

// --- legal/illegal discrimination -------------------------------------------------------------------

describe('isLegalMove discrimination', () => {
  it('accepts a normal legal move and rejects an illegal one', () => {
    const p = startingPosition();
    expect(isLegalMove(p, mv('e2', 'e4'))).toBe(true); // double pawn push
    expect(isLegalMove(p, mv('e2', 'e5'))).toBe(false); // three squares
    expect(isLegalMove(p, mv('e1', 'e2'))).toBe(false); // king blocked by its own pawn
    expect(isLegalMove(p, mv('b1', 'c3'))).toBe(true); // knight out
    expect(isLegalMove(p, mv('b1', 'd2'))).toBe(false); // knight onto its own pawn
  });

  it('rejects moving a piece that would leave the king in check', () => {
    // The pinned bishop again: any bishop move is illegal.
    const p = pos([
      '....r...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '....B...',
      '....K..k',
    ]);
    expect(isLegalMove(p, mv('e2', 'd3'))).toBe(false);
    expect(isLegalMove(p, mv('e2', 'f3'))).toBe(false);
  });

  it('rejects moving out of turn (a piece of the side NOT to move)', () => {
    const p = startingPosition(); // White to move
    // A black pawn move is not legal for White (pseudoMovesFrom returns [] for the wrong color).
    expect(pseudoMovesFrom(p, 1, 4)).toHaveLength(0);
    expect(isLegalMove(p, mv('e7', 'e5'))).toBe(false);
  });
});

// --- a small sanity playthrough ---------------------------------------------------------------------

describe('applyMove counters', () => {
  it('increments the fullmove number after Black moves and resets halfmove on a pawn move', () => {
    let p = startingPosition();
    p = applyMove(p, mv('e2', 'e4')); // White pawn move: halfmove resets, fullmove stays 1
    expect(p.fullmove).toBe(1);
    expect(p.halfmove).toBe(0);
    p = applyMove(p, mv('b8', 'c6')); // Black knight move: halfmove increments, fullmove -> 2
    expect(p.fullmove).toBe(2);
    expect(p.halfmove).toBe(1);
  });
});
