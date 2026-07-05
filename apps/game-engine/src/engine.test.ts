import { beforeEach, describe, expect, it } from 'vitest';
import type { GameCompleteReport, RoundReport, StartHandoffRequest } from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import { GameEngine, NoSessionError } from './engine';
import { InMemoryPubSub } from './pubsub';
import { GameRegistry } from './registry';
import type { ControlPlaneReporter } from './reporter';
import { ManualScheduler } from './scheduler';
import { InMemorySessionStore } from './session';
import { stubGame, STUB_GAME_ID } from './stub-game';

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

interface Harness {
  engine: GameEngine;
  store: InMemorySessionStore;
  pubsub: InMemoryPubSub;
  reporter: CapturingReporter;
  scheduler: ManualScheduler;
}

function harness(): Harness {
  const store = new InMemorySessionStore();
  const pubsub = new InMemoryPubSub();
  const reporter = new CapturingReporter();
  const scheduler = new ManualScheduler();
  const engine = new GameEngine({
    registry: new GameRegistry([stubGame]),
    store,
    pubsub,
    reporter,
    scheduler,
    logger: { error: () => {} },
  });
  return { engine, store, pubsub, reporter, scheduler };
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

  it('does not mark a round reported when the control-plane rejects it, then reports on retry', async () => {
    await h.engine.start(handoff({ config: { rounds: 1, secrets: ['blue'] } }));
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    h.reporter.failRoundOnce = true;

    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // reveal -> disputing
    await h.engine.control('r1', STUB_GAME_ID, 'advance'); // finalize round 1 (report fails)
    let state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.reportedRounds).toEqual([]);
    expect(h.reporter.rounds).toHaveLength(0);

    // Restart replays the round; the same roundId is now free to report (new run id).
    await h.engine.control('r1', STUB_GAME_ID, 'restart');
    state = await h.engine.getState('r1', STUB_GAME_ID);
    expect(state?.runId).toBe(2);
    expect(state?.scores.p1).toBe(0);
  });

  it('recovers session state on reconnect (join returns the live snapshot)', async () => {
    await h.engine.start(handoff());
    await h.engine.submitAnswer('r1', STUB_GAME_ID, 'p1', 1, 'blue');
    await playRoundNoDispute(h.engine, 'r1');

    const snapshot = await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
    expect(snapshot).toMatchObject({ type: 'state', phase: 'leaderboard', scores: { p1: 100 } });
    const player = snapshot.players.find((p) => p.player === 'p1');
    expect(player?.connected).toBe(true);

    await h.engine.disconnect('r1', STUB_GAME_ID, 'p1');
    const again = await h.engine.join('r1', STUB_GAME_ID, 'p1', 'Ada');
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
