import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../lib/game-state';
import { GameStage } from './GameStage';

// The stage scrolls to the top when a new question opens; jsdom leaves `scrollTo` unimplemented, so
// stub it module-wide to keep test output clean. The scroll-to-question tests re-spy to assert.
vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

// The single-surface (Teeter) viewer draws with a 2D canvas context jsdom does not implement; the
// draw loop guards on a null context, so stub getContext to null to keep the jsdom noise out.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);

// The host-only Feedback affordance is a canopy ResponsiveDialog, which reads matchMedia; jsdom has
// none. Stub it (desktop form) so the trigger mounts cleanly in the layout tests.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

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
  // difficulty is the question's numeric 1-10 rating (spec 0016).
  prompt: { round: 1, category: 'Science', difficulty: 3, question: 'What is H2O?' },
  // A round game with auto-advance OFF: the host must tap Next, so the host-controls accordion is
  // open by default and its buttons are directly reachable in these layout tests (spec 0069).
  autoAdvance: false,
});

function noop() {}

function renderStage(props: Partial<Parameters<typeof GameStage>[0]>) {
  return render(
    <GameStage
      state={collecting}
      me="p1"
      game="trivia"
      code="ABC12"
      mode="interactive"
      isHost={false}
      onMove={noop}
      onVote={noop}
      onControl={noop}
      {...props}
    />,
  );
}

describe('GameStage layout by mode', () => {
  it('interactive player sees the viewer and the controller', () => {
    renderStage({ mode: 'interactive' });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.getByLabelText('Your controller')).toBeDefined();
  });

  it('remote player sees the controller only', () => {
    renderStage({ mode: 'remote' });
    expect(screen.queryByLabelText('Game viewer')).toBeNull();
    expect(screen.getByLabelText('Your controller')).toBeDefined();
  });

  it('viewer mode sees the game only', () => {
    renderStage({ mode: 'viewer' });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.queryByLabelText('Your controller')).toBeNull();
  });

  it('an interactive host sees the viewer, the controller, and the control bar', () => {
    renderStage({ mode: 'interactive', isHost: true });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.getByLabelText('Your controller')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined();
  });

  it('a remote host sees the controller and the control bar but no viewer', () => {
    renderStage({ mode: 'remote', isHost: true });
    expect(screen.queryByLabelText('Game viewer')).toBeNull();
    expect(screen.getByLabelText('Your controller')).toBeDefined();
    // The host plays: the answer UI is present on the controller.
    expect(screen.getByLabelText('Your answer')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined();
  });
});

describe('GameStage per-phase rendering', () => {
  it('collecting shows the prompt on the viewer and a free-text answer on the remote', () => {
    const onMove = vi.fn();
    renderStage({ onMove });
    expect(screen.getByText('What is H2O?')).toBeDefined();
    const input = screen.getByLabelText('Your answer') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'water' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onMove).toHaveBeenCalledWith(1, 'water');
  });

  it('lets a player resubmit their answer until the round closes', () => {
    const onMove = vi.fn();
    renderStage({ onMove });
    const input = screen.getByLabelText('Your answer') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText(/Answer submitted/)).toBeDefined();
    // The button now offers a resubmit and a second answer is sent.
    fireEvent.change(input, { target: { value: 'water' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    expect(onMove).toHaveBeenLastCalledWith(1, 'water');
  });

  it('disputing offers the dispute button to a player marked wrong', () => {
    const onVote = vi.fn();
    // The reveal question is the prompt text; the answer is answers[0]. Use distinct values so the
    // viewer showing the question as the answer would fail this test.
    const state = build({
      phase: 'disputing',
      prompt: collecting.prompt,
      reveals: [
        {
          round: 1,
          question: 'What is H2O?',
          answers: ['Water'],
          correct: ['p3'],
          wrong: ['p1', 'p2'],
        },
      ],
    });
    renderStage({ state, onVote });
    // The viewer shows the answer (answers[0]), not the question text.
    within(screen.getByLabelText('Game viewer')).getByText('Water');
    const button = screen.getByRole('button', { name: 'Dispute' });
    fireEvent.click(button);
    // A dispute is a vote targeting the player themselves (spec 0007).
    expect(onVote).toHaveBeenCalledWith(1, 'p1', true);
  });

  it('does not offer the dispute button to a player who was not marked wrong', () => {
    const state = build({
      phase: 'disputing',
      prompt: collecting.prompt,
      reveals: [
        {
          round: 1,
          question: 'What is H2O?',
          answers: ['Water'],
          correct: ['p1'],
          wrong: ['p2'],
        },
      ],
    });
    // me is p1, who answered correctly, so no dispute button appears.
    renderStage({ state, mode: 'remote' });
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();
  });

  it('voting shows a ballot to the other players and reports the vote', () => {
    const onVote = vi.fn();
    const state = build({
      phase: 'voting',
      prompt: collecting.prompt,
      disputes: ['p2', 'p3'],
      reveals: [
        {
          round: 1,
          question: 'What is H2O?',
          answers: ['Water'],
          correct: ['p1'],
          wrong: ['p2', 'p3'],
        },
      ],
    });
    renderStage({ state, onVote });
    // p1 (me) did not dispute, so both other disputers appear as ballots.
    const controller = screen.getByLabelText('Your controller');
    within(controller).getByText('Bo');
    within(controller).getByText('Cy');
    fireEvent.click(within(controller).getByRole('button', { name: "Bo's answer should count" }));
    expect(onVote).toHaveBeenCalledWith(1, 'p2', true);
  });

  it('lists exactly the disputers, not every wrong answer', () => {
    const state = build({
      phase: 'voting',
      prompt: collecting.prompt,
      // p2 and p3 were both wrong, but only p2 actually disputed.
      disputes: ['p2'],
      reveals: [
        {
          round: 1,
          question: 'What is H2O?',
          answers: ['Water'],
          correct: ['p1'],
          wrong: ['p2', 'p3'],
        },
      ],
    });
    renderStage({ state });
    const controller = screen.getByLabelText('Your controller');
    within(controller).getByText('Bo');
    expect(within(controller).queryByText('Cy')).toBeNull();
  });

  it('offers no ballot when the voter is the only disputed player', () => {
    const state = build({
      phase: 'voting',
      prompt: collecting.prompt,
      disputes: ['p1'],
      reveals: [
        {
          round: 1,
          question: 'What is H2O?',
          answers: ['Water'],
          correct: [],
          wrong: ['p1'],
        },
      ],
    });
    renderStage({ state, mode: 'remote' });
    expect(screen.getByText(/Nothing for you to vote on/)).toBeDefined();
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
    renderStage({ state, mode: 'interactive', isHost: true });
    expect(screen.getByText(/Final results/)).toBeDefined();
    // Rank 1 earns three stars, rank 2 earns two, both labelled for assistive tech.
    expect(screen.getByLabelText('3 stars')).toBeDefined();
    expect(screen.getByLabelText('2 stars')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Back to lobby' })).toBeDefined();
  });
});

describe('GameStage connection, paused, and error surfaces', () => {
  it('shows a reconnecting banner while the socket is down', () => {
    renderStage({ state: { ...collecting, connection: 'reconnecting' } });
    expect(screen.getByText('Reconnecting...')).toBeDefined();
  });

  it('shows a host-aware paused banner and flips the host Pause control to Resume', () => {
    const state = build({
      phase: 'collecting',
      prompt: collecting.prompt,
      paused: true,
      autoAdvance: false,
    });
    renderStage({ state, mode: 'interactive', isHost: true });
    // One banner at the stage level, host-aware (the viewer pane no longer carries its own).
    expect(screen.getByText(/resume when you are ready/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined();
  });

  it('tells a non-host viewer the game is paused waiting on the host (not that it ended)', () => {
    // A host disconnect also sets paused; the copy must not read as a deliberate, permanent stop.
    const state = build({ phase: 'collecting', prompt: collecting.prompt, paused: true });
    renderStage({ state, mode: 'viewer', isHost: false });
    expect(screen.getByText(/waiting for the host/i)).toBeDefined();
  });

  it('surfaces a protocol error frame as an alert', () => {
    renderStage({ state: { ...collecting, error: 'join a session first' } });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('join a session first');
  });
});

describe('GameStage remote-only player sees results without a viewer', () => {
  it('renders the leaderboard on the controller between rounds', () => {
    const state = build({
      phase: 'leaderboard',
      standings: [
        { player: 'p1', nickname: 'Ada', score: 100, rank: 1 },
        { player: 'p2', nickname: 'Bo', score: 50, rank: 2 },
      ],
    });
    renderStage({ state, mode: 'remote' });
    expect(screen.queryByLabelText('Game viewer')).toBeNull();
    const controller = screen.getByLabelText('Your controller');
    within(controller).getByLabelText('Leaderboard');
    within(controller).getByText(/Ada/);
  });

  it('shows the question on the controller so a remote-only player does not answer blind', () => {
    renderStage({ mode: 'remote' });
    const controller = screen.getByLabelText('Your controller');
    // No viewer beside them, so the question must live on the controller itself.
    within(controller).getByText('What is H2O?');
    within(controller).getByLabelText('Your answer');
  });

  it('does not duplicate the question on the controller for an interactive player', () => {
    renderStage({ mode: 'interactive' });
    // The interactive player reads the question from the viewer; the controller stays answer-only.
    const controller = screen.getByLabelText('Your controller');
    expect(within(controller).queryByText('What is H2O?')).toBeNull();
    within(screen.getByLabelText('Game viewer')).getByText('What is H2O?');
  });

  it('shows a paused banner to a remote-only player who has no viewer', () => {
    const state = build({ phase: 'collecting', prompt: collecting.prompt, paused: true });
    renderStage({ state, mode: 'remote' });
    expect(screen.getByText(/waiting for the host/i)).toBeDefined();
  });

  it('renders the final results on the controller when the game ends', () => {
    const state = build({
      phase: 'complete',
      standings: [{ player: 'p1', nickname: 'Ada', score: 100, rank: 1 }],
    });
    renderStage({ state, mode: 'remote' });
    const controller = screen.getByLabelText('Your controller');
    within(controller).getByText(/Final results/);
    within(controller).getByLabelText('3 stars');
  });

  it('tells a remote host to tap Next between rounds, not to wait', () => {
    const state = build({
      phase: 'leaderboard',
      standings: [{ player: 'p1', nickname: 'Ada', score: 100, rank: 1 }],
    });
    renderStage({ state, mode: 'remote', isHost: true });
    const controller = screen.getByLabelText('Your controller');
    within(controller).getByText(/Tap Next when you are ready/);
    expect(within(controller).queryByText(/Waiting for the host/)).toBeNull();
  });
});

describe('GameStage single-surface game (Teeter Tower)', () => {
  // A single-surface game (registry flag `singleSurface: true`) is one interactive canvas: the shell
  // renders only the Viewer, full width, and passes onMove to it - even for a role that would
  // normally see the remote-only or viewer-only split.
  function teeterState(activePlayer: string): GameState {
    return build({
      phase: 'collecting',
      sim: {
        bodies: [],
        next: {
          id: 1,
          verts: [],
          eyes: [],
          skin: { fill: '#fff', stroke: '#000' },
          x: 410,
          y: 440,
          spinSeed: 0.02,
        },
        activePlayer,
        height: 0,
        score: 0,
        level: 0,
        target: 600,
        requiredLine: 520,
        over: false,
      },
    });
  }

  it('renders only the viewer (no separate controller) for a remote player', () => {
    renderStage({ game: 'teeter-tower', state: teeterState('p1'), mode: 'remote' });
    // The single surface is the viewer, shown even though a remote player normally sees no viewer.
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    // No separate remote controller pane (Teeter's Remote is a null no-op and is never rendered).
    expect(screen.queryByLabelText('Your controller')).toBeNull();
  });

  it('shows the game for a viewer without any controller', () => {
    renderStage({
      game: 'teeter-tower',
      state: teeterState('p1'),
      mode: 'viewer',
    });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.queryByLabelText('Your controller')).toBeNull();
  });

  it('leaves the standard viewer + remote split intact for a non-single-surface game', () => {
    // Trivia is not single-surface: an interactive player still gets both panes.
    renderStage({ game: 'trivia', mode: 'interactive' });
    expect(screen.getByLabelText('Game viewer')).toBeDefined();
    expect(screen.getByLabelText('Your controller')).toBeDefined();
  });
});

describe('GameStage host controls emphasis', () => {
  it('labels the host control bar and de-emphasizes Next while a question is answerable', () => {
    renderStage({ mode: 'remote', isHost: true });
    expect(screen.getByText('Host controls')).toBeDefined();
    // The player's answer Submit stays the clear primary; the advance control is an outline button.
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next.className).toMatch(/outline|border/);
  });

  it('opens the host-controls accordion by default when auto-advance is OFF (host must tap Next)', () => {
    const state = build({
      phase: 'collecting',
      prompt: collecting.prompt,
      autoAdvance: false,
    });
    renderStage({ state, mode: 'remote', isHost: true });
    // Auto-advance off: the manual Next control is expanded and reachable without opening anything.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined();
  });

  it('collapses the host-controls accordion by default when auto-advance is ON', () => {
    const state = build({
      phase: 'collecting',
      prompt: collecting.prompt,
      autoAdvance: true,
    });
    renderStage({ state, mode: 'remote', isHost: true });
    // The disclosure trigger is present, but its controls (Next) stay collapsed out of the DOM.
    expect(screen.getByText('Host controls')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('keeps host controls open for a game that reports no auto-advance (degrades like pre-feature)', () => {
    // A round game that does not send `autoAdvance` (null on the client - the insider games like
    // Sketchy / Zinger) is host-advanced: the host MUST reach Next to drive the last leaderboard to
    // the finale. So the accordion opens by default, exactly as the plain host bar behaved before.
    const state = build({
      phase: 'collecting',
      prompt: collecting.prompt,
      autoAdvance: null,
    });
    renderStage({ state, mode: 'remote', isHost: true });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDefined();
  });

  it('renders the Feedback affordance only for the host (spec 0048)', () => {
    const { rerender } = render(
      <GameStage
        state={collecting}
        me="p1"
        game="trivia"
        code="ABC12"
        mode="interactive"
        isHost={false}
        onMove={noop}
        onVote={noop}
        onControl={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Feedback' })).toBeNull();

    rerender(
      <GameStage
        state={collecting}
        me="p1"
        game="trivia"
        code="ABC12"
        mode="interactive"
        isHost={true}
        onMove={noop}
        onVote={noop}
        onControl={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeDefined();
  });
});

// The "How to play" control moved out of GameStage into the room header (spec 0068), inline with the
// room code; the RoomClient tests cover it there, and HowToPlayButton has its own sheet-behavior test.

describe('GameStage scroll-to-question', () => {
  // Assert against the module-level `window.scrollTo` stub (declared at top); clear between tests
  // rather than restore, so the stub survives for later files/tests (keeps jsdom quiet).
  const scrollTo = vi.mocked(window.scrollTo);
  beforeEach(() => scrollTo.mockClear());

  function stage(state: GameState, over: Partial<Parameters<typeof GameStage>[0]> = {}) {
    return (
      <GameStage
        state={state}
        me="p1"
        game="trivia"
        mode="remote"
        isHost={false}
        onMove={noop}
        onVote={noop}
        onControl={noop}
        {...over}
      />
    );
  }

  const round = (n: number): GameState =>
    build({
      phase: 'collecting',
      round: n,
      prompt: { round: n, category: 'Science', difficulty: 3, question: `Q${n}?` },
    });

  const leaderboard = (): GameState =>
    build({
      phase: 'leaderboard',
      round: 1,
      standings: [{ player: 'p1', nickname: 'Ada', score: 100, rank: 1 }],
    });

  it('scrolls to the top on mount into a fresh answer round', () => {
    render(stage(round(1)));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('scrolls again when the next answer round opens', () => {
    const { rerender } = render(stage(round(1)));
    scrollTo.mockClear();
    rerender(stage(round(2)));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('scrolls when a fresh collecting phase opens on the same round (restart to round 1)', () => {
    // restart() re-enters collecting with round still 1, so phase flips but the round does not.
    const { rerender } = render(stage(leaderboard()));
    scrollTo.mockClear();
    rerender(stage(round(1)));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('does not scroll when advancing to the leaderboard (no new question)', () => {
    const { rerender } = render(stage(round(1)));
    scrollTo.mockClear();
    rerender(stage(leaderboard()));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not re-scroll on a re-render with the same round and phase', () => {
    // A resync/reconnect state frame mid-collecting must not yank the viewport to the top.
    const state = round(1);
    const { rerender } = render(stage(state));
    scrollTo.mockClear();
    rerender(stage({ ...state, scores: { p1: 200, p2: 50 } }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll a viewer-only screen (no controller below the fold)', () => {
    // An observer sees only the viewer, so there is nothing to scroll past.
    render(stage(round(1), { mode: 'viewer' }));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
