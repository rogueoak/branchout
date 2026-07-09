import { beforeEach, describe, expect, it } from 'vitest';
import type {
  GameCompleteReport,
  RoundReport,
  ServerMessage,
  StartHandoffRequest,
  StateMessage,
} from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import { GameEngine, NoSessionError, UnknownPlayerError } from './engine';

/** `join` returns the ordered catch-up frames; the authoritative `state` frame is the last one. */
function stateFrame(frames: ServerMessage[]): StateMessage {
  const frame = frames.find((f): f is StateMessage => f.type === 'state');
  if (!frame) throw new Error('join returned no state frame');
  return frame;
}
import {
  ManualScheduler,
  stubGame,
  STUB_GAME_ID,
  deciderGame,
  DECIDER_GAME_ID,
} from '@branchout/game-sdk/testing';
import { InMemoryPubSub } from './pubsub';
import { GameRegistry } from './registry';
import type { ControlPlaneReporter } from './reporter';
import { InMemorySessionStore } from './session';

class CapturingReporter implements ControlPlaneReporter {
  rounds: RoundReport[] = [];
  completes: GameCompleteReport[] = [];
  failRoundOnce = false;

  async reportRound(report: RoundReport): Promise<void> {
    if (this.failRoundOnce) {
      this.failRoundOnce = false;
      throw new Error('control-plane down');
    }
    this.rounds.push(report);
  }

  async reportComplete(report: GameCompleteReport): Promise<void> {
    this.completes.push(report);
  }
}

function handoff(overrides: Partial<StartHandoffRequest> = {}): StartHandoffRequest {
  return {
    v: PROTOCOL_VERSION,
    room: 'r1',
    game: STUB_GAME_ID,
    players: [
      { player: 'p1', nickname: 'Ada' },
      { player: 'p2', nickname: 'Bo' },
    ],
    config: { rounds: 2, secrets: ['blue', 'green'] },
    ...overrides,
  };
}

/** A hand-cranked clock so answer-window deadline math is deterministic (no wall time). */
class ManualClock {
  private t = 1_000_000;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

interface Harness {
  engine: GameEngine;
  store: InMemorySessionStore;
  pubsub: InMemoryPubSub;
  reporter: CapturingReporter;
  scheduler: ManualScheduler;
  clock: ManualClock;
}

function harness(): Harness {
  const store = new InMemorySessionStore();
  const pubsub = new InMemoryPubSub();
  const reporter = new CapturingReporter();
  const scheduler = new ManualScheduler();
  const clock = new ManualClock();
  const engine = new GameEngine({
    registry: new GameRegistry([stubGame]),
    store,
    pubsub,
    reporter,
    scheduler,
    clock: clock.now,
    logger: { error: () => {} },
  });
  return { engine, store, pubsub, reporter, scheduler, clock };
}

// Drive a no-dispute round from `collecting` to `leaderboard`.
async function playRoundNoDispute(engine: GameEngine, room: string): Promise<void> {
  await engine.control(room, STUB_GAME_ID, 'advance'); // collecting -> disputing (reveal)
  await engine.control(room, STUB_GAME_ID, 'advance'); // disputing -> leaderboard (no disputes)
}

describe('GameEngine lifecycle', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('runs a full game end to end and reports each round then the completion', async () => {
    const res = await h.engine.start(handoff());
    expect(res.status).toBe('started');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    // Round 1: p1 correct, p2 wrong.
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'wrong');
    await playRoundNoDispute(h.engine, 'r1');

    let state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.phase).toBe('leaderboard');
    expect(state?.scores).toEqual({ p1: 100, p2: 0 });

    // Advance to round 2.
    await h.engine.control('r1', STUB_GAME_ID, 'advance');
    state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.round).toBe(2);
    expect(state?.phase).toBe('collecting');

    // Round 2: both correct.
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 2, 'green');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 2, 'green');
    await playRoundNoDispute(h.engine, 'r1');

    // Last round's leaderboard advance ends the game.
    await h.engine.control('r1', STUB_GAME_ID, 'advance');
    state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.phase).toBe('complete');
    expect(state?.scores).toEqual({ p1: 200, p2: 100 });

    // Reporting: one round report per round, one completion, ranked standings.
    expect(h.reporter.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(h.reporter.completes).toHaveLength(1);
    expect(h.reporter.completes[0]?.standings).toEqual([
      { player: 'p1', nickname: 'Ada', score: 200, rank: 1 },
      { player: 'p2', nickname: 'Bo', score: 100, rank: 2 },
    ]);
  });

  it('awards 50 to a disputer upheld by a majority of the other players', async () => {
    await h.engine.start(
      handoff({
        players: [
          { player: 'p1', nickname: 'Ada' },
          { player: 'p2', nickname: 'Bo' },
          { player: 'p3', nickname: 'Cy' },
        ],
        config: { rounds: 1, secrets: ['blue'] },
      }),
    );

    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue'); // correct
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'bleu'); // wrong, will dispute
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p3', 1, 'red'); // wrong

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p2', 1, 'p2', false); // p2 raises a dispute

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // disputing -> voting
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('voting');
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p1', 1, 'p2', true); // both others uphold
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p3', 1, 'p2', true);

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // voting -> leaderboard
    const state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.scores).toEqual({ p1: 100, p2: 50, p3: 0 });
    expect(h.reporter.rounds[0]?.scores).toEqual([
      { player: 'p1', points: 100, reason: 'correct answer' },
      { player: 'p2', points: 50, reason: 'dispute upheld' },
    ]);
  });

  it('plays a full round driven by a non-host player who joined with its handoff playerId', async () => {
    // Mirror the control-plane handoff: the roster is keyed by opaque public playerIds (the tokens
    // a browser gets back from join), not control-plane session ids. The host is p_host; p_guest is
    // a non-host player on its own device.
    const roster = [
      { player: 'p_host', nickname: 'Host' },
      { player: 'kQ9m-tokenA', nickname: 'Guest' },
      { player: 'Zr3x-tokenB', nickname: 'Other' },
    ];
    await h.engine.start(
      handoff({ players: roster, config: { rounds: 2, secrets: ['blue', 'green'] } }),
    );

    // The non-host device binds to the session with the playerId it was handed - no session id.
    const joined = stateFrame(await h.engine.join('r1', STUB_GAME_ID, 'kQ9m-tokenA', 'Guest'));
    expect(joined.type).toBe('state');
    expect(joined.players.find((p) => p.player === 'kQ9m-tokenA')?.connected).toBe(true);

    // Round 1: host correct, guest wrong (will dispute), other wrong.
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p_host', 1, 'blue');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'kQ9m-tokenA', 1, 'bleu');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'Zr3x-tokenB', 1, 'red');

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // collecting -> disputing (reveal)
    // The non-host raises a dispute from its own device.
    await h.engine.submitVote('r1', STUB_GAME_ID, 'kQ9m-tokenA', 1, 'kQ9m-tokenA', false);
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // disputing -> voting

    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.disputes).toEqual(['kQ9m-tokenA']);
    // The other two uphold the guest's dispute.
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p_host', 1, 'kQ9m-tokenA', true);
    await h.engine.submitVote('r1', STUB_GAME_ID, 'Zr3x-tokenB', 1, 'kQ9m-tokenA', true);
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // voting -> leaderboard

    let state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.phase).toBe('leaderboard');
    expect(state?.scores).toEqual({ p_host: 100, 'kQ9m-tokenA': 50, 'Zr3x-tokenB': 0 });

    // The host advances to the next round.
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // leaderboard -> round 2 collecting
    state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.round).toBe(2);
    expect(state?.phase).toBe('collecting');
    expect(h.reporter.rounds.map((r) => r.round)).toEqual([1]);
  });

  it('projects the current disputers in the state frame during voting', async () => {
    await h.engine.start(
      handoff({
        players: [
          { player: 'p1', nickname: 'Ada' },
          { player: 'p2', nickname: 'Bo' },
          { player: 'p3', nickname: 'Cy' },
        ],
        config: { rounds: 2, secrets: ['blue', 'green'] },
      }),
    );
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue'); // correct
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'bleu'); // wrong, disputes
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p3', 1, 'red'); // wrong, does not dispute

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing
    // Only p2 raises a dispute; p3 was also wrong but stays silent.
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p2', 1, 'p2', false);
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // disputing -> voting

    // The wire projection names exactly the disputers - p2 - not the whole wrong-answer set.
    const snapshot = await h.engine.getSnapshot('r1', STUB_GAME_ID);
    expect(snapshot?.phase).toBe('voting');
    expect(snapshot?.disputes).toEqual(['p2']);

    // A device that joins mid-vote (e.g. a non-host reconnecting) sees the disputers too.
    const joinFrame = stateFrame(await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada'));
    expect(joinFrame.disputes).toEqual(['p2']);

    // The disputers are a per-round fact: a fresh round starts with none.
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // voting -> leaderboard
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // leaderboard -> round 2 collecting
    const round2 = await h.engine.getSnapshot('r1', STUB_GAME_ID);
    expect(round2?.round).toBe(2);
    expect(round2?.disputes).toEqual([]);
  });

  it('awards nothing when a dispute lacks a majority', async () => {
    await h.engine.start(
      handoff({
        players: [
          { player: 'p1', nickname: 'Ada' },
          { player: 'p2', nickname: 'Bo' },
          { player: 'p3', nickname: 'Cy' },
        ],
        config: { rounds: 1, secrets: ['blue'] },
      }),
    );
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'bleu');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p3', 1, 'red');

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p2', 1, 'p2', false);
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // disputing -> voting
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p1', 1, 'p2', true); // only one of two upholds
    await h.engine.submitVote('r1', STUB_GAME_ID, 'p3', 1, 'p2', false);
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // voting -> leaderboard

    expect((await h.engine.getState('r1', STUB_GAME_ID))?.scores).toEqual({
      p1: 100,
      p2: 0,
      p3: 0,
    });
  });

  it('skips the voting phase when nobody disputes', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // disputing -> leaderboard (no disputes)
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('auto-advances the answer round 2s after every connected player has answered', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    // Both roster players connect - the auto-advance only fires once *every connected* device has
    // answered.
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');

    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    // One of two answered: nothing scheduled, still collecting.
    expect(h.scheduler.pending).toBe(0);
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'green');
    // Everyone has answered now: the grace timer is armed but has not fired yet.
    expect(h.scheduler.pending).toBe(1);
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    h.scheduler.flush(); // fire the 2s grace timer
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
    // p1 answered correctly, so the reveal already scored the round.
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.scores.p1).toBe(100);
  });

  it('lets the host advance before the grace timer, and the stale timer then no-ops', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'green');
    expect(h.scheduler.pending).toBe(1); // grace timer armed

    // The host does not wait for the 2s grace - it advances now.
    await h.engine.control('r1', STUB_GAME_ID, 'advance');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');

    // The still-pending grace timer must find the phase already moved on and do nothing (no double
    // advance out of disputing).
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
  });

  it('does not auto-advance while a connected player is still silent', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');

    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    // p2 is present and has not answered: the round stays open with nothing scheduled.
    expect(h.scheduler.pending).toBe(0);
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');
  });

  it('auto-advances when the last silent player drops, without needing a resubmit', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    expect(h.scheduler.pending).toBe(0); // p2 still silent

    // p2 drops. Nobody resubmits: the disconnect alone completes the round for the remaining
    // connected players, so the engine arms the grace timer.
    await h.engine.disconnect('r1', STUB_GAME_ID, 'p2');
    expect(h.scheduler.pending).toBe(1);
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
  });

  it('does not auto-advance on a host drop (the game pauses instead)', async () => {
    await h.engine.start(
      handoff({
        players: [
          { player: 'p1', nickname: 'Ada', isHost: true },
          { player: 'p2', nickname: 'Bo' },
        ],
        config: { rounds: 1, secrets: ['blue'] },
      }),
    );
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada'); // host
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'green');
    expect(h.scheduler.pending).toBe(0); // host p1 still silent

    // The host drops: that pauses the game (spec 0014), so even though the only remaining connected
    // player has answered, the round must not auto-advance while paused.
    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1');
    expect(h.scheduler.pending).toBe(0);
    const state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.paused).toBe(true);
    expect(state?.phase).toBe('collecting');
  });

  it('force-closes the answer round when the 60s window expires, even with no answers', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], answerWindowMs: 60_000 } }),
    );
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    // Nobody answers; let the deadline pass, then the armed timer closes the round.
    h.clock.advance(60_000);
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
    // The window is over: the reveal-phase state frame carries no stale countdown.
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.answerMsRemaining).toBeUndefined();
  });

  it('re-arms the all-answered 2s grace on resume (a finished table closes promptly)', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], answerWindowMs: 60_000 } }),
    );
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p2', 1, 'green'); // everyone answered -> grace armed

    // Pause for longer than the 2s grace, then resume: the grace must be re-armed, not lost.
    await h.engine.control('r1', STUB_GAME_ID, 'pause');
    h.clock.advance(10_000);
    h.scheduler.flush(); // stale grace + answer timers no-op while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // resume
    h.scheduler.flush(); // the re-armed 2s grace fires and closes the finished round
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
  });

  it('self-heals the answer-window timer after a restart when a player submits', async () => {
    // Simulate an engine restart: a second engine over the same store has no in-memory timers.
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], answerWindowMs: 60_000 } }),
    );
    const scheduler2 = new ManualScheduler();
    const engine2 = new GameEngine({
      registry: new GameRegistry([stubGame]),
      store: h.store,
      pubsub: h.pubsub,
      reporter: h.reporter,
      scheduler: scheduler2,
      clock: h.clock.now,
      logger: { error: () => {} },
    });

    // No timer is armed on engine2. A late answer re-arms the window from the persisted deadline.
    await engine2.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'late');
    h.clock.advance(60_000);
    scheduler2.flush();
    expect((await engine2.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
  });

  it('projects the answer time left on the state frame, ticking down with the clock', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], answerWindowMs: 60_000 } }),
    );
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.answerMsRemaining).toBe(60_000);
    h.clock.advance(15_000);
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.answerMsRemaining).toBe(45_000);
  });

  it('holds the answer countdown while paused and continues from the time left on resume', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], answerWindowMs: 60_000 } }),
    );
    h.clock.advance(20_000); // 40s left

    await h.engine.control('r1', STUB_GAME_ID, 'pause');
    const snap = await h.engine.getSnapshot('r1', STUB_GAME_ID);
    expect(snap?.paused).toBe(true);
    expect(snap?.answerMsRemaining).toBe(40_000); // frozen

    // Time passes while paused: the countdown does not move and the round does not close.
    h.clock.advance(100_000);
    h.scheduler.flush(); // the pre-pause timer fires but no-ops while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.answerMsRemaining).toBe(40_000);

    // Resume: the deadline continues from the 40s that were left, not a fresh 60s.
    await h.engine.control('r1', STUB_GAME_ID, 'pause');
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.answerMsRemaining).toBe(40_000);
    h.clock.advance(39_999);
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting'); // 1ms left
    h.clock.advance(1);
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
  });

  it('closes the dispute window on a timer when one is configured', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], disputeWindowMs: 10000 } }),
    );
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing, arms timer
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');

    h.scheduler.flush(); // fire the dispute-window timer
    // Serialize behind the timer's queued work, then assert it advanced.
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('is idempotent: a duplicate handoff does not restart a running session', async () => {
    await h.engine.start(handoff());
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    const second = await h.engine.start(handoff());
    expect(second.status).toBe('running');
    // The submitted answer survived (session was not reset).
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.scores.p1).toBe(100);
  });

  it('reports each round exactly once with a stable idempotency id across a full game', async () => {
    await h.engine.start(handoff()); // 2 rounds
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> round 2
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 2, 'green');
    await playRoundNoDispute(h.engine, 'r1');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // end

    const ids = h.reporter.rounds.map((r) => r.roundId);
    expect(ids).toEqual(['r1:stub:1:1', 'r1:stub:1:2']);
    expect(new Set(ids).size).toBe(ids.length); // each id sent at most once
  });

  it('retries a failed round report via the outbox and delivers it exactly once', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    h.reporter.failRoundOnce = true; // the first delivery attempt fails

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // finalize round 1 (report fails, queued)
    let state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.reportedRounds).toEqual([]);
    expect(state?.pendingRounds).toHaveLength(1);
    expect(h.reporter.rounds).toHaveLength(0);

    // Ending the game flushes the outbox: the same roundId is retried and now delivered.
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // leaderboard -> endGame
    state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.phase).toBe('complete');
    expect(state?.pendingRounds).toEqual([]);
    expect(h.reporter.rounds.map((r) => r.roundId)).toEqual(['r1:stub:1:1']); // delivered once
    expect(state?.reportedRounds).toEqual(['r1:stub:1:1']);
  });

  it('lets a completed game be started again (0006 can re-hand-off the room)', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // complete
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('complete');

    const restarted = await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    expect(restarted.status).toBe('started');
    const state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.phase).toBe('collecting');
    expect(state?.scores).toEqual({ p1: 0, p2: 0 });
  });

  it('recovers session state on reconnect (join returns the live snapshot)', async () => {
    await h.engine.start(handoff());
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');

    const snapshot = stateFrame(await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada'));
    expect(snapshot).toMatchObject({ type: 'state', phase: 'leaderboard', scores: { p1: 100 } });
    const player = snapshot.players.find((p) => p.player === 'p1');
    expect(player?.connected).toBe(true);

    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1');
    const again = stateFrame(await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada'));
    expect(again.scores.p1).toBe(100); // score recovered after a reconnect
  });

  it('pause blocks answers and advancing until resumed', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.control('r1', STUB_GAME_ID, 'pause');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.paused).toBe(true);

    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue'); // ignored while paused
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // ignored while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // toggle back on
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.scores.p1).toBe(100);
  });

  it('re-arms a timed dispute window after a pause/resume so the round does not stall', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], disputeWindowMs: 10000 } }),
    );
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> disputing, arms window
    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // pause: cancels the window
    h.scheduler.flush(); // the original timer no-ops while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');

    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // resume: re-arms the window
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('rejects a join for a player not in the handed-off roster', async () => {
    await h.engine.start(handoff());
    await expect(h.engine.join('r1', STUB_GAME_ID, 'intruder', 'Mallory')).rejects.toThrow(
      UnknownPlayerError,
    );
  });

  it('exit ends the game, reports completion, and drops the session', async () => {
    await h.engine.start(handoff());
    await h.engine.control('r1', STUB_GAME_ID, 'exit');
    expect(await h.engine.getState('r1', STUB_GAME_ID)).toBeNull();
    expect(h.reporter.completes).toHaveLength(1);
  });

  it('rejects an invalid config at start (bad round count)', async () => {
    await expect(h.engine.start(handoff({ config: { rounds: 0 } }))).rejects.toThrow();
  });

  it('throws NoSessionError controlling a session that does not exist', async () => {
    await expect(h.engine.control('ghost', STUB_GAME_ID, 'advance')).rejects.toThrow(
      NoSessionError,
    );
  });
});

describe('join catch-up', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('replays the current prompt so a device that joins mid-round sees the question', async () => {
    // The prompt is published at start, before any device is subscribed - so a joiner only sees
    // the question if join replays it. Without the catch-up the joiner would get state only.
    await h.engine.start(handoff({ config: { rounds: 2, secrets: ['blue', 'green'] } }));
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    const prompt = frames.find((f) => f.type === 'prompt');
    expect(prompt).toBeDefined();
    expect(prompt).toMatchObject({ round: 1, prompt: { round: 1, question: 'stub round 1' } });
    // The state frame is last so the client's phase is authoritative after the replay.
    expect(frames.at(-1)?.type).toBe('state');
  });

  it('replays reveal and standings when a device joins after the round closes', async () => {
    await h.engine.start(handoff({ config: { rounds: 2, secrets: ['blue', 'green'] } }));
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1'); // -> leaderboard
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    expect(frames.some((f) => f.type === 'reveal')).toBe(true);
    expect(frames.some((f) => f.type === 'leaderboard')).toBe(true);
    expect(stateFrame(frames).phase).toBe('leaderboard');
  });

  it('drops the stale reveal from catch-up once the next round opens', async () => {
    await h.engine.start(handoff({ config: { rounds: 2, secrets: ['blue', 'green'] } }));
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1'); // round 1 -> leaderboard
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> round 2 collecting
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    // A new round cleared the prior reveal/standings; only the round-2 prompt replays.
    expect(frames.some((f) => f.type === 'reveal')).toBe(false);
    expect(frames.some((f) => f.type === 'leaderboard')).toBe(false);
    expect(frames.find((f) => f.type === 'prompt')).toMatchObject({ round: 2 });
  });
});

describe('host-disconnect auto-pause (spec 0014)', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  // p1 is the host, p2 a regular player.
  const hosted = () =>
    handoff({
      players: [
        { player: 'p1', nickname: 'Ada', isHost: true },
        { player: 'p2', nickname: 'Bo' },
      ],
      config: { rounds: 2, secrets: ['blue', 'green'] },
    });

  it('pauses a live game when the host disconnects and resumes when it reconnects', async () => {
    await h.engine.start(hosted());
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.paused).toBe(true);

    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.paused).toBe(false);
  });

  it('does not pause when a non-host disconnects', async () => {
    await h.engine.start(hosted());
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.disconnect('r1', STUB_GAME_ID, 'p2');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.paused).toBe(false);
  });

  it('does not undo a deliberate host pause when a non-host reconnects', async () => {
    await h.engine.start(hosted());
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // host pauses on purpose
    await h.engine.disconnect('r1', STUB_GAME_ID, 'p2');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo'); // non-host returns
    // The manual pause (hostPaused=false) is left intact.
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.paused).toBe(true);
  });

  it('re-arms a timed dispute window when the host reconnects so the round does not stall', async () => {
    // A host who drops mid-`disputing` auto-pauses (cancelling the window); its reconnect must
    // re-arm the timer, mirroring a manual pause/resume, or the round stalls on a dead timer.
    await h.engine.start(
      handoff({
        players: [{ player: 'p1', nickname: 'Ada', isHost: true }],
        config: { rounds: 1, secrets: ['blue'], disputeWindowMs: 10000 },
      }),
    );
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada'); // host connects (so disconnect fires)
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> disputing, arms the window

    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1'); // host drops: auto-pause
    h.scheduler.flush(); // the original timer no-ops while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');

    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada'); // host returns: resume + re-arm
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');
  });
});

describe('config-schema boundary', () => {
  function engineWith(schema: (raw: unknown) => unknown): GameEngine {
    return new GameEngine({
      registry: new GameRegistry([stubGame]),
      // The manifest schema map the plugin runtime hands the engine (see registerPlugins).
      configSchemas: new Map([[STUB_GAME_ID, schema]]),
      store: new InMemorySessionStore(),
      pubsub: new InMemoryPubSub(),
      reporter: new CapturingReporter(),
      scheduler: new ManualScheduler(),
      logger: { error: () => {} },
    });
  }

  it('rejects a handoff whose config fails the manifest schema, before the game configures', async () => {
    const engine = engineWith((raw) => {
      if ((raw as { bad?: boolean }).bad) throw new Error('schema: bad config');
      return raw;
    });
    await expect(engine.start(handoff({ config: { bad: true } }))).rejects.toThrow(
      'schema: bad config',
    );
    // The boundary threw before any state was written, so nothing was persisted.
    expect(await engine.getState('r1', STUB_GAME_ID)).toBeNull();
  });

  it('starts normally when the config passes the manifest schema', async () => {
    const engine = engineWith((raw) => raw);
    const res = await engine.start(handoff());
    expect(res.status).toBe('started');
  });
});

describe('decision/guess phase (spec 0020)', () => {
  const roster = [
    { player: 'p1', nickname: 'Ada' },
    { player: 'p2', nickname: 'Bo' },
    { player: 'p3', nickname: 'Cy' },
  ];

  function deciderHarness() {
    const store = new InMemorySessionStore();
    const pubsub = new InMemoryPubSub();
    const reporter = new CapturingReporter();
    const scheduler = new ManualScheduler();
    const clock = new ManualClock();
    const engine = new GameEngine({
      registry: new GameRegistry([deciderGame]),
      store,
      pubsub,
      reporter,
      scheduler,
      clock: clock.now,
      logger: { error: () => {} },
    });
    return { engine, store, pubsub, reporter, scheduler };
  }

  function deciderHandoff(overrides: Partial<StartHandoffRequest> = {}): StartHandoffRequest {
    return {
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: DECIDER_GAME_ID,
      players: roster,
      config: { truths: ['blue'], windowMs: 30000 },
      ...overrides,
    };
  }

  async function startJoinSubmit(engine: GameEngine): Promise<void> {
    await engine.start(deciderHandoff());
    for (const p of roster) await engine.join('r1', DECIDER_GAME_ID, p.player, p.nickname);
    await engine.submitAnswer('r1', DECIDER_GAME_ID, 'p1', 1, 'red');
    await engine.submitAnswer('r1', DECIDER_GAME_ID, 'p2', 1, 'green');
    await engine.submitAnswer('r1', DECIDER_GAME_ID, 'p3', 1, 'yellow');
  }

  it('enters guessing after reveal and scores on resolve (all-decided early close)', async () => {
    const h = deciderHarness();
    await startJoinSubmit(h.engine);
    await h.engine.control('r1', DECIDER_GAME_ID, 'advance'); // collecting -> guessing
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('guessing');

    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p1', 1, 'blue', true); // correct guess
    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p2', 1, 'red', true); // fools p1
    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p3', 1, 'green', true); // fools p2
    h.scheduler.flush(); // all-decided grace timer -> advance guessing -> finalize

    const state = await h.engine.getState('r1', DECIDER_GAME_ID);
    expect(state?.phase).toBe('leaderboard');
    expect(state?.scores).toEqual({ p1: 150, p2: 50, p3: 0 });
  });

  it('closes the guess round when the window timer fires', async () => {
    const h = deciderHarness();
    await startJoinSubmit(h.engine);
    await h.engine.control('r1', DECIDER_GAME_ID, 'advance');
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('guessing');
    // No one guesses; the guess-window timer force-closes the round.
    h.scheduler.flush();
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('re-arms the guess window after a pause and resume', async () => {
    const h = deciderHarness();
    await startJoinSubmit(h.engine);
    await h.engine.control('r1', DECIDER_GAME_ID, 'advance'); // -> guessing
    await h.engine.control('r1', DECIDER_GAME_ID, 'pause'); // paused
    h.scheduler.flush(); // window timer no-ops while paused
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('guessing');
    await h.engine.control('r1', DECIDER_GAME_ID, 'pause'); // resume + re-arm
    h.scheduler.flush(); // re-armed window fires
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('rejects a duplicate submission privately and writes no scratch', async () => {
    const h = deciderHarness();
    await h.engine.start(deciderHandoff());
    await h.engine.join('r1', DECIDER_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', DECIDER_GAME_ID, 'p2', 'Bo');

    const ok = await h.engine.submitAnswer('r1', DECIDER_GAME_ID, 'p1', 1, 'red');
    expect(ok.reject).toBeUndefined();
    const before = JSON.stringify((await h.engine.getState('r1', DECIDER_GAME_ID))?.scratch);

    const dup = await h.engine.submitAnswer('r1', DECIDER_GAME_ID, 'p2', 1, 'RED'); // duplicate
    expect(dup.reject?.type).toBe('answer_rejected');
    expect(dup.reject?.reason).toBe('taken');
    expect(dup.reject?.round).toBe(1);
    // No scratch was written: p2's fake never landed, the round is exactly as it was.
    const after = JSON.stringify((await h.engine.getState('r1', DECIDER_GAME_ID))?.scratch);
    expect(after).toBe(before);
  });
});
