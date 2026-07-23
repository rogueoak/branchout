import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { CATEGORIES, type TriviaQuestion } from './question-bank';
import type { RoundType } from './plan';
import { createTriviaGame, validateConfig } from './trivia';

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

// Three representative ratings standing in for easy/medium/hard on the 1-10 scale.
const RATINGS = [2, 5, 9] as const;

interface BankOpts {
  /** MC-capable recall items per rating per category (recall WITH choices). */
  mcPerRating?: number;
  /** Open-only recall items per rating per category (recall WITHOUT choices). */
  openPerRating?: number;
  /** True/false items per rating per category. */
  tfPerRating?: number;
  categories?: readonly string[];
}

/**
 * A synthetic multi-type bank. Per category per rating it produces `mcPerRating` choice-bearing
 * recall items (ids `<cat>-mc-<rating>-<n>`), `openPerRating` open-only recall items
 * (`<cat>-open-...`), and `tfPerRating` true/false items (`<cat>-tf-...`). A recall item's canonical
 * answer is `<id>-answer`; a TF item's `isTrue` alternates deterministically.
 */
function makeBank(perRating: number, opts: BankOpts = {}): TriviaQuestion[] {
  const mcPer = opts.mcPerRating ?? perRating;
  const openPer = opts.openPerRating ?? perRating;
  const tfPer = opts.tfPerRating ?? perRating;
  const cats = opts.categories ?? CATEGORIES;
  const out: TriviaQuestion[] = [];
  for (const category of cats) {
    const prefix = category.toLowerCase();
    for (const rating of RATINGS) {
      for (let n = 0; n < mcPer; n += 1) {
        const id = `${prefix}-mc-${rating}-${n}`;
        out.push({
          id,
          category,
          prompt: `${id}?`,
          answers: [`${id}-answer`],
          choices: [`${id}-d1`, `${id}-d2`, `${id}-d3`],
          difficulty: rating,
        });
      }
      for (let n = 0; n < openPer; n += 1) {
        const id = `${prefix}-open-${rating}-${n}`;
        out.push({ id, category, prompt: `${id}?`, answers: [`${id}-answer`], difficulty: rating });
      }
      for (let n = 0; n < tfPer; n += 1) {
        const id = `${prefix}-tf-${rating}-${n}`;
        out.push({
          id,
          type: 'true-false',
          category,
          prompt: `${id}?`,
          isTrue: (rating + n) % 2 === 0,
          difficulty: rating,
        });
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
  type: RoundType;
  category: string;
  difficulty: number;
  answers: string[];
  choices?: string[];
}

/** Read the question the module drew for a round out of persisted scratch. */
function storedAt(scratch: Record<string, unknown>, round: number): StoredQuestionView {
  const questions = (scratch as { questions?: Record<string, StoredQuestionView> }).questions ?? {};
  const q = questions[String(round)];
  if (!q) throw new Error(`no question drawn for round ${round}`);
  return q;
}

interface TriviaPromptView {
  round: number;
  type: RoundType;
  category: string;
  difficulty: number;
  question: string;
  choices?: string[];
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

describe('validateConfig', () => {
  it('defaults to Random, the Standard 6/4/2 composition, difficulty 3-6, and per-type windows', () => {
    expect(validateConfig({})).toEqual({
      categories: [],
      composition: { multipleChoice: 6, trueFalse: 4, open: 2 },
      rounds: 12,
      difficultyMin: 3,
      difficultyMax: 6,
      autoAdvance: true,
      advanceAfterMs: 5_000,
      mcWindowMs: 20_000,
      tfWindowMs: 15_000,
      openWindowMs: 60_000,
    });
  });

  it('maps each duration preset to its composition', () => {
    expect(validateConfig({ duration: 'fast' }).composition).toEqual({
      multipleChoice: 3,
      trueFalse: 2,
      open: 1,
    });
    expect(validateConfig({ duration: 'long' }).composition).toEqual({
      multipleChoice: 12,
      trueFalse: 8,
      open: 4,
    });
    expect(validateConfig({ duration: 'marathon' }).rounds).toBe(48);
  });

  it('resolves a custom composition and totals the round count', () => {
    const resolved = validateConfig({
      duration: 'custom',
      custom: { multipleChoice: 5, trueFalse: 2, open: 3 },
    });
    expect(resolved.composition).toEqual({ multipleChoice: 5, trueFalse: 2, open: 3 });
    expect(resolved.rounds).toBe(10);
  });

  it('rejects an unknown duration and a custom mix that is empty or too large', () => {
    expect(() => validateConfig({ duration: 'epic' as never })).toThrow(/duration/);
    expect(() =>
      validateConfig({ duration: 'custom', custom: { multipleChoice: 0, trueFalse: 0, open: 0 } }),
    ).toThrow(/total/);
    expect(() =>
      validateConfig({ duration: 'custom', custom: { multipleChoice: 31, trueFalse: 0, open: 0 } }),
    ).toThrow(/custom.multipleChoice/);
    expect(() =>
      validateConfig({
        duration: 'custom',
        custom: { multipleChoice: 30, trueFalse: 30, open: 5 },
      }),
    ).toThrow(/total/);
    // custom duration with no custom object is rejected up front.
    expect(() => validateConfig({ duration: 'custom' })).toThrow(/custom/);
  });

  it('tolerates the legacy `rounds` alias as an open-only Custom plan', () => {
    const resolved = validateConfig({ rounds: 7 });
    expect(resolved.composition).toEqual({ multipleChoice: 0, trueFalse: 0, open: 7 });
    expect(resolved.rounds).toBe(7);
    // An explicit duration wins over a stray legacy rounds field.
    expect(validateConfig({ duration: 'fast', rounds: 7 }).composition).toEqual({
      multipleChoice: 3,
      trueFalse: 2,
      open: 1,
    });
  });

  it('tolerates the legacy `timeLimitSeconds` as the open window', () => {
    expect(validateConfig({ timeLimitSeconds: 45 }).openWindowMs).toBe(45_000);
    // The new field wins when both are present.
    expect(validateConfig({ timeLimitSeconds: 45, openTimeLimitSeconds: 90 }).openWindowMs).toBe(
      90_000,
    );
  });

  it('resolves and bounds the per-type timers', () => {
    const resolved = validateConfig({
      mcTimeLimitSeconds: 30,
      tfTimeLimitSeconds: 10,
      openTimeLimitSeconds: 90,
    });
    expect(resolved.mcWindowMs).toBe(30_000);
    expect(resolved.tfWindowMs).toBe(10_000);
    expect(resolved.openWindowMs).toBe(90_000);
    // Bounds: tap timers 5-180, open 10-180.
    expect(() => validateConfig({ mcTimeLimitSeconds: 4 })).toThrow(/mcTimeLimitSeconds/);
    expect(() => validateConfig({ tfTimeLimitSeconds: 181 })).toThrow(/tfTimeLimitSeconds/);
    expect(() => validateConfig({ openTimeLimitSeconds: 9 })).toThrow(/openTimeLimitSeconds/);
  });

  it('resolves categories and rejects an unknown one, incl. the new Movies/Music', () => {
    expect(validateConfig({ categories: ['Movies', 'Music'] }).categories).toEqual([
      'Movies',
      'Music',
    ]);
    expect(() => validateConfig({ categories: ['Sportsball'] })).toThrow();
    expect(validateConfig({ category: 'Random' }).categories).toEqual([]);
  });

  it('rejects a difficulty range outside 1-10 or with min > max', () => {
    expect(() => validateConfig({ difficultyMin: 0, difficultyMax: 6 })).toThrow();
    expect(() => validateConfig({ difficultyMin: 7, difficultyMax: 4 })).toThrow();
    expect(validateConfig({ difficultyMin: 3, difficultyMax: 8 })).toMatchObject({
      difficultyMin: 3,
      difficultyMax: 8,
    });
  });

  it('validates the auto-advance pacing fields', () => {
    expect(validateConfig({ autoAdvance: false }).autoAdvance).toBe(false);
    expect(validateConfig({ advanceAfterSeconds: 12 }).advanceAfterMs).toBe(12_000);
    expect(() => validateConfig({ advanceAfterSeconds: 0 })).toThrow();
    expect(() => validateConfig({ advanceAfterSeconds: 61 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// configure: plan, pacing, pool sufficiency
// ---------------------------------------------------------------------------

describe('configure', () => {
  it('sets rounds to the plan length and maps the pacing windows', () => {
    const game = createTriviaGame(makeBank(4), mulberry32(1));
    const result = game.configure({ duration: 'fast', categories: ['Food'] }, players);
    expect(result.rounds).toBe(6); // fast = 3 + 2 + 1
    // Configure-time fallback window is the open window; per-round windows come from startRound.
    expect(result.moveWindowMs).toBe(60_000);
    expect(result.disputeWindowMs).toBe(5_000);
    expect(result.leaderboardWindowMs).toBe(5_000);
    // The plan is stored in scratch, sized to the composition total.
    const plan = (result.scratch as { plan?: RoundType[] }).plan ?? [];
    expect(plan).toHaveLength(6);
    expect(plan.filter((t) => t === 'multiple-choice')).toHaveLength(3);
    expect(plan.filter((t) => t === 'true-false')).toHaveLength(2);
    expect(plan.filter((t) => t === 'open')).toHaveLength(1);
  });

  it('turns the dwell off when auto-advance is off; the answer window still stands', () => {
    const game = createTriviaGame(makeBank(4), mulberry32(2));
    const off = game.configure({ categories: ['Food'], autoAdvance: false }, players);
    expect(off.disputeWindowMs).toBe(0);
    expect(off.leaderboardWindowMs).toBe(0);
    expect(off.moveWindowMs).toBe(60_000);
  });

  it('rejects a duration the category+difficulty pool cannot supply, per type', () => {
    // Only 1 TF and 1 MC-capable and 1 open item per rating (3 each per category across ratings).
    const game = createTriviaGame(
      makeBank(1, { mcPerRating: 1, openPerRating: 1, tfPerRating: 1 }),
      mulberry32(3),
    );
    // Not enough true/false: need 4, have 3.
    expect(() =>
      game.configure(
        {
          duration: 'custom',
          custom: { multipleChoice: 0, trueFalse: 4, open: 0 },
          categories: ['Nature'],
        },
        players,
      ),
    ).toThrow(/true\/false/);
    // Not enough MC-capable: need 4, have 3.
    expect(() =>
      game.configure(
        {
          duration: 'custom',
          custom: { multipleChoice: 4, trueFalse: 0, open: 0 },
          categories: ['Nature'],
        },
        players,
      ),
    ).toThrow(/multiple-choice/);
    // Not enough recall for open+MC combined: recall = 3 mc + 3 open = 6; ask for 5 open + 3 mc = 8.
    expect(() =>
      game.configure(
        {
          duration: 'custom',
          custom: { multipleChoice: 3, trueFalse: 0, open: 5 },
          categories: ['Nature'],
        },
        players,
      ),
    ).toThrow(/recall/);
    // A mix the pool CAN supply passes.
    expect(() =>
      game.configure(
        {
          duration: 'custom',
          custom: { multipleChoice: 2, trueFalse: 2, open: 1 },
          categories: ['Nature'],
        },
        players,
      ),
    ).not.toThrow();
  });

  it('rejects invalid config so the engine rejects the start', () => {
    const game = createTriviaGame(makeBank(4));
    expect(() => game.configure({ categories: ['Nope'] }, players)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Draw by type + per-round windows
// ---------------------------------------------------------------------------

describe('draw by round type (spec 0074)', () => {
  it('draws the plan type each round: open->recall, MC->choice-bearing recall, TF->true/false', () => {
    const game = createTriviaGame(makeBank(6), mulberry32(11));
    let scratch = game.configure({ duration: 'fast', categories: ['Science'] }, players).scratch;
    const plan = (scratch as { plan: RoundType[] }).plan;
    for (let round = 1; round <= 6; round += 1) {
      const started = game.startRound(ctx(scratch, { round }));
      scratch = started.scratch;
      const prompt = started.prompt as TriviaPromptView;
      const type = plan[round - 1]!;
      expect(prompt.type).toBe(type);
      const stored = storedAt(scratch, round);
      expect(stored.type).toBe(type);
      if (type === 'multiple-choice') {
        // Four shuffled options, including the canonical answer; the prompt carries them.
        expect(prompt.choices).toHaveLength(4);
        expect(prompt.choices).toContain(stored.answers[0]);
        expect(stored.id).toContain('-mc-');
      } else if (type === 'true-false') {
        expect(prompt.choices).toBeUndefined();
        expect(stored.answers[0] === 'True' || stored.answers[0] === 'False').toBe(true);
        expect(stored.id).toContain('-tf-');
      } else {
        expect(prompt.choices).toBeUndefined();
        expect(stored.answers[0]).toBe(`${stored.id}-answer`);
      }
    }
  });

  it('open rounds never starve a later MC round in a tight pool (PR #174 review)', () => {
    // Standard = 6 MC + 4 TF + 2 open. A single-category in-band pool of EXACTLY 6 MC-capable, 2
    // open-only, and 4 TF recall passes configure (mcCapable 6 >= 6, recall 8 >= mc+open 8), yet
    // buildRoundPlan puts an open at position 6 - BEFORE the MC rounds at 7-11. If open drew any
    // recall it could grab an MC-capable item and strand a later MC round; because it prefers
    // open-only recall, every full game completes. Only rating 5 falls in the default 3-6 band.
    const bank = makeBank(0, {
      mcPerRating: 6,
      openPerRating: 2,
      tfPerRating: 4,
      categories: ['Science'],
    });
    for (const seed of [1, 7, 42, 99, 123, 2024]) {
      const game = createTriviaGame(bank, mulberry32(seed));
      let scratch = game.configure(
        { duration: 'standard', categories: ['Science'] },
        players,
      ).scratch;
      const plan = (scratch as { plan: RoundType[] }).plan;
      for (let round = 1; round <= 12; round += 1) {
        const started = game.startRound(ctx(scratch, { round }));
        scratch = started.scratch;
        // Each round draws its planned type; no round throws "ran out of ... questions".
        expect(storedAt(scratch, round).type).toBe(plan[round - 1]);
      }
    }
  });

  it('shuffles the MC options so the canonical answer is not pinned to the first slot', () => {
    // A no-op shuffle (canonical always choices[0]) would pass the "contains canonical" checks but
    // ship "the answer is always button A". Assert every MC round's options are a permutation of the
    // canonical + its three distractors, and that across the game the canonical is NOT always first.
    const bank = makeBank(0, {
      mcPerRating: 8,
      openPerRating: 0,
      tfPerRating: 0,
      categories: ['Food'],
    });
    const game = createTriviaGame(bank, mulberry32(3));
    let scratch = game.configure(
      {
        duration: 'custom',
        custom: { multipleChoice: 6, trueFalse: 0, open: 0 },
        categories: ['Food'],
      },
      players,
    ).scratch;
    let canonicalNotFirst = false;
    for (let round = 1; round <= 6; round += 1) {
      const started = game.startRound(ctx(scratch, { round }));
      scratch = started.scratch;
      const prompt = started.prompt as TriviaPromptView;
      const stored = storedAt(scratch, round);
      const canonical = stored.answers[0]!;
      const expected = [canonical, `${stored.id}-d1`, `${stored.id}-d2`, `${stored.id}-d3`];
      expect([...prompt.choices!].sort()).toEqual([...expected].sort());
      if (prompt.choices![0] !== canonical) canonicalNotFirst = true;
    }
    expect(canonicalNotFirst).toBe(true);
  });

  it('returns the round type window via StartRoundResult.moveWindowMs', () => {
    const game = createTriviaGame(makeBank(4), mulberry32(5));
    const cfg = {
      mcTimeLimitSeconds: 25,
      tfTimeLimitSeconds: 12,
      openTimeLimitSeconds: 40,
      categories: ['Food'],
    };
    // Isolate each type with a single-type custom plan to check its window deterministically.
    const mc = createTriviaGame(makeBank(4), mulberry32(5));
    const mcStart = mc.startRound(
      ctx(
        mc.configure(
          { ...cfg, duration: 'custom', custom: { multipleChoice: 1, trueFalse: 0, open: 0 } },
          players,
        ).scratch,
      ),
    );
    expect((mcStart as { moveWindowMs?: number }).moveWindowMs).toBe(25_000);

    const tf = createTriviaGame(makeBank(4), mulberry32(6));
    const tfStart = tf.startRound(
      ctx(
        tf.configure(
          { ...cfg, duration: 'custom', custom: { multipleChoice: 0, trueFalse: 1, open: 0 } },
          players,
        ).scratch,
      ),
    );
    expect((tfStart as { moveWindowMs?: number }).moveWindowMs).toBe(12_000);

    const open = createTriviaGame(makeBank(4), mulberry32(7));
    const openStart = open.startRound(
      ctx(
        open.configure(
          { ...cfg, duration: 'custom', custom: { multipleChoice: 0, trueFalse: 0, open: 1 } },
          players,
        ).scratch,
      ),
    );
    expect((openStart as { moveWindowMs?: number }).moveWindowMs).toBe(40_000);
    void game;
  });

  it('never repeats a question across a full marathon (48 rounds)', () => {
    const game = createTriviaGame(makeBank(12), mulberry32(42));
    let scratch = game.configure({ duration: 'marathon', categories: ['People'] }, players).scratch;
    const seen = new Set<string>();
    for (let round = 1; round <= 48; round += 1) {
      scratch = game.startRound(ctx(scratch, { round })).scratch;
      const q = storedAt(scratch, round);
      expect(seen.has(q.id)).toBe(false);
      expect(q.category).toBe('People');
      seen.add(q.id);
    }
    expect(seen.size).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// Per-type scoring + open-only disputes
// ---------------------------------------------------------------------------

/** Configure a single-round game of one type and start it. */
function singleRound(type: RoundType, seed: number) {
  const game = createTriviaGame(makeBank(4), mulberry32(seed));
  const custom =
    type === 'multiple-choice'
      ? { multipleChoice: 1, trueFalse: 0, open: 0 }
      : type === 'true-false'
        ? { multipleChoice: 0, trueFalse: 1, open: 0 }
        : { multipleChoice: 0, trueFalse: 0, open: 1 };
  const scratch = game.configure(
    { duration: 'custom', custom, categories: ['Nature'] },
    players,
  ).scratch;
  const started = game.startRound(ctx(scratch));
  return { game, scratch: started.scratch, prompt: started.prompt as TriviaPromptView };
}

describe('per-type scoring (spec 0074)', () => {
  it('scores a correct multiple-choice answer 100 by exact option match, no disputes', () => {
    const { game, scratch: s0, prompt } = singleRound('multiple-choice', 21);
    const canonical = storedAt(s0, 1).answers[0]!;
    const wrongOption = prompt.choices!.find((c) => c !== canonical)!;
    let s = game.collectMove(ctx(s0), 'p1', canonical).scratch;
    s = game.collectMove(ctx(s), 'p2', wrongOption).scratch;
    s = game.collectMove(ctx(s), 'p3', 'not even an option').scratch;
    const revealed = game.reveal(ctx(s));
    expect(revealed.scores).toEqual([{ player: 'p1', points: 100, reason: 'correct answer' }]);
    const reveal = revealed.reveal as { type: RoundType; wrong: string[]; answers: string[] };
    expect(reveal.type).toBe('multiple-choice');
    expect(reveal.answers).toEqual([canonical]);
    // MC is unambiguous: no dispute-eligible wrong set.
    expect(reveal.wrong).toEqual([]);
  });

  it('scores a correct true/false answer 75 by exact match, no disputes', () => {
    const { game, scratch: s0 } = singleRound('true-false', 22);
    const truth = storedAt(s0, 1).answers[0]!; // 'True' or 'False'
    const other = truth === 'True' ? 'False' : 'True';
    let s = game.collectMove(ctx(s0), 'p1', truth).scratch;
    s = game.collectMove(ctx(s), 'p2', other).scratch;
    const revealed = game.reveal(ctx(s));
    expect(revealed.scores).toEqual([{ player: 'p1', points: 75, reason: 'correct answer' }]);
    const reveal = revealed.reveal as { type: RoundType; wrong: string[] };
    expect(reveal.type).toBe('true-false');
    expect(reveal.wrong).toEqual([]);
  });

  it('scores a correct open answer 150 (incl. fuzzy) and keeps the dispute-eligible wrong set', () => {
    const { game, scratch: s0 } = singleRound('open', 23);
    const answer = storedAt(s0, 1).answers[0]!;
    let s = game.collectMove(ctx(s0), 'p1', answer).scratch; // exact
    s = game.collectMove(ctx(s), 'p2', answer.slice(0, -1)).scratch; // 1-edit typo -> fuzzy match
    s = game.collectMove(ctx(s), 'p3', 'totally wrong').scratch;
    const revealed = game.reveal(ctx(s));
    expect(new Set(revealed.scores.map((e) => e.player))).toEqual(new Set(['p1', 'p2']));
    expect(revealed.scores.every((e) => e.points === 150)).toBe(true);
    const reveal = revealed.reveal as { type: RoundType; wrong: string[] };
    expect(reveal.type).toBe('open');
    // Only open rounds populate the dispute-eligible wrong set.
    expect(reveal.wrong).toEqual(['p3']);
  });
});

describe('disputes are open-only (spec 0074)', () => {
  it('lets a wrong open answer raise and win a dispute (+50)', () => {
    const { game, scratch: s0 } = singleRound('open', 31);
    const answer = storedAt(s0, 1).answers[0]!;
    let s = game.collectMove(ctx(s0), 'p1', answer).scratch;
    s = game.collectMove(ctx(s), 'p2', 'wrong-a').scratch;
    s = game.collectMove(ctx(s), 'p3', 'wrong-b').scratch;
    s = game.reveal(ctx(s)).scratch;
    s = game.collectVote(ctx(s, { phase: 'disputing' }), {
      player: 'p2',
      target: 'p2',
      agree: true,
    }).scratch;
    expect(game.disputeWindow(ctx(s, { phase: 'disputing' })).disputes).toEqual(['p2']);
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
  });

  it('offers no dispute on a multiple-choice round (a wrong player cannot become a disputer)', () => {
    const { game, scratch: s0, prompt } = singleRound('multiple-choice', 32);
    const canonical = storedAt(s0, 1).answers[0]!;
    const wrongOption = prompt.choices!.find((c) => c !== canonical)!;
    let s = game.collectMove(ctx(s0), 'p1', canonical).scratch;
    s = game.collectMove(ctx(s), 'p2', wrongOption).scratch;
    s = game.reveal(ctx(s)).scratch;
    // p2 tries to dispute their wrong MC answer; the empty `wrong` set means it never registers.
    s = game.collectVote(ctx(s, { phase: 'disputing' }), {
      player: 'p2',
      target: 'p2',
      agree: true,
    }).scratch;
    expect(game.disputeWindow(ctx(s, { phase: 'disputing' })).disputes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Submit-once + answeredCount + ranking (unchanged behaviors)
// ---------------------------------------------------------------------------

describe('submit-once and answeredCount', () => {
  it('rejects a second submission for the same player+round', () => {
    const { game, scratch: s0 } = singleRound('open', 41);
    const answer = storedAt(s0, 1).answers[0]!;
    const first = game.collectMove(ctx(s0), 'p1', '');
    expect(first.rejected).toBeUndefined();
    const second = game.collectMove(ctx(first.scratch), 'p1', answer);
    expect(second.rejected).toBeDefined();
  });

  it('counts connected players who have answered this round', () => {
    const { game, scratch: s0 } = singleRound('open', 42);
    expect(game.answeredCount?.(ctx(s0))).toBe(0);
    const s = game.collectMove(ctx(s0), 'p1', 'anything').scratch;
    expect(game.answeredCount?.(ctx(s))).toBe(1);
  });
});

describe('end-game ranking', () => {
  const game = createTriviaGame(makeBank(4));

  it('ranks by score, highest first, with shared ranks on ties', () => {
    const standings = game.endGame(ctx({}, { scores: { p1: 200, p2: 200, p3: 50 } }));
    const byPlayer = Object.fromEntries(standings.map((sd) => [sd.player, sd.rank]));
    expect(byPlayer.p1).toBe(1);
    expect(byPlayer.p2).toBe(1);
    expect(byPlayer.p3).toBe(3);
  });

  it('advance reports done only on the final round', () => {
    const scratch = game.configure({ duration: 'fast', categories: ['Food'] }, players).scratch;
    expect(game.advance(ctx(scratch, { round: 5 })).done).toBe(false);
    expect(game.advance(ctx(scratch, { round: 6 })).done).toBe(true);
  });
});
