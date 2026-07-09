// Full-lifecycle integration for Liar Liar (spec 0021). This drives the module by hand through the
// exact sequence the engine drives - configure -> startRound -> collectAnswer(+reject) -> allAnswered
// -> reveal -> collectVote -> allDecided -> resolveDecision -> leaderboard -> advance - across two
// rounds with three players and a seeded rng, and builds the module via `liarLiarPlugin.create` so the
// injected asset loader (not disk) supplies the clues. The engine-level integration (registering the
// plugin through GameEngine + registerPlugins) lands when Liar Liar is wired into boot with its real
// content (spec 0022); the engine's own generic decision-phase path is already covered in
// apps/game-engine (spec 0020).

import { describe, expect, it } from 'vitest';
import { createTestServices, mulberry32 } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import type { ScoreEvent, Standing } from '@branchout/protocol';
import { CATEGORIES } from './clues';
import { liarLiarPlugin, CORRECT_POINTS, FOOL_POINTS } from './liar-liar';

function clueFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const category of CATEGORIES) files[`data/liar-liar/${category}.json`] = [];
  files['data/liar-liar/people.json'] = [
    { id: 'people-001', category: 'people', clue: 'Round one clue', answer: 'Alpha' },
    { id: 'people-002', category: 'people', clue: 'Round two clue', answer: 'Beta' },
  ];
  return files;
}

const roster: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

interface Peek {
  attribution: Record<string, { kind: 'truth' | 'fake'; author?: string }>;
}

function introspect(scratch: Record<string, unknown>): {
  truthId: string;
  fakeOf: Record<string, string>;
} {
  const attribution = (scratch as unknown as Peek).attribution;
  const truthId = Object.keys(attribution).find((id) => attribution[id]!.kind === 'truth')!;
  const fakeOf: Record<string, string> = {};
  for (const [id, attr] of Object.entries(attribution)) {
    if (attr.kind === 'fake' && attr.author) fakeOf[attr.author] = id;
  }
  return { truthId, fakeOf };
}

describe('Liar Liar full game', () => {
  it('runs two rounds through the whole lifecycle and ranks the winner', async () => {
    const game: GameModule = await liarLiarPlugin.create(
      createTestServices({ files: clueFiles(), rng: mulberry32(11) }),
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
      game: 'liar-liar',
      phase,
      round,
      players: roster,
      scores,
      scratch,
      config: {},
    });

    let scratch = game.configure({ categories: ['people'], rounds: 2 }, roster).scratch;

    for (let round = 1; round <= 2; round++) {
      scratch = game.startRound(ctx(round, 'collecting', scratch)).scratch;

      // Every player submits a distinct fake; a duplicate is rejected and writes nothing.
      scratch = game.collectAnswer(
        ctx(round, 'collecting', scratch),
        'p1',
        `Fake1-${round}`,
      ).scratch;
      scratch = game.collectAnswer(
        ctx(round, 'collecting', scratch),
        'p2',
        `Fake2-${round}`,
      ).scratch;
      const dup = game.collectAnswer(ctx(round, 'collecting', scratch), 'p3', `fake1-${round}`);
      expect(dup.rejected?.reason).toBe('someone already submitted that');
      scratch = game.collectAnswer(
        ctx(round, 'collecting', scratch),
        'p3',
        `Fake3-${round}`,
      ).scratch;

      expect(game.allAnswered?.(ctx(round, 'collecting', scratch))).toBe(true);

      const revealed = game.reveal(ctx(round, 'collecting', scratch));
      scratch = revealed.scratch;
      apply(revealed.scores); // none at reveal for Liar Liar
      expect(revealed.decision?.windowMs).toBe(30_000);

      const { truthId, fakeOf } = introspect(scratch);
      // p1 and p2 find the truth (+100 each); p3 falls for p1's fake (+50 to p1).
      scratch = game.collectVote(ctx(round, 'guessing', scratch), {
        player: 'p1',
        target: truthId,
        agree: true,
      }).scratch;
      scratch = game.collectVote(ctx(round, 'guessing', scratch), {
        player: 'p2',
        target: truthId,
        agree: true,
      }).scratch;
      scratch = game.collectVote(ctx(round, 'guessing', scratch), {
        player: 'p3',
        target: fakeOf.p1!,
        agree: true,
      }).scratch;

      expect(game.allDecided?.(ctx(round, 'guessing', scratch))).toBe(true);

      const resolved = game.resolveDecision!(ctx(round, 'guessing', scratch));
      scratch = resolved.scratch;
      apply(resolved.scores);

      const standings = game.leaderboard(ctx(round, 'leaderboard', scratch));
      expect(standings).toHaveLength(3);
    }

    // Each round: p1 = 100 (truth) + 50 (fooled p3) = 150; p2 = 100; p3 = 0. Over two rounds:
    expect(scores).toEqual({
      p1: 2 * (CORRECT_POINTS + FOOL_POINTS),
      p2: 2 * CORRECT_POINTS,
      p3: 0,
    });

    const final: Standing[] = game.endGame(ctx(2, 'complete', scratch));
    expect(final[0]).toMatchObject({ player: 'p1', rank: 1, score: 300 });
    expect(final[1]).toMatchObject({ player: 'p2', rank: 2, score: 200 });
    expect(final[2]).toMatchObject({ player: 'p3', rank: 3, score: 0 });
  });
});
