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

describe('RemotePane answer reveal (WS12)', () => {
  // A remote-only player has no viewer pane, so after each question the controller must show the
  // same AnswerReveal card the interactive player reads from the viewer.
  const revealState = (correct: string[]): GameState =>
    build({
      phase: 'disputing',
      players: [
        { player: 'p1', nickname: 'Ada', connected: true },
        { player: 'p2', nickname: 'Bo', connected: true },
      ],
      reveals: [
        {
          round: 1,
          question: 'Capital of France?',
          answers: ['Paris'],
          correct,
          wrong: correct.includes('p1') ? [] : ['p1'],
          submissions: [
            { player: 'p1', answer: 'Paris', correct: correct.includes('p1') },
            { player: 'p2', answer: 'Lyon', correct: correct.includes('p2') },
          ],
        },
      ],
    });

  it('renders the AnswerReveal card during the reveal phase for a remote-only player', () => {
    render(
      <RemotePane state={revealState(['p1'])} me="p1" showResults onMove={noop} onVote={noop} />,
    );
    // The canonical answer is the focus of the shared reveal card.
    expect(screen.getByTestId('reveal-answer').textContent).toBe('Paris');
    // Per-player correctness reads off the answers table.
    expect(screen.getByLabelText('Ada answered Paris, correct')).toBeDefined();
    expect(screen.getByLabelText('Bo answered Lyon, wrong')).toBeDefined();
  });

  it('does NOT render the reveal card for an interactive remote (the viewer pane carries it)', () => {
    // No showResults: this player has a viewer beside them showing the reveal.
    render(<RemotePane state={revealState(['p1'])} me="p1" onMove={noop} onVote={noop} />);
    expect(screen.queryByTestId('reveal-answer')).toBeNull();
  });
});

describe('RemotePane multiple choice + true/false (spec 0074)', () => {
  const mcCollecting = (): GameState =>
    build({
      phase: 'collecting',
      players: [{ player: 'p1', nickname: 'Ada', connected: true }],
      moveMsRemaining: 20_000,
      moveWindowMs: 20_000,
      prompt: {
        round: 1,
        type: 'multiple-choice',
        category: 'Animals',
        difficulty: 3,
        question: 'Fastest land animal?',
        choices: ['Lion', 'Cheetah', 'Pronghorn', 'Greyhound'],
      },
    });

  const tfCollecting = (): GameState =>
    build({
      phase: 'collecting',
      players: [{ player: 'p1', nickname: 'Ada', connected: true }],
      moveMsRemaining: 15_000,
      moveWindowMs: 15_000,
      prompt: {
        round: 1,
        type: 'true-false',
        category: 'Animals',
        difficulty: 4,
        question: "A shrimp's heart is in its head.",
      },
    });

  it('offers four option buttons and submits the chosen option text (no free-text field)', () => {
    const onMove = vi.fn();
    render(<RemotePane state={mcCollecting()} me="p1" onMove={onMove} onVote={noop} />);
    expect(screen.queryByLabelText('Your answer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cheetah' }));
    expect(onMove).toHaveBeenCalledWith(1, 'Cheetah');
    // Locked in after one tap - no give-up, no resubmit.
    expect(screen.queryByRole('button', { name: 'Cheetah' })).toBeNull();
    expect(screen.getByText('Answer locked in.')).toBeDefined();
  });

  it('offers True / False buttons and submits the judged value', () => {
    const onMove = vi.fn();
    render(<RemotePane state={tfCollecting()} me="p1" onMove={onMove} onVote={noop} />);
    expect(screen.getByRole('button', { name: 'True' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'False' }));
    expect(onMove).toHaveBeenCalledWith(1, 'False');
  });

  it('shows no give-up affordance on a tap-to-answer round', () => {
    render(<RemotePane state={mcCollecting()} me="p1" onMove={noop} onVote={noop} />);
    expect(screen.queryByRole('button', { name: "I don't know" })).toBeNull();
  });

  it('offers no dispute on a multiple-choice reveal (objectively scored)', () => {
    // MC/TF never populate `wrong`, and the reveal must not stream a dispute affordance at all.
    const state = build({
      phase: 'disputing',
      players: [
        { player: 'p1', nickname: 'Ada', connected: true },
        { player: 'p2', nickname: 'Bo', connected: true },
      ],
      reveals: [
        {
          round: 1,
          type: 'multiple-choice',
          question: 'Fastest land animal?',
          answers: ['Cheetah'],
          correct: ['p2'],
          wrong: [],
          submissions: [
            { player: 'p1', answer: 'Lion', correct: false },
            { player: 'p2', answer: 'Cheetah', correct: true },
          ],
        },
      ],
    });
    render(<RemotePane state={state} me="p1" showResults onMove={noop} onVote={noop} />);
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();
    expect(screen.queryByText(/may go to a vote/i)).toBeNull();
  });
});

describe('RemotePane answer countdown', () => {
  afterEach(() => vi.useRealTimers());

  const collecting = (moveMsRemaining: number | null): GameState =>
    build({
      phase: 'collecting',
      players: [{ player: 'p1', nickname: 'Ada', connected: true }],
      moveMsRemaining,
      moveWindowMs: 60_000,
      prompt: { round: 1, category: 'People', difficulty: 5, question: 'Q?' },
    });

  it('shows the seconds left to answer on the question card for a remote-only player', () => {
    // A remote-only player (showResults) renders the shared question card, which carries the timer.
    render(
      <RemotePane state={collecting(30_000)} me="p1" showResults onMove={noop} onVote={noop} />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('aria-label')).toBe('30 seconds left to answer');
    expect(timer.textContent).toBe('30');
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

  it('locks in once submitted: the form is gone with no resubmit or "you can change it" copy', () => {
    const onMove = vi.fn();
    render(<RemotePane state={collecting(30_000)} me="p1" onMove={onMove} onVote={noop} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'water' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onMove).toHaveBeenCalledWith(1, 'water');
    // The input, Submit, and give-up are all gone - a player answers exactly once.
    expect(screen.queryByLabelText('Your answer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resubmit' })).toBeNull();
    expect(screen.queryByRole('button', { name: "I don't know" })).toBeNull();
    // No "you can change it" copy; a locked confirmation instead.
    expect(screen.queryByText(/change/i)).toBeNull();
    expect(screen.getByText('Answer locked in.')).toBeDefined();
  });

  it('offers a red "I don\'t know" give-up under Submit that fails the round and locks the player', () => {
    const onMove = vi.fn();
    render(<RemotePane state={collecting(30_000)} me="p1" onMove={onMove} onVote={noop} />);
    const giveUp = screen.getByRole('button', { name: "I don't know" });
    // Styled red (the destructive/danger variant paints bg-danger).
    expect(giveUp.className).toContain('bg-danger');
    // The cost is stated UP FRONT, before the tap (fat-finger mitigation).
    expect(screen.getByText(/counts as wrong - no points/i)).toBeDefined();
    fireEvent.click(giveUp);
    // A give-up submits the empty-answer sentinel: the engine scores it wrong (no points).
    expect(onMove).toHaveBeenCalledWith(1, '');
    // Same locked-out state as a normal submit - no form, no resubmit.
    expect(screen.queryByLabelText('Your answer')).toBeNull();
    expect(screen.queryByRole('button', { name: "I don't know" })).toBeNull();
    expect(screen.getByText(/passed on this question/i)).toBeDefined();
  });

  it('locks the form when the engine rejects a resubmit (reload/replay guard)', () => {
    // A reloaded device lost its local submit flag, so it renders the form. Once it attempts a submit,
    // the engine rejects it (already answered), which the reducer stores in `state.rejected`. The
    // remote must lock to that authoritative truth instead of leaving the form open to overwrite.
    const rejected = { ...collecting(30_000), rejected: 'You already answered this round.' };
    render(<RemotePane state={rejected} me="p1" onMove={noop} onVote={noop} />);
    expect(screen.queryByLabelText('Your answer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.queryByRole('button', { name: "I don't know" })).toBeNull();
    expect(screen.getByText(/already answered this round/i)).toBeDefined();
  });

  it('does not auto-submit while paused at expiry (the engine would drop it)', () => {
    const onMove = vi.fn();
    // Paused with 0 remaining: the countdown reads 0 but the round is held, so nothing should send.
    const state = build({
      phase: 'collecting',
      paused: true,
      players: [{ player: 'p1', nickname: 'Ada', connected: true }],
      moveMsRemaining: 0,
      moveWindowMs: 60_000,
      prompt: { round: 1, category: 'People', difficulty: 5, question: 'Q?' },
    });
    // Remote-only so the question card (with the paused countdown) renders here.
    render(<RemotePane state={state} me="p1" showResults onMove={onMove} onVote={noop} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'water' } });
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('Paused')).toBeDefined();
  });
});
