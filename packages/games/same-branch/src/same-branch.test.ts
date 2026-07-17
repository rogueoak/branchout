// Full-lifecycle unit + integration coverage for Same Branch. The module is driven by hand through
// the exact sequence the engine drives - configure -> startRound -> collectMove (hunch + guesses) ->
// allSubmitted -> reveal -> leaderboard -> advance - across multiple rounds with a seeded rng.
//
// The load-bearing test proves the SECRET DISCIPLINE (spec 0052): the bud is delivered ONLY to the
// round's Reader via `startRound().private`, and NEVER appears in the broadcast `prompt`. A
// non-Reader's private entry is absent, so a non-Reader device can never receive the bud.

import { describe, expect, it } from 'vitest';
import { createTestServices } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { sameBranchPlugin } from './same-branch';
import { createSameBranchGame, readerFor } from './same-branch';
import { scoreGuess } from './scoring';
import type { Spectrum } from './spectrums';

const roster: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

/** A tiny deterministic bank spanning enough spectrums for the multi-round tests. */
const testBank: Spectrum[] = [
  { id: 'senses-001', category: 'senses', left: 'cold', right: 'hot' },
  { id: 'senses-002', category: 'senses', left: 'quiet', right: 'loud' },
  { id: 'senses-003', category: 'senses', left: 'dark', right: 'bright' },
  { id: 'nature-001', category: 'nature', left: 'a puddle', right: 'an ocean' },
  { id: 'nature-002', category: 'nature', left: 'a pebble', right: 'a mountain' },
];

function ctxFor(
  module: GameModule,
  scratch: Record<string, unknown>,
  round: number,
  players: SessionPlayer[] = roster,
  scores: Record<string, number> = {},
): RoundContext {
  return {
    room: 'ROOM1',
    game: 'same-branch',
    phase: 'collecting',
    round,
    players,
    scores,
    scratch,
    config: {},
  };
}

/** The bud a startRound dealt this round, read from the Reader's private entry. */
function budFromPrivate(priv: Record<string, unknown> | undefined, reader: string): number {
  const entry = priv?.[reader] as { bud?: number } | undefined;
  if (!entry || typeof entry.bud !== 'number') throw new Error('no bud in reader private entry');
  return entry.bud;
}

describe('configure', () => {
  it('freezes the seat order and returns the round count + move window', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    const result = module.configure({ categories: 'random', rounds: 3 }, roster);
    expect(result.rounds).toBe(3);
    expect(result.moveWindowMs).toBe(120_000);
    expect((result.scratch as { seats: string[] }).seats).toEqual(['p1', 'p2', 'p3']);
  });

  it('throws when the chosen categories cannot cover the round count', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    expect(() => module.configure({ categories: ['nature'], rounds: 5 }, roster)).toThrow(
      /only 2 spectrums/,
    );
  });
});

describe('reader rotation', () => {
  it('rotates the Reader by seat each round', () => {
    expect(readerFor(['p1', 'p2', 'p3'], 0)).toBe('p1');
    expect(readerFor(['p1', 'p2', 'p3'], 1)).toBe('p2');
    expect(readerFor(['p1', 'p2', 'p3'], 2)).toBe('p3');
    // Wraps once past the last seat.
    expect(readerFor(['p1', 'p2', 'p3'], 3)).toBe('p1');
  });

  it('startRound picks the Reader for the round from seat order', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    let scratch = module.configure({ categories: 'random', rounds: 3 }, roster).scratch;
    for (let round = 1; round <= 3; round++) {
      const started = module.startRound(ctxFor(module, scratch, round));
      const prompt = started.prompt as { reader: string };
      expect(prompt.reader).toBe(roster[round - 1]!.player);
      scratch = started.scratch;
    }
  });
});

describe('the bud is a secret delivered only to the Reader (spec 0052)', () => {
  it('puts the bud in the Reader private entry and NEVER in the broadcast prompt', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    const scratch = module.configure({ categories: 'random', rounds: 1 }, roster).scratch;
    const started = module.startRound(ctxFor(module, scratch, 1));

    const prompt = started.prompt as Record<string, unknown>;
    const reader = prompt.reader as string;
    expect(reader).toBe('p1');

    // The broadcast prompt carries the branch ends + who reads, but no bud anywhere in it.
    expect('bud' in prompt).toBe(false);
    expect(JSON.stringify(prompt)).not.toContain('"bud"');

    // The private map has exactly one entry, keyed by the Reader, and it holds the bud.
    const priv = started.private as Record<string, unknown>;
    expect(Object.keys(priv)).toEqual([reader]);
    const bud = budFromPrivate(priv, reader);
    expect(bud).toBeGreaterThanOrEqual(0);
    expect(bud).toBeLessThanOrEqual(100);
  });

  it('never emits a private entry for a non-Reader in any round', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    let scratch = module.configure({ categories: 'random', rounds: 3 }, roster).scratch;
    for (let round = 1; round <= 3; round++) {
      const started = module.startRound(ctxFor(module, scratch, round));
      const reader = (started.prompt as { reader: string }).reader;
      const priv = (started.private ?? {}) as Record<string, unknown>;
      // Exactly the Reader has a secret; every other player is absent from the private map, so the
      // engine has nothing to deliver to a non-Reader's device.
      for (const player of roster) {
        if (player.player === reader) {
          expect(priv[player.player]).toBeDefined();
        } else {
          expect(priv[player.player]).toBeUndefined();
        }
      }
      scratch = started.scratch;
    }
  });
});

describe('collectMove', () => {
  it('records the Reader hunch and rejects an empty one', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    const scratch = module.configure({ categories: 'random', rounds: 1 }, roster).scratch;
    const started = module.startRound(ctxFor(module, scratch, 1));
    const reader = (started.prompt as { reader: string }).reader; // p1

    const empty = module.collectMove(ctxFor(module, started.scratch, 1), reader, '   ');
    expect(empty.rejected?.reason).toMatch(/hunch/);

    const good = module.collectMove(ctxFor(module, started.scratch, 1), reader, 'like a warm bath');
    expect((good.scratch as { hunch: string }).hunch).toBe('like a warm bath');
  });

  it('records a guesser sap-line position clamped to the branch, and rejects a non-number', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    const scratch = module.configure({ categories: 'random', rounds: 1 }, roster).scratch;
    const started = module.startRound(ctxFor(module, scratch, 1));

    const bad = module.collectMove(ctxFor(module, started.scratch, 1), 'p2', 'nope');
    expect(bad.rejected?.reason).toMatch(/sap line/);

    const clamped = module.collectMove(ctxFor(module, started.scratch, 1), 'p2', '150');
    expect((clamped.scratch as { guesses: Record<string, number> }).guesses.p2).toBe(100);
  });
});

describe('allSubmitted', () => {
  it('is true only once the Reader gave a hunch and every guesser set a position', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    let scratch = module.configure({ categories: 'random', rounds: 1 }, roster).scratch;
    scratch = module.startRound(ctxFor(module, scratch, 1)).scratch;

    expect(module.allSubmitted!(ctxFor(module, scratch, 1))).toBe(false);
    scratch = module.collectMove(ctxFor(module, scratch, 1), 'p1', 'a clue').scratch;
    expect(module.allSubmitted!(ctxFor(module, scratch, 1))).toBe(false);
    scratch = module.collectMove(ctxFor(module, scratch, 1), 'p2', '40').scratch;
    expect(module.allSubmitted!(ctxFor(module, scratch, 1))).toBe(false);
    scratch = module.collectMove(ctxFor(module, scratch, 1), 'p3', '60').scratch;
    expect(module.allSubmitted!(ctxFor(module, scratch, 1))).toBe(true);
  });
});

describe('reveal scores by closeness and never leaks the bud early', () => {
  it('awards each guesser the band points for their distance and reveals the bud only now', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    const scratch0 = module.configure({ categories: 'random', rounds: 1 }, roster).scratch;
    const started = module.startRound(ctxFor(module, scratch0, 1));
    const reader = (started.prompt as { reader: string }).reader; // p1
    const bud = budFromPrivate(started.private as Record<string, unknown>, reader);

    let scratch = module.collectMove(ctxFor(module, started.scratch, 1), reader, 'warm').scratch;
    // p2 lands a bullseye, p3 lands a miss.
    scratch = module.collectMove(ctxFor(module, scratch, 1), 'p2', String(bud)).scratch;
    const missPos = bud > 50 ? bud - 40 : bud + 40;
    scratch = module.collectMove(ctxFor(module, scratch, 1), 'p3', String(missPos)).scratch;

    const revealed = module.reveal(ctxFor(module, scratch, 1));
    const reveal = revealed.reveal as {
      bud: number;
      guesses: { player: string; points: number }[];
    };
    expect(reveal.bud).toBe(bud);

    const scoreOf = (p: string) => revealed.scores.find((s) => s.player === p)?.points ?? 0;
    expect(scoreOf('p2')).toBe(scoreGuess(bud, bud)); // 4, bullseye
    expect(scoreOf('p2')).toBe(4);
    expect(scoreOf('p3')).toBe(scoreGuess(bud, missPos)); // 0, miss
    // The Reader is not a guesser and scores nothing.
    expect(revealed.scores.find((s) => s.player === reader)).toBeUndefined();
  });
});

describe('a full two-round free game reaches final standings through real moves', () => {
  it('scores across rounds and ranks the winner', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    let scratch = module.configure({ categories: 'random', rounds: 2 }, roster).scratch;
    const scores: Record<string, number> = {};

    for (let round = 1; round <= 2; round++) {
      const started = module.startRound(ctxFor(module, scratch, round, roster, scores));
      const reader = (started.prompt as { reader: string }).reader;
      const bud = budFromPrivate(started.private as Record<string, unknown>, reader);
      scratch = started.scratch;
      scratch = module.collectMove(
        ctxFor(module, scratch, round, roster, scores),
        reader,
        'hint',
      ).scratch;
      // Every non-Reader guesses the exact bud -> a bullseye each, so scoring accrues really.
      for (const p of roster) {
        if (p.player === reader) continue;
        scratch = module.collectMove(
          ctxFor(module, scratch, round, roster, scores),
          p.player,
          String(bud),
        ).scratch;
      }
      const revealed = module.reveal(ctxFor(module, scratch, round, roster, scores));
      scratch = revealed.scratch;
      for (const s of revealed.scores) scores[s.player] = (scores[s.player] ?? 0) + s.points;

      const done = module.advance(ctxFor(module, scratch, round, roster, scores)).done;
      expect(done).toBe(round === 2);
    }

    // Each player was Reader once (round 1: p1, round 2: p2) and a bullseye guesser once, except p3
    // who guessed a bullseye both rounds. So p3 has the most points.
    const final = module.endGame(ctxFor(module, scratch, 2, roster, scores));
    const top = final.find((s) => s.rank === 1);
    expect(top?.player).toBe('p3');
    expect(top?.score).toBeGreaterThan(0);
  });
});

describe('coop mode pools the grove score onto one shared rank', () => {
  it('gives every player the same total and rank 1', () => {
    const module = createSameBranchGame(testBank, () => 0.5);
    let scratch = module.configure(
      { categories: 'random', rounds: 1, mode: 'coop' },
      roster,
    ).scratch;
    const started = module.startRound(ctxFor(module, scratch, 1));
    const reader = (started.prompt as { reader: string }).reader;
    const bud = budFromPrivate(started.private as Record<string, unknown>, reader);
    scratch = module.collectMove(ctxFor(module, started.scratch, 1), reader, 'x').scratch;
    const scores: Record<string, number> = {};
    for (const p of roster) {
      if (p.player === reader) continue;
      scratch = module.collectMove(ctxFor(module, scratch, 1), p.player, String(bud)).scratch;
    }
    const revealed = module.reveal(ctxFor(module, scratch, 1, roster, scores));
    for (const s of revealed.scores) scores[s.player] = (scores[s.player] ?? 0) + s.points;

    const final = module.endGame(ctxFor(module, revealed.scratch, 1, roster, scores));
    const total = final[0]!.score;
    expect(total).toBeGreaterThan(0);
    for (const row of final) {
      expect(row.score).toBe(total);
      expect(row.rank).toBe(1);
    }
  });
});

describe('the plugin manifest', () => {
  it('is insider, 2-8 players, versioned', () => {
    expect(sameBranchPlugin.manifest.visibility).toBe('insider');
    expect(sameBranchPlugin.manifest.capabilities?.minPlayers).toBe(2);
    expect(sameBranchPlugin.manifest.capabilities?.maxPlayers).toBe(8);
    expect(sameBranchPlugin.manifest.version).toBe('1.0.0');
  });

  it('builds via create() over the injected asset loader', async () => {
    const files: Record<string, unknown> = {
      'data/same-branch/senses.json': testBank.filter((s) => s.category === 'senses'),
      'data/same-branch/nature.json': testBank.filter((s) => s.category === 'nature'),
      'data/same-branch/feelings.json': [],
      'data/same-branch/everyday.json': [],
      'data/same-branch/people.json': [],
      'data/same-branch/wild.json': [],
    };
    const module = await sameBranchPlugin.create(createTestServices({ files }));
    expect(module.id).toBe('same-branch');
  });
});
