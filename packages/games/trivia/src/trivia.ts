// The Trivia game module (spec 0008). Pure game logic over the engine's GameModule lifecycle:
// the engine owns phase sequencing, the 10s dispute-window timer, streaming, and persistence;
// this module owns Trivia's rules - config validation, question draw, answer scoring, and
// dispute resolution. Everything here is a pure callback over `RoundContext`; the only injected
// state is the pre-indexed question bank and an rng, both fixed when the module is built.

import { rankStandings, type ScoreEvent, type Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  GamePlugin,
  RevealResult,
  RoundContext,
  ScratchResult,
  StartRoundResult,
  VoteInput,
} from '@branchout/game-sdk';
import { CATEGORIES, loadQuestionBank, type TriviaQuestion } from './question-bank';
import {
  DEFAULT_DIFFICULTY_MAX,
  DEFAULT_DIFFICULTY_MIN,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  isValidDifficultyRange,
} from './difficulty';
import { isCorrectAnswer } from './matching';
import {
  RANDOM_CATEGORY,
  indexQuestions,
  pickQuestion,
  poolFor,
  type QuestionIndex,
} from './selection';

export const TRIVIA_GAME_ID = 'trivia';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;

/** Auto-advance defaults (spec 0068): on, with a 5s dwell for each hop. */
export const DEFAULT_AUTO_ADVANCE = true;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;

/** Answer-window (time-limit) defaults and bounds in seconds (spec 0068). */
export const DEFAULT_TIME_LIMIT_SECONDS = 60;
export const MIN_TIME_LIMIT_SECONDS = 10;
export const MAX_TIME_LIMIT_SECONDS = 180;

const CORRECT_POINTS = 100;
const DISPUTE_POINTS = 50;

/**
 * The categories a host may configure: the eight question categories plus `Random`. `Random` is a
 * UI convenience meaning "all categories" - on the wire it is the empty `categories` list.
 */
export const CONFIGURABLE_CATEGORIES: readonly string[] = [...CATEGORIES, RANDOM_CATEGORY];

/** Host-supplied configuration, validated by {@link validateConfig}. All fields optional (spec 0068). */
export interface TriviaConfig {
  /** A subset of the eight categories to draw from. Omitted or empty = Random (all categories). */
  categories?: string[];
  /**
   * Legacy single-category field (pre-0068). Still accepted for backward compatibility: `Random`
   * resolves to all categories (empty list), any other value to that one category.
   */
  category?: string;
  /** 1-100, default 10. */
  rounds?: number;
  /** Difficulty range floor, integer 1-10, default 3. Must be <= `difficultyMax`. */
  difficultyMin?: number;
  /** Difficulty range ceiling, integer 1-10, default 6. Must be >= `difficultyMin`. */
  difficultyMax?: number;
  /** Auto-advance the answer screen -> leaderboard -> next round. Default true. */
  autoAdvance?: boolean;
  /** Dwell before each auto-advance hop, in seconds. Default 5, range 1-60. */
  advanceAfterSeconds?: number;
  /** Answer window, in seconds. Default 60, range 10-180. Maps to the engine move window. */
  timeLimitSeconds?: number;
}

/** A validated, defaulted configuration. Durations are resolved to milliseconds for the engine. */
export interface ResolvedTriviaConfig {
  /** The resolved category subset; an EMPTY list means Random (all categories). */
  categories: string[];
  rounds: number;
  difficultyMin: number;
  difficultyMax: number;
  autoAdvance: boolean;
  /** Resolved dwell in ms (`advanceAfterSeconds * 1000`). */
  advanceAfterMs: number;
  /** Resolved answer window in ms (`timeLimitSeconds * 1000`). */
  timeLimitMs: number;
}

/** A question snapshot persisted per round so reveal can score without re-drawing. */
interface StoredQuestion {
  id: string;
  category: string;
  prompt: string;
  answers: string[];
  difficulty: number;
}

interface TriviaScratch {
  /** The category subset to draw from; an empty list means Random (all categories). */
  categories: string[];
  difficultyMin: number;
  difficultyMax: number;
  rounds: number;
  /** Ids drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  // Per-round working state, keyed by round number. Only the current round is ever read, so
  // startRound prunes finalized rounds to keep the persisted blob and the clone cost O(1round).
  questions: Record<string, StoredQuestion>;
  submitted: Record<string, Record<string, string>>;
  /** Players who submitted an answer that was marked wrong: the dispute-eligible set. */
  wrong: Record<string, string[]>;
  disputers: Record<string, string[]>;
  ballots: Record<string, Record<string, Record<string, boolean>>>;
}

function emptyScratch(cfg: ResolvedTriviaConfig): TriviaScratch {
  return {
    categories: [...cfg.categories],
    difficultyMin: cfg.difficultyMin,
    difficultyMax: cfg.difficultyMax,
    rounds: cfg.rounds,
    usedIds: [],
    questions: {},
    submitted: {},
    wrong: {},
    disputers: {},
    ballots: {},
  };
}

/**
 * Read a category subset from a persisted scratch, tolerating the pre-0068 single-`category` shape so
 * an in-progress game survives an engine deploy: `Random` (or absent) -> all categories (empty list),
 * any named category -> that one.
 */
function scratchCategories(s: Partial<TriviaScratch> & { category?: unknown }): string[] {
  if (Array.isArray(s.categories))
    return s.categories.filter((c): c is string => typeof c === 'string');
  const legacy = s.category;
  if (typeof legacy === 'string' && legacy !== RANDOM_CATEGORY) return [legacy];
  return [];
}

function asScratch(scratch: Readonly<Record<string, unknown>>): TriviaScratch {
  const s = scratch as Partial<TriviaScratch> & { category?: unknown };
  // Degrade a pre-0016 scratch (a single numeric `difficulty`) to a single-rating band rather than
  // silently resetting a game-in-progress to the default range across an engine deploy (spec 0016).
  const legacy = (scratch as { difficulty?: unknown }).difficulty;
  const legacyBand = typeof legacy === 'number' ? legacy : undefined;
  return {
    categories: scratchCategories(s),
    difficultyMin: s.difficultyMin ?? legacyBand ?? DEFAULT_DIFFICULTY_MIN,
    difficultyMax: s.difficultyMax ?? legacyBand ?? DEFAULT_DIFFICULTY_MAX,
    rounds: s.rounds ?? DEFAULT_ROUNDS,
    usedIds: s.usedIds ?? [],
    questions: s.questions ?? {},
    submitted: s.submitted ?? {},
    wrong: s.wrong ?? {},
    disputers: s.disputers ?? {},
    ballots: s.ballots ?? {},
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: TriviaScratch): TriviaScratch {
  return JSON.parse(JSON.stringify(scratch)) as TriviaScratch;
}

function toRecord(scratch: TriviaScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** Total questions available for a category subset (an empty list spans all categories). */
function poolSize(index: QuestionIndex, categories: readonly string[]): number {
  return poolFor(index, categories).length;
}

/**
 * Resolve a host's category selection to a validated subset, tolerating the legacy single-`category`
 * field. An empty result means Random (all categories). Throws on any unknown category.
 */
function resolveCategories(cfg: Partial<TriviaConfig>): string[] {
  const raw = Array.isArray(cfg.categories)
    ? cfg.categories
    : typeof cfg.category === 'string'
      ? cfg.category === RANDOM_CATEGORY
        ? []
        : [cfg.category]
      : [];
  // Drop a stray `Random` sentinel and de-duplicate, preserving order.
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const category of raw) {
    if (category === RANDOM_CATEGORY || seen.has(category)) continue;
    if (!CATEGORIES.includes(category)) {
      throw new Error(
        `trivia categories must each be one of ${CATEGORIES.join(', ')}, got ${JSON.stringify(category)}`,
      );
    }
    seen.add(category);
    resolved.push(category);
  }
  return resolved;
}

function resolveIntInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== 'number' ||
    !Number.isInteger(resolved) ||
    resolved < min ||
    resolved > max
  ) {
    throw new Error(
      `trivia ${label} must be an integer ${min}-${max}, got ${JSON.stringify(value)}`,
    );
  }
  return resolved;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's `configure` handoff rejects a bad start rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedTriviaConfig {
  const cfg = (config ?? {}) as Partial<TriviaConfig>;

  const categories = resolveCategories(cfg);

  const rounds = resolveIntInRange(cfg.rounds, DEFAULT_ROUNDS, MIN_ROUNDS, MAX_ROUNDS, 'rounds');

  const difficultyMin = cfg.difficultyMin ?? DEFAULT_DIFFICULTY_MIN;
  const difficultyMax = cfg.difficultyMax ?? DEFAULT_DIFFICULTY_MAX;
  if (!isValidDifficultyRange(difficultyMin, difficultyMax)) {
    throw new Error(
      `trivia difficulty range must be integers ${MIN_DIFFICULTY}-${MAX_DIFFICULTY} with min <= max, ` +
        `got ${JSON.stringify(difficultyMin)}-${JSON.stringify(difficultyMax)}`,
    );
  }

  const autoAdvance = cfg.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
  if (typeof autoAdvance !== 'boolean') {
    throw new Error(`trivia autoAdvance must be a boolean, got ${JSON.stringify(cfg.autoAdvance)}`);
  }

  const advanceAfterSeconds = resolveIntInRange(
    cfg.advanceAfterSeconds,
    DEFAULT_ADVANCE_AFTER_SECONDS,
    MIN_ADVANCE_AFTER_SECONDS,
    MAX_ADVANCE_AFTER_SECONDS,
    'advanceAfterSeconds',
  );
  const timeLimitSeconds = resolveIntInRange(
    cfg.timeLimitSeconds,
    DEFAULT_TIME_LIMIT_SECONDS,
    MIN_TIME_LIMIT_SECONDS,
    MAX_TIME_LIMIT_SECONDS,
    'timeLimitSeconds',
  );

  return {
    categories,
    rounds,
    difficultyMin,
    difficultyMax,
    autoAdvance,
    advanceAfterMs: advanceAfterSeconds * 1000,
    timeLimitMs: timeLimitSeconds * 1000,
  };
}

/**
 * Build a Trivia module bound to a question bank. `rng` (defaulting to `Math.random`) drives the
 * in-range question pick; inject a seeded rng to make a whole game deterministic in tests. The bank
 * is indexed once here, not per round.
 */
export function createTriviaGame(
  bank: readonly TriviaQuestion[],
  rng: () => number = Math.random,
): GameModule {
  const index: QuestionIndex = indexQuestions(bank);

  return {
    id: TRIVIA_GAME_ID,

    // Trivia does not need the roster to configure; the interface allows fewer params.
    configure(config: unknown): ConfigureResult {
      const cfg = validateConfig(config);
      // The draw never repeats a question, so the chosen pool must hold at least `rounds`
      // questions. Reject up front here rather than let `startRound` throw partway through a live
      // game, after players have already invested rounds.
      const available = poolSize(index, cfg.categories);
      if (available < cfg.rounds) {
        const label = cfg.categories.length === 0 ? RANDOM_CATEGORY : cfg.categories.join(', ');
        throw new Error(
          `trivia categories "${label}" have only ${available} question(s), fewer than the ` +
            `configured ${cfg.rounds} round(s)`,
        );
      }
      // Pacing (spec 0068): the answer window is always the time limit; the dispute/answer-screen
      // dwell and the leaderboard auto-advance dwell are the advance-after delay when auto-advance is
      // on, and 0 (host-advanced) when it is off.
      const dwellMs = cfg.autoAdvance ? cfg.advanceAfterMs : 0;
      return {
        scratch: toRecord(emptyScratch(cfg)),
        rounds: cfg.rounds,
        disputeWindowMs: dwellMs,
        moveWindowMs: cfg.timeLimitMs,
        // The leaderboard dwell (and the matching dispute dwell) are the auto-advance windows: >0 when
        // the host left auto-advance on, 0 when off. The engine reports `autoAdvance` = (this > 0), so
        // no extra field is needed here (spec 0069).
        leaderboardWindowMs: dwellMs,
      };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const used = new Set(scratch.usedIds);
      const question = pickQuestion(
        index,
        scratch.categories,
        scratch.difficultyMin,
        scratch.difficultyMax,
        used,
        rng,
      );
      if (!question) {
        const label =
          scratch.categories.length === 0 ? RANDOM_CATEGORY : scratch.categories.join(', ');
        throw new Error(`trivia ran out of questions for categories "${label}"`);
      }
      scratch.usedIds.push(question.id);
      // Prior rounds are finalized (their scores already applied on the engine); only the current
      // round's working state is ever read again, so drop the rest. This keeps the Redis-persisted
      // scratch and the per-frame clone cost flat instead of growing with every round played.
      scratch.questions = {
        [key]: {
          id: question.id,
          category: question.category,
          prompt: question.prompt,
          answers: [...question.answers],
          difficulty: question.difficulty,
        },
      };
      scratch.submitted = { [key]: {} };
      scratch.wrong = {};
      scratch.disputers = {};
      scratch.ballots = {};
      return {
        scratch: toRecord(scratch),
        prompt: {
          round: ctx.round,
          category: question.category,
          difficulty: question.difficulty,
          question: question.prompt,
        },
      };
    },

    collectMove(ctx: RoundContext, player: string, answer: string): ScratchResult {
      const key = String(ctx.round);
      // Submit-once (WS16): a player answers each round exactly ONCE. If they already have a
      // submission this round, REJECT the second attempt instead of overwriting it. This makes both a
      // real answer and an "I don't know" give-up authoritative and final across reloads/replays - a
      // player cannot reload and overwrite a give-up (or a wrong answer) with a scoring answer. The
      // guard is Trivia-specific; every other game's collectMove is untouched.
      const already = asScratch(ctx.scratch).submitted[key] ?? {};
      if (already[player] !== undefined) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'You already answered this round.' },
        };
      }
      const scratch = clone(asScratch(ctx.scratch));
      const round = (scratch.submitted[key] ??= {});
      round[player] = answer;
      return { scratch: toRecord(scratch) };
    },

    // The round is complete once every connected player has an answer this round. Only connected
    // players count, so a dropped device never holds the round open; the empty-table guard keeps a
    // roster with nobody connected from reading as "all answered".
    allSubmitted(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const round = scratch.submitted[String(ctx.round)] ?? {};
      const connected = ctx.players.filter((p) => p.connected);
      return connected.length > 0 && connected.every((p) => round[p.player] !== undefined);
    },

    // How many connected players have answered this round - the live "x of y answered" numerator
    // (spec 0069). Mirrors allSubmitted's connected-only rule so the count never exceeds the
    // connected roster the client uses as the denominator.
    answeredCount(ctx: RoundContext): number {
      const scratch = asScratch(ctx.scratch);
      const round = scratch.submitted[String(ctx.round)] ?? {};
      return ctx.players.filter((p) => p.connected && round[p.player] !== undefined).length;
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const question = scratch.questions[key];
      const submitted = scratch.submitted[key] ?? {};

      const correct: string[] = [];
      const wrong: string[] = [];
      // Every player's submitted answer, so the reveal can show the whole table what each other
      // person said (spec 0017), with its correct/wrong verdict.
      const submissions: { player: string; answer: string; correct: boolean }[] = [];
      for (const [player, answer] of Object.entries(submitted)) {
        const isCorrect = question ? isCorrectAnswer(answer, question.answers) : false;
        if (isCorrect) {
          correct.push(player);
        } else if (answer.trim() !== '') {
          // A wrong answer is dispute-eligible. A blank give-up ("I don't know", WS16) is NOT: a blank
          // cannot be disputed and must never earn the 50-point dispute award. It still shows red in
          // the reveal table via its `correct: false` submission; it just never enters the
          // dispute-eligible `wrong` set (so the player is not offered the dispute button either).
          wrong.push(player);
        }
        submissions.push({ player, answer, correct: isCorrect });
      }
      // Only `wrong` is persisted - it gates dispute eligibility. `correct` is streamed in the
      // reveal payload but never read back, so it is not kept in scratch.
      scratch.wrong[key] = wrong;

      const scores: ScoreEvent[] = correct.map((player) => ({
        player,
        points: CORRECT_POINTS,
        reason: 'correct answer',
      }));

      return {
        scratch: toRecord(scratch),
        reveal: {
          round: ctx.round,
          question: question?.prompt ?? null,
          answers: question?.answers ?? [],
          correct,
          wrong,
          submissions,
        },
        scores,
      };
    },

    collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      if (ctx.phase === 'disputing') {
        // Only a player who submitted an answer and was marked wrong may raise a dispute.
        const wrong = scratch.wrong[key] ?? [];
        if (wrong.includes(vote.player)) {
          const disputers = (scratch.disputers[key] ??= []);
          if (!disputers.includes(vote.player)) disputers.push(vote.player);
        }
      } else if (ctx.phase === 'voting') {
        // A ballot on a disputer, cast by any other player (never the disputer themselves).
        const disputers = scratch.disputers[key] ?? [];
        if (vote.target !== vote.player && disputers.includes(vote.target)) {
          const perRound = (scratch.ballots[key] ??= {});
          const perTarget = (perRound[vote.target] ??= {});
          perTarget[vote.player] = vote.agree;
        }
      }
      return { scratch: toRecord(scratch) };
    },

    disputeWindow(ctx: RoundContext): DisputeWindowResult {
      const scratch = asScratch(ctx.scratch);
      const key = String(ctx.round);
      return {
        scratch: ctx.scratch as Record<string, unknown>,
        disputes: [...(scratch.disputers[key] ?? [])],
      };
    },

    disputeVote(ctx: RoundContext): DisputeVoteResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const disputers = scratch.disputers[key] ?? [];
      const ballots = scratch.ballots[key] ?? {};
      const upheld: string[] = [];
      const scores: ScoreEvent[] = [];

      for (const disputer of disputers) {
        // Denominator is every *connected other* player (the eligible voters), not just those who
        // cast a ballot, so a present-but-silent player counts against the dispute. Disconnected
        // players are excluded - in a party game where devices drop, counting an offline player as
        // an implicit "no" could make a legitimate dispute mathematically impossible to win.
        const otherPlayers = ctx.players.filter((p) => p.player !== disputer && p.connected).length;
        const perTarget = ballots[disputer] ?? {};
        const agrees = Object.values(perTarget).filter(Boolean).length;
        if (otherPlayers > 0 && agrees * 2 > otherPlayers) {
          upheld.push(disputer);
          scores.push({ player: disputer, points: DISPUTE_POINTS, reason: 'dispute upheld' });
        }
      }

      return { scratch: toRecord(scratch), scores, reveal: { round: ctx.round, upheld } };
    },

    leaderboard(ctx: RoundContext): Standing[] {
      return rankStandings(ctx.players, ctx.scores);
    },

    advance(ctx: RoundContext): AdvanceResult {
      const scratch = asScratch(ctx.scratch);
      return { done: ctx.round >= scratch.rounds };
    },

    endGame(ctx: RoundContext): Standing[] {
      return rankStandings(ctx.players, ctx.scores);
    },
  };
}

/**
 * Trivia as a plugin the engine registers. `create` loads the question bank once through the
 * injected asset loader (rooted at this package via `import.meta.url`) and builds the module with
 * the injected rng; `validateConfig` is the manifest's config schema, run at the start-handoff
 * boundary.
 */
export const triviaPlugin: GamePlugin<ResolvedTriviaConfig> = {
  manifest: {
    id: TRIVIA_GAME_ID,
    name: 'Trivia',
    version: '1.0.0',
    configSchema: validateConfig,
  },
  create: async (services) =>
    createTriviaGame(
      await loadQuestionBank(services.assets.forModule(import.meta.url)),
      services.rng,
    ),
};
