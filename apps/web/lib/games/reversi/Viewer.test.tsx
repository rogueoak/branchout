import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { ReversiViewer } from './Viewer';

// The board draws on a 2D canvas via rAF; jsdom leaves getContext unimplemented, and the draw loop
// guards on a null context, so rendering is safe - stub it to keep the "Not implemented" noise out.
// The scoreboard + turn state are DOM rows (not canvas text), so the tests assert on those and on the
// onMove payload a tap emits.
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

/** A 2x2 mini-sim is enough to exercise tap->cell; the real board is 8x8 but the math is size-driven. */
function reversiSim(overrides: Record<string, unknown> = {}) {
  return {
    size: 8,
    cells: Array.from({ length: 64 }, () => 'empty'),
    toMove: 'violet',
    activePlayer: 'p1',
    legal: [{ row: 2, col: 3 }],
    violet: 2,
    amber: 2,
    passed: false,
    over: false,
    outcome: null,
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
  const board = 320 - 16; // 304
  const cell = board / 8; // 38
  const origin = (320 - board) / 2; // 8
  return { x: origin + col * cell + cell / 2, y: origin + row * cell + cell / 2 };
}

describe('ReversiViewer single interactive surface', () => {
  it('labels the board as interactive for the active player', () => {
    render(<ReversiViewer state={state({ sim: reversiSim() })} me="p1" onMove={noop} />);
    expect(screen.getByRole('img', { name: /tap a highlighted square/i })).toBeDefined();
  });

  it('labels the board passively for the non-active player', () => {
    render(<ReversiViewer state={state({ sim: reversiSim() })} me="p2" onMove={noop} />);
    expect(screen.getByRole('img', { name: /reversi board/i })).toBeDefined();
    expect(screen.queryByRole('img', { name: /tap a highlighted square/i })).toBeNull();
  });

  it('shows the scoreboard and whose turn it is in the DOM (screen readers + tests)', () => {
    render(<ReversiViewer state={state({ sim: reversiSim() })} me="p1" onMove={noop} />);
    expect(screen.getByText(/Violet 2/)).toBeDefined();
    expect(screen.getByText(/Amber 2/)).toBeDefined();
    expect(screen.getByRole('status').textContent).toMatch(/your turn/i);
  });

  it('emits an onMove with the tapped cell when the active player taps a legal square', () => {
    const onMove = vi.fn();
    render(<ReversiViewer state={state({ sim: reversiSim() })} me="p1" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /tap a highlighted square/i }).parentElement!;
    const c = cellCenter(2, 3); // the one legal square
    firePointerDown(board, c.x, c.y);
    expect(onMove).toHaveBeenCalledWith(1, JSON.stringify({ row: 2, col: 3 }));
  });

  it('ignores a tap on a non-legal square', () => {
    const onMove = vi.fn();
    render(<ReversiViewer state={state({ sim: reversiSim() })} me="p1" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /tap a highlighted square/i }).parentElement!;
    const c = cellCenter(0, 0); // not in the legal list
    firePointerDown(board, c.x, c.y);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores a tap when it is not the local turn', () => {
    const onMove = vi.fn();
    render(<ReversiViewer state={state({ sim: reversiSim() })} me="p2" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /reversi board/i }).parentElement!;
    const c = cellCenter(2, 3);
    firePointerDown(board, c.x, c.y);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('announces a forced pass from the skipped player vantage (it was my turn)', () => {
    // activePlayer is p1, so from p2's phone p2 was the one skipped (they do not hold the turn).
    render(
      <ReversiViewer
        state={state({ sim: reversiSim({ passed: true, activePlayer: 'p1' }) })}
        me="p2"
        onMove={noop}
      />,
    );
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/your turn was skipped/i);
    // The skipped player must NOT be told the other side passed - that reads backwards.
    expect(text).not.toMatch(/your turn again/i);
  });

  it('announces a forced pass from the extra-turn vantage (the other side was skipped)', () => {
    // activePlayer is p1 and me is p1, so p1 kept the turn - the OTHER side had no move.
    render(
      <ReversiViewer
        state={state({ sim: reversiSim({ passed: true, activePlayer: 'p1' }) })}
        me="p1"
        onMove={noop}
      />,
    );
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/your turn again/i);
    expect(text).not.toMatch(/your turn was skipped/i);
  });

  it('announces the winner when the game is over', () => {
    render(
      <ReversiViewer
        state={state({ sim: reversiSim({ over: true, toMove: null, outcome: 'amber' }) })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/amber wins/i);
  });

  it('keeps the winning tally highlighted at game over', () => {
    render(
      <ReversiViewer
        state={state({
          sim: reversiSim({ over: true, toMove: null, outcome: 'amber', violet: 20, amber: 44 }),
        })}
        me="p1"
        onMove={noop}
      />,
    );
    // Amber won: its tally keeps the accent highlight; Violet's drops to plain text.
    const amberSpan = screen.getByText(/Amber 44/).closest('span')!;
    const violetSpan = screen.getByText(/Violet 20/).closest('span')!;
    expect(amberSpan.className).toContain('text-accent-strong');
    expect(violetSpan.className).toContain('text-text');
    expect(violetSpan.className).not.toContain('text-primary');
  });

  it('renders the reject alert copy when the engine rejected a move', () => {
    render(
      <ReversiViewer
        state={state({ sim: reversiSim(), rejected: 'illegal move' })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/does not flip/i);
  });
});
