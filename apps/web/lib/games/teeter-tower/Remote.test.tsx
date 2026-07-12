import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { TeeterRemote } from './Remote';
import type { TeeterPrompt } from './protocol';

// A minimal but valid Teeter prompt: the decoder (asTeeterPrompt) requires a well-formed piece and a
// tower array, so we build a tiny square piece with two eyes and an empty tower. `activePlayer` picks
// who is building this turn.
function teeterPrompt(activePlayer: string): TeeterPrompt {
  return {
    round: 1,
    level: 0,
    target: 300,
    height: 0,
    activePlayer,
    tower: [],
    piece: {
      verts: [
        [
          { x: -20, y: -20 },
          { x: 20, y: -20 },
          { x: 20, y: 20 },
          { x: -20, y: 20 },
        ],
      ],
      eyes: [
        { x: -8, y: -6, r: 6 },
        { x: 8, y: -6, r: 6 },
      ],
      skin: { fill: '#ef476f', stroke: '#b52c4d' },
      x: 410,
      y: 440,
      spinSeed: 0.02,
    },
  };
}

function state(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    joined: true,
    connection: 'live',
    round: 1,
    players: [
      { player: 'p1', nickname: 'Ada', connected: true },
      { player: 'p2', nickname: 'Bo', connected: true },
    ],
    ...overrides,
  };
}

function noop() {}

describe('TeeterRemote', () => {
  it('shows the aim UI to the active player', () => {
    render(
      <TeeterRemote
        state={state({ phase: 'collecting', prompt: teeterPrompt('p1') })}
        me="p1"
        onMove={noop}
        onVote={noop}
      />,
    );
    // The active player is prompted to lock the piece's angle (the aim entry point).
    expect(screen.getByRole('button', { name: /lock the angle/i })).toBeDefined();
    expect(screen.getByText(/your turn/i)).toBeDefined();
  });

  it('shows a watching state to a non-active player', () => {
    render(
      <TeeterRemote
        state={state({ phase: 'collecting', prompt: teeterPrompt('p1') })}
        me="p2"
        onMove={noop}
        onVote={noop}
      />,
    );
    // p2 is not building this turn: no aim controls, just a watching note that names the builder.
    expect(screen.queryByRole('button', { name: /lock the angle/i })).toBeNull();
    expect(screen.getByText(/watching ada build/i)).toBeDefined();
  });

  it('renders the mapped player-clear alert, not the raw engine reason', () => {
    render(
      <TeeterRemote
        state={state({
          phase: 'collecting',
          prompt: teeterPrompt('p1'),
          rejected: 'not your turn',
        })}
        me="p1"
        onMove={noop}
        onVote={noop}
      />,
    );
    const alert = screen.getByRole('alert');
    // The friendly mapped copy shows, and the self-contradictory raw reason does not.
    expect(alert.textContent).toMatch(/it is not your turn yet/i);
    expect(alert.textContent).not.toMatch(/re-aim and drop again/i);
  });

  it('falls back to a generic message for an unknown rejection reason', () => {
    render(
      <TeeterRemote
        state={state({
          phase: 'collecting',
          prompt: teeterPrompt('p1'),
          rejected: 'some unexpected reason',
        })}
        me="p1"
        onMove={noop}
        onVote={noop}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/did not land - re-aim and drop again/i);
    expect(alert.textContent).not.toMatch(/some unexpected reason/i);
  });
});
