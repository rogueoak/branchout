import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { TeeterViewer } from './Viewer';

// The single canvas draws with rAF + a 2D context. jsdom leaves getContext unimplemented (returns
// null); the draw loop guards on a null context, so rendering is safe - stub getContext to keep the
// jsdom "Not implemented" noise out of the test output. The level/height/score HUD and the turn/aim
// hint now render ON the canvas (screen-space overlays), so they are NOT in the DOM. The tests assert
// on what IS still in the DOM: the canvas aria-label (aim vs board), the rejection alert copy, the
// over-screen summary, and the drop payload emitted via onMove.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
});

const skin = { fill: '#ef476f', stroke: '#b52c4d' };
const eyes = [
  { x: -8, y: -6, r: 6 },
  { x: 8, y: -6, r: 6 },
];
const verts = [
  [
    { x: -20, y: -20 },
    { x: 20, y: -20 },
    { x: 20, y: 20 },
    { x: -20, y: 20 },
  ],
];

function teeterSim(activePlayer: string, over = false) {
  return {
    bodies: [] as unknown[],
    next: over ? null : { id: 3, verts, eyes, skin, x: 410, y: 440, spinSeed: 0.02 },
    activePlayer,
    height: 0,
    score: 0,
    level: 0,
    target: 450,
    // requiredLine well below the piece so a drop at the default pointer is legal.
    requiredLine: 520,
    // Level 1 is a wide, walled platform (feedback 0023); the client draws + clamps from this.
    platform: { width: 760, walls: true },
    over,
  };
}

function state(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    joined: true,
    connection: 'live',
    round: 4,
    players: [
      { player: 'p1', nickname: 'Ada', connected: true },
      { player: 'p2', nickname: 'Bo', connected: true },
    ],
    ...overrides,
  };
}

function noop() {}

// jsdom's synthetic PointerEvent drops clientX/clientY (they arrive undefined), which would make the
// screen->world mapping NaN. Construct the event and pin the coordinates so a real drag can be tested.
function firePointer(
  el: HTMLElement,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  clientX: number,
  clientY: number,
  timeStamp?: number,
): void {
  const ev = createEvent[type](el, { bubbles: true });
  Object.defineProperty(ev, 'clientX', { value: clientX });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  if (timeStamp != null) Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  fireEvent(el, ev);
}

// A quick, near-stationary tap: a pointerdown + pointerup at (x,y) at time `t`. Two taps close in time
// are the double-tap shortcut (feedback 0025).
function tap(board: HTMLElement, x: number, y: number, t: number): void {
  firePointer(board, 'pointerDown', x, y, t);
  firePointer(board, 'pointerUp', x, y, t + 10);
}

describe('TeeterViewer single interactive surface', () => {
  it('labels the board for aiming for the active player (an interactive surface)', () => {
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={noop} />);
    // The turn/aim hint is drawn on-canvas now, so the DOM signal that it is the local turn is the
    // canvas aria-label switching to the interactive "aim and drop" label.
    expect(screen.getByRole('img', { name: /aim and drop the piece/i })).toBeDefined();
    expect(screen.queryByRole('img', { name: /teeter tower board/i })).toBeNull();
  });

  it('labels the board as a passive board for a non-active player (no aim affordance)', () => {
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p2" onMove={noop} />);
    expect(screen.getByRole('img', { name: /teeter tower board/i })).toBeDefined();
    expect(screen.queryByRole('img', { name: /aim and drop the piece/i })).toBeNull();
  });

  it('mirrors the round/score + turn state into an aria-live region for assistive tech', () => {
    // The HUD + hint paint on the canvas (opaque to a screen reader), so the live state must survive in
    // the DOM via a polite aria-live status region (also the stable signal the e2e asserts on). Points
    // only, "Round" not "Level" (feedback 0025).
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={noop} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/Round 1, Warm-up/i);
    expect(status.textContent).toMatch(/0 points/i);
    expect(status.textContent).not.toMatch(/pixels/i);
    expect(status.textContent).toMatch(/move the piece on the board, then Stop spin/i);
  });

  it('the top-right button reads "Stop spin" while spinning and switches to "Drop" once stopped', () => {
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={noop} />);
    // Spinning: the aim button offers to stop the spin (a real HTML button, accessible by name).
    const stop = screen.getByRole('button', { name: /stop the spin and lock the angle/i });
    expect(stop).toBeDefined();
    // Tapping it locks the angle and moves to placing; the status flips to the "then Drop" prompt.
    fireEvent.click(stop);
    expect(screen.getByRole('status').textContent).toMatch(/move it into place, then Drop/i);
    // With the piece above the required line, the button now offers the Drop action.
    expect(screen.getByRole('button', { name: /drop the piece/i })).toBeDefined();
  });

  it('canvas moves the piece, then Stop spin + Drop calls onMove with a JSON {angle,dropX,dropY}', () => {
    const onMove = vi.fn();
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /aim and drop the piece/i })
      .parentElement as HTMLElement;
    // The canvas only MOVES the piece now - a tap/drag never drops.
    fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(board, { pointerId: 1, clientX: 120, clientY: 90 });
    expect(onMove).not.toHaveBeenCalled();
    // Stop the spin (locks the angle), then Drop via the top-right button.
    fireEvent.click(screen.getByRole('button', { name: /stop the spin and lock the angle/i }));
    fireEvent.click(screen.getByRole('button', { name: /drop the piece/i }));
    expect(onMove).toHaveBeenCalledTimes(1);
    const [round, moveString] = onMove.mock.calls[0]!;
    expect(round).toBe(4);
    const move = JSON.parse(moveString as string);
    expect(move).toHaveProperty('angle');
    expect(move).toHaveProperty('dropX');
    expect(move).toHaveProperty('dropY');
    expect(typeof move.dropX).toBe('number');
    expect(typeof move.dropY).toBe('number');
  });

  it('a double-tap on the board is a shortcut for the aim button (feedback 0025)', () => {
    const onMove = vi.fn();
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /aim and drop the piece/i })
      .parentElement as HTMLElement;
    // A single tap only moves the piece - it must not stop the spin or drop.
    tap(board, 100, 100, 500);
    expect(screen.getByRole('button', { name: /stop the spin and lock the angle/i })).toBeDefined();
    expect(onMove).not.toHaveBeenCalled();
    // A double-tap while spinning stops the spin (same as the button) - it now offers Drop.
    tap(board, 100, 100, 1000);
    tap(board, 100, 100, 1150); // second tap within DOUBLE_TAP_MS
    expect(screen.getByRole('button', { name: /drop the piece/i })).toBeDefined();
    expect(onMove).not.toHaveBeenCalled();
    // A double-tap while placing drops (submits the move).
    tap(board, 100, 100, 2000);
    tap(board, 100, 100, 2150);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('follows a press-drag but ignores a bare hover, so travelling to the button never re-aims (feedback 0023)', () => {
    // pointerToWorld ignores a zero-sized rect (jsdom's default) and keeps the last pointer, so give the
    // canvas a real rect to make the screen->world mapping live. Then a hover (pointer move with no press
    // down) must be a no-op while a real press-drag moves the piece: this is the regression guard for the
    // desktop bug where a mouse travelling up to the top-right Stop-spin/Drop button dragged the piece to
    // that corner (a high drop that instantly cleared the level). Touch has no hover, so mobile was fine.
    const rect = {
      left: 0,
      top: 0,
      right: 356,
      bottom: 648,
      width: 356,
      height: 648,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect;
    const rectSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect);
    try {
      const dropXAfter = (interact: (board: HTMLElement) => void): number => {
        const onMove = vi.fn();
        const { unmount } = render(
          <TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={onMove} />,
        );
        const board = screen.getByRole('img', { name: /aim and drop the piece/i })
          .parentElement as HTMLElement;
        interact(board);
        fireEvent.click(screen.getByRole('button', { name: /stop the spin and lock the angle/i }));
        fireEvent.click(screen.getByRole('button', { name: /drop the piece/i }));
        const move = JSON.parse(onMove.mock.calls[0]![1] as string) as { dropX: number };
        unmount();
        return move.dropX;
      };

      // A legal, well-left-of-center spot (maps above the required line, so the Drop stays enabled). A
      // mouse hovers across positions like this on its way up to the top-right button.
      const [x, y] = [60, 300];
      const baseline = dropXAfter(() => {}); // no board interaction -> default (centered) aim x
      const hovered = dropXAfter((b) => firePointer(b, 'pointerMove', x, y)); // hover only (no press)
      const dragged = dropXAfter((b) => {
        firePointer(b, 'pointerDown', x, y);
        firePointer(b, 'pointerMove', x, y);
      });

      // A bare hover leaves the drop x at the centered default; only a real press-drag moves it.
      expect(hovered).toBeCloseTo(baseline, 5);
      expect(dragged).toBeLessThan(baseline - 50);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('maps a server rejection reason to player-clear copy', () => {
    render(
      <TeeterViewer
        state={state({ sim: teeterSim('p1'), rejected: 'drop above the required line' })}
        me="p1"
        onMove={noop}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/drop it higher, above the marked line/i);
  });

  it('falls back to a generic message for an unknown rejection reason', () => {
    render(
      <TeeterViewer
        state={state({ sim: teeterSim('p1'), rejected: 'some surprise' })}
        me="p1"
        onMove={noop}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/aim and drop again/i);
    expect(alert.textContent).not.toMatch(/some surprise/i);
  });

  it('shows a final summary when the game is over', () => {
    render(<TeeterViewer state={state({ sim: teeterSim('p1', true) })} me="p1" onMove={noop} />);
    expect(screen.getByText(/tower complete/i)).toBeDefined();
    // The over view shows a board-only canvas (no interactive aim surface).
    expect(screen.getByRole('img', { name: /teeter tower board/i })).toBeDefined();
    expect(screen.queryByRole('img', { name: /aim and drop the piece/i })).toBeNull();
  });
});
