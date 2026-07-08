import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../lib/game-state';
import { RemotePane } from './RemotePane';

function build(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    joined: true,
    connection: 'live',
    round: 1,
    ...overrides,
  };
}

function noop() {}

function renderRemote(state: GameState) {
  return render(
    <RemotePane
      state={state}
      me="p1"
      onAnswer={noop}
      onDispute={noop}
      onBallot={noop}
    />,
  );
}

// The local player (p1) was marked wrong, so the only variable is whether another connected player
// exists to vote on a dispute.
function disputingState(players: GameState['players']): GameState {
  return build({
    phase: 'disputing',
    players,
    reveal: {
      round: 1,
      question: 'Q?',
      answers: ['answer'],
      correct: [],
      wrong: ['p1'],
    },
  });
}

describe('RemotePane dispute button', () => {
  it('offers Dispute when another connected player can vote', () => {
    const state = disputingState([
      { player: 'p1', nickname: 'Ada', connected: true },
      { player: 'p2', nickname: 'Bo', connected: true },
    ]);
    renderRemote(state);
    expect(screen.getByRole('button', { name: 'Dispute' })).toBeDefined();
  });

  it('hides Dispute in a solo game and explains why to the marked-wrong player', () => {
    const state = disputingState([{ player: 'p1', nickname: 'Ada', connected: true }]);
    renderRemote(state);
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();
    // Honest, closed copy instead of a dangling "may go to a vote".
    expect(screen.getByText(/no one else here to vote/i)).toBeDefined();
  });

  it('hides Dispute when the only other player is disconnected', () => {
    const state = disputingState([
      { player: 'p1', nickname: 'Ada', connected: true },
      { player: 'p2', nickname: 'Bo', connected: false },
    ]);
    renderRemote(state);
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();
  });
});
