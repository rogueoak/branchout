import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from '../../lifecycle';
import { CATEGORIES, type Difficulty, type TriviaQuestion } from '../../question-bank';
import { blendWeights } from './difficulty';
import { createTriviaGame, DISPUTE_WINDOW_MS, MAX_ROUNDS, validateConfig } from './trivia';

/** Deterministic PRNG so an entire game replays identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS: Difficulty[] = ['easy', 'medium', 'hard'];

/** A synthetic bank: `perTier` questions per tier per category, ids `<cat>-<tier>-<n>`. */
function makeBank(perTier: number): TriviaQuestion[] {
  const out: TriviaQuestion[] = [];
  for (const category of CATEGORIES) {
    for (const tier of TIERS) {
      for (let n = 0; n < perTier; n += 1) {
        const id = `${category.toLowerCase()}-${tier}-${n}`;
        out.push({ id, category, prompt: `${id}?`, answers: [`${id}-answer`], difficulty: tier });
      }
    }
  }
  return out;
}

const players: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

function ctx(
  scratch: Record<string, unknown>,
  overrides: Partial<RoundContext> = {},
): RoundContext {
  return {
    room: 'r1',
    game: 'trivia',
    phase: 'collecting',
    round: 1,
    players,
    scores: { p1: 0, p2: 0, p3: 0 },
    scratch,
    config: {},
    ...overrides,
  };
}

interface StoredQuestionView {
  id: string;
  category: string;
  difficulty: Difficulty;
}

/** Read the question the module drew for a round out of persisted scratch. */
function questionAt(scratch: Record<string, unknown>, round: number): StoredQuestionView {
  const questions = (scratch as { questions?: Record<string, StoredQuestionView> }).questions ?? {};
  const q = questions[String(round)];
  if (!q) throw new Error(`no question drawn for round ${round}`);
  return q;
}

describe('validateConfig', () => {
  it('defaults rounds to 10 and difficulty to 5', () => {
    expect(validateConfig({ category: 'Science' })).toEqual({
      category: 'Science',
      rounds: 10,
      difficulty: 5,
    });
  });

  it('accepts Random and every named category', () => {
    for (const category of [...CATEGORIES, 'Random']) {
      expect(validateConfig({ category }).category).toBe(category);
    }
  });

  it('rejects an unknown category', () => {
    expect(() => validateConfig({ category: 'Sportsball' })).toThrow();
    expect(() => validateConfig({})).toThrow();
    expect(() => validateConfig({ category: 5 })).toThrow();
  });

  it('rejects rounds outside 1-100', () => {
    expect(() => validateConfig({ category: 'Food', rounds: 0 })).toThrow();
    expect(() => validateConfig({ category: 'Food', rounds: 101 })).toThrow();
    expect(() => validateConfig({ category: 'Food', rounds: 3.5 })).toThrow();
    expect(validateConfig({ category: 'Food', rounds: 1 }).rounds).toBe(1);
    expect(validateConfig({ category: 'Food', rounds: MAX_ROUNDS }).rounds).toBe(MAX_ROUNDS);
  });

  it('rejects difficulty outside 1-10', () => {
    expect(() => validateConfig({ category: 'Food', difficulty: 0 })).toThrow();
    expect(() => validateConfig({ category: 'Food', difficulty: 11 })).toThrow();
  });
});

describe('configure', () => {
  it('sets the 10-second dispute window and passes the round count through', () => {
    const game = createTriviaGame(makeBank(2));
    const result = game.configure({ category: 'Food', rounds: 7 }, players);
    expect(result.rounds).toBe(7);
    expect(result.disputeWindowMs).toBe(DISPUTE_WINDOW_MS);
  });

  it('throws on invalid config so the engine rejects the start', () => {
    const game = createTriviaGame(makeBank(2));
    expect(() => game.configure({ category: 'Nope' }, players)).toThrow();
  });
});

describe('reveal scoring', () => {
  const game = createTriviaGame(makeBank(2), mulberry32(1));

  it('awards 100 for a correct (incl. fuzzy) answer and nothing for a wrong one', () => {
    let scratch = game.configure({ category: 'Nature', difficulty: 5 }, players).scratch;
    const started = game.startRound(ctx(scratch));
    scratch = started.scratch;
    const answer = (started.prompt as { question: string }).question.replace('?', '-answer');

    scratch = game.collectAnswer(ctx(scratch), 'p1', answer).scratch; // exact
    scratch = game.collectAnswer(ctx(scratch), 'p2', answer.slice(0, -1)).scratch; // 1-edit typo
    scratch = game.collectAnswer(ctx(scratch), 'p3', 'totally wrong').scratch;

    const revealed = game.reveal(ctx(scratch));
    const scored = new Set(revealed.scores.map((s) => s.player));
    expect(scored).toEqual(new Set(['p1', 'p2']));
    expect(revealed.scores.every((s) => s.points === 100 && s.reason === 'correct answer')).toBe(
      true,
    );
    const reveal = revealed.reveal as { wrong: string[] };
    expect(reveal.wrong).toEqual(['p3']);
  });
});

describe('dispute resolution', () => {
  const game = createTriviaGame(makeBank(2), mulberry32(3));

  // p1 answers correctly; p2 and p3 are wrong. p2 disputes; p1 and p3 are the "other" voters.
  function setup(): Record<string, unknown> {
    const scratch = game.configure({ category: 'Nature' }, players).scratch;
    let s = game.startRound(ctx(scratch)).scratch;
    const answer = `${questionAt(s, 1).id}-answer`;
    s = game.collectAnswer(ctx(s), 'p1', answer).scratch;
    s = game.collectAnswer(ctx(s), 'p2', 'wrong-a').scratch;
    s = game.collectAnswer(ctx(s), 'p3', 'wrong-b').scratch;
    return game.reveal(ctx(s)).scratch;
  }

  it('upholds a dispute when a majority of the other players agree (50 points)', () => {
    let s = setup();
    s = game.collectVote(ctx(s, { phase: 'disputing' }), {
      player: 'p2',
      target: 'p2',
      agree: true,
    }).scratch;
    expect(game.disputeWindow(ctx(s, { phase: 'disputing' })).disputes).toEqual(['p2']);

    // Both other players (p1, p3) agree -> majority.
    s = game.collectVote(ctx(s, { phase: 'voting' }), {
      player: 'p1',
      target: 'p2',
      agree: true,
    }).scratch;
    s = game.collectVote(ctx(s, { phase: 'voting' }), {
      player: 'p3',
      target: 'p2',
      agree: true,
    }).scratch;
    const result = game.disputeVote(ctx(s, { phase: 'voting' }));
    expect(result.scores).toEqual([{ player: 'p2', points: 50, reason: 'dispute upheld' }]);
    expect((result.reveal as { upheld: string[] }).upheld).toEqual(['p2']);
  });

  it('awards nothing on a tie (half of the other players agree)', () => {
    let s = setup();
    s = game.collectVote(ctx(s, { phase: 'disputing' }), {
      player: 'p2',
      target: 'p2',
      agree: true,
    }).scratch;
    // Only one of the two other players agrees -> 1 of 2 is not a strict majority (tie).
    s = game.collectVote(ctx(s, { phase: 'voting' }), {
      player: 'p1',
      target: 'p2',
      agree: true,
    }).scratch;
    s = game.collectVote(ctx(s, { phase: 'voting' }), {
      player: 'p3',
      target: 'p2',
      agree: false,
    }).scratch;
    expect(game.disputeVote(ctx(s, { phase: 'voting' })).scores).toEqual([]);
  });

  it('has no disputes when nobody raises one', () => {
    const s = setup();
    expect(game.disputeWindow(ctx(s, { phase: 'disputing' })).disputes).toEqual([]);
    expect(game.disputeVote(ctx(s, { phase: 'voting' })).scores).toEqual([]);
  });

  it('ignores a dispute from a player who was not marked wrong', () => {
    let s = setup();
    // p1 answered correctly; they cannot dispute.
    s = game.collectVote(ctx(s, { phase: 'disputing' }), {
      player: 'p1',
      target: 'p1',
      agree: true,
    }).scratch;
    expect(game.disputeWindow(ctx(s, { phase: 'disputing' })).disputes).toEqual([]);
  });

  it('ignores a ballot cast by the disputer on themselves', () => {
    let s = setup();
    s = game.collectVote(ctx(s, { phase: 'disputing' }), {
      player: 'p2',
      target: 'p2',
      agree: true,
    }).scratch;
    // Self-vote must not count toward the majority.
    s = game.collectVote(ctx(s, { phase: 'voting' }), {
      player: 'p2',
      target: 'p2',
      agree: true,
    }).scratch;
    s = game.collectVote(ctx(s, { phase: 'voting' }), {
      player: 'p1',
      target: 'p2',
      agree: true,
    }).scratch;
    // Only p1 (a real other voter) agreed: 1 of 2 others -> no majority.
    expect(game.disputeVote(ctx(s, { phase: 'voting' })).scores).toEqual([]);
  });
});

describe('end-game ranking', () => {
  const game = createTriviaGame(makeBank(2));

  it('ranks by score, highest first, with shared ranks on ties', () => {
    const standings = game.endGame(ctx({}, { scores: { p1: 200, p2: 200, p3: 50 } }));
    const byPlayer = Object.fromEntries(standings.map((s) => [s.player, s.rank]));
    expect(byPlayer.p1).toBe(1);
    expect(byPlayer.p2).toBe(1); // tie for first
    expect(byPlayer.p3).toBe(3); // rank skips 2 (competition ranking)
  });

  it('advance reports done only on the final round', () => {
    const scratch = game.configure({ category: 'Food', rounds: 3 }, players).scratch;
    expect(game.advance(ctx(scratch, { round: 2 })).done).toBe(false);
    expect(game.advance(ctx(scratch, { round: 3 })).done).toBe(true);
  });
});

describe('no-repeat selection over a full game', () => {
  it('never repeats a question across a 100-round single-category game', () => {
    const game = createTriviaGame(makeBank(40), mulberry32(42)); // 120 per category
    let scratch = game.configure({ category: 'Science', rounds: MAX_ROUNDS }, players).scratch;
    const seen = new Set<string>();
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
      const q = questionAt(scratch, round);
      expect(seen.has(q.id)).toBe(false);
      expect(q.category).toBe('Science');
      seen.add(q.id);
    }
    expect(seen.size).toBe(MAX_ROUNDS);
  });

  it('Random draws across all categories and never repeats', () => {
    const game = createTriviaGame(makeBank(5), mulberry32(7));
    let scratch = game.configure({ category: 'Random', rounds: MAX_ROUNDS }, players).scratch;
    const seen = new Set<string>();
    const categories = new Set<string>();
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
      const q = questionAt(scratch, round);
      expect(seen.has(q.id)).toBe(false);
      seen.add(q.id);
      categories.add(q.category);
    }
    expect(seen.size).toBe(MAX_ROUNDS);
    expect(categories.size).toBeGreaterThan(1); // genuinely spanned categories
  });

  it('draws difficulty tiers matching the blend table over a full game', () => {
    // Plenty of questions per tier so no fallback distorts the draw; measure the sampled tier.
    const game = createTriviaGame(makeBank(50), mulberry32(99));
    const difficulty = 8;
    let scratch = game.configure(
      { category: 'People', rounds: MAX_ROUNDS, difficulty },
      players,
    ).scratch;
    const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
      counts[questionAt(scratch, round).difficulty] += 1;
    }
    const [easy, medium, hard] = blendWeights(difficulty);
    // 100 draws is noisy; assert the ordering the 15/37/48 table implies rather than tight bands.
    expect(counts.hard).toBeGreaterThan(counts.medium);
    expect(counts.medium).toBeGreaterThan(counts.easy);
    // Sanity: totals add up and roughly track the weights (wide tolerance for n=100).
    expect(counts.easy + counts.medium + counts.hard).toBe(MAX_ROUNDS);
    expect(Math.abs(counts.easy - easy)).toBeLessThan(15);
    expect(Math.abs(counts.hard - hard)).toBeLessThan(20);
    void medium;
  });
});
