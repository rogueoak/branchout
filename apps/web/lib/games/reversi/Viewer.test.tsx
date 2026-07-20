import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { ReversiViewer, hintsVisibleFor } from './Viewer';
import { asReversiSim } from './protocol';

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

  it('still lets the active player tap and place when hints are turned off', () => {
    // With showAvailableMoves off the hint dots are hidden, but the square is still legal, so a tap on
    // it must still submit - the toggle is a display setting, not a rules change.
    const onMove = vi.fn();
    render(
      <ReversiViewer
        state={state({ sim: reversiSim({ showAvailableMoves: false }) })}
        me="p1"
        onMove={onMove}
      />,
    );
    // With hints off the board label no longer says "highlighted" (nothing is), so query the new copy.
    const board = screen.getByRole('img', { name: /tap an empty square to place/i }).parentElement!;
    const c = cellCenter(2, 3);
    firePointerDown(board, c.x, c.y);
    expect(onMove).toHaveBeenCalledWith(1, JSON.stringify({ row: 2, col: 3 }));
  });

  describe('interactive copy drops "highlighted" when hints are off', () => {
    it('turn line: says highlighted with hints on, empty-square with hints off', () => {
      const { rerender } = render(
        <ReversiViewer
          state={state({ sim: reversiSim({ showAvailableMoves: true }) })}
          me="p1"
          onMove={noop}
        />,
      );
      expect(screen.getByRole('status').textContent).toMatch(/tap a highlighted square/i);

      rerender(
        <ReversiViewer
          state={state({ sim: reversiSim({ showAvailableMoves: false }) })}
          me="p1"
          onMove={noop}
        />,
      );
      const text = screen.getByRole('status').textContent ?? '';
      expect(text).toMatch(/tap an empty square/i);
      expect(text).not.toMatch(/highlighted/i);
    });

    it('board aria-label: highlighted with hints on, empty-square with hints off', () => {
      const { rerender } = render(
        <ReversiViewer
          state={state({ sim: reversiSim({ showAvailableMoves: true }) })}
          me="p1"
          onMove={noop}
        />,
      );
      expect(screen.getByRole('img', { name: /tap a highlighted square to place/i })).toBeDefined();

      rerender(
        <ReversiViewer
          state={state({ sim: reversiSim({ showAvailableMoves: false }) })}
          me="p1"
          onMove={noop}
        />,
      );
      expect(screen.getByRole('img', { name: /tap an empty square to place/i })).toBeDefined();
      expect(screen.queryByRole('img', { name: /highlighted/i })).toBeNull();
    });

    it('illegal-move rejection: references a highlight only when hints are on', () => {
      const { rerender } = render(
        <ReversiViewer
          state={state({ sim: reversiSim({ showAvailableMoves: true }), rejected: 'illegal move' })}
          me="p1"
          onMove={noop}
        />,
      );
      expect(screen.getByRole('alert').textContent).toMatch(/highlighted/i);

      rerender(
        <ReversiViewer
          state={state({
            sim: reversiSim({ showAvailableMoves: false }),
            rejected: 'illegal move',
          })}
          me="p1"
          onMove={noop}
        />,
      );
      const alert = screen.getByRole('alert').textContent ?? '';
      expect(alert).toMatch(/does not flip anything/i);
      expect(alert).not.toMatch(/highlighted/i);
    });
  });

  describe('turn-start popup', () => {
    it('pops "Your turn" on the board for the player who now holds the turn', () => {
      render(<ReversiViewer state={state({ sim: reversiSim() })} me="p1" onMove={noop} />);
      expect(screen.getByText('Your turn')).toBeDefined();
    });

    it('names the skipped opponent when the active player got an extra turn', () => {
      render(
        <ReversiViewer
          state={state({ sim: reversiSim({ passed: true, activePlayer: 'p1' }) })}
          me="p1"
          onMove={noop}
        />,
      );
      // p2's nickname is "Am" in the test roster.
      expect(screen.getByText('Am has no moves, your turn')).toBeDefined();
    });

    it('tells the skipped player their turn was skipped', () => {
      render(
        <ReversiViewer
          state={state({ sim: reversiSim({ passed: true, activePlayer: 'p1' }) })}
          me="p2"
          onMove={noop}
        />,
      );
      expect(screen.getByText('You have no moves, turn skipped')).toBeDefined();
    });

    it('does not pop a turn notice for the plain waiting player', () => {
      render(<ReversiViewer state={state({ sim: reversiSim() })} me="p2" onMove={noop} />);
      expect(screen.queryByText('Your turn')).toBeNull();
    });

    it('does not pop a turn notice once the game is over', () => {
      render(
        <ReversiViewer
          state={state({ sim: reversiSim({ over: true, toMove: null, outcome: 'violet' }) })}
          me="p1"
          onMove={noop}
        />,
      );
      expect(screen.queryByText('Your turn')).toBeNull();
    });
  });

  // These prove the popup is keyed on the BOARD (a new move), not merely mounted once - a regression
  // that swapped the effect dep to [sim] / [state] or [activePlayer] would break at least one of them.
  describe('turn-start popup across successive sims (rerender)', () => {
    const emptyBoard = (): string[] => Array.from({ length: 64 }, () => 'empty');

    it('re-fires "Your turn" on the next move when the board changes', () => {
      const before = emptyBoard();
      const after = emptyBoard();
      after[20] = 'violet';
      const { rerender } = render(
        <ReversiViewer
          state={state({ sim: reversiSim({ cells: before, activePlayer: 'p1' }) })}
          me="p2"
          onMove={noop}
        />,
      );
      // p2 is the plain waiting player on p1's turn: no popup yet.
      expect(screen.queryByText('Your turn')).toBeNull();
      // p1 moved -> a NEW board -> it is now p2's turn.
      rerender(
        <ReversiViewer
          state={state({ sim: reversiSim({ cells: after, activePlayer: 'p2' }) })}
          me="p2"
          onMove={noop}
        />,
      );
      expect(screen.getByText('Your turn')).toBeDefined();
    });

    it('stays quiet on a score/label-only re-render where the board is unchanged', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const board = emptyBoard();
        const { rerender } = render(
          <ReversiViewer
            state={state({ sim: reversiSim({ cells: board, activePlayer: 'p1' }) })}
            me="p1"
            onMove={noop}
          />,
        );
        expect(screen.getByText('Your turn')).toBeDefined();
        // Let the self-dismiss timer clear the pill.
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(screen.queryByText('Your turn')).toBeNull();
        // A score-only update: the SAME board, only the disc counts differ. The popup must NOT return.
        rerender(
          <ReversiViewer
            state={state({
              sim: reversiSim({ cells: board, activePlayer: 'p1', violet: 4, amber: 1 }),
            })}
            me="p1"
            onMove={noop}
          />,
        );
        expect(screen.queryByText('Your turn')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fires exactly one "has no moves" popup on a forced-pass double turn (active player unchanged)', () => {
      const before = emptyBoard();
      const after = emptyBoard();
      after[20] = 'violet';
      const { rerender } = render(
        <ReversiViewer
          state={state({ sim: reversiSim({ cells: before, activePlayer: 'p1', passed: false }) })}
          me="p1"
          onMove={noop}
        />,
      );
      expect(screen.getByText('Your turn')).toBeDefined();
      // p1 moved; p2 had no legal move, so the turn PASSES back to p1: activePlayer is unchanged but the
      // board changed and passed is true. The popup must still re-fire, now with the skip copy.
      rerender(
        <ReversiViewer
          state={state({ sim: reversiSim({ cells: after, activePlayer: 'p1', passed: true }) })}
          me="p1"
          onMove={noop}
        />,
      );
      // Exactly one pill carries the skip copy (the aria-live status line uses a different phrasing).
      expect(screen.getAllByText('Am has no moves, your turn')).toHaveLength(1);
      // The single pill state was replaced, not duplicated.
      expect(screen.queryByText('Your turn')).toBeNull();
    });
  });

  describe('turn-start popup honors prefers-reduced-motion', () => {
    const originalMatchMedia = window.matchMedia;
    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    function stubReducedMotion(matches: boolean): void {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }

    it('applies the fade animation class when motion is allowed', () => {
      stubReducedMotion(false);
      render(<ReversiViewer state={state({ sim: reversiSim() })} me="p1" onMove={noop} />);
      expect(screen.getByText('Your turn').className).toContain('animate-reversi-turn-notice');
    });

    it('drops the fade animation class under reduced motion', () => {
      stubReducedMotion(true);
      render(<ReversiViewer state={state({ sim: reversiSim() })} me="p1" onMove={noop} />);
      expect(screen.getByText('Your turn').className).not.toContain('animate-reversi-turn-notice');
    });
  });
});

describe('hintsVisibleFor - the pure hint gating the canvas draw reads', () => {
  const on = asReversiSim(reversiSim())!;
  const off = asReversiSim(reversiSim({ showAvailableMoves: false }))!;

  it('shows hints only for the active player when the setting is on', () => {
    expect(hintsVisibleFor(on, true)).toBe(true);
    expect(hintsVisibleFor(on, false)).toBe(false);
  });

  it('never shows hints when the host turned the setting off', () => {
    expect(hintsVisibleFor(off, true)).toBe(false);
    expect(hintsVisibleFor(off, false)).toBe(false);
  });

  it('shows no hints for a null sim', () => {
    expect(hintsVisibleFor(null, true)).toBe(false);
  });
});
