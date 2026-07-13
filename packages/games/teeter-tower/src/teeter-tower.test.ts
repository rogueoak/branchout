// Teeter Tower module tests (spec 0044 - live physics). Teeter is now a LIVE game: `collectMove`
// applies a drop to the continuously-running world, `tick` steps the world and streams a TeeterSim,
// and the game ends when the final level clears. These prove: applyMove adds a body (and rejects
// not-your-turn / below-the-line / overlap), tick steps + returns a TeeterSim, a level target
// advances the level, over flips after the final level, and a world rebuilds from a scratch snapshot.

import { describe, expect, it } from 'vitest';
import type { LiveTickResult, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { createTeeterTowerGame } from './teeter-tower';
import { GROUND_TOP, LEVELS, levelAt, TOTAL_ROUNDS } from './levels';
import { MAX_PLACED_BODIES, type StoredBody } from './physics';
import type { TeeterMove, TeeterSim } from './types';

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
    round: 1,
    players: players('p1'),
    scores: {},
    scratch: {},
    config: {},
    ...overrides,
  };
}

/** A tall stored block whose top reaches `height` px above the platform (centered on x=410). */
function tallBlock(id: number, height: number): StoredBody {
  const half = height / 2;
  return {
    id,
    verts: [
      [
        { x: -40, y: -half },
        { x: 40, y: -half },
        { x: 40, y: half },
        { x: -40, y: half },
      ],
    ],
    x: 410,
    y: GROUND_TOP - half,
    angle: 0,
    vx: 0,
    vy: 0,
    angularVelocity: 0,
    skin: { fill: '#fff', stroke: '#000' },
    eyes: [],
  };
}

/** Move helper defaulting dropY to 0 (the server clamps dropY anyway). */
function move(angle: number, dropX: number, dropY = 0): TeeterMove {
  return { angle, dropX, dropY };
}

describe('configure', () => {
  it('returns a >=1 round count and no move timer (live game ends via tick.over)', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const result = game.configure({}, players('p1'));
    expect(result.rounds).toBe(TOTAL_ROUNDS);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.moveWindowMs).toBe(0);
  });

  it('accepts an empty/object config and rejects a non-object config', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    expect(() => game.configure(undefined, players('p1'))).not.toThrow();
    expect(() => game.configure({}, players('p1'))).not.toThrow();
    expect(() => game.configure(42, players('p1'))).toThrow();
  });
});

describe('startRound', () => {
  it('returns a TeeterSim prompt with an aim piece so the client renders before tick 1', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const started = game.startRound(ctx({ scratch }));
    const sim = started.prompt as TeeterSim;
    expect(sim.next).not.toBeNull();
    expect(sim.activePlayer).toBe('p1');
    expect(sim.bodies).toEqual([]);
    expect(sim.level).toBe(0);
    expect(sim.target).toBe(LEVELS[0]!.target);
    expect(sim.over).toBe(false);
    // requiredLine is above the platform (smaller y than GROUND_TOP).
    expect(sim.requiredLine).toBeLessThan(GROUND_TOP);
  });
});

describe('collectMove (apply to the live world)', () => {
  it('adds a dynamic body on a legal drop and advances the aim piece', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const collected = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410)),
    );
    expect(collected.rejected).toBeUndefined();
    const after = collected.scratch as { bodies: StoredBody[]; pieceIndex: number };
    expect(after.bodies).toHaveLength(1);
    expect(after.pieceIndex).toBe(1);
  });

  it('rejects a move from a player who is not the active player', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1', 'p2')).scratch;
    const roster = players('p1', 'p2');
    // pieceIndex 0 -> active = index 0 = p1; p2 must be rejected.
    const base = ctx({ scratch, players: roster });
    const started = game.startRound(base);
    expect((started.prompt as TeeterSim).activePlayer).toBe('p1');
    const bad = game.collectMove(
      { ...base, scratch: started.scratch },
      'p2',
      JSON.stringify(move(0, 410)),
    );
    expect(bad.rejected?.reason).toMatch(/turn/i);
  });

  it('rejects a malformed move', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const bad = game.collectMove({ ...base, scratch: started.scratch }, 'p1', 'not json');
    expect(bad.rejected?.reason).toMatch(/malformed/i);
  });

  it('rejects a drop that overlaps the tower', () => {
    // Drop a piece high, then IMMEDIATELY (no tick) drop the next piece at the SAME x and y. The
    // first body is still at its drop origin (nothing has stepped), so the second piece placed on top
    // of it geometrically overlaps and is rejected. dropY is honored as sent (the client aims height).
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const first = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410, 0)),
    );
    expect(first.rejected).toBeUndefined();
    // Second drop at the exact same spot, before any tick moves the first piece: overlaps it.
    const bad = game.collectMove(
      { ...base, scratch: first.scratch },
      'p1',
      JSON.stringify(move(0, 410, 0)),
    );
    expect(bad.rejected?.reason).toMatch(/overlap/i);
  });

  it('rejects a drop whose lowest point is below the required line', () => {
    // For an empty tower (target 600) the required line is 150px = world-y 390; a piece must sit fully
    // ABOVE it (bottom y < 390). Dropping low (bottom well below 390) is rejected on the line rule.
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const requiredLine = (started.prompt as TeeterSim).requiredLine;
    // Drop the piece centroid at requiredLine + 100 (well below the line, y grows down).
    const bad = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410, requiredLine + 100)),
    );
    expect(bad.rejected?.reason).toMatch(/line/i);
  });
});

describe('tick (step the live world)', () => {
  it('steps the world and returns a TeeterSim; not over on an early level', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const collected = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410)),
    );
    let cur = collected.scratch;
    let last: LiveTickResult | null = null;
    for (let i = 0; i < 60; i++) {
      last = game.tick!({ ...base, scratch: cur });
      cur = last.scratch;
    }
    expect(last!.over).toBe(false);
    const sim = last!.sim as TeeterSim;
    expect(sim.bodies.length).toBeGreaterThan(0);
    expect(sim.height).toBeGreaterThan(0);
    expect(sim.level).toBe(0);
  });

  it('advances the internal level once the tower reaches the target', () => {
    // Pre-seed a tower already at level 0's target; the first tick reads height >= target and
    // advances the level, resetting the tower and keeping the banked score.
    const game = createTeeterTowerGame(stubRng(0.5));
    const target = LEVELS[0]!.target;
    const scratch: Record<string, unknown> = {
      seed: 42,
      levelIndex: 0,
      bestHeight: 0,
      totalScore: 0,
      pieceIndex: 3,
      bodies: [tallBlock(1, target + 40)], // top well above the target line
      next: null,
      over: false,
    };
    const base = ctx({ scratch, round: 4 });
    const started = game.startRound(base);
    const ticked = game.tick!({ ...base, scratch: started.scratch });
    const sim = ticked.sim as TeeterSim;
    expect(ticked.over).toBe(false);
    expect(sim.level).toBe(1); // advanced
    expect(sim.target).toBe(LEVELS[1]!.target);
    expect(sim.bodies).toEqual([]); // tower reset for the new level
    expect(sim.score).toBe(100); // the cleared level banked 100
    const after = ticked.scratch as { levelIndex: number; bodies: unknown[]; totalScore: number };
    expect(after.levelIndex).toBe(1);
    expect(after.bodies).toHaveLength(0);
    expect(after.totalScore).toBe(100);
  });

  it('flips over=true once the final level clears (no lose state)', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const lastIndex = LEVELS.length - 1;
    const target = levelAt(lastIndex).target;
    const scratch: Record<string, unknown> = {
      seed: 42,
      levelIndex: lastIndex,
      bestHeight: 0,
      totalScore: 200, // two levels already banked
      pieceIndex: 10,
      bodies: [tallBlock(1, target + 40)],
      next: null,
      over: false,
    };
    const base = ctx({ scratch, round: 5 });
    const started = game.startRound(base);
    const ticked = game.tick!({ ...base, scratch: started.scratch });
    const sim = ticked.sim as TeeterSim;
    expect(ticked.over).toBe(true);
    expect(sim.over).toBe(true);
    expect(sim.next).toBeNull();
    expect((ticked.scratch as { over: boolean }).over).toBe(true);
  });
});

describe('tower cap (spec 0044: no lose state, so a hard cap bounds the world)', () => {
  it('rejects a drop once the tower is at the placed-body cap', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    // Seed a full tower: MAX_PLACED_BODIES (60) stored bodies stacked above the line so only the cap,
    // not overlap or the line rule, can reject the next drop.
    const bodies: StoredBody[] = [];
    for (let i = 0; i < MAX_PLACED_BODIES; i++) {
      bodies.push(tallBlock(i + 1, LEVELS[0]!.target + 40));
    }
    const base = ctx({ scratch: { ...(scratch as object), bodies, pieceIndex: 0 } });
    const started = game.startRound(base);
    const bad = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410)),
    );
    expect(bad.rejected?.reason).toMatch(/full/i);
  });
});

describe('dropY is clamped to the world range before it reaches the solver', () => {
  it('accepts a legal move whose dropY is a wildly out-of-range value', () => {
    // A dropY far above the world (a huge negative y) is clamped, not passed through, so a straight
    // aim above the line still lands rather than being flung off-world.
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const collected = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410, -100000)),
    );
    expect(collected.rejected).toBeUndefined();
    expect((collected.scratch as { bodies: StoredBody[] }).bodies).toHaveLength(1);
  });
});

describe('disposeLive releases the in-process world (spec 0044)', () => {
  it('a fresh rebuild after disposeLive starts from the given scratch, not a stale world', () => {
    // Play a drop, dispose, then tick from EMPTY scratch: with the world released, the module rebuilds
    // from that empty scratch (no bodies) rather than reusing the stale one-piece world.
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const collected = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410)),
    );
    expect((collected.scratch as { bodies: StoredBody[] }).bodies).toHaveLength(1);

    game.disposeLive!(base);
    // A fresh empty scratch: after disposal the module must rebuild from it (empty tower).
    const emptyScratch = game.configure({}, players('p1')).scratch;
    const ticked = game.tick!({ ...base, scratch: emptyScratch });
    expect((ticked.sim as TeeterSim).bodies).toEqual([]);
  });
});

describe('rebuild from scratch', () => {
  it('a fresh module rebuilds the world from a scratch snapshot and keeps ticking', () => {
    // Play a drop with module A, snapshot its scratch, then drive a BRAND-NEW module from that
    // scratch (its in-memory world is empty, so it must rebuild). The tower persists.
    const gameA = createTeeterTowerGame(stubRng(0.5));
    const scratch = gameA.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = gameA.startRound(base);
    const collected = gameA.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410)),
    );
    let cur = collected.scratch;
    for (let i = 0; i < 40; i++) cur = gameA.tick!({ ...base, scratch: cur }).scratch;
    const bodiesBefore = (cur as { bodies: StoredBody[] }).bodies;
    expect(bodiesBefore.length).toBeGreaterThan(0);

    // A fresh module has no in-memory world; ticking from `cur` must rebuild it from the snapshot.
    const gameB = createTeeterTowerGame(stubRng(0.9));
    const ticked = gameB.tick!({ ...base, scratch: cur });
    const sim = ticked.sim as TeeterSim;
    expect(sim.bodies.length).toBe(bodiesBefore.length);
    expect(sim.height).toBeGreaterThan(0);
  });
});

describe('turn-based callbacks are defensive no-ops for the live game', () => {
  it('advance is done, disputeWindow/disputeVote empty, endGame ranks by score', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    expect(game.advance(ctx({}))).toEqual({ done: true });
    expect(game.disputeWindow(ctx({})).disputes).toEqual([]);
    expect(game.disputeVote(ctx({})).scores).toEqual([]);
    const roster = players('p1', 'p2');
    const standings = game.endGame(ctx({ players: roster, scores: { p1: 50, p2: 100 } }));
    expect(standings[0]!.player).toBe('p2');
    expect(standings[0]!.rank).toBe(1);
  });
});
