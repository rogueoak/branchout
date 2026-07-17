import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { ChessViewer } from './Viewer';

// The board draws on a 2D canvas via rAF; jsdom leaves getContext unimplemented and the draw loop guards
// on a null context, so rendering is safe - stub it to keep the noise out. The turn/check/result state
// is DOM text (not canvas), so the tests assert on those and on the onMove payload a two-tap move emits.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 320,
    height: 320,
    right: 320,
    bottom: 320,
    toJSON: () => ({}),
  } as DOMRect);
});

function emptyBoard(): string[] {
  return Array.from({ length: 64 }, () => 'empty');
}

function chessSim(overrides: Record<string, unknown> = {}) {
  return {
    size: 8,
    cells: emptyBoard(),
    toMove: 'white',
    activePlayer: 'p1',
    legal: [] as unknown[],
    check: false,
    over: false,
    outcome: null,
    endReason: null,
    ...overrides,
  };
}

function state(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    joined: true,
    connection: 'live',
    round: 1,
    players: [
      { player: 'p1', nickname: 'Vi', connected: true },
      { player: 'p2', nickname: 'Am', connected: true },
    ],
    ...overrides,
  };
}

function noop() {}

function firePointerDown(el: HTMLElement, clientX: number, clientY: number): void {
  const ev = createEvent.pointerDown(el, { bubbles: true });
  Object.defineProperty(ev, 'clientX', { value: clientX });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  fireEvent(el, ev);
}

/** The center pixel of cell {row,col} for a 320x320 canvas, 8x8, margin 8 (board 304px, cell 38px). */
function cellCenter(row: number, col: number): { x: number; y: number } {
  const board = 320 - 16;
  const cell = board / 8;
  const origin = (320 - board) / 2;
  return { x: origin + col * cell + cell / 2, y: origin + row * cell + cell / 2 };
}

/** The interactive board element for the active player. */
function activeBoard(): HTMLElement {
  return screen.getByRole('img', { name: /tap a piece/i }).parentElement!;
}

describe('ChessViewer single interactive surface', () => {
  it('labels the board as interactive for the active player and passive otherwise', () => {
    const { unmount } = render(
      <ChessViewer state={state({ sim: chessSim() })} me="p1" onMove={noop} />,
    );
    expect(screen.getByRole('img', { name: /tap a piece/i })).toBeDefined();
    unmount();
    render(<ChessViewer state={state({ sim: chessSim() })} me="p2" onMove={noop} />);
    expect(screen.getByRole('img', { name: /chess board/i })).toBeDefined();
  });

  it('shows whose turn it is in the DOM (screen readers + tests)', () => {
    render(<ChessViewer state={state({ sim: chessSim() })} me="p1" onMove={noop} />);
    expect(screen.getByRole('status').textContent).toMatch(/your turn/i);
  });

  it('emits a two-tap move: select a piece, then tap a legal destination', () => {
    const onMove = vi.fn();
    // A white pawn on e2 (row6,col4) with a legal double push to e4 (row4,col4).
    const cells = emptyBoard();
    cells[6 * 8 + 4] = 'wP';
    const sim = chessSim({
      cells,
      legal: [{ from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }],
    });
    render(<ChessViewer state={state({ sim })} me="p1" onMove={onMove} />);
    const board = activeBoard();
    // First tap: select the pawn. Second tap: the destination.
    let c = cellCenter(6, 4);
    firePointerDown(board, c.x, c.y);
    expect(onMove).not.toHaveBeenCalled(); // selection only, no move yet
    c = cellCenter(4, 4);
    firePointerDown(board, c.x, c.y);
    expect(onMove).toHaveBeenCalledWith(
      1,
      JSON.stringify({ from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }),
    );
  });

  it('ignores selecting an empty square or a piece with no legal move', () => {
    const onMove = vi.fn();
    const sim = chessSim({ legal: [] });
    render(<ChessViewer state={state({ sim })} me="p1" onMove={onMove} />);
    const board = activeBoard();
    const c = cellCenter(3, 3); // empty, no legal moves
    firePointerDown(board, c.x, c.y);
    firePointerDown(board, cellCenter(4, 4).x, cellCenter(4, 4).y);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores taps when it is not the local turn', () => {
    const onMove = vi.fn();
    const cells = emptyBoard();
    cells[6 * 8 + 4] = 'wP';
    const sim = chessSim({ cells, legal: [{ from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }] });
    render(<ChessViewer state={state({ sim })} me="p2" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /chess board/i }).parentElement!;
    firePointerDown(board, cellCenter(6, 4).x, cellCenter(6, 4).y);
    firePointerDown(board, cellCenter(4, 4).x, cellCenter(4, 4).y);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('raises a promotion picker and submits the chosen piece', () => {
    const onMove = vi.fn();
    // A white pawn on e7 (row1,col4) promoting to e8 (row0,col4): the sim lists all four variants.
    const cells = emptyBoard();
    cells[1 * 8 + 4] = 'wP';
    const legal = (['Q', 'R', 'B', 'N'] as const).map((promotion) => ({
      from: { row: 1, col: 4 },
      to: { row: 0, col: 4 },
      promotion,
    }));
    const sim = chessSim({ cells, legal });
    render(<ChessViewer state={state({ sim })} me="p1" onMove={onMove} />);
    const board = activeBoard();
    firePointerDown(board, cellCenter(1, 4).x, cellCenter(1, 4).y); // select
    firePointerDown(board, cellCenter(0, 4).x, cellCenter(0, 4).y); // destination -> promotion picker
    expect(onMove).not.toHaveBeenCalled();
    // The picker appears; choose a Rook (underpromotion) and it submits with promotion 'R'.
    const dialog = screen.getByRole('dialog', { name: /promotion/i });
    fireEvent.click(dialog.querySelector('button:nth-of-type(2)')!); // Q, R, B, N -> the 2nd is Rook
    expect(onMove).toHaveBeenCalledWith(
      1,
      JSON.stringify({ from: { row: 1, col: 4 }, to: { row: 0, col: 4 }, promotion: 'R' }),
    );
  });

  it('flags check for the side to move', () => {
    render(<ChessViewer state={state({ sim: chessSim({ check: true }) })} me="p1" onMove={noop} />);
    expect(screen.getByRole('status').textContent).toMatch(/in check/i);
  });

  it('announces the winner by checkmate when the game is over', () => {
    render(
      <ChessViewer
        state={state({
          sim: chessSim({ over: true, toMove: null, outcome: 'black', endReason: 'checkmate' }),
        })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/amber wins by checkmate/i);
  });

  it('announces a stalemate draw', () => {
    render(
      <ChessViewer
        state={state({
          sim: chessSim({ over: true, toMove: null, outcome: 'draw', endReason: 'stalemate' }),
        })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/draw \(stalemate\)/i);
  });

  it('offers Resign on the local turn and submits a resign move', () => {
    const onMove = vi.fn();
    render(<ChessViewer state={state({ sim: chessSim() })} me="p1" onMove={onMove} />);
    fireEvent.click(screen.getByRole('button', { name: /resign/i }));
    expect(onMove).toHaveBeenCalledWith(1, JSON.stringify({ resign: true }));
  });

  it('renders the reject alert copy when the engine rejected a move', () => {
    render(
      <ChessViewer
        state={state({ sim: chessSim(), rejected: 'illegal move' })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/not a legal move/i);
  });
});
