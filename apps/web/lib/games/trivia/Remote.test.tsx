import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { RemotePane } from './Remote';

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
  return render(<RemotePane state={state} me="p1" onMove={noop} onVote={noop} />);
}

// The local player (p1) was marked wrong, so the only variable is whether another connected player
// exists to vote on a dispute.
function disputingState(players: GameState['players']): GameState {
  return build({
    phase: 'disputing',
    players,
    reveals: [
      {
        round: 1,
        question: 'Q?',
        answers: ['answer'],
        correct: [],
        wrong: ['p1'],
      },
    ],
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

describe('RemotePane answer countdown', () => {
  afterEach(() => vi.useRealTimers());

  const collecting = (moveMsRemaining: number | null): GameState =>
    build({
      phase: 'collecting',
      players: [{ player: 'p1', nickname: 'Ada', connected: true }],
      moveMsRemaining,
      prompt: { round: 1, category: 'People', difficulty: 5, question: 'Q?' },
    });

  it('shows the seconds left to answer', () => {
    renderRemote(collecting(30_000));
    expect(screen.getByRole('timer')).toBeDefined();
    expect(screen.getByText(/30s left to answer/)).toBeDefined();
  });

  it('auto-submits the typed draft when the countdown reaches zero', () => {
    vi.useFakeTimers();
    const onMove = vi.fn();
    render(<RemotePane state={collecting(1_000)} me="p1" onMove={onMove} onVote={noop} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'water' } });
    act(() => vi.advanceTimersByTime(1_000));
    expect(onMove).toHaveBeenCalledWith(1, 'water');
  });

  it('does not auto-submit a whitespace-only draft at zero', () => {
    vi.useFakeTimers();
    const onMove = vi.fn();
    render(<RemotePane state={collecting(1_000)} me="p1" onMove={onMove} onVote={noop} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '   ' } });
    act(() => vi.advanceTimersByTime(1_000));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not auto-submit while paused at expiry (the engine would drop it)', () => {
    const onMove = vi.fn();
    // Paused with 0 remaining: the countdown reads 0 but the round is held, so nothing should send.
    const state = build({
      phase: 'collecting',
      paused: true,
      players: [{ player: 'p1', nickname: 'Ada', connected: true }],
      moveMsRemaining: 0,
      prompt: { round: 1, category: 'People', difficulty: 5, question: 'Q?' },
    });
    render(<RemotePane state={state} me="p1" onMove={onMove} onVote={noop} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'water' } });
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('Paused')).toBeDefined();
  });
});
