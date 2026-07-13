import { fireEvent, render, screen } from '@testing-library/react';
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
    target: 600,
    // requiredLine well below the piece so a drop at the default pointer is legal.
    requiredLine: 520,
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

  it('mirrors the level/height/score + turn state into an aria-live region for assistive tech', () => {
    // The HUD + hint paint on the canvas (opaque to a screen reader), so the live state must survive in
    // the DOM via a polite aria-live status region (also the stable signal the e2e asserts on).
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={noop} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/Level 1, Warm-up/i);
    expect(status.textContent).toMatch(/Tower 0 of 600 pixels, 0 points/i);
    expect(status.textContent).toMatch(/Your turn: tap the board to lock/i);
  });

  it('a tap to lock then a tap to drop (after the debounce) calls onMove with a JSON {angle,dropX,dropY}', () => {
    vi.useFakeTimers();
    try {
      const onMove = vi.fn();
      render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={onMove} />);
      const board = screen.getByRole('img', { name: /aim and drop the piece/i })
        .parentElement as HTMLElement;
      // getBoundingClientRect is 0-sized in jsdom; pointerToWorld tolerates it and the drop still
      // fires. Tap 1 locks the spin angle (the placing hint is now on-canvas, not in the DOM).
      fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100 });
      // The double-tap guard: the drop is not armed until the debounce elapses. Advance past it so a
      // deliberate second tap in the same spot drops.
      vi.advanceTimersByTime(250);
      // Tap 2 drops: onMove is called once with a JSON-encoded move for this round.
      fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100 });
      expect(onMove).toHaveBeenCalledTimes(1);
      const [round, moveString] = onMove.mock.calls[0]!;
      expect(round).toBe(4);
      const move = JSON.parse(moveString as string);
      expect(move).toHaveProperty('angle');
      expect(move).toHaveProperty('dropX');
      expect(move).toHaveProperty('dropY');
      expect(typeof move.dropX).toBe('number');
      expect(typeof move.dropY).toBe('number');
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a reflexive double-tap (lock+drop in the same spot with no delay does not drop)', () => {
    vi.useFakeTimers();
    try {
      const onMove = vi.fn();
      render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={onMove} />);
      const board = screen.getByRole('img', { name: /aim and drop the piece/i })
        .parentElement as HTMLElement;
      // Two fast taps in the SAME spot with no debounce elapsed: the first locks, the second is
      // swallowed by the guard, so the irreversible drop does not fire.
      fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100 });
      expect(onMove).not.toHaveBeenCalled();
      // Still aimable - the piece was not committed, so the board keeps its interactive aim label.
      expect(screen.getByRole('img', { name: /aim and drop the piece/i })).toBeDefined();
    } finally {
      vi.useRealTimers();
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
