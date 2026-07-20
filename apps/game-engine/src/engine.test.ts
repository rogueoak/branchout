import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GameCompleteReport,
  RoundReport,
  ServerMessage,
  StartHandoffRequest,
  StateMessage,
} from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import type { GameModule } from '@branchout/game-sdk';
import { GameEngine, NoSessionError, AUTO_ADVANCE_MS, MAX_SIM_TICK_FAILURES } from './engine';

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
import { InMemoryPubSub, privateChannel, streamChannel } from './pubsub';
import { InProcessRuntimeProvider } from './worker/runtime';
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
    runtimeProvider: new InProcessRuntimeProvider([stubGame]),
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'wrong');
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 2, 'green');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 2, 'green');
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

  it('auto-advances the leaderboard to the next round after the configured dwell (spec 0068)', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 2, secrets: ['blue', 'green'], leaderboardWindowMs: 5_000 } }),
    );
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'wrong');
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');

    // No host tap: the leaderboard dwell fires and opens round 2 on its own.
    h.scheduler.advance(5_000);
    const state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.round).toBe(2);
    expect(state?.phase).toBe('collecting');
  });

  it('auto-advances the FINAL round leaderboard to game end + one completion report (spec 0068)', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], leaderboardWindowMs: 5_000 } }),
    );
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');

    // The last round's dwell ends the game with no host tap, and reports completion exactly once.
    h.scheduler.advance(5_000);
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('complete');
    expect(h.reporter.completes).toHaveLength(1);
    expect(h.reporter.rounds.map((r) => r.round)).toEqual([1]);
    // No further timer fires a second completion.
    h.scheduler.flush();
    expect(h.reporter.completes).toHaveLength(1);
  });

  it('re-arms the leaderboard auto-advance across a pause and resume (spec 0068)', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 2, secrets: ['blue', 'green'], leaderboardWindowMs: 5_000 } }),
    );
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');

    await h.engine.control('r1', STUB_GAME_ID, 'pause');
    h.scheduler.flush(); // the pre-pause dwell timer is cancelled, so nothing advances while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');

    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // resume re-arms the dwell from the time left
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.round).toBe(2);
  });

  it('re-arms the leaderboard auto-advance when the host reconnects (spec 0068)', async () => {
    await h.engine.start(
      handoff({
        players: [
          { player: 'p1', nickname: 'Ada', isHost: true },
          { player: 'p2', nickname: 'Bo' },
        ],
        config: { rounds: 2, secrets: ['blue', 'green'], leaderboardWindowMs: 5_000 },
      }),
    );
    for (const p of ['p1', 'p2']) await h.engine.join('r1', STUB_GAME_ID, p, p);
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');

    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1'); // host drops -> auto-pause freezes the dwell
    h.scheduler.flush(); // the frozen dwell does not advance while the host is away
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');

    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada'); // host returns -> resume + re-arm the dwell
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.round).toBe(2);
  });

  it('does not let a stale leaderboard timer advance a later round or a post-restart run (spec 0068)', async () => {
    await h.engine.start(
      handoff({
        config: { rounds: 3, secrets: ['blue', 'green', 'red'], leaderboardWindowMs: 5_000 },
      }),
    );
    // Round 1 -> leaderboard (a dwell timer is armed for round 1).
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    // The host taps to round 2 before the round-1 dwell fires; the round-1 timer must not survive to
    // advance a later round's leaderboard. (A restart would likewise start a fresh run.)
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> round 2 collecting
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.round).toBe(2);
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 2, 'green');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 2, 'green');
    await playRoundNoDispute(h.engine, 'r1'); // round 2 -> leaderboard (round-2 dwell armed)

    // Firing every pending timer must advance ONLY once (the round-2 dwell), landing on round 3 -
    // not skip a round or end the game from a stale round-1 timer.
    h.scheduler.flush();
    const state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.round).toBe(3);
    expect(state?.phase).toBe('collecting');
  });

  it('leaves the leaderboard host-advanced when no dwell is configured', async () => {
    await h.engine.start(handoff({ config: { rounds: 2, secrets: ['blue', 'green'] } }));
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');

    // With leaderboardWindowMs unset (0), firing every timer never leaves the leaderboard.
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.round).toBe(1);
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

    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue'); // correct
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'bleu'); // wrong, will dispute
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p3', 1, 'red'); // wrong

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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p_host', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'kQ9m-tokenA', 1, 'bleu');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'Zr3x-tokenB', 1, 'red');

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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue'); // correct
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'bleu'); // wrong, disputes
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p3', 1, 'red'); // wrong, does not dispute

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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'bleu');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p3', 1, 'red');

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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
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

    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    // One of two answered: nothing scheduled, still collecting.
    expect(h.scheduler.pending).toBe(0);
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'green');
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'green');
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

    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    // p2 is present and has not answered: the round stays open with nothing scheduled.
    expect(h.scheduler.pending).toBe(0);
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');
  });

  it('auto-advances when the last silent player drops, without needing a resubmit', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'green');
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
      handoff({ config: { rounds: 1, secrets: ['blue'], moveWindowMs: 60_000 } }),
    );
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    // Nobody answers; let the deadline pass, then the armed timer closes the round.
    h.clock.advance(60_000);
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
    // The window is over: the reveal-phase state frame carries no stale countdown.
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.moveMsRemaining).toBeUndefined();
  });

  it('re-arms the all-answered 2s grace on resume (a finished table closes promptly)', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], moveWindowMs: 60_000 } }),
    );
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p2', 1, 'green'); // everyone answered -> grace armed

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
      handoff({ config: { rounds: 1, secrets: ['blue'], moveWindowMs: 60_000 } }),
    );
    const scheduler2 = new ManualScheduler();
    const engine2 = new GameEngine({
      runtimeProvider: new InProcessRuntimeProvider([stubGame]),
      store: h.store,
      pubsub: h.pubsub,
      reporter: h.reporter,
      scheduler: scheduler2,
      clock: h.clock.now,
      logger: { error: () => {} },
    });

    // No timer is armed on engine2. A late answer re-arms the window from the persisted deadline.
    await engine2.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'late');
    h.clock.advance(60_000);
    scheduler2.flush();
    expect((await engine2.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');
  });

  it('projects the answer time left on the state frame, ticking down with the clock', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], moveWindowMs: 60_000 } }),
    );
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.moveMsRemaining).toBe(60_000);
    h.clock.advance(15_000);
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.moveMsRemaining).toBe(45_000);
  });

  it('holds the answer countdown while paused and continues from the time left on resume', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], moveWindowMs: 60_000 } }),
    );
    h.clock.advance(20_000); // 40s left

    await h.engine.control('r1', STUB_GAME_ID, 'pause');
    const snap = await h.engine.getSnapshot('r1', STUB_GAME_ID);
    expect(snap?.paused).toBe(true);
    expect(snap?.moveMsRemaining).toBe(40_000); // frozen

    // Time passes while paused: the countdown does not move and the round does not close.
    h.clock.advance(100_000);
    h.scheduler.flush(); // the pre-pause timer fires but no-ops while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.moveMsRemaining).toBe(40_000);

    // Resume: the deadline continues from the 40s that were left, not a fresh 60s.
    await h.engine.control('r1', STUB_GAME_ID, 'pause');
    expect((await h.engine.getSnapshot('r1', STUB_GAME_ID))?.moveMsRemaining).toBe(40_000);
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing, arms timer
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');

    h.scheduler.flush(); // fire the dispute-window timer
    // Serialize behind the timer's queued work, then assert it advanced.
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('is idempotent: a duplicate handoff does not restart a running session', async () => {
    await h.engine.start(handoff());
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    const second = await h.engine.start(handoff());
    expect(second.status).toBe('running');
    // The submitted answer survived (session was not reset).
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.scores.p1).toBe(100);
  });

  it('reports each round exactly once with a stable idempotency id across a full game', async () => {
    await h.engine.start(handoff()); // 2 rounds
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> round 2
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 2, 'green');
    await playRoundNoDispute(h.engine, 'r1');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // end

    const ids = h.reporter.rounds.map((r) => r.roundId);
    expect(ids).toEqual(['r1:stub:1:1', 'r1:stub:1:2']);
    expect(new Set(ids).size).toBe(ids.length); // each id sent at most once
  });

  it('retries a failed round report via the outbox and delivers it exactly once', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
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

    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue'); // ignored while paused
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // ignored while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('collecting');

    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // toggle back on
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.scores.p1).toBe(100);
  });

  it('re-arms a timed dispute window after a pause/resume so the round does not stall', async () => {
    await h.engine.start(
      handoff({ config: { rounds: 1, secrets: ['blue'], disputeWindowMs: 10000 } }),
    );
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> disputing, arms window
    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // pause: cancels the window
    h.scheduler.flush(); // the original timer no-ops while paused
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('disputing');

    await h.engine.control('r1', STUB_GAME_ID, 'pause'); // resume: re-arms the window
    h.scheduler.flush();
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('admits a non-roster player as a broadcast-only VIEWER (spec 0050)', async () => {
    // A viewer (spec 0050) is not in the playing roster but still needs the broadcast stream to
    // watch. join must hand it the catch-up broadcast frames (prompt + authoritative state) rather
    // than reject it - otherwise a shared-screen watcher never sees the game. It stays OUT of the
    // roster (never a player) and its connection is not a roster (re)connection.
    await h.engine.start(handoff({ config: { rounds: 2, secrets: ['blue', 'green'] } }));
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'viewer-1', 'Olive');
    // The viewer sees the current round's prompt and the authoritative state, just like a player.
    expect(frames.find((f) => f.type === 'prompt')).toMatchObject({ round: 1 });
    expect(frames.at(-1)?.type).toBe('state');
    // But it never joined the roster: the game still has exactly the two handed-off players.
    const state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.players.map((p) => p.player).sort()).toEqual(['p1', 'p2']);
    expect(state?.players.some((p) => p.player === 'viewer-1')).toBe(false);
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1'); // -> leaderboard
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    expect(frames.some((f) => f.type === 'reveal')).toBe(true);
    expect(frames.some((f) => f.type === 'leaderboard')).toBe(true);
    expect(stateFrame(frames).phase).toBe('leaderboard');
  });

  it('drops the stale reveal from catch-up once the next round opens', async () => {
    await h.engine.start(handoff({ config: { rounds: 2, secrets: ['blue', 'green'] } }));
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1'); // round 1 -> leaderboard
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> round 2 collecting
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    // A new round cleared the prior reveal/standings; only the round-2 prompt replays.
    expect(frames.some((f) => f.type === 'reveal')).toBe(false);
    expect(frames.some((f) => f.type === 'leaderboard')).toBe(false);
    expect(frames.find((f) => f.type === 'prompt')).toMatchObject({ round: 2 });
  });
});

describe('per-player private payloads (spec 0052)', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  // A handoff whose stub deals a distinct secret to each of p1 (A) and p2 (B) at each round start.
  const secretHandoff = () =>
    handoff({
      config: {
        rounds: 2,
        secrets: ['blue', 'green'],
        privates: [
          { p1: 'secretA', p2: 'secretB' },
          { p1: 'r2-secretA', p2: 'r2-secretB' },
        ],
      },
    });

  /** Capture every frame each channel carries: p1's private channel, p2's, and the broadcast. */
  function taps() {
    const p1: ServerMessage[] = [];
    const p2: ServerMessage[] = [];
    const broadcast: ServerMessage[] = [];
    return {
      p1,
      p2,
      broadcast,
      subscribe: async () => {
        await h.pubsub.subscribe(privateChannel('r1', STUB_GAME_ID, 'p1'), (f) => p1.push(f));
        await h.pubsub.subscribe(privateChannel('r1', STUB_GAME_ID, 'p2'), (f) => p2.push(f));
        await h.pubsub.subscribe(streamChannel('r1', STUB_GAME_ID), (f) => broadcast.push(f));
      },
    };
  }

  it('delivers each secret only to its own player and never onto the broadcast channel', async () => {
    await h.engine.start(secretHandoff());
    // Both devices connect (the round-1 secret was stored at start, before anyone subscribed).
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');

    const tap = taps();
    await tap.subscribe();

    // Advance to round 2 so startRound re-deals its private map with both devices connected.
    await playRoundNoDispute(h.engine, 'r1'); // round 1 -> leaderboard
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> round 2 (deals r2 secrets)

    const p1Privates = tap.p1.filter((f) => f.type === 'private');
    const p2Privates = tap.p2.filter((f) => f.type === 'private');
    // A gets ITS secret, B gets ITS secret - dealt for round 2, the round both taps were live for.
    expect(p1Privates).toHaveLength(1);
    expect(p1Privates[0]).toMatchObject({ player: 'p1', private: 'r2-secretA', round: 2 });
    expect(p2Privates).toHaveLength(1);
    expect(p2Privates[0]).toMatchObject({ player: 'p2', private: 'r2-secretB', round: 2 });
    // ...and for that SAME round, A's channel carried A's secret yet NEVER B's, and vice versa - the
    // load-bearing secrecy guarantee proven against the cross-secret that was live at the same time
    // (not merely a later round the other channel never carried).
    expect(JSON.stringify(tap.p1)).toContain('r2-secretA');
    expect(JSON.stringify(tap.p1)).not.toContain('r2-secretB');
    expect(JSON.stringify(tap.p2)).toContain('r2-secretB');
    expect(JSON.stringify(tap.p2)).not.toContain('r2-secretA');
    // Nothing private ever lands on the broadcast channel every device reads.
    expect(tap.broadcast.some((f) => f.type === 'private')).toBe(false);
    expect(JSON.stringify(tap.broadcast)).not.toContain('secretA');
    expect(JSON.stringify(tap.broadcast)).not.toContain('secretB');
  });

  it('never hands a VIEWER any private payload in its catch-up (spec 0050 + 0064)', async () => {
    // A viewer joins a session that has a live per-player secret. Its catch-up must carry the
    // broadcast (prompt + state) but NOT a single `private` frame - a shared-screen watcher only
    // ever sees the broadcast, so a hidden-info game's secret never reaches the viewer.
    await h.engine.start(secretHandoff());
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'viewer-1', 'Olive');
    expect(frames.some((f) => f.type === 'private')).toBe(false);
    expect(JSON.stringify(frames)).not.toContain('secretA');
    expect(JSON.stringify(frames)).not.toContain('secretB');
    // It still got the broadcast catch-up so it can render the game.
    expect(frames.find((f) => f.type === 'prompt')).toBeDefined();
    expect(frames.at(-1)?.type).toBe('state');
  });

  it('restores a re-joining player its current secret via catch-up, never another player s', async () => {
    await h.engine.start(secretHandoff());
    // p1 joins mid-round-1: catch-up must hand back its OWN round-1 secret.
    const frames = await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    const priv = frames.filter((f) => f.type === 'private');
    expect(priv).toHaveLength(1);
    expect(priv[0]).toMatchObject({ player: 'p1', private: 'secretA', round: 1 });
    // p2's secret is never in p1's catch-up.
    expect(JSON.stringify(frames)).not.toContain('secretB');

    // A reconnect (disconnect then rejoin) re-hydrates the same secret.
    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1');
    const again = await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    expect(again.filter((f) => f.type === 'private')).toMatchObject([
      { player: 'p1', private: 'secretA' },
    ]);
  });

  it('clears the prior round s secrets when a new round starts, dropping a key not re-dealt', async () => {
    // Round 2 deliberately deals a DIFFERENT key set (only p1) so the assertion distinguishes a real
    // reset from a merge: if the engine merged over round 1's map, p2's stale 'secretB' would survive.
    await h.engine.start(
      handoff({
        config: {
          rounds: 2,
          secrets: ['blue', 'green'],
          privates: [{ p1: 'secretA', p2: 'secretB' }, { p1: 'r2-secretA' }],
        },
      }),
    );
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.privatePayloads).toEqual({
      p1: 'secretA',
      p2: 'secretB',
    });
    // Advancing into round 2 replaces round 1's map - the dropped p2 key is gone, not merged over.
    await playRoundNoDispute(h.engine, 'r1');
    await h.engine.control('r1', STUB_GAME_ID, 'advance');
    const payloads = (await h.engine.getState('r1', STUB_GAME_ID))?.privatePayloads;
    expect(payloads).toEqual({ p1: 'r2-secretA' });
    expect(payloads).not.toHaveProperty('p2');
  });

  it('suppresses a fresh deal to a player that joined then disconnected, yet persists it for catch-up', async () => {
    await h.engine.start(secretHandoff());
    // p1 joins (getting round 1's secret) and then disconnects - so it has a live-then-dead history,
    // the exact branch the `target.connected` guard protects (not the never-connected case).
    await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', STUB_GAME_ID, 'p2', 'Bo');
    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1');

    // Subscribe AFTER the disconnect, then advance to round 2 so a NEW private is dealt to p1.
    const tap = taps();
    await tap.subscribe();
    await playRoundNoDispute(h.engine, 'r1');
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // -> round 2 deals r2 secrets

    // No round-2 private frame reached the disconnected p1's channel (delivery is suppressed)...
    expect(tap.p1.filter((f) => f.type === 'private')).toHaveLength(0);
    // ...but the updated secret WAS persisted, so a later re-join's catch-up recovers the fresh one.
    expect((await h.engine.getState('r1', STUB_GAME_ID))?.privatePayloads?.p1).toBe('r2-secretA');
    const again = await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    expect(again.filter((f) => f.type === 'private')).toMatchObject([
      { player: 'p1', private: 'r2-secretA', round: 2 },
    ]);
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
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
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
      runtimeProvider: new InProcessRuntimeProvider([stubGame]),
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
      runtimeProvider: new InProcessRuntimeProvider([deciderGame]),
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
    await engine.submitMove('r1', DECIDER_GAME_ID, 'p1', 1, 'red');
    await engine.submitMove('r1', DECIDER_GAME_ID, 'p2', 1, 'green');
    await engine.submitMove('r1', DECIDER_GAME_ID, 'p3', 1, 'yellow');
  }

  it('enters guessing after reveal and scores on resolve (all-decided early close)', async () => {
    const h = deciderHarness();
    await startJoinSubmit(h.engine);
    await h.engine.control('r1', DECIDER_GAME_ID, 'advance'); // collecting -> guessing
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('guessing');

    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p1', 1, 'blue', true); // correct guess
    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p2', 1, 'red', true); // fools p1
    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p3', 1, 'green', true); // fools p2

    // Fire ONLY the 2s all-decided grace timer, not the 30s guess window: this proves the early
    // close (not the window) advanced the round. Were armAutoAdvance('guessing') dead code, a 2s
    // advance would fire nothing and the phase would stay 'guessing'.
    h.scheduler.advance(AUTO_ADVANCE_MS);

    const state = await h.engine.getState('r1', DECIDER_GAME_ID);
    expect(state?.phase).toBe('leaderboard');
    expect(state?.scores).toEqual({ p1: 150, p2: 50, p3: 0 });
    // The round closed on the 2s grace timer; advancing out of `guessing` cancels the still-pending
    // 30s guess window (spec 0068: a superseding arm cancels the prior window timer), so nothing lingers.
    expect(h.scheduler.pending).toBe(0);
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

    // Watch the broadcast channel: the reject must reach only the submitter, never the room.
    const seen: ServerMessage[] = [];
    await h.pubsub.subscribe(streamChannel('r1', DECIDER_GAME_ID), (f) =>
      seen.push(f as ServerMessage),
    );

    const ok = await h.engine.submitMove('r1', DECIDER_GAME_ID, 'p1', 1, 'red');
    expect(ok.reject).toBeUndefined();
    const before = JSON.stringify((await h.engine.getState('r1', DECIDER_GAME_ID))?.scratch);

    const dup = await h.engine.submitMove('r1', DECIDER_GAME_ID, 'p2', 1, 'RED'); // duplicate
    expect(dup.reject?.type).toBe('move_rejected');
    expect(dup.reject?.reason).toBe('taken');
    expect(dup.reject?.round).toBe(1);
    // No scratch was written: p2's fake never landed, the round is exactly as it was.
    const after = JSON.stringify((await h.engine.getState('r1', DECIDER_GAME_ID))?.scratch);
    expect(after).toBe(before);
    // The reject was a targeted reply, not a broadcast: no frame (least of all move_rejected)
    // reached the room stream, so other devices never learn a fake was rejected.
    expect(seen).toHaveLength(0);
  });

  it('re-arms the guess window after a host disconnect and reconnect', async () => {
    const h = deciderHarness();
    const players = [
      { player: 'p1', nickname: 'Ada', isHost: true },
      { player: 'p2', nickname: 'Bo' },
      { player: 'p3', nickname: 'Cy' },
    ];
    await h.engine.start(deciderHandoff({ players }));
    for (const p of players) await h.engine.join('r1', DECIDER_GAME_ID, p.player, p.nickname);
    await h.engine.submitMove('r1', DECIDER_GAME_ID, 'p1', 1, 'red');
    await h.engine.submitMove('r1', DECIDER_GAME_ID, 'p2', 1, 'green');
    await h.engine.submitMove('r1', DECIDER_GAME_ID, 'p3', 1, 'yellow');
    await h.engine.control('r1', DECIDER_GAME_ID, 'advance'); // -> guessing
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('guessing');

    await h.engine.disconnect('r1', DECIDER_GAME_ID, 'p1'); // host drops -> auto-pause
    h.scheduler.flush(); // the guess window no-ops while paused
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('guessing');

    await h.engine.join('r1', DECIDER_GAME_ID, 'p1', 'Ada'); // host returns -> resume + re-arm
    h.scheduler.flush(); // the re-armed window fires
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('re-arms the all-decided close when a paused, fully-guessed round resumes', async () => {
    const h = deciderHarness();
    await startJoinSubmit(h.engine);
    await h.engine.control('r1', DECIDER_GAME_ID, 'advance'); // -> guessing
    // Everyone guesses (arming the 2s grace close), then the host pauses (cancelling it).
    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p1', 1, 'blue', true);
    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p2', 1, 'red', true);
    await h.engine.submitVote('r1', DECIDER_GAME_ID, 'p3', 1, 'green', true);
    await h.engine.control('r1', DECIDER_GAME_ID, 'pause');
    h.scheduler.flush(); // timers no-op while paused
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('guessing');

    await h.engine.control('r1', DECIDER_GAME_ID, 'pause'); // resume must re-arm the all-decided close
    h.scheduler.advance(AUTO_ADVANCE_MS); // fire only the re-armed 2s grace, not the 30s window
    expect((await h.engine.getState('r1', DECIDER_GAME_ID))?.phase).toBe('leaderboard');
  });

  it('fails fast if a game opens a guess phase but implements no resolveDecision', async () => {
    // A misconfigured game: reveal declares a decision but there is no resolveDecision to score it.
    const scratch = (ctx: { scratch: Readonly<Record<string, unknown>> }) => ({
      scratch: ctx.scratch as Record<string, unknown>,
    });
    const badGame: GameModule = {
      id: 'bad-decider',
      configure: () => ({ scratch: {}, rounds: 1 }),
      startRound: () => ({ scratch: {}, prompt: {} }),
      collectMove: (ctx) => scratch(ctx),
      reveal: (ctx) => ({ ...scratch(ctx), reveal: {}, scores: [], decision: { windowMs: 1000 } }),
      collectVote: (ctx) => scratch(ctx),
      disputeWindow: (ctx) => ({ ...scratch(ctx), disputes: [] }),
      disputeVote: (ctx) => ({ ...scratch(ctx), scores: [] }),
      leaderboard: () => [],
      advance: () => ({ done: true }),
      endGame: () => [],
      // no resolveDecision on purpose
    };
    const engine = new GameEngine({
      runtimeProvider: new InProcessRuntimeProvider([badGame]),
      store: new InMemorySessionStore(),
      pubsub: new InMemoryPubSub(),
      reporter: new CapturingReporter(),
      scheduler: new ManualScheduler(),
      logger: { error: () => {} },
    });
    await engine.start({
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: 'bad-decider',
      players: [{ player: 'p1', nickname: 'Ada' }],
      config: {},
    });
    // collecting -> reveal must throw a clear error rather than wedge the round in 'guessing'.
    await expect(engine.control('r1', 'bad-decider', 'advance')).rejects.toThrow(
      /no resolveDecision/,
    );
    expect((await engine.getState('r1', 'bad-decider'))?.phase).toBe('collecting');
  });
});

// A live game (spec 0044): the engine runs a per-session sim loop calling `tick`, streams the
// returned `sim`, ends the game when `tick` reports `over`, and does NOT drive reveal/leaderboard.
const LIVE_GAME_ID = 'live-stub';

/** Number of ticks the fake live game runs before it reports `over`. */
const LIVE_TICKS_TO_END = 3;

/**
 * A minimal live module modeling the in-process-world lifecycle (spec 0044). It holds a per-session
 * `worlds` Map keyed by room (the Matter-world analogue): `tick` gets-or-creates the world and
 * streams the in-process piece count; `collectMove` "drops" a piece into it. `disposeLive` deletes
 * the world and records the disposal, so a test can assert the engine calls it on
 * endGame/exit/restart and that a restart rebuilds from empty scratch (a fresh, empty world).
 *
 * The world's piece count seeds from scratch when first (re)built, so a rebuild-from-snapshot
 * resumes the tower - and a restart that did NOT dispose would reuse the stale world (old count).
 */
function liveStubGame(): {
  module: GameModule;
  worlds: Map<string, { pieces: number }>;
  disposed: string[];
} {
  const t = (ctx: { scratch: Readonly<Record<string, unknown>> }): number =>
    (ctx.scratch.t as number | undefined) ?? 0;
  const worlds = new Map<string, { pieces: number }>();
  const disposed: string[] = [];
  const worldFor = (ctx: {
    room: string;
    scratch: Readonly<Record<string, unknown>>;
  }): {
    pieces: number;
  } => {
    let world = worlds.get(ctx.room);
    if (!world) {
      // Rebuild from the scratch snapshot (or empty on a fresh session/restart).
      world = { pieces: (ctx.scratch.pieces as number | undefined) ?? 0 };
      worlds.set(ctx.room, world);
    }
    return world;
  };
  const module: GameModule = {
    id: LIVE_GAME_ID,
    configure: () => ({ scratch: { t: 0, pieces: 0 }, rounds: 1, moveWindowMs: 0 }),
    startRound: (ctx) => {
      const world = worldFor(ctx);
      return { scratch: { ...ctx.scratch, pieces: world.pieces }, prompt: { t: t(ctx) } };
    },
    collectMove: (ctx) => {
      const world = worldFor(ctx);
      world.pieces += 1;
      return { scratch: { ...ctx.scratch, pieces: world.pieces } };
    },
    reveal: (ctx) => ({
      scratch: ctx.scratch as Record<string, unknown>,
      reveal: null,
      scores: [],
    }),
    collectVote: (ctx) => ({ scratch: ctx.scratch as Record<string, unknown> }),
    disputeWindow: (ctx) => ({ scratch: ctx.scratch as Record<string, unknown>, disputes: [] }),
    disputeVote: (ctx) => ({ scratch: ctx.scratch as Record<string, unknown>, scores: [] }),
    leaderboard: () => [],
    advance: () => ({ done: true }),
    endGame: (ctx) => [{ player: 'p1', nickname: 'Ada', score: t(ctx) * 10, rank: 1 }],
    tick: (ctx) => {
      const world = worldFor(ctx);
      const next = t(ctx) + 1;
      return {
        scratch: { ...ctx.scratch, t: next, pieces: world.pieces },
        sim: { t: next, pieces: world.pieces },
        over: next >= LIVE_TICKS_TO_END,
      };
    },
    disposeLive: (ctx) => {
      worlds.delete(ctx.room);
      disposed.push(ctx.room);
    },
  };
  return { module, worlds, disposed };
}

describe('GameEngine live game (sim loop)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function liveHarness() {
    const store = new InMemorySessionStore();
    const pubsub = new InMemoryPubSub();
    const reporter = new CapturingReporter();
    const scheduler = new ManualScheduler();
    const stub = liveStubGame();
    const engine = new GameEngine({
      runtimeProvider: new InProcessRuntimeProvider([stub.module]),
      store,
      pubsub,
      reporter,
      scheduler,
      logger: { error: () => {} },
    });
    return {
      engine,
      store,
      pubsub,
      reporter,
      scheduler,
      worlds: stub.worlds,
      disposed: stub.disposed,
    };
  }

  function liveHandoff(): StartHandoffRequest {
    return {
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: LIVE_GAME_ID,
      players: [{ player: 'p1', nickname: 'Ada' }],
      config: {},
    };
  }

  it('runs the sim loop on a timer, streaming sim frames and ending on tick.over', async () => {
    const h = liveHarness();
    const sims: unknown[] = [];
    // Subscribe to capture every streamed frame; collect the sim payloads.
    await h.pubsub.subscribe(streamChannel('r1', LIVE_GAME_ID), (frame) => {
      if (frame.type === 'sim') sims.push((frame as { sim: unknown }).sim);
    });

    await h.engine.start(liveHandoff());
    // Connect a device: the sim loop only streams/saves while at least one player is connected (the
    // idle guard, spec 0044) - with no devices there is nobody to stream to and no move can land.
    await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');
    // The game sits in the live `collecting` phase (no reveal/leaderboard); no sim yet (loop armed).
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.phase).toBe('collecting');

    // Advance one tick: the loop fires, steps the world, and streams one sim frame.
    await vi.advanceTimersByTimeAsync(40);
    expect(sims).toEqual([{ t: 1, pieces: 0 }]);

    // Two more ticks reach LIVE_TICKS_TO_END: tick reports over -> the engine ends the game.
    await vi.advanceTimersByTimeAsync(80);
    expect(sims).toEqual([
      { t: 1, pieces: 0 },
      { t: 2, pieces: 0 },
      { t: 3, pieces: 0 },
    ]);
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.phase).toBe('complete');

    // The final standings came from endGame (score = t*10), and the completion was reported once.
    expect(h.reporter.completes).toHaveLength(1);
    expect(h.reporter.completes[0]?.standings[0]?.score).toBe(30);

    // No sim frames stream after the game ended (the loop stopped).
    await vi.advanceTimersByTimeAsync(200);
    expect(sims).toEqual([
      { t: 1, pieces: 0 },
      { t: 2, pieces: 0 },
      { t: 3, pieces: 0 },
    ]);

    // A live game never runs the turn cycle: no round report was ever produced.
    expect(h.reporter.rounds).toHaveLength(0);
  });

  it('freezes the world on pause and resumes it, and a joiner catches up to the last sim', async () => {
    const h = liveHarness();
    await h.engine.start(liveHandoff());
    // Connect the device so the sim loop actually steps + persists (the idle guard, spec 0044).
    await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');

    // One tick, then pause: the loop stops, so time passing streams no further sims.
    await vi.advanceTimersByTimeAsync(40);
    await h.engine.control('r1', LIVE_GAME_ID, 'pause');
    expect((await h.engine.getSnapshot('r1', LIVE_GAME_ID))?.paused).toBe(true);

    // A joiner mid-pause gets the last streamed sim in its catch-up frames.
    const frames = await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');
    const sim = frames.find((f) => f.type === 'sim') as { sim: unknown } | undefined;
    expect(sim?.sim).toEqual({ t: 1, pieces: 0 });

    // Time passes while paused: the world does not step (t stays 1 in scratch).
    await vi.advanceTimersByTimeAsync(400);
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.scratch.t).toBe(1);

    // Resume: the loop restarts and the world steps again, ending the game.
    await h.engine.control('r1', LIVE_GAME_ID, 'pause');
    await vi.advanceTimersByTimeAsync(80);
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.phase).toBe('complete');
  });

  it('a host advance ends a live game rather than pushing it into reveal', async () => {
    const h = liveHarness();
    await h.engine.start(liveHandoff());
    await h.engine.control('r1', LIVE_GAME_ID, 'advance');
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.phase).toBe('complete');
    // No reveal frame was streamed and no round was reported.
    expect(h.reporter.rounds).toHaveLength(0);
    expect(h.reporter.completes).toHaveLength(1);
  });

  it('disposes the in-process world on endGame (tick.over), so it does not leak', async () => {
    const h = liveHarness();
    await h.engine.start(liveHandoff());
    await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');
    // The world is built once the loop ticks; run to over (endGame).
    await vi.advanceTimersByTimeAsync(40 * LIVE_TICKS_TO_END);
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.phase).toBe('complete');
    // disposeLive fired for this session, and the in-process world was dropped (no leak).
    expect(h.disposed).toContain('r1');
    expect(h.worlds.has('r1')).toBe(false);
  });

  it('disposes the in-process world on host exit', async () => {
    const h = liveHarness();
    await h.engine.start(liveHandoff());
    await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');
    await vi.advanceTimersByTimeAsync(40); // build the world
    expect(h.worlds.has('r1')).toBe(true);
    await h.engine.control('r1', LIVE_GAME_ID, 'exit');
    expect(h.disposed).toContain('r1');
    expect(h.worlds.has('r1')).toBe(false);
    // Exit drops the session entirely.
    expect(await h.engine.getState('r1', LIVE_GAME_ID)).toBeNull();
  });

  it('restart disposes the stale world and rebuilds a fresh, empty tower', async () => {
    const h = liveHarness();
    await h.engine.start(liveHandoff());
    await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');
    // Drop two pieces into the live world, then let it tick so the count persists to scratch.
    await h.engine.submitMove('r1', LIVE_GAME_ID, 'p1', 1, 'drop');
    await h.engine.submitMove('r1', LIVE_GAME_ID, 'p1', 1, 'drop');
    await vi.advanceTimersByTimeAsync(40);
    expect(h.worlds.get('r1')?.pieces).toBe(2);

    // Restart: the old world (2 pieces) must be disposed BEFORE the fresh configure/startRound, so the
    // rebuilt world starts empty from fresh scratch - not the stale 2-piece tower.
    await h.engine.control('r1', LIVE_GAME_ID, 'restart');
    expect(h.disposed).toContain('r1');
    // The fresh session's world (rebuilt by startRound) has zero pieces, and scratch reset too.
    expect(h.worlds.get('r1')?.pieces).toBe(0);
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.scratch.pieces).toBe(0);
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.phase).toBe('collecting');
  });

  // Under worker isolation (spec 0045) a live tick runs in a worker that can crash or be killed for
  // hanging, surfacing as a rejected `tick`. The sim loop must swallow it (not end/error the game) and
  // recover on a later tick, and must not respawn forever if the worker is persistently wedged. A tick
  // that throws in the in-process module rejects the runtime's `tick`, standing in for that failure.

  /** A live game whose `tick` throws its first `failCount` calls, then behaves normally. */
  function flakyLiveHarness(failCount: number) {
    const store = new InMemorySessionStore();
    const pubsub = new InMemoryPubSub();
    const reporter = new CapturingReporter();
    const scheduler = new ManualScheduler();
    const base = liveStubGame().module;
    let ticks = 0;
    const module: GameModule = {
      ...base,
      tick: (ctx) => {
        ticks += 1;
        if (ticks <= failCount) throw new Error('worker tick crashed');
        return base.tick!(ctx);
      },
    };
    const engine = new GameEngine({
      runtimeProvider: new InProcessRuntimeProvider([module]),
      store,
      pubsub,
      reporter,
      scheduler,
      logger: { error: () => {} },
    });
    return { engine, pubsub, ticksSoFar: () => ticks };
  }

  it('survives a few rejecting ticks and recovers streaming on a later tick', async () => {
    const h = flakyLiveHarness(2); // two crashes, then healthy - under the stop threshold
    const sims: unknown[] = [];
    await h.pubsub.subscribe(streamChannel('r1', LIVE_GAME_ID), (frame) => {
      if (frame.type === 'sim') sims.push((frame as { sim: unknown }).sim);
    });
    await h.engine.start(liveHandoff());
    await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');

    // The first two ticks reject: nothing streams, but the game stays live (not ended, no throw leaks).
    await vi.advanceTimersByTimeAsync(80);
    expect(sims).toEqual([]);
    expect((await h.engine.getState('r1', LIVE_GAME_ID))?.phase).toBe('collecting');

    // The next tick succeeds - the loop recovered and streams again.
    await vi.advanceTimersByTimeAsync(40);
    expect(sims.length).toBeGreaterThan(0);
    expect(h.ticksSoFar()).toBeGreaterThanOrEqual(3);
  });

  it('stops the sim loop after too many consecutive tick failures (no respawn thrash)', async () => {
    const h = flakyLiveHarness(Number.MAX_SAFE_INTEGER); // never recovers
    await h.engine.start(liveHandoff());
    await h.engine.join('r1', LIVE_GAME_ID, 'p1', 'Ada');

    // Let far more than the failure budget of intervals elapse. The loop stops after the cap, so the
    // tick count is exactly MAX_SIM_TICK_FAILURES - not attempted forever every 40ms.
    await vi.advanceTimersByTimeAsync(40 * (MAX_SIM_TICK_FAILURES + 10));
    expect(h.ticksSoFar()).toBe(MAX_SIM_TICK_FAILURES);
  });
});

// A round game with Trivia-shaped pacing (spec 0069): timed answers, an auto-advance dwell for the
// reveal + leaderboard (a positive `leaderboardWindowMs`, from which the engine reports
// `autoAdvance: true`), and a live answered count. Built by wrapping the stub so only the new seam
// (answeredCount) is exercised here.
const PACED_GAME_ID = 'paced';
const pacedGame: GameModule = {
  ...stubGame,
  id: PACED_GAME_ID,
  answeredCount: (ctx) => {
    const submitted =
      (ctx.scratch as { submitted?: Record<string, Record<string, string>> }).submitted ?? {};
    const round = submitted[String(ctx.round)] ?? {};
    return ctx.players.filter((p) => p.connected && round[p.player] !== undefined).length;
  },
};

describe('GameEngine spec 0069 pacing on the state frame', () => {
  function pacedHarness(): Harness {
    const store = new InMemorySessionStore();
    const pubsub = new InMemoryPubSub();
    const reporter = new CapturingReporter();
    const scheduler = new ManualScheduler();
    const clock = new ManualClock();
    const engine = new GameEngine({
      runtimeProvider: new InProcessRuntimeProvider([pacedGame]),
      store,
      pubsub,
      reporter,
      scheduler,
      clock: clock.now,
      logger: { error: () => {} },
    });
    return { engine, store, pubsub, reporter, scheduler, clock };
  }

  const pacedHandoff = (): StartHandoffRequest => ({
    v: PROTOCOL_VERSION,
    room: 'r1',
    game: PACED_GAME_ID,
    players: [
      { player: 'p1', nickname: 'Ada' },
      { player: 'p2', nickname: 'Bo' },
    ],
    // A 60s answer window and a 5s auto-advance dwell for both the reveal and the leaderboard.
    config: {
      rounds: 2,
      secrets: ['blue', 'green'],
      moveWindowMs: 60_000,
      disputeWindowMs: 5_000,
      leaderboardWindowMs: 5_000,
    },
  });

  /** The last `state` frame seen on the room stream, or undefined if none. */
  function lastState(frames: ServerMessage[]): StateMessage | undefined {
    const states = frames.filter((f): f is StateMessage => f.type === 'state');
    return states[states.length - 1];
  }

  it('projects the total move window, auto-advance, and answered while collecting', async () => {
    const h = pacedHarness();
    await h.engine.start(pacedHandoff());
    const joined = stateFrame(await h.engine.join('r1', PACED_GAME_ID, 'p1', 'Ada'));
    expect(joined.phase).toBe('collecting');
    expect(joined.moveWindowMs).toBe(60_000);
    expect(joined.autoAdvance).toBe(true);
    expect(joined.answered).toBe(0);
  });

  it('drops the answered count once the round leaves collecting (gated on phase)', async () => {
    const h = pacedHarness();
    await h.engine.start(pacedHandoff());
    await h.engine.control('r1', PACED_GAME_ID, 'advance'); // collecting -> disputing (reveal)
    const revealSnap = stateFrame(await h.engine.join('r1', PACED_GAME_ID, 'p1', 'Ada'));
    expect(revealSnap.phase).toBe('disputing');
    expect(revealSnap.answered).toBeUndefined();
    // The total window is constant across the game, so it is still present off the collecting phase.
    expect(revealSnap.moveWindowMs).toBe(60_000);
  });

  it('arms the dwell BEFORE the entering frame so reveal + leaderboard carry a live countdown', async () => {
    const h = pacedHarness();
    const frames: ServerMessage[] = [];
    await h.pubsub.subscribe(streamChannel('r1', PACED_GAME_ID), (f) => frames.push(f));
    await h.engine.start(pacedHandoff());

    // Entering the reveal (disputing): the dwell deadline was armed before the frame was published,
    // so the countdown is the full 5s, not a stale ~0 (this guards the arm-before-publish reorder).
    await h.engine.control('r1', PACED_GAME_ID, 'advance');
    const reveal = lastState(frames);
    expect(reveal?.phase).toBe('disputing');
    expect(reveal?.autoAdvanceMsRemaining).toBe(5_000);

    // Entering the leaderboard (no disputes): same guarantee for the "next round in x" dwell.
    await h.engine.control('r1', PACED_GAME_ID, 'advance');
    const leaderboard = lastState(frames);
    expect(leaderboard?.phase).toBe('leaderboard');
    expect(leaderboard?.autoAdvanceMsRemaining).toBe(5_000);
  });

  it('re-broadcasts state with a growing answered count on each accepted submit', async () => {
    const h = pacedHarness();
    await h.engine.start(pacedHandoff());
    // Both players must be connected for the answered count to include them (it mirrors the
    // connected-only rule of allSubmitted). Subscribe after joining so `frames` holds only the
    // per-submit broadcasts.
    await h.engine.join('r1', PACED_GAME_ID, 'p1', 'Ada');
    await h.engine.join('r1', PACED_GAME_ID, 'p2', 'Bo');
    const frames: ServerMessage[] = [];
    await h.pubsub.subscribe(streamChannel('r1', PACED_GAME_ID), (f) => frames.push(f));

    await h.engine.submitMove('r1', PACED_GAME_ID, 'p1', 1, 'blue');
    expect(lastState(frames)?.answered).toBe(1);
    await h.engine.submitMove('r1', PACED_GAME_ID, 'p2', 1, 'nope');
    expect(lastState(frames)?.answered).toBe(2);
  });

  it('does NOT re-broadcast on submit for a game that reports no answered count (the stub)', async () => {
    const h = harness(); // the plain stub: no answeredCount
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    const states: ServerMessage[] = [];
    await h.pubsub.subscribe(streamChannel('r1', STUB_GAME_ID), (f) => {
      if (f.type === 'state') states.push(f);
    });
    await h.engine.submitMove('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    // The stub omits answeredCount, so an accepted submit stays quiet - no per-move state broadcast.
    expect(states).toHaveLength(0);
  });
});
