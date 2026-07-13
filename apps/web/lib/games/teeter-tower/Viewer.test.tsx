import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { spinGapY, TeeterViewer } from './Viewer';

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
    par: 8,
    pieces: 0,
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

  it('a double-tap does not drop when the pose is below the line (feedback 0025)', () => {
    const onMove = vi.fn();
    // A required line ABOVE the default pointer makes the pose illegal (the button reads "Too low" and
    // is disabled). The double-tap shortcut reaches drop() directly, so it must honor that too.
    const sim = { ...teeterSim('p1'), requiredLine: 100 };
    render(<TeeterViewer state={state({ sim })} me="p1" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /aim and drop the piece/i })
      .parentElement as HTMLElement;
    // Stop the spin (that is legal in any pose), then the placing pose is below the line.
    tap(board, 100, 100, 1000);
    tap(board, 100, 100, 1150);
    const btn = screen.getByRole('button', { name: /below the line/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // A double-tap must NOT submit an illegal (below-line) drop.
    tap(board, 100, 100, 2000);
    tap(board, 100, 100, 2150);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('shows the start-of-game gesture hint until a piece has landed (feedback 0025)', () => {
    const { rerender } = render(
      <TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={noop} />,
    );
    // At the very start (nothing landed: round 0, score 0, height 0) the onboarding overlay is shown
    // (mouse copy in jsdom, which has no `pointer: coarse`).
    expect(screen.getByText(/to stop spin and drop/i)).toBeDefined();
    // Once a piece has settled (height > 0) the hint is gone.
    rerender(
      <TeeterViewer
        state={state({ sim: { ...teeterSim('p1'), height: 40 } })}
        me="p1"
        onMove={noop}
      />,
    );
    expect(screen.queryByText(/to stop spin and drop/i)).toBeNull();
  });

  it('reports the round par + pieces used in the aria-live status (feedback 0026)', () => {
    const sim = { ...teeterSim('p1'), par: 8, pieces: 3, score: 25 };
    render(<TeeterViewer state={state({ sim })} me="p1" onMove={noop} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/3 of 8 par pieces used/i);
    expect(status.textContent).not.toMatch(/over par/i);
  });

  it('warns over par and reports a negative score (feedback 0026)', () => {
    const sim = { ...teeterSim('p1'), par: 8, pieces: 10, score: -20 };
    render(<TeeterViewer state={state({ sim })} me="p1" onMove={noop} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/-20 points/i);
    expect(status.textContent).toMatch(/over par/i);
  });

  it('aims on a bare hover as well as a press-drag - the mouse moves the piece without clicking (feedback 0026)', () => {
    // pointerToWorld ignores a zero-sized rect (jsdom's default) and keeps the last pointer, so give the
    // canvas a real rect to make the screen->world mapping live. A hover (pointer move with NO press) now
    // moves the piece just like a drag - the drag-guard was removed once the button moved off the canvas
    // (feedback 0026), so a mouse aims without clicking.
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

      // A legal, well-left-of-center spot (maps above the required line, so the Drop stays enabled).
      const [x, y] = [60, 300];
      const baseline = dropXAfter(() => {}); // no board interaction -> default (centered) aim x
      const hovered = dropXAfter((b) => firePointer(b, 'pointerMove', x, y)); // hover only (no press)
      const dragged = dropXAfter((b) => {
        firePointer(b, 'pointerDown', x, y);
        firePointer(b, 'pointerMove', x, y);
      });

      // Both a bare hover and a press-drag move the piece off the centered default to the same spot.
      expect(hovered).toBeLessThan(baseline - 50);
      expect(dragged).toBeLessThan(baseline - 50);
      expect(hovered).toBeCloseTo(dragged, 5);
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
    const sim = { ...teeterSim('p1', true), score: 175 };
    render(<TeeterViewer state={state({ sim })} me="p1" onMove={noop} />);
    expect(screen.getByText(/tower complete/i)).toBeDefined();
    expect(screen.getByText(/stacked your way to 175 pts/i)).toBeDefined();
    // The over view shows a board-only canvas (no interactive aim surface).
    expect(screen.getByRole('img', { name: /teeter tower board/i })).toBeDefined();
    expect(screen.queryByRole('img', { name: /aim and drop the piece/i })).toBeNull();
  });

  it('softens the game-over copy when the score went negative (feedback 0026)', () => {
    const sim = { ...teeterSim('p1', true), score: -30 };
    render(<TeeterViewer state={state({ sim })} me="p1" onMove={noop} />);
    expect(screen.getByText(/tower complete/i)).toBeDefined();
    // No mocking "-30 pts. Nice climbing." - a kinder sign-off instead.
    expect(screen.getByText(/give it another go/i)).toBeDefined();
    expect(screen.queryByText(/-30 pts/i)).toBeNull();
    expect(screen.queryByText(/nice climbing/i)).toBeNull();
  });
});

describe('spinGapY (fixed-height spin math, feedback 0027)', () => {
  it('pins the centroid a fixed gap above the line, INDEPENDENT of the spin angle (no bob)', () => {
    const requiredLine = 400;
    const y = spinGapY(requiredLine);
    // The centre sits a fixed gap above the line...
    expect(y).toBeLessThan(requiredLine);
    expect(requiredLine - y).toBe(110);
    // ...and takes NO piece/angle argument, so as the piece spins (its rotated half-height changing
    // every frame) the height never moves. It also tracks the line: a lower line lowers the piece by
    // the same amount.
    expect(spinGapY(500) - spinGapY(400)).toBe(100);
  });
});
