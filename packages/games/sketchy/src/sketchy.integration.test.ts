// Full-lifecycle integration for Sketchy (spec 0063). Drives the module by hand through the exact
// sequence the engine drives - configure -> [draw round: startRound -> collectMove -> reveal] ->
// [sketch rounds: startRound -> collectMove(decoys) -> reveal -> collectVote -> resolveDecision] ->
// leaderboard -> advance - for one cycle with three players and a seeded rng, built via
// `sketchyPlugin.create` so the injected asset loader (not disk) supplies the seeds. Proves the
// draw+bluff two-stage flow reaches a ranked winner, and that a non-recipient never receives another
// player's seed.

import { describe, expect, it } from 'vitest';
import { createTestServices, mulberry32 } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import type { ScoreEvent, Standing } from '@branchout/protocol';
import { CATEGORIES } from './seeds';
import { sketchyPlugin, CORRECT_POINTS, FOOL_POINTS } from './sketchy';
import { serializeSketch, type Sketch } from './strokes';

function bankFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const category of CATEGORIES) files[`data/sketchy/${category}.json`] = [];
  files['data/sketchy/animals.json'] = [
    { id: 'animals-001', category: 'animals', text: 'a cat' },
    { id: 'animals-002', category: 'animals', text: 'a dog' },
    { id: 'animals-003', category: 'animals', text: 'an owl' },
  ];
  return files;
}

const roster: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

const sketch: Sketch = { strokes: [{ color: '#0d0a15', points: [0, 0, 500, 500, 1000, 0] }] };

describe('Sketchy full cycle', () => {
  it('runs a draw round + a sketch round per player and ranks a winner', async () => {
    const game: GameModule = await sketchyPlugin.create(
      createTestServices({ files: bankFiles(), rng: mulberry32(5) }),
    );

    const scores: Record<string, number> = { p1: 0, p2: 0, p3: 0 };
    const apply = (events: readonly ScoreEvent[]) => {
      for (const e of events) scores[e.player] = (scores[e.player] ?? 0) + e.points;
    };
    const ctx = (
      round: number,
      phase: RoundContext['phase'],
      scratch: Record<string, unknown>,
    ): RoundContext => ({
      room: 'r',
      game: 'sketchy',
      phase,
      round,
      players: roster,
      scores,
      scratch,
      config: {},
    });

    const configured = game.configure({ rounds: 1 }, roster);
    // One cycle of 3 players = 1 draw round + 3 sketch rounds = 4 engine rounds.
    expect(configured.rounds).toBe(4);
    let scratch = configured.scratch;

    // ----- Round 1: the DRAW round. -----
    const draw = game.startRound(ctx(1, 'collecting', scratch));
    scratch = draw.scratch;
    const priv = draw.private as Record<string, { seed: string }>;
    // Secrecy: p1's seed is not in p2's or p3's private payload.
    expect(JSON.stringify(priv.p2)).not.toContain(priv.p1!.seed);
    expect(JSON.stringify(priv.p3)).not.toContain(priv.p1!.seed);

    for (const p of ['p1', 'p2', 'p3']) {
      scratch = game.collectMove(ctx(1, 'collecting', scratch), p, serializeSketch(sketch)).scratch;
    }
    expect(game.allSubmitted?.(ctx(1, 'collecting', scratch))).toBe(true);
    const drawReveal = game.reveal(ctx(1, 'collecting', scratch));
    scratch = drawReveal.scratch;
    apply(drawReveal.scores);
    expect(drawReveal.decision).toBeUndefined(); // draw round: no guess
    // Leaderboard + advance to round 2.
    game.leaderboard(ctx(1, 'leaderboard', scratch));
    expect(game.advance(ctx(1, 'leaderboard', scratch)).done).toBe(false);

    // ----- Rounds 2..4: one SKETCH round per player. -----
    for (let round = 2; round <= 4; round++) {
      const start = game.startRound(ctx(round, 'collecting', scratch));
      scratch = start.scratch;
      const featured = (start.prompt as { featured: string }).featured;
      const others = ['p1', 'p2', 'p3'].filter((p) => p !== featured);

      // Each non-featured player writes a distinct decoy.
      others.forEach((p, i) => {
        scratch = game.collectMove(
          ctx(round, 'collecting', scratch),
          p,
          `decoy ${round}-${i}`,
        ).scratch;
      });
      expect(game.allSubmitted?.(ctx(round, 'collecting', scratch))).toBe(true);

      const revealed = game.reveal(ctx(round, 'collecting', scratch));
      scratch = revealed.scratch;
      apply(revealed.scores);
      expect(revealed.decision?.windowMs).toBeGreaterThan(0);

      // Find the truth option and have both non-featured players guess it (each scores +100).
      const attribution = (
        scratch as {
          attribution: Record<string, { kind: string; author?: string }>;
        }
      ).attribution;
      const truthId = Object.keys(attribution).find((id) => attribution[id]!.kind === 'truth')!;
      for (const p of others) {
        scratch = game.collectVote(ctx(round, 'guessing', scratch), {
          player: p,
          target: truthId,
          agree: true,
        }).scratch;
      }
      expect(game.allDecided?.(ctx(round, 'guessing', scratch))).toBe(true);

      const resolved = game.resolveDecision!(ctx(round, 'guessing', scratch));
      scratch = resolved.scratch;
      apply(resolved.scores);
      game.leaderboard(ctx(round, 'leaderboard', scratch));
    }

    // Everyone guessed the truth on every sketch round they were eligible for. Across the 3 sketch
    // rounds each player is featured once (does not guess) and guesses the other two -> +200 each.
    expect(scores).toEqual({
      p1: 2 * CORRECT_POINTS,
      p2: 2 * CORRECT_POINTS,
      p3: 2 * CORRECT_POINTS,
    });

    expect(game.advance(ctx(4, 'leaderboard', scratch)).done).toBe(true);
    const final: Standing[] = game.endGame(ctx(4, 'complete', scratch));
    expect(final).toHaveLength(3);
    expect(final.every((s) => s.score === 200)).toBe(true);
  });

  it('gives a decoy author points for each guesser they fool', async () => {
    const game: GameModule = await sketchyPlugin.create(
      createTestServices({ files: bankFiles(), rng: mulberry32(9) }),
    );
    const ctx = (
      round: number,
      phase: RoundContext['phase'],
      scratch: Record<string, unknown>,
    ): RoundContext => ({
      room: 'r',
      game: 'sketchy',
      phase,
      round,
      players: roster,
      scores: {},
      scratch,
      config: {},
    });

    let scratch = game.configure({ rounds: 1 }, roster).scratch;
    scratch = game.startRound(ctx(1, 'collecting', scratch)).scratch;
    for (const p of ['p1', 'p2', 'p3']) {
      scratch = game.collectMove(ctx(1, 'collecting', scratch), p, serializeSketch(sketch)).scratch;
    }
    scratch = game.reveal(ctx(1, 'collecting', scratch)).scratch;

    // Round 2 features order[0]. Both others write decoys; the non-featured guessers pick one
    // player's decoy so that author is credited for fooling.
    scratch = game.startRound(ctx(2, 'collecting', scratch)).scratch;
    const featured = (scratch as { featured: string }).featured;
    const others = ['p1', 'p2', 'p3'].filter((p) => p !== featured);
    const [a, b] = others as [string, string];
    scratch = game.collectMove(ctx(2, 'collecting', scratch), a, 'a decoy from a').scratch;
    scratch = game.collectMove(ctx(2, 'collecting', scratch), b, 'a decoy from b').scratch;
    scratch = game.reveal(ctx(2, 'collecting', scratch)).scratch;

    const attribution = (
      scratch as {
        attribution: Record<string, { kind: string; author?: string }>;
      }
    ).attribution;
    const aDecoyId = Object.keys(attribution).find(
      (id) => attribution[id]!.kind === 'decoy' && attribution[id]!.author === a,
    )!;
    // b falls for a's decoy -> a scores FOOL_POINTS.
    scratch = game.collectVote(ctx(2, 'guessing', scratch), {
      player: b,
      target: aDecoyId,
      agree: true,
    }).scratch;

    const resolved = game.resolveDecision!(ctx(2, 'guessing', scratch));
    const byPlayer: Record<string, number> = {};
    for (const e of resolved.scores) byPlayer[e.player] = (byPlayer[e.player] ?? 0) + e.points;
    expect(byPlayer[a]).toBe(FOOL_POINTS);
  });
});
