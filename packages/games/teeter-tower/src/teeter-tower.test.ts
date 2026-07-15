// Teeter Tower module tests (spec 0044 - live physics). Teeter is now a LIVE game: `collectMove`
// applies a drop to the continuously-running world, `tick` steps the world and streams a TeeterSim,
// and the game ends when the final level clears. These prove: applyMove adds a body (and rejects
// not-your-turn / below-the-line / overlap), tick steps + returns a TeeterSim, a level target
// advances the level, over flips after the final level, and a world rebuilds from a scratch snapshot.

import { describe, expect, it } from 'vitest';
import type { LiveTickResult, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { createTeeterTowerGame } from './teeter-tower';
import { GROUND_TOP, LEVELS, levelAt, PAR_PENALTY, TOTAL_ROUNDS } from './levels';
import {
  COMPLETE_TICKS,
  INTRO_TICKS,
  MAX_PLACED_BODIES,
  MAX_SETTLE_TICKS,
  type StoredBody,
} from './physics';
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

/**
 * Move helper. dropY defaults to a modest world-y (~200px above the platform) so the piece lands ABOVE
 * the required min-drop line yet the resulting tower height stays well UNDER the level-1 target (450) -
 * a drop far higher would report a huge height and trip the target-reached level advance mid-test.
 */
function move(angle: number, dropX: number, dropY = GROUND_TOP - 200): TeeterMove {
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
  it('adds a dynamic body on a legal drop and advances the piece index', () => {
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

  it('pauses between pieces: clears the aim piece on a drop, re-offers it once settled (feedback 0027)', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch0 = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch: scratch0 });
    const started = game.startRound(base);
    // The FIRST piece is offered immediately (empty/settled scene) - no start-of-game pause.
    expect((started.prompt as TeeterSim).next).not.toBeNull();
    // Drop it from up high so it falls for a while.
    const dropped = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410, GROUND_TOP - 350)),
    );
    expect(dropped.rejected).toBeUndefined();
    // The aim piece is cleared immediately - nothing to aim while the last piece falls.
    expect((dropped.scratch as { next: unknown }).next).toBeNull();

    // Tick: `next` stays null while the piece is still moving, then re-appears once the tower settles
    // (or the settle-wait cap). It must NOT come back on the very first tick - there is a real pause.
    let cur = dropped.scratch;
    let ticks = 0;
    let next: unknown = null;
    for (; ticks < MAX_SETTLE_TICKS + 20; ticks++) {
      const t = game.tick!({ ...base, scratch: cur });
      cur = t.scratch;
      next = (t.sim as TeeterSim).next;
      if (next) break;
    }
    expect(next).not.toBeNull(); // the next piece did re-appear (no soft-lock)
    expect(ticks).toBeGreaterThan(1); // ...but only after a pause, not on the first tick
  });

  it('offers the next piece at the settle-wait cap even if the tower never settles (feedback 0027)', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch0 = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch: scratch0 });
    const started = game.startRound(base);
    // Drop from the maximum release height so the piece is still airborne when the cap fires.
    const dropped = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410, GROUND_TOP - 2000)),
    );
    expect(dropped.rejected).toBeUndefined();
    let cur = dropped.scratch;
    let next: unknown = null;
    for (let i = 0; i < MAX_SETTLE_TICKS; i++) {
      const t = game.tick!({ ...base, scratch: cur });
      cur = t.scratch;
      next = (t.sim as TeeterSim).next;
    }
    // By the cap the next piece is offered even though the tall drop has not settled (stableHeight, the
    // settled height, is still 0) - the pause is bounded so a never-resting scene can't soft-lock.
    expect(next).not.toBeNull();
    expect((cur as { stableHeight: number }).stableHeight).toBe(0);
  });

  it('rejects a drop during the between-piece pause, server-side (feedback 0027)', () => {
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch0 = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch: scratch0 });
    const started = game.startRound(base);
    // Drop the first piece high; `next` is now cleared while the tower settles.
    const dropped = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410, GROUND_TOP - 350)),
    );
    expect(dropped.rejected).toBeUndefined();
    expect((dropped.scratch as { next: unknown }).next).toBeNull();
    // A second drop before the tower settles is REFUSED (not silently regenerated), so a lagging or
    // scripted client cannot drop onto a still-tumbling tower - the pause is a server rule.
    const early = game.collectMove(
      { ...base, scratch: dropped.scratch },
      'p1',
      JSON.stringify(move(0, 410)),
    );
    expect(early.rejected?.reason).toMatch(/settle/i);
    expect((early.scratch as { bodies: unknown[] }).bodies).toHaveLength(1); // no new body added
  });

  it('subtracts points for a piece dropped beyond the round par (feedback 0026)', () => {
    const par = LEVELS[0]!.par; // 8
    // A started scratch (which carries a valid `next` aim piece) pre-seeded to ALREADY be at par pieces
    // this round, so the next drop is the (par+1)th - the first one past par. A fresh game rebuilds from
    // this scratch (its world is not cached), so the seeded piecesThisLevel takes effect. This isolates
    // the penalty from band scoring (which only updates in tick) without needing many drops.
    const seedGame = createTeeterTowerGame(stubRng(0.5));
    const started = seedGame.startRound(
      ctx({ scratch: seedGame.configure({}, players('p1')).scratch }),
    );
    const seeded = { ...(started.scratch as Record<string, unknown>), piecesThisLevel: par };

    const game = createTeeterTowerGame(stubRng(0.5)); // fresh -> rebuilds the world from `seeded`
    const dropped = game.collectMove(ctx({ scratch: seeded }), 'p1', JSON.stringify(move(0, 410)));
    expect(dropped.rejected).toBeUndefined();
    const after = dropped.scratch as { totalScore: number; piecesThisLevel: number };
    expect(after.piecesThisLevel).toBe(par + 1);
    expect(after.totalScore).toBe(-PAR_PENALTY); // one piece over par -> -PENALTY (the total can go negative)
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
    // Pre-seed a tower with a block centered on x=410, plus a valid next aim piece, then drop that piece
    // onto the block (same x, a y inside it): it geometrically overlaps and is rejected. (Overlap is
    // checked before the min-drop line, so the low drop reads as 'overlap', not 'line'.) A fresh game
    // rebuilds from the seeded scratch. This replaces the old "drop twice at the same spot without
    // ticking" setup, which the between-piece pause (feedback 0027) no longer allows.
    const seedGame = createTeeterTowerGame(stubRng(0.5));
    const started = seedGame.startRound(
      ctx({ scratch: seedGame.configure({}, players('p1')).scratch }),
    );
    const seeded = {
      ...(started.scratch as Record<string, unknown>),
      bodies: [tallBlock(1, 120)], // a 120px block resting on the platform, centered on x=410
    };
    const game = createTeeterTowerGame(stubRng(0.5)); // fresh -> rebuilds the world from `seeded`
    const bad = game.collectMove(
      ctx({ scratch: seeded }),
      'p1',
      JSON.stringify(move(0, 410, GROUND_TOP - 60)), // into the block's body
    );
    expect(bad.rejected?.reason).toMatch(/overlap/i);
  });

  it('clamps a below-the-line drop up to line height instead of blocking it (feedback 0032)', () => {
    // For an empty tower the required line is the first 25%-of-target line above the platform. A
    // below-line aim is no longer rejected (feedback 0032) - the server CLAMPS the piece up so its
    // bottom rests just above the line, then runs the overlap check. So a drop below the line is
    // ACCEPTED and the placed body sits above the line.
    const game = createTeeterTowerGame(stubRng(0.5));
    const scratch = game.configure({}, players('p1')).scratch;
    const base = ctx({ scratch });
    const started = game.startRound(base);
    const requiredLine = (started.prompt as TeeterSim).requiredLine;
    // Drop the piece centroid below the line (larger world-y, y grows down) but clear of the platform.
    const collected = game.collectMove(
      { ...base, scratch: started.scratch },
      'p1',
      JSON.stringify(move(0, 410, requiredLine + 45)),
    );
    expect(collected.rejected).toBeUndefined();
    const after = collected.scratch as { bodies: StoredBody[] };
    expect(after.bodies).toHaveLength(1);
    // The clamped body's bottom (centroid y + half-height) sits above the line (smaller y). The stored
    // block placed here is 80px tall (see move()'s piece) - read its bottom off the stored transform.
    const b = after.bodies[0]!;
    const bottom = b.y + Math.max(...b.verts.flat().map((v) => v.y));
    expect(bottom).toBeLessThanOrEqual(requiredLine + 0.6); // just above the line, within the margin
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

  it('runs the round-transition beat: playing -> complete -> intro -> playing (feedback 0032)', () => {
    // Pre-seed a tower already at level 0's target. The first tick reads height >= target and enters the
    // "Complete!" beat (`'complete'`) - it does NOT advance yet, and withholds the next piece. After
    // COMPLETE_TICKS it advances the level and plays the "Round X" intro (`'intro'`); after INTRO_TICKS
    // it resumes normal play at level 1, offering the next piece.
    const game = createTeeterTowerGame(stubRng(0.5));
    const target = LEVELS[0]!.target;
    const scratch: Record<string, unknown> = {
      seed: 42,
      levelIndex: 0,
      bestHeight: 0,
      totalScore: 0,
      pieceIndex: 3,
      piecesThisLevel: 5, // pieces used this round - must reset when the round advances (feedback 0026)
      bodies: [tallBlock(1, target + 40)], // top well above the target line
      next: null,
      over: false,
      phase: 'playing',
      phaseTicks: 0,
    };
    const base = ctx({ scratch, round: 4 });
    const started = game.startRound(base);

    // First tick: enter the 'complete' beat. Still level 0, tower held, next withheld, NOT over.
    let ticked = game.tick!({ ...base, scratch: started.scratch });
    let sim = ticked.sim as TeeterSim;
    expect(ticked.over).toBe(false);
    expect(sim.phase).toBe('complete');
    expect(sim.level).toBe(0); // not advanced yet
    expect(sim.next).toBeNull(); // next piece withheld during the beat
    expect(sim.score).toBe(100); // the cleared level banked 100

    // Run out the 'complete' countdown: on the last tick it advances the level and enters 'intro'.
    let cur = ticked.scratch;
    for (let i = 0; i < COMPLETE_TICKS - 1; i++) {
      ticked = game.tick!({ ...base, scratch: cur });
      cur = ticked.scratch;
      expect((ticked.sim as TeeterSim).phase).toBe('complete');
    }
    ticked = game.tick!({ ...base, scratch: cur });
    cur = ticked.scratch;
    sim = ticked.sim as TeeterSim;
    expect(sim.phase).toBe('intro');
    expect(sim.level).toBe(1); // advanced
    expect(sim.target).toBe(LEVELS[1]!.target);
    expect(sim.bodies).toEqual([]); // tower reset for the new level
    expect(sim.par).toBe(LEVELS[1]!.par); // the new round's par
    expect(sim.pieces).toBe(0); // per-round piece count reset for the fresh round
    expect(sim.next).toBeNull(); // still withheld during the intro

    // Run out the 'intro' countdown: it returns to 'playing', and the next tick offers the piece.
    for (let i = 0; i < INTRO_TICKS - 1; i++) {
      ticked = game.tick!({ ...base, scratch: cur });
      cur = ticked.scratch;
      expect((ticked.sim as TeeterSim).phase).toBe('intro');
    }
    ticked = game.tick!({ ...base, scratch: cur });
    cur = ticked.scratch;
    expect((ticked.sim as TeeterSim).phase).toBe('playing');
    // One more tick in 'playing' offers the fresh piece (empty/settled tower).
    ticked = game.tick!({ ...base, scratch: cur });
    expect((ticked.sim as TeeterSim).next).not.toBeNull();

    const after = ticked.scratch as {
      levelIndex: number;
      bodies: unknown[];
      totalScore: number;
      piecesThisLevel: number;
    };
    expect(after.levelIndex).toBe(1);
    expect(after.bodies).toHaveLength(0);
    expect(after.totalScore).toBe(100);
    expect(after.piecesThisLevel).toBe(0);
  });

  it('the final round routes through complete, then flips over=true (feedback 0032)', () => {
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
      phase: 'playing',
      phaseTicks: 0,
    };
    const base = ctx({ scratch, round: 5 });
    const started = game.startRound(base);

    // First tick: the FINAL round routes through 'complete' too (so "Complete!" shows) - not over yet.
    let ticked = game.tick!({ ...base, scratch: started.scratch });
    expect(ticked.over).toBe(false);
    expect((ticked.sim as TeeterSim).phase).toBe('complete');

    // Run out the 'complete' countdown: on the last tick the game ends (no next level to advance to).
    let cur = ticked.scratch;
    for (let i = 0; i < COMPLETE_TICKS - 1; i++) {
      ticked = game.tick!({ ...base, scratch: cur });
      cur = ticked.scratch;
      expect(ticked.over).toBe(false);
    }
    ticked = game.tick!({ ...base, scratch: cur });
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
    const before = cur as { bodies: StoredBody[]; stableHeight: number; piecesThisLevel: number };
    expect(before.bodies.length).toBeGreaterThan(0);
    // The settled tower + per-round count are persisted in the snapshot (feedback 0026).
    expect(before.piecesThisLevel).toBe(1);
    expect(before.stableHeight).toBeGreaterThan(0);

    // A fresh module has no in-memory world; ticking from `cur` must rebuild it from the snapshot -
    // including stableHeight + piecesThisLevel, so the rebuilt world reports the same tower + par count.
    const gameB = createTeeterTowerGame(stubRng(0.9));
    const ticked = gameB.tick!({ ...base, scratch: cur });
    const sim = ticked.sim as TeeterSim;
    expect(sim.bodies.length).toBe(before.bodies.length);
    expect(sim.height).toBeGreaterThan(0);
    expect(sim.pieces).toBe(1);
    const afterSnap = ticked.scratch as { stableHeight: number; piecesThisLevel: number };
    expect(afterSnap.piecesThisLevel).toBe(1);
    expect(afterSnap.stableHeight).toBeGreaterThan(0);
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
