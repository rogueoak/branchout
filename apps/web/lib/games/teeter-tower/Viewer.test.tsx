import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { TeeterViewer } from './Viewer';

// The single canvas draws with rAF + a 2D context. jsdom leaves getContext unimplemented (returns
// null); the draw loop guards on a null context, so rendering is safe - stub getContext to keep the
// jsdom "Not implemented" noise out of the test output. The tests assert on the DOM affordances (the
// aim badges, the watching note, the drop payload), not the pixels.
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
  it('shows the aim affordance to the active player', () => {
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={noop} />);
    expect(screen.getByText(/your turn/i)).toBeDefined();
    expect(screen.getByText(/lock the angle/i)).toBeDefined();
    // The board is labelled for aiming (an interactive surface), not just a passive board.
    expect(screen.getByRole('img', { name: /aim and drop the piece/i })).toBeDefined();
  });

  it('shows a watching note to a non-active player (no aim affordance)', () => {
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p2" onMove={noop} />);
    expect(screen.getByText(/watching ada build/i)).toBeDefined();
    expect(screen.queryByText(/your turn/i)).toBeNull();
    expect(screen.getByRole('img', { name: /teeter tower board/i })).toBeDefined();
  });

  it('a tap to lock then a tap to drop calls onMove with a JSON {angle,dropX,dropY}', () => {
    const onMove = vi.fn();
    render(<TeeterViewer state={state({ sim: teeterSim('p1') })} me="p1" onMove={onMove} />);
    const board = screen.getByRole('img', { name: /aim and drop the piece/i })
      .parentElement as HTMLElement;
    // getBoundingClientRect is 0-sized in jsdom; pointerToWorld tolerates it and the drop still fires.
    // Tap 1 locks the spin angle; the badge flips to the placing hint.
    fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(screen.getByText(/move to aim, tap to drop/i)).toBeDefined();
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
    expect(screen.queryByText(/your turn/i)).toBeNull();
  });
});
