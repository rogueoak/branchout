import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../lib/game-state';
import { GameStage } from './GameStage';

const players = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

function build(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    joined: true,
    connection: 'live',
    round: 1,
    players,
    scores: { p1: 100, p2: 50, p3: 0 },
    ...overrides,
  };
}

const collecting = build({
  phase: 'collecting',
  prompt: { round: 1, category: 'Science', difficulty: 5, question: 'What is H2O?' },
});

function noop() {}

function renderStage(props: Partial<Parameters<typeof GameStage>[0]>) {
  return render(
    <GameStage
      state={collecting}
      me="p1"
      role="player"
      mode="interactive"
      isHost={false}
      onAnswer={noop}
      onDispute={noop}
      onBallot={noop}
      onControl={noop}
      {...props}
    />,
  );
}

describe('GameStage layout by mode and role', () => {
  it('interactive player sees the viewer and the controller', () => {
    renderStage({ role: 'player', mode: 'interactive' });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.getByLabelText('Your controller')).toBeDefined();
  });

  it('remote player sees the controller only', () => {
    renderStage({ role: 'player', mode: 'remote' });
    expect(screen.queryByLabelText('Game viewer')).toBeNull();
    expect(screen.getByLabelText('Your controller')).toBeDefined();
  });

  it('observer sees the viewer only', () => {
    renderStage({ role: 'observer', mode: undefined });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.queryByLabelText('Your controller')).toBeNull();
  });

  it('host sees the viewer and the control bar', () => {
    renderStage({ role: 'host', mode: undefined, isHost: true });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined();
  });
});

describe('GameStage per-phase rendering', () => {
  it('collecting shows the prompt on the viewer and a free-text answer on the remote', () => {
    const onAnswer = vi.fn();
    renderStage({ onAnswer });
    expect(screen.getByText('What is H2O?')).toBeDefined();
    const input = screen.getByLabelText('Your answer') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'water' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAnswer).toHaveBeenCalledWith(1, 'water');
  });

  it('disputing offers the dispute button to a player marked wrong', () => {
    const onDispute = vi.fn();
    const state = build({
      phase: 'disputing',
      prompt: collecting.prompt,
      reveal: {
        round: 1,
        question: 'Water',
        answers: ['Water'],
        correct: ['p3'],
        wrong: ['p1', 'p2'],
      },
    });
    renderStage({ state, onDispute });
    const button = screen.getByRole('button', { name: 'Dispute' });
    fireEvent.click(button);
    expect(onDispute).toHaveBeenCalledWith(1);
  });

  it('voting shows a ballot to the other players and reports the vote', () => {
    const onBallot = vi.fn();
    const state = build({
      phase: 'voting',
      prompt: collecting.prompt,
      reveal: {
        round: 1,
        question: 'Water',
        answers: ['Water'],
        correct: ['p1'],
        wrong: ['p2', 'p3'],
      },
    });
    renderStage({ state, onBallot });
    // p1 (me) is not in `wrong`, so both other disputed players appear as ballots.
    const controller = screen.getByLabelText('Your controller');
    within(controller).getByText('Bo');
    within(controller).getByText('Cy');
    fireEvent.click(within(controller).getAllByRole('button', { name: 'Should count' })[0]);
    expect(onBallot).toHaveBeenCalledWith(1, 'p2', true);
  });

  it('leaderboard shows the between-round standings', () => {
    const state = build({
      phase: 'leaderboard',
      standings: [
        { player: 'p1', nickname: 'Ada', score: 100, rank: 1 },
        { player: 'p2', nickname: 'Bo', score: 50, rank: 2 },
      ],
    });
    renderStage({ state });
    expect(screen.getByText(/Waiting for the host/)).toBeDefined();
    const board = screen.getByLabelText('Leaderboard');
    within(board).getByText(/Ada/);
  });

  it('complete shows the final results with stars and a way back to the lobby for the host', () => {
    const state = build({
      phase: 'complete',
      standings: [
        { player: 'p1', nickname: 'Ada', score: 100, rank: 1 },
        { player: 'p2', nickname: 'Bo', score: 50, rank: 2 },
      ],
    });
    renderStage({ state, role: 'host', mode: undefined, isHost: true });
    expect(screen.getByText(/Final results/)).toBeDefined();
    // Rank 1 earns three stars, labelled for assistive tech.
    expect(screen.getByLabelText('3 stars')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Back to lobby' })).toBeDefined();
  });
});
