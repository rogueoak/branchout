// Teeter Tower engine tests (spec 0043). These prove the four properties an authoritative physics
// sim lives or dies by: determinism (same seed + same moves -> identical tower + score), scoring +
// height correctness, move rejection (non-active player; an illegal placement), and a level
// transition (reaching the target advances the level and resets the tower). No wall-clock, no
// Math.random: every run is seeded through a stub services.rng.

import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { createTeeterTowerGame, DISPUTE_WINDOW_MS } from './teeter-tower';
import { GROUND_TOP, LEVELS, TOTAL_ROUNDS } from './levels';
import type { TeeterMove, TeeterPrompt, TeeterReveal } from './types';

/** A fixed rng so `configure` derives a stable base seed. Returns a constant per game. */
function stubRng(value: number): () => number {
  return () => value;
}

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: id, connected: true }));
}

function ctx(overrides: Partial<RoundContext>): RoundContext {
  return {
    room: 'r',
    game: 'teeter-tower',
    phase: 'collecting',
    round: 0,
    players: players('p1'),
    scores: {},
    scratch: {},
    config: {},
    ...overrides,
  };
}

/**
 * Run one full round (startRound -> collectMove -> reveal) for a solo player, threading scratch.
 * Returns the reveal and the resulting scratch. Throws if the move is rejected.
 */
function playRound(
  game: ReturnType<typeof createTeeterTowerGame>,
  scratch: Record<string, unknown>,
  round: number,
  move: TeeterMove,
  roster: SessionPlayer[] = players('p1'),
  scores: Record<string, number> = {},
): { reveal: TeeterReveal; prompt: TeeterPrompt; scratch: Record<string, unknown> } {
  const base = ctx({ round, scratch, players: roster, scores });
  const started = game.startRound(base);
  const afterStart = { ...base, scratch: started.scratch };
  const active = (started.prompt as TeeterPrompt).activePlayer;
  const collected = game.collectMove(afterStart, active, JSON.stringify(move));
  if (collected.rejected) throw new Error(`move rejected: ${collected.rejected.reason}`);
  const afterCollect = { ...afterStart, scratch: collected.scratch };
  expect(game.allSubmitted?.(afterCollect)).toBe(true);
  const revealed = game.reveal(afterCollect);
  return {
    reveal: revealed.reveal as TeeterReveal,
    prompt: started.prompt as TeeterPrompt,
    scratch: revealed.scratch,
  };
}

describe('configure', () => {
  it('returns the total piece count as rounds, a small dispute window, and no move timer', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const result = game.configure({}, players('p1'));
    expect(result.rounds).toBe(TOTAL_ROUNDS);
    expect(result.rounds).toBe(53); // 11 + 20 + 22
    expect(result.disputeWindowMs).toBe(DISPUTE_WINDOW_MS);
    expect(result.moveWindowMs).toBe(0);
  });

  it('accepts an empty/object config and rejects a non-object config', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    expect(() => game.configure(undefined, players('p1'))).not.toThrow();
    expect(() => game.configure({}, players('p1'))).not.toThrow();
    expect(() => game.configure(42, players('p1'))).toThrow();
  });
});

describe('determinism', () => {
  it('same seed + same moves -> identical final tower transforms and score', () => {
    const moves: TeeterMove[] = [
      { angle: 0, dropX: 410 },
      { angle: 0.1, dropX: 400 },
      { angle: -0.1, dropX: 420 },
      { angle: 0, dropX: 405 },
    ];

    const run = (): { tower: TeeterReveal['tower']; score: number; height: number } => {
      const game = createTeeterTowerGame(stubRng(0.123456));
      let scratch = game.configure({}, players('p1')).scratch;
      let last: TeeterReveal | null = null;
      for (let r = 0; r < moves.length; r++) {
        const played = playRound(game, scratch, r, moves[r]!);
        scratch = played.scratch;
        last = played.reveal;
      }
      return { tower: last!.tower, score: last!.score, height: last!.height };
    };

    const a = run();
    const b = run();
    expect(a.score).toBe(b.score);
    expect(a.height).toBe(b.height);
    expect(a.tower).toEqual(b.tower);
    // The settle actually produced a multi-body tower (the sim ran, not a no-op).
    expect(a.tower.length).toBeGreaterThan(1);
  });

  it('produces the same piece geometry for a given round across runs', () => {
    const gameA = createTeeterTowerGame(stubRng(0.777));
    const gameB = createTeeterTowerGame(stubRng(0.777));
    const scratchA = gameA.configure({}, players('p1')).scratch;
    const scratchB = gameB.configure({}, players('p1')).scratch;
    const pa = gameA.startRound(ctx({ round: 3, scratch: scratchA })).prompt as TeeterPrompt;
    const pb = gameB.startRound(ctx({ round: 3, scratch: scratchB })).prompt as TeeterPrompt;
    expect(pa.piece).toEqual(pb.piece);
  });
});

describe('scoring and height', () => {
  it('reveal reports a settled tower height and a banded score, and awards the score delta', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;

    const base = ctx({ round: 0, scratch });
    const started = game.startRound(base);
    const active = (started.prompt as TeeterPrompt).activePlayer;
    const collected = game.collectMove(
      { ...base, scratch: started.scratch },
      active,
      JSON.stringify({ angle: 0, dropX: 410 }),
    );
    expect(collected.rejected).toBeUndefined();
    const revealed = game.reveal({ ...base, scratch: collected.scratch });
    const reveal = revealed.reveal as TeeterReveal;

    expect(reveal.height).toBeGreaterThan(0);
    expect([0, 25, 50, 75, 100]).toContain(reveal.score);
    expect(reveal.level).toBe(0);
    expect(reveal.target).toBe(LEVELS[0]!.target);
    expect(reveal.track.length).toBeGreaterThan(1);
    // The awarded points equal the score (from 0), attributed to the active player.
    const total = revealed.scores.reduce((s, e) => s + e.points, 0);
    expect(total).toBe(reveal.score);
    for (const e of revealed.scores) expect(e.player).toBe(active);
  });

  it('the settle track is a monotonic time series with a t=0 opening frame', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const { reveal } = playRound(game, scratch, 0, { angle: 0, dropX: 410 });
    expect(reveal.track[0]!.t).toBe(0);
    for (let i = 1; i < reveal.track.length; i++) {
      expect(reveal.track[i]!.t).toBeGreaterThanOrEqual(reveal.track[i - 1]!.t);
    }
    // Every frame carries the dropped body's transform.
    expect(reveal.track.at(-1)!.bodies.length).toBeGreaterThan(0);
  });
});

describe('move rejection', () => {
  it('rejects a move from a player who is not the active player', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1', 'p2')).scratch;
    const roster = players('p1', 'p2');
    // round 0 -> active = index 0 = p1; p2 must be rejected.
    const base = ctx({ round: 0, scratch, players: roster });
    const started = game.startRound(base);
    const active = (started.prompt as TeeterPrompt).activePlayer;
    expect(active).toBe('p1');
    const bad = game.collectMove(
      { ...base, scratch: started.scratch },
      'p2',
      JSON.stringify({ angle: 0, dropX: 410 }),
    );
    expect(bad.rejected).toBeDefined();
    expect(bad.rejected?.reason).toMatch(/turn/i);
  });

  it('rejects a malformed move', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ round: 0, scratch });
    const started = game.startRound(base);
    const bad = game.collectMove({ ...base, scratch: started.scratch }, 'p1', 'not json');
    expect(bad.rejected?.reason).toMatch(/malformed/i);
  });

  // The ported overlap + min-drop-line legality rules are exercised directly in physics.test.ts,
  // where a held piece can be positioned at an arbitrary (illegal) transform. Through collectMove the
  // server always picks a clearing drop height, so the reachable move-level rejections are the
  // turn-order and malformed-payload guards covered above.
});

describe('level transition', () => {
  it('reaching the level target advances the internal level and resets the tower', () => {
    // Force a cleared level by driving the tower height to the target directly through a crafted
    // scratch, then simulate a benign drop; reveal should flip cleared, bump levelIndex, reset tower.
    const game = createTeeterTowerGame(stubRng(0.5));
    // Build a real tower up to (near) the target using a tall stack of stored bodies is hard to hand-
    // author; instead we prove the transition by pre-seeding a tower whose top already sits at the
    // target, so the next settle keeps height >= target.
    const target = LEVELS[0]!.target;
    // A single tall stored block whose bounds reach the target height above the platform.
    const half = target / 2 + 20;
    const tallBlock = {
      id: 1,
      verts: [
        [
          { x: -30, y: -half },
          { x: 30, y: -half },
          { x: 30, y: half },
          { x: -30, y: half },
        ],
      ],
      x: 410,
      y: GROUND_TOP - half,
      angle: 0,
      skin: { fill: '#fff', stroke: '#000' },
      eyes: [],
    };
    const scratch: Record<string, unknown> = {
      seed: 42,
      levelIndex: 0,
      tower: [tallBlock],
      bestHeight: 0,
      nextId: 2,
      pending: null,
    };

    const base = ctx({ round: 5, scratch });
    const started = game.startRound(base);
    const active = (started.prompt as TeeterPrompt).activePlayer;
    // Drop a piece high and to the side so it does not disturb the tall block; height stays >= target.
    const collected = game.collectMove(
      { ...base, scratch: started.scratch },
      active,
      JSON.stringify({ angle: 0, dropX: 250 }),
    );
    // The placement may be legal (clear + above line) since the tall block already cleared the lines.
    expect(collected.rejected).toBeUndefined();
    const revealed = game.reveal({ ...base, scratch: collected.scratch });
    const reveal = revealed.reveal as TeeterReveal;
    const nextScratch = revealed.scratch as { levelIndex: number; tower: unknown[] };

    expect(reveal.cleared).toBe(true);
    expect(reveal.level).toBe(1); // advanced to the next level
    expect(reveal.target).toBe(LEVELS[1]!.target);
    expect(nextScratch.levelIndex).toBe(1);
    expect(nextScratch.tower).toHaveLength(0); // tower reset for the new level
  });
});

describe('advance and lifecycle', () => {
  it('advance is done only after the final round', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    expect(game.advance(ctx({ round: TOTAL_ROUNDS - 1 })).done).toBe(false);
    expect(game.advance(ctx({ round: TOTAL_ROUNDS })).done).toBe(true);
  });

  it('disputeWindow yields no disputes and disputeVote no scores', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    expect(game.disputeWindow(ctx({})).disputes).toEqual([]);
    expect(game.disputeVote(ctx({})).scores).toEqual([]);
  });

  it('leaderboard and endGame rank by score', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const roster = players('p1', 'p2');
    const standings = game.endGame(ctx({ players: roster, scores: { p1: 50, p2: 100 } }));
    expect(standings[0]!.player).toBe('p2');
    expect(standings[0]!.rank).toBe(1);
  });
});
