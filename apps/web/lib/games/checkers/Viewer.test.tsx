import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { CheckersViewer } from './Viewer';

// The board draws on a 2D canvas via rAF; jsdom leaves getContext unimplemented, and the draw loop
// guards on a null context, so rendering is safe - stub it to keep the "Not implemented" noise out.
// The scoreboard + turn state are DOM rows (not canvas text), so the tests assert on those and on the
// onMove payload a select-then-move tap sequence emits.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
  // jsdom gives every element a 0x0 rect; pin a real board box so the tap hit-test maps to a cell.
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

/** An 8x8 sim of empty cells, overridable. The real board is 8x8 and the math is size-driven. */
function checkersSim(overrides: Record<string, unknown> = {}) {
  return {
    size: 8,
    cells: Array.from({ length: 64 }, () => 'empty'),
    toMove: 'violet',
    activePlayer: 'p1',
    legal: [] as unknown[],
    violet: 12,
    amber: 12,
    over: false,
    outcome: null,
    ...overrides,
  };
}

/** Place a wire cell into an 8x8 cells array at {row,col}. */
function withPiece(cells: string[], row: number, col: number, cell: string): string[] {
  const next = cells.slice();
  next[row * 8 + col] = cell;
  return next;
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
  const board = 320 - 16; // 304
  const cell = board / 8; // 38
  const origin = (320 - board) / 2; // 8
  return { x: origin + col * cell + cell / 2, y: origin + row * cell + cell / 2 };
}

/** Tap the given cell on the interactive board (queries the active-turn board element). */
function tap(row: number, col: number): void {
  const board = screen.getByRole('img', { name: /tap a piece/i }).parentElement!;
  const c = cellCenter(row, col);
  firePointerDown(board, c.x, c.y);
}

describe('CheckersViewer single interactive surface', () => {
  it('labels the board as interactive for the active player', () => {
    render(<CheckersViewer state={state({ sim: checkersSim() })} me="p1" onMove={noop} />);
    expect(screen.getByRole('img', { name: /tap a piece/i })).toBeDefined();
  });

  it('labels the board passively for the non-active player', () => {
    render(<CheckersViewer state={state({ sim: checkersSim() })} me="p2" onMove={noop} />);
    expect(screen.getByRole('img', { name: /checkers board/i })).toBeDefined();
    expect(screen.queryByRole('img', { name: /tap a piece/i })).toBeNull();
  });

  it('shows the scoreboard and whose turn it is in the DOM (screen readers + tests)', () => {
    render(<CheckersViewer state={state({ sim: checkersSim() })} me="p1" onMove={noop} />);
    expect(screen.getByText(/Violet 12/)).toBeDefined();
    expect(screen.getByText(/Amber 12/)).toBeDefined();
    expect(screen.getByRole('status').textContent).toMatch(/your turn/i);
  });

  it('emits a plain-step onMove after selecting a piece then tapping its destination', () => {
    const onMove = vi.fn();
    // A violet man at (5,2) can step to (4,1). One legal move.
    const cells = withPiece(
      Array.from({ length: 64 }, () => 'empty'),
      5,
      2,
      'violet',
    );
    const legal = [{ from: { row: 5, col: 2 }, path: [{ row: 4, col: 1 }] }];
    render(
      <CheckersViewer
        state={state({ sim: checkersSim({ cells, legal }) })}
        me="p1"
        onMove={onMove}
      />,
    );
    // First tap selects the source; no move yet.
    tap(5, 2);
    expect(onMove).not.toHaveBeenCalled();
    // Second tap on the destination submits the whole move.
    tap(4, 1);
    expect(onMove).toHaveBeenCalledWith(
      1,
      JSON.stringify({ from: { row: 5, col: 2 }, path: [{ row: 4, col: 1 }] }),
    );
  });

  it('submits the FULL multi-jump path from a single destination tap', () => {
    const onMove = vi.fn();
    // A violet man at (5,4) with a two-hop jump landing (3,2) then (1,4).
    const cells = withPiece(
      Array.from({ length: 64 }, () => 'empty'),
      5,
      4,
      'violet',
    );
    const legal = [
      {
        from: { row: 5, col: 4 },
        path: [
          { row: 3, col: 2 },
          { row: 1, col: 4 },
        ],
      },
    ];
    render(
      <CheckersViewer
        state={state({ sim: checkersSim({ cells, legal }) })}
        me="p1"
        onMove={onMove}
      />,
    );
    tap(5, 4); // select
    tap(1, 4); // tap the FINAL landing square of the chain
    expect(onMove).toHaveBeenCalledWith(
      1,
      JSON.stringify({
        from: { row: 5, col: 4 },
        path: [
          { row: 3, col: 2 },
          { row: 1, col: 4 },
        ],
      }),
    );
  });

  it('ignores a tap on a non-movable square (no selection, no move)', () => {
    const onMove = vi.fn();
    const cells = withPiece(
      Array.from({ length: 64 }, () => 'empty'),
      5,
      2,
      'violet',
    );
    const legal = [{ from: { row: 5, col: 2 }, path: [{ row: 4, col: 1 }] }];
    render(
      <CheckersViewer
        state={state({ sim: checkersSim({ cells, legal }) })}
        me="p1"
        onMove={onMove}
      />,
    );
    // Tap an empty square that is not a movable source, then a would-be destination: nothing selected.
    tap(0, 0);
    tap(4, 1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears the selection when the same piece is tapped again', () => {
    const onMove = vi.fn();
    const cells = withPiece(
      Array.from({ length: 64 }, () => 'empty'),
      5,
      2,
      'violet',
    );
    const legal = [{ from: { row: 5, col: 2 }, path: [{ row: 4, col: 1 }] }];
    render(
      <CheckersViewer
        state={state({ sim: checkersSim({ cells, legal }) })}
        me="p1"
        onMove={onMove}
      />,
    );
    tap(5, 2); // select
    tap(5, 2); // deselect
    tap(4, 1); // now a destination tap does nothing (no selection)
    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores taps when it is not the local turn', () => {
    const onMove = vi.fn();
    const cells = withPiece(
      Array.from({ length: 64 }, () => 'empty'),
      5,
      2,
      'violet',
    );
    const legal = [{ from: { row: 5, col: 2 }, path: [{ row: 4, col: 1 }] }];
    render(
      <CheckersViewer
        state={state({ sim: checkersSim({ cells, legal }) })}
        me="p2"
        onMove={onMove}
      />,
    );
    const board = screen.getByRole('img', { name: /checkers board/i }).parentElement!;
    const src = cellCenter(5, 2);
    const dst = cellCenter(4, 1);
    firePointerDown(board, src.x, src.y);
    firePointerDown(board, dst.x, dst.y);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('announces the winner when the game is over', () => {
    render(
      <CheckersViewer
        state={state({
          sim: checkersSim({ over: true, toMove: null, outcome: 'amber', legal: [] }),
        })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/amber wins/i);
  });

  it('keeps the winning tally highlighted at game over', () => {
    render(
      <CheckersViewer
        state={state({
          sim: checkersSim({
            over: true,
            toMove: null,
            outcome: 'amber',
            violet: 0,
            amber: 5,
            legal: [],
          }),
        })}
        me="p1"
        onMove={noop}
      />,
    );
    // Amber won: its tally keeps the accent highlight; Violet's drops to plain text.
    const amberSpan = screen.getByText(/Amber 5/).closest('span')!;
    const violetSpan = screen.getByText(/Violet 0/).closest('span')!;
    expect(amberSpan.className).toContain('text-accent-strong');
    expect(violetSpan.className).toContain('text-text');
    expect(violetSpan.className).not.toContain('text-primary');
  });

  it('renders the reject alert copy when the engine rejected a move', () => {
    render(
      <CheckersViewer
        state={state({ sim: checkersSim(), rejected: 'illegal move' })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/if a jump is available/i);
  });
});
