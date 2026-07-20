import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@branchout/game-sdk/testing';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import {
  CORRECT_POINTS,
  DRAW_DISPUTE_WINDOW_MS,
  FOOL_POINTS,
  createSketchyGame,
  stageForRound,
} from './sketchy';
import { serializeSketch, type Sketch } from './strokes';
import type { SketchySeed } from './seeds';

const BANK: SketchySeed[] = [
  { id: 'animals-001', category: 'animals', text: 'a cat' },
  { id: 'animals-002', category: 'animals', text: 'a dog' },
  { id: 'animals-003', category: 'animals', text: 'an owl' },
  { id: 'food-001', category: 'food', text: 'a taco' },
  { id: 'food-002', category: 'food', text: 'a pizza' },
  { id: 'food-003', category: 'food', text: 'a donut' },
];

const roster: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

function ctxOf(
  round: number,
  phase: RoundContext['phase'],
  scratch: Record<string, unknown>,
  scores: Record<string, number> = {},
): RoundContext {
  return {
    room: 'r',
    game: 'sketchy',
    phase,
    round,
    players: roster,
    scores,
    scratch,
    config: {},
  };
}

const sampleSketch: Sketch = {
  strokes: [{ color: '#0d0a15', points: [10, 10, 500, 500, 900, 100] }],
};

describe('stageForRound', () => {
  it('maps a cycle to 1 draw round then one sketch round per player', () => {
    // 3 players: round 1 = draw; rounds 2,3,4 = sketch for player index 0,1,2.
    expect(stageForRound(1, 3)).toEqual({ stage: 'draw', cycle: 0, featureIndex: -1 });
    expect(stageForRound(2, 3)).toEqual({ stage: 'sketch', cycle: 0, featureIndex: 0 });
    expect(stageForRound(4, 3)).toEqual({ stage: 'sketch', cycle: 0, featureIndex: 2 });
    // Second cycle starts at round 5 with another draw round.
    expect(stageForRound(5, 3)).toEqual({ stage: 'draw', cycle: 1, featureIndex: -1 });
  });
});

describe('per-player seed secrecy (spec 0052)', () => {
  it('deals each player only their own seed in private, and no seed in the broadcast prompt', () => {
    const game = createSketchyGame(BANK, mulberry32(7));
    const scratch = game.configure({ rounds: 1 }, roster).scratch;
    const start = game.startRound(ctxOf(1, 'collecting', scratch));

    // The broadcast prompt names no seed at all.
    expect(JSON.stringify(start.prompt)).not.toMatch(/cat|dog|owl|taco|pizza|donut/i);

    // Every player got a private payload; each is only THEIR own seed.
    const priv = start.private as Record<string, { seed: string }>;
    expect(Object.keys(priv).sort()).toEqual(['p1', 'p2', 'p3']);
    const seeds = Object.values(priv).map((p) => p.seed);
    // Distinct seeds, each drawn from the bank.
    expect(new Set(seeds).size).toBe(3);
    for (const seed of seeds) expect(BANK.map((s) => s.text)).toContain(seed);

    // Crucially: p2's private payload never contains p1's or p3's seed.
    const p2Blob = JSON.stringify(priv.p2);
    expect(p2Blob).toContain(priv.p2!.seed);
    expect(p2Blob).not.toContain(priv.p1!.seed);
    expect(p2Blob).not.toContain(priv.p3!.seed);
  });
});

describe('draw round', () => {
  it('declares a POSITIVE dispute window so the no-decision draw round auto-finalizes', () => {
    // The draw round's reveal returns no decision, so the engine takes the dispute path
    // (collecting -> reveal -> disputing -> leaderboard). The engine only arms the dispute-window
    // timer when the window is > 0; a 0 window ("host advances manually") would strand the draw round
    // in `disputing` - a phase no Sketchy client renders - and hang the whole game. Guard the fix:
    // configure must hand the engine a positive dispute window so the round bridges to the gallery
    // leaderboard on its own.
    const game = createSketchyGame(BANK, mulberry32(1));
    const configured = game.configure({ rounds: 1 }, roster);
    expect(configured.disputeWindowMs).toBe(DRAW_DISPUTE_WINDOW_MS);
    expect(configured.disputeWindowMs).toBeGreaterThan(0);
  });

  it('keeps the draw->gallery dispute bridge positive even with auto-advance off', () => {
    // The dispute window is the mechanical draw->gallery bridge, NOT the host-pause leaderboard dwell,
    // so it must stay positive regardless of auto-advance or the draw round would hang.
    const game = createSketchyGame(BANK, mulberry32(1));
    const off = game.configure({ rounds: 1, autoAdvance: false }, roster);
    expect(off.disputeWindowMs).toBe(DRAW_DISPUTE_WINDOW_MS);
    expect(off.disputeWindowMs).toBeGreaterThan(0);
  });
});

describe('auto-advance pacing (spec 0068)', () => {
  it('reports the leaderboard dwell as the advance-after delay when auto-advance is on', () => {
    // The engine infers `autoAdvance` = leaderboardWindowMs > 0, which drives the host-controls
    // collapse and the client countdown.
    const game = createSketchyGame(BANK, mulberry32(1));
    const on = game.configure({ rounds: 1, autoAdvance: true, advanceAfterSeconds: 8 }, roster);
    expect(on.leaderboardWindowMs).toBe(8_000);
  });

  it('reports a 0 leaderboard dwell (host-advanced) when auto-advance is off', () => {
    const game = createSketchyGame(BANK, mulberry32(1));
    const off = game.configure({ rounds: 1, autoAdvance: false }, roster);
    expect(off.leaderboardWindowMs).toBe(0);
  });

  it('rejects a blank or malformed sketch and banks a real one', () => {
    const game = createSketchyGame(BANK, mulberry32(1));
    let scratch = game.configure({ rounds: 1 }, roster).scratch;
    scratch = game.startRound(ctxOf(1, 'collecting', scratch)).scratch;

    const bad = game.collectMove(ctxOf(1, 'collecting', scratch), 'p1', 'not a sketch');
    expect(bad.rejected?.reason).toMatch(/draw something/);

    const blank = game.collectMove(
      ctxOf(1, 'collecting', scratch),
      'p1',
      serializeSketch({ strokes: [] }),
    );
    expect(blank.rejected?.reason).toMatch(/draw something/);

    const good = game.collectMove(
      ctxOf(1, 'collecting', scratch),
      'p1',
      serializeSketch(sampleSketch),
    );
    expect(good.rejected).toBeUndefined();
    expect((good.scratch as { sketches: Record<string, string> }).sketches.p1).toBeTruthy();
  });

  it('takes the no-decision path and reveals a gallery of the sketches', () => {
    const game = createSketchyGame(BANK, mulberry32(1));
    let scratch = game.configure({ rounds: 1 }, roster).scratch;
    scratch = game.startRound(ctxOf(1, 'collecting', scratch)).scratch;
    for (const p of ['p1', 'p2', 'p3']) {
      scratch = game.collectMove(
        ctxOf(1, 'collecting', scratch),
        p,
        serializeSketch(sampleSketch),
      ).scratch;
    }
    expect(game.allSubmitted?.(ctxOf(1, 'collecting', scratch))).toBe(true);
    const revealed = game.reveal(ctxOf(1, 'collecting', scratch));
    expect(revealed.decision).toBeUndefined();
    const reveal = revealed.reveal as { stage: string; gallery: unknown[] };
    expect(reveal.stage).toBe('draw');
    expect(reveal.gallery).toHaveLength(3);
  });
});

describe('sketch round: allSubmitted holds when only the featured author is connected', () => {
  it('does not close a decoy stage with no decoy-writers present', () => {
    const game = createSketchyGame(BANK, mulberry32(2));
    let scratch = game.configure({ rounds: 1 }, roster).scratch;
    scratch = game.startRound(ctxOf(1, 'collecting', scratch)).scratch;
    for (const p of ['p1', 'p2', 'p3']) {
      scratch = game.collectMove(
        ctxOf(1, 'collecting', scratch),
        p,
        serializeSketch(sampleSketch),
      ).scratch;
    }
    game.reveal(ctxOf(1, 'collecting', scratch));
    scratch = game.startRound(ctxOf(2, 'collecting', scratch)).scratch;
    const featured = (scratch as { featured: string }).featured;

    // Only the featured author is connected: there are zero decoy-writers, so the stage must NOT
    // close (an empty `.every` would falsely report done and open an unguessable single option).
    const onlyFeatured: SessionPlayer[] = roster.map((p) => ({
      ...p,
      connected: p.player === featured,
    }));
    const ctx: RoundContext = {
      room: 'r',
      game: 'sketchy',
      phase: 'collecting',
      round: 2,
      players: onlyFeatured,
      scores: {},
      scratch,
      config: {},
    };
    expect(game.allSubmitted?.(ctx)).toBe(false);
  });
});

describe('sketch round: decoys, dedupe, truth rejection, scoring', () => {
  // Drive one whole cycle: draw round, then feature p1's sketch and score the guesses.
  function playToSketchRound() {
    const game = createSketchyGame(BANK, mulberry32(3));
    let scratch = game.configure({ rounds: 1 }, roster).scratch;
    // Draw round (call startRound once so the seed assignment is stable).
    const start = game.startRound(ctxOf(1, 'collecting', scratch));
    scratch = start.scratch;
    const priv = start.private as Record<string, { seed: string }>;
    for (const p of ['p1', 'p2', 'p3']) {
      scratch = game.collectMove(
        ctxOf(1, 'collecting', scratch),
        p,
        serializeSketch(sampleSketch),
      ).scratch;
    }
    game.reveal(ctxOf(1, 'collecting', scratch));
    // Move to the sketch round featuring p1 (round 2 -> featureIndex 0 -> order[0] = p1).
    scratch = game.startRound(ctxOf(2, 'collecting', scratch)).scratch;
    return { game, scratch, p1Seed: priv.p1!.seed };
  }

  it('rejects a decoy equal to the true seed and a duplicate of another decoy', () => {
    const { game, scratch, p1Seed } = playToSketchRound();
    // p2 tries the true seed -> rejected.
    const truthTry = game.collectMove(ctxOf(2, 'collecting', scratch), 'p2', p1Seed);
    expect(truthTry.rejected?.reason).toMatch(/already suggested/);

    // p2 submits a decoy, p3 tries the same decoy -> rejected.
    const s = game.collectMove(ctxOf(2, 'collecting', scratch), 'p2', 'a wolf').scratch;
    const dup = game.collectMove(ctxOf(2, 'collecting', s), 'p3', 'A Wolf');
    expect(dup.rejected?.reason).toMatch(/already suggested/);

    // The featured player (p1) writes no decoy: ignored quietly (no reject, no change).
    const featuredTry = game.collectMove(ctxOf(2, 'collecting', s), 'p1', 'a wolf');
    expect(featuredTry.rejected).toBeUndefined();
    expect((featuredTry.scratch as { decoys: Record<string, string> }).decoys.p1).toBeUndefined();
  });

  it('scores a correct guess and a fooled decoy author', () => {
    const { game, scratch: initial, p1Seed } = playToSketchRound();
    let scratch = initial;

    // p2 and p3 each write a distinct decoy.
    scratch = game.collectMove(ctxOf(2, 'collecting', scratch), 'p2', 'a wolf').scratch;
    scratch = game.collectMove(ctxOf(2, 'collecting', scratch), 'p3', 'a fox').scratch;
    expect(game.allSubmitted?.(ctxOf(2, 'collecting', scratch))).toBe(true);

    const revealed = game.reveal(ctxOf(2, 'collecting', scratch));
    expect(revealed.decision?.windowMs).toBeGreaterThan(0);
    scratch = revealed.scratch;

    // Find option ids from the attribution in scratch.
    const attribution = (
      scratch as { attribution: Record<string, { kind: string; author?: string }> }
    ).attribution;
    const truthId = Object.keys(attribution).find((id) => attribution[id]!.kind === 'truth')!;

    // p2 finds the truth (+100); p3 picks p2's decoy so p2's decoy fools p3 (+50 to p2).
    const p2DecoyId = Object.keys(attribution).find(
      (id) => attribution[id]!.kind === 'decoy' && attribution[id]!.author === 'p2',
    )!;
    scratch = game.collectVote(ctxOf(2, 'guessing', scratch), {
      player: 'p2',
      target: truthId,
      agree: true,
    }).scratch;
    scratch = game.collectVote(ctxOf(2, 'guessing', scratch), {
      player: 'p3',
      target: p2DecoyId,
      agree: true,
    }).scratch;

    // The featured author (p1) cannot vote.
    const p1Vote = game.collectVote(ctxOf(2, 'guessing', scratch), {
      player: 'p1',
      target: truthId,
      agree: true,
    });
    expect((p1Vote.scratch as { guesses: Record<string, string> }).guesses.p1).toBeUndefined();

    expect(game.allDecided?.(ctxOf(2, 'guessing', scratch))).toBe(true);

    const resolved = game.resolveDecision!(ctxOf(2, 'guessing', scratch));
    const byPlayer: Record<string, number> = {};
    for (const e of resolved.scores) byPlayer[e.player] = (byPlayer[e.player] ?? 0) + e.points;
    // p2: +100 truth, +50 fooling p3 = 150. p3: 0.
    expect(byPlayer.p2).toBe(CORRECT_POINTS + FOOL_POINTS);
    expect(byPlayer.p3 ?? 0).toBe(0);
    // A player cannot pick their own decoy (backstop): unused here but the reveal marks who fooled.
    const reveal = resolved.reveal as { correctGuessers: string[]; trueSeed: string };
    expect(reveal.correctGuessers).toContain('p2');
    void p1Seed;
  });
});
