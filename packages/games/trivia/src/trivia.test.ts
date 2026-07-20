import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { CATEGORIES, type TriviaQuestion } from './question-bank';
import { createTriviaGame, MAX_ROUNDS, validateConfig } from './trivia';

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

// Three representative ratings standing in for easy/medium/hard on the 1-10 scale. `5` sits inside
// the default 4-6 range; `2` and `9` are the nearest widening targets on either side.
const RATINGS = [2, 5, 9] as const;

/** A synthetic bank: `perRating` questions at each of the 3 ratings per category (so 3*perRating
 *  per category), ids `<cat>-<rating>-<n>`. */
function makeBank(perRating: number): TriviaQuestion[] {
  const out: TriviaQuestion[] = [];
  for (const category of CATEGORIES) {
    for (const rating of RATINGS) {
      for (let n = 0; n < perRating; n += 1) {
        const id = `${category.toLowerCase()}-${rating}-${n}`;
        out.push({ id, category, prompt: `${id}?`, answers: [`${id}-answer`], difficulty: rating });
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
  difficulty: number;
}

/** Read the question the module drew for a round out of persisted scratch. */
function questionAt(scratch: Record<string, unknown>, round: number): StoredQuestionView {
  const questions = (scratch as { questions?: Record<string, StoredQuestionView> }).questions ?? {};
  const q = questions[String(round)];
  if (!q) throw new Error(`no question drawn for round ${round}`);
  return q;
}

describe('validateConfig', () => {
  it('defaults to Random, 10 rounds, difficulty 3-6, auto-advance on at 5s, 60s answer window', () => {
    expect(validateConfig({})).toEqual({
      categories: [],
      rounds: 10,
      difficultyMin: 3,
      difficultyMax: 6,
      autoAdvance: true,
      advanceAfterMs: 5_000,
      timeLimitMs: 60_000,
    });
  });

  it('resolves a single-category subset', () => {
    expect(validateConfig({ categories: ['Science'] }).categories).toEqual(['Science']);
  });

  it('resolves a multi-category subset, de-duplicating and dropping the Random sentinel', () => {
    expect(validateConfig({ categories: ['Science', 'Food', 'Science'] }).categories).toEqual([
      'Science',
      'Food',
    ]);
    // A stray `Random` in the list means "all", so it drops out and leaves the empty (Random) subset.
    expect(validateConfig({ categories: ['Random'] }).categories).toEqual([]);
    expect(validateConfig({ categories: [] }).categories).toEqual([]);
  });

  it('accepts the legacy single `category` field (Random -> all, named -> that one)', () => {
    expect(validateConfig({ category: 'Random' }).categories).toEqual([]);
    for (const category of CATEGORIES) {
      expect(validateConfig({ category }).categories).toEqual([category]);
    }
  });

  it('rejects an unknown category, in either the subset or the legacy field', () => {
    expect(() => validateConfig({ categories: ['Sportsball'] })).toThrow();
    expect(() => validateConfig({ categories: ['Science', 'Nope'] })).toThrow();
    expect(() => validateConfig({ category: 'Sportsball' })).toThrow();
  });

  it('rejects rounds outside 1-100', () => {
    expect(() => validateConfig({ rounds: 0 })).toThrow();
    expect(() => validateConfig({ rounds: 101 })).toThrow();
    expect(() => validateConfig({ rounds: 3.5 })).toThrow();
    expect(validateConfig({ rounds: 1 }).rounds).toBe(1);
    expect(validateConfig({ rounds: MAX_ROUNDS }).rounds).toBe(MAX_ROUNDS);
  });

  it('rejects a difficulty range outside 1-10 or with min > max', () => {
    expect(() => validateConfig({ difficultyMin: 0, difficultyMax: 6 })).toThrow();
    expect(() => validateConfig({ difficultyMin: 4, difficultyMax: 11 })).toThrow();
    expect(() => validateConfig({ difficultyMin: 7, difficultyMax: 4 })).toThrow();
    expect(() => validateConfig({ difficultyMin: 4.5, difficultyMax: 6 })).toThrow();
    // A valid custom range passes through.
    expect(validateConfig({ difficultyMin: 3, difficultyMax: 8 })).toMatchObject({
      difficultyMin: 3,
      difficultyMax: 8,
    });
  });

  it('validates the auto-advance pacing fields and resolves them to ms', () => {
    expect(validateConfig({ autoAdvance: false }).autoAdvance).toBe(false);
    expect(validateConfig({ advanceAfterSeconds: 12 }).advanceAfterMs).toBe(12_000);
    expect(validateConfig({ timeLimitSeconds: 30 }).timeLimitMs).toBe(30_000);
    // Bounds: advance-after 1-60, time-limit 10-180.
    expect(() => validateConfig({ advanceAfterSeconds: 0 })).toThrow();
    expect(() => validateConfig({ advanceAfterSeconds: 61 })).toThrow();
    expect(() => validateConfig({ timeLimitSeconds: 9 })).toThrow();
    expect(() => validateConfig({ timeLimitSeconds: 181 })).toThrow();
    expect(() => validateConfig({ advanceAfterSeconds: 5.5 })).toThrow();
  });
});

describe('configure', () => {
  it('maps the answer window and auto-advance dwell from the config', () => {
    const game = createTriviaGame(makeBank(4));
    const result = game.configure({ category: 'Food', rounds: 7 }, players);
    expect(result.rounds).toBe(7);
    // Defaults: 60s answer window, 5s dwell for the answer-screen and leaderboard hops.
    expect(result.moveWindowMs).toBe(60_000);
    expect(result.disputeWindowMs).toBe(5_000);
    expect(result.leaderboardWindowMs).toBe(5_000);
  });

  it('honors custom pacing and turns the dwell off when auto-advance is off', () => {
    const game = createTriviaGame(makeBank(4));
    const on = game.configure(
      { categories: ['Food'], advanceAfterSeconds: 8, timeLimitSeconds: 20 },
      players,
    );
    expect(on.moveWindowMs).toBe(20_000);
    expect(on.disputeWindowMs).toBe(8_000);
    expect(on.leaderboardWindowMs).toBe(8_000);
    // Auto-advance off: both dwell windows go host-manual (0); the answer window still stands.
    const off = game.configure({ categories: ['Food'], autoAdvance: false }, players);
    expect(off.disputeWindowMs).toBe(0);
    expect(off.leaderboardWindowMs).toBe(0);
    expect(off.moveWindowMs).toBe(60_000);
  });

  it('throws on invalid config so the engine rejects the start', () => {
    const game = createTriviaGame(makeBank(4));
    expect(() => game.configure({ categories: ['Nope'] }, players)).toThrow();
  });

  it('rejects more rounds than the chosen categories have questions', () => {
    const game = createTriviaGame(makeBank(1)); // 3 per category, 24 across Random
    expect(() => game.configure({ categories: ['Nature'], rounds: 4 }, players)).toThrow(
      /fewer than/,
    );
    expect(game.configure({ categories: ['Nature'], rounds: 3 }, players).rounds).toBe(3);
    // Two categories pool their questions (3 + 3 = 6), so a 4-round game now fits.
    expect(() =>
      game.configure({ categories: ['Nature', 'Food'], rounds: 4 }, players),
    ).not.toThrow();
    // Random spans every category, so the same round count fits.
    expect(() => game.configure({ categories: [], rounds: 4 }, players)).not.toThrow();
  });

  it('draws only from the selected category subset', () => {
    const game = createTriviaGame(makeBank(4), mulberry32(7));
    let scratch = game.configure({ categories: ['Nature', 'Food'], rounds: 6 }, players).scratch;
    const drawn = new Set<string>();
    for (let round = 1; round <= 6; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
      drawn.add(questionAt(scratch, round).category);
    }
    expect([...drawn].sort()).toEqual(['Food', 'Nature']);
  });
});

describe('question exhaustion (defensive)', () => {
  it('throws from startRound if the pool is somehow drained mid-game', () => {
    // configure guards against this, so drive startRound past the pool directly.
    const game = createTriviaGame(makeBank(1)); // Nature has 3 questions
    let scratch = game.configure({ category: 'Nature', rounds: 3 }, players).scratch;
    for (let round = 1; round <= 3; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
    }
    expect(() => game.startRound(ctx(scratch, { round: 4 }))).toThrow(/ran out of questions/);
  });
});

describe('reveal scoring', () => {
  const game = createTriviaGame(makeBank(4), mulberry32(1));

  it('awards 100 for a correct (incl. fuzzy) answer and nothing for a wrong one', () => {
    let scratch = game.configure({ category: 'Nature' }, players).scratch;
    const started = game.startRound(ctx(scratch));
    scratch = started.scratch;
    const answer = (started.prompt as { question: string }).question.replace('?', '-answer');

    scratch = game.collectMove(ctx(scratch), 'p1', answer).scratch; // exact
    scratch = game.collectMove(ctx(scratch), 'p2', answer.slice(0, -1)).scratch; // 1-edit typo
    scratch = game.collectMove(ctx(scratch), 'p3', 'totally wrong').scratch;

    const revealed = game.reveal(ctx(scratch));
    const scored = new Set(revealed.scores.map((s) => s.player));
    expect(scored).toEqual(new Set(['p1', 'p2']));
    expect(revealed.scores.every((s) => s.points === 100 && s.reason === 'correct answer')).toBe(
      true,
    );
    const reveal = revealed.reveal as {
      wrong: string[];
      submissions: { player: string; answer: string; correct: boolean }[];
    };
    expect(reveal.wrong).toEqual(['p3']);
    // The reveal carries every player's submitted answer + verdict, so the table sees them all.
    expect(reveal.submissions).toEqual([
      { player: 'p1', answer, correct: true },
      { player: 'p2', answer: answer.slice(0, -1), correct: true },
      { player: 'p3', answer: 'totally wrong', correct: false },
    ]);
  });

  it('marks a blank submission wrong and excludes a non-submitter entirely', () => {
    let scratch = game.configure({ category: 'Nature' }, players).scratch;
    const started = game.startRound(ctx(scratch));
    scratch = started.scratch;
    const answer = (started.prompt as { question: string }).question.replace('?', '-answer');

    scratch = game.collectMove(ctx(scratch), 'p1', answer).scratch; // correct
    scratch = game.collectMove(ctx(scratch), 'p2', '   ').scratch; // blank -> wrong
    // p3 never submits.

    const revealed = game.reveal(ctx(scratch));
    const reveal = revealed.reveal as { correct: string[]; wrong: string[] };
    expect(reveal.correct).toEqual(['p1']);
    expect(reveal.wrong).toEqual(['p2']); // blank is dispute-eligible; p3 is absent from both
    expect(revealed.scores.map((s) => s.player)).toEqual(['p1']);
  });

  // The "I don't know" give-up (WS16) submits the empty-string sentinel. It must always score wrong -
  // no points - and, being a real submission, keep the player in the reveal (locked out, not absent).
  it('scores the empty-string give-up sentinel wrong with no points', () => {
    let scratch = game.configure({ category: 'Nature' }, players).scratch;
    const started = game.startRound(ctx(scratch));
    scratch = started.scratch;
    const answer = (started.prompt as { question: string }).question.replace('?', '-answer');

    scratch = game.collectMove(ctx(scratch), 'p1', answer).scratch; // correct
    scratch = game.collectMove(ctx(scratch), 'p2', '').scratch; // give-up sentinel -> wrong

    const revealed = game.reveal(ctx(scratch));
    const reveal = revealed.reveal as {
      correct: string[];
      wrong: string[];
      submissions: { player: string; answer: string; correct: boolean }[];
    };
    expect(reveal.wrong).toEqual(['p2']);
    // The give-up earns nothing, so p2 is not among the scored players.
    expect(revealed.scores.map((s) => s.player)).toEqual(['p1']);
    // It is a real submission: p2 stays in the reveal table (a give-up, not an absence).
    expect(reveal.submissions).toContainEqual({ player: 'p2', answer: '', correct: false });
  });
});

describe('dispute resolution', () => {
  const game = createTriviaGame(makeBank(4), mulberry32(3));

  // p1 answers correctly; p2 and p3 are wrong. p2 disputes; p1 and p3 are the "other" voters.
  function setup(): Record<string, unknown> {
    const scratch = game.configure({ category: 'Nature' }, players).scratch;
    let s = game.startRound(ctx(scratch)).scratch;
    const answer = `${questionAt(s, 1).id}-answer`;
    s = game.collectMove(ctx(s), 'p1', answer).scratch;
    s = game.collectMove(ctx(s), 'p2', 'wrong-a').scratch;
    s = game.collectMove(ctx(s), 'p3', 'wrong-b').scratch;
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

// A 3-player roster keeps "others" = 2, where several wrong majority denominators collapse to the
// same verdict. These tests use 4-5 players so the denominator is genuinely falsifiable: the
// majority is of the *other connected* players, not the ballots cast nor the whole roster.
describe('dispute majority denominator (larger rosters)', () => {
  const game = createTriviaGame(makeBank(4), mulberry32(11));

  function roster(n: number, disconnected: string[] = []): SessionPlayer[] {
    return Array.from({ length: n }, (_, i) => {
      const id = `p${i + 1}`;
      return { player: id, nickname: id, connected: !disconnected.includes(id) };
    });
  }

  /** Play a round where p1 is correct and everyone else is wrong; return post-reveal scratch. */
  function toReveal(seats: SessionPlayer[]): Record<string, unknown> {
    const scores = Object.fromEntries(seats.map((p) => [p.player, 0]));
    const c = (s: Record<string, unknown>, phase: RoundContext['phase'] = 'collecting') =>
      ctx(s, { players: seats, scores, phase });
    let s = game.configure({ category: 'Nature' }, seats).scratch;
    s = game.startRound(c(s)).scratch;
    const answer = `${questionAt(s, 1).id}-answer`;
    s = game.collectMove(c(s), 'p1', answer).scratch;
    for (const p of seats.slice(1)) s = game.collectMove(c(s), p.player, 'nope').scratch;
    return game.reveal(c(s)).scratch;
  }

  function dispute(
    seats: SessionPlayer[],
    disputer: string,
    agreers: string[],
    disagreers: string[] = [],
  ) {
    const scores = Object.fromEntries(seats.map((p) => [p.player, 0]));
    const c = (s: Record<string, unknown>, phase: RoundContext['phase']) =>
      ctx(s, { players: seats, scores, phase });
    let s = toReveal(seats);
    s = game.collectVote(c(s, 'disputing'), {
      player: disputer,
      target: disputer,
      agree: true,
    }).scratch;
    for (const v of agreers)
      s = game.collectVote(c(s, 'voting'), { player: v, target: disputer, agree: true }).scratch;
    for (const v of disagreers)
      s = game.collectVote(c(s, 'voting'), { player: v, target: disputer, agree: false }).scratch;
    return game.disputeVote(c(s, 'voting'));
  }

  it('upholds when 2 of 3 other players agree (not caught by an all-players denominator)', () => {
    // 4 players, disputer p2, others {p1,p3,p4}. 2 agree, 1 silent: 2*2 > 3 upholds.
    const result = dispute(roster(4), 'p2', ['p1', 'p3']);
    expect(result.scores).toEqual([{ player: 'p2', points: 50, reason: 'dispute upheld' }]);
  });

  it('awards nothing when only 1 of 3 agrees and 2 stay silent (not ballots-cast)', () => {
    // If the denominator were "ballots cast" (=1), this would wrongly uphold. Others=3: 1*2 !> 3.
    const result = dispute(roster(4), 'p2', ['p1']);
    expect(result.scores).toEqual([]);
  });

  it('counts only connected others, so a disconnected player cannot block a dispute', () => {
    // 5 players, p5 disconnected. Connected others of p2 = {p1,p3,p4} = 3. 2 agree, 1 silent:
    // 2*2 > 3 upholds. Were the offline p5 counted (others=4), 2*2 !> 4 would wrongly fail.
    const result = dispute(roster(5, ['p5']), 'p2', ['p1', 'p3']);
    expect(result.scores).toEqual([{ player: 'p2', points: 50, reason: 'dispute upheld' }]);
  });

  it('resolves multiple disputers independently in one round', () => {
    // p2 and p3 both dispute (4 players). p2's others {p1,p3,p4}: 2 agree -> upheld.
    // p3's others {p1,p2,p4}: only 1 agrees -> not upheld.
    const seats = roster(4);
    const scores = Object.fromEntries(seats.map((p) => [p.player, 0]));
    const c = (s: Record<string, unknown>, phase: RoundContext['phase']) =>
      ctx(s, { players: seats, scores, phase });
    let s = toReveal(seats);
    s = game.collectVote(c(s, 'disputing'), { player: 'p2', target: 'p2', agree: true }).scratch;
    s = game.collectVote(c(s, 'disputing'), { player: 'p3', target: 'p3', agree: true }).scratch;
    expect(new Set(game.disputeWindow(c(s, 'disputing')).disputes)).toEqual(new Set(['p2', 'p3']));
    // p2 upheld by p1 + p4.
    s = game.collectVote(c(s, 'voting'), { player: 'p1', target: 'p2', agree: true }).scratch;
    s = game.collectVote(c(s, 'voting'), { player: 'p4', target: 'p2', agree: true }).scratch;
    // p3 supported by only p1.
    s = game.collectVote(c(s, 'voting'), { player: 'p1', target: 'p3', agree: true }).scratch;
    const result = game.disputeVote(c(s, 'voting'));
    expect(result.scores).toEqual([{ player: 'p2', points: 50, reason: 'dispute upheld' }]);
    expect((result.reveal as { upheld: string[] }).upheld).toEqual(['p2']);
  });
});

describe('end-game ranking', () => {
  const game = createTriviaGame(makeBank(4));

  it('ranks distinct scores strictly highest-first (1/2/3)', () => {
    const standings = game.endGame(ctx({}, { scores: { p1: 100, p2: 250, p3: 50 } }));
    expect(standings.map((s) => [s.player, s.rank])).toEqual([
      ['p2', 1],
      ['p1', 2],
      ['p3', 3],
    ]);
  });

  it('ranks by score, highest first, with shared ranks on ties', () => {
    const standings = game.endGame(ctx({}, { scores: { p1: 200, p2: 200, p3: 50 } }));
    const byPlayer = Object.fromEntries(standings.map((s) => [s.player, s.rank]));
    expect(byPlayer.p1).toBe(1);
    expect(byPlayer.p2).toBe(1); // tie for first
    expect(byPlayer.p3).toBe(3); // rank skips 2 (competition ranking)
  });

  it('leaderboard between rounds reflects current scores', () => {
    const standings = game.leaderboard(ctx({}, { scores: { p1: 100, p2: 300, p3: 200 } }));
    expect(standings.map((s) => s.player)).toEqual(['p2', 'p3', 'p1']);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(standings.find((s) => s.player === 'p2')?.score).toBe(300);
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

  it('draws only questions whose rating falls in the configured range', () => {
    // makeBank(50) gives 50 questions at each rating {2, 5, 9} per category. With the range set to
    // 8-10 and 40 rounds (<= the 50 rated 9), every draw stays in range - no widening.
    const game = createTriviaGame(makeBank(50), mulberry32(99));
    let scratch = game.configure(
      { category: 'People', rounds: 40, difficultyMin: 8, difficultyMax: 10 },
      players,
    ).scratch;
    for (let round = 1; round <= 40; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
      const rating = questionAt(scratch, round).difficulty;
      expect(rating).toBeGreaterThanOrEqual(8);
      expect(rating).toBeLessThanOrEqual(10);
    }
  });

  it('widens to the nearest rating when the range is exhausted', () => {
    // Only 5 questions rate 8-10 (the `9` group) per category, but 8 rounds are requested; once the
    // in-range five are drawn the rest widen to the nearest rating (5, distance 3), never to the
    // farther 2, and never repeating.
    const game = createTriviaGame(makeBank(5), mulberry32(3));
    let scratch = game.configure(
      { category: 'People', rounds: 8, difficultyMin: 8, difficultyMax: 10 },
      players,
    ).scratch;
    const ratings: number[] = [];
    for (let round = 1; round <= 8; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
      ratings.push(questionAt(scratch, round).difficulty);
    }
    expect(ratings.filter((r) => r === 9)).toHaveLength(5); // all in-range questions used first
    expect(ratings.filter((r) => r === 5)).toHaveLength(3); // remainder widened to the nearest
    expect(ratings.every((r) => r !== 2)).toBe(true); // never jumped past the nearer rating
  });

  it('degrades a pre-0016 scratch (a single numeric difficulty) to that single-rating band', () => {
    const game = createTriviaGame(makeBank(5), mulberry32(5));
    // A session persisted by the old engine: one `difficulty` key, no min/max. It must draw at that
    // rating, not silently reset to the default 4-6 band across the deploy.
    const legacyScratch = {
      category: 'People',
      difficulty: 9,
      rounds: 3,
      usedIds: [],
      questions: {},
      submitted: {},
      wrong: {},
      disputers: {},
      ballots: {},
    } as unknown as Record<string, unknown>;
    const started = game.startRound(ctx(legacyScratch, { round: 1 }));
    expect((started.prompt as { difficulty: number }).difficulty).toBe(9);
  });
});

describe('answeredCount (spec 0069)', () => {
  const game = createTriviaGame(makeBank(4), mulberry32(3));

  it('counts connected players who have answered this round, growing as answers land', () => {
    let scratch = game.configure({ category: 'Nature' }, players).scratch;
    scratch = game.startRound(ctx(scratch)).scratch;
    // Nobody has answered yet.
    expect(game.answeredCount?.(ctx(scratch))).toBe(0);
    scratch = game.collectMove(ctx(scratch), 'p1', 'anything').scratch;
    expect(game.answeredCount?.(ctx(scratch))).toBe(1);
    scratch = game.collectMove(ctx(scratch), 'p2', 'anything').scratch;
    expect(game.answeredCount?.(ctx(scratch))).toBe(2);
  });

  it('never counts a disconnected player, so it stays <= the connected roster', () => {
    let scratch = game.configure({ category: 'Nature' }, players).scratch;
    scratch = game.startRound(ctx(scratch)).scratch;
    scratch = game.collectMove(ctx(scratch), 'p1', 'anything').scratch;
    // p1 answered then dropped: the count excludes them, matching allSubmitted's connected-only rule.
    const dropped = [
      { player: 'p1', nickname: 'Ada', connected: false },
      { player: 'p2', nickname: 'Bo', connected: true },
      { player: 'p3', nickname: 'Cy', connected: true },
    ];
    expect(game.answeredCount?.(ctx(scratch, { players: dropped }))).toBe(0);
  });
});
