// The Trivial Matters game module (spec 0008, multi-type rearchitect spec 0074). Pure game logic
// over the engine's GameModule lifecycle: the engine owns phase sequencing, the dispute-window timer,
// streaming, and persistence; this module owns the rules - config validation, a duration -> ordered
// round plan, draw-by-type, per-type scoring, and dispute resolution. Everything here is a pure
// callback over `RoundContext`; the only injected state is the pre-indexed question bank and an rng,
// both fixed when the module is built.
//
// A round is one of three types, drawn from a plan the host's chosen Duration builds:
//   - multiple-choice (100 pts): a recall item with 4 shuffled options; exact-match scored.
//   - true-false (75 pts): a statement judged against `isTrue`; exact-match scored.
//   - open (150 pts): today's free-text recall, fuzzy-matched and dispute-eligible.
// Disputes run ONLY on open rounds. Each type carries its own answer window, delivered per round via
// StartRoundResult.moveWindowMs (spec 0074).

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
import {
  CATEGORIES,
  isMultipleChoiceCapable,
  isRecallQuestion,
  isTrueFalseQuestion,
  loadQuestionBank,
  type RecallQuestion,
  type TriviaQuestion,
} from './question-bank';
import {
  DEFAULT_DIFFICULTY_MAX,
  DEFAULT_DIFFICULTY_MIN,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  isValidDifficultyRange,
} from './difficulty';
import { isCorrectAnswer } from './matching';
import { buildRoundPlan, shuffleInPlace, type Composition, type RoundType } from './plan';
import {
  RANDOM_CATEGORY,
  indexQuestions,
  pickQuestion,
  poolFor,
  type QuestionIndex,
} from './selection';

export const TRIVIA_GAME_ID = 'trivia';

/** Legacy `rounds` alias bounds (pre-0074): an N-round open-only Custom plan. */
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;

/** The duration presets a host may pick (spec 0074). `custom` reveals the three count inputs. */
export type Duration = 'fast' | 'standard' | 'long' | 'marathon' | 'custom';
export const DURATIONS: readonly Duration[] = [
  'fast',
  'standard',
  'long',
  'marathon',
  'custom',
] as const;
export const DEFAULT_DURATION = 'standard' satisfies Exclude<Duration, 'custom'>;

/** Fixed compositions (MC / TF / open) for each non-custom preset (spec 0074). */
export const DURATION_COMPOSITIONS: Readonly<Record<Exclude<Duration, 'custom'>, Composition>> = {
  fast: { multipleChoice: 3, trueFalse: 2, open: 1 },
  standard: { multipleChoice: 6, trueFalse: 4, open: 2 },
  long: { multipleChoice: 12, trueFalse: 8, open: 4 },
  marathon: { multipleChoice: 24, trueFalse: 16, open: 8 },
};

/** Custom count bounds: each type 0-30, with a total of 1-60 rounds (spec 0074). */
export const MIN_CUSTOM_COUNT = 0;
export const MAX_CUSTOM_COUNT = 30;
export const MIN_CUSTOM_TOTAL = 1;
export const MAX_CUSTOM_TOTAL = 60;

/** Auto-advance defaults (spec 0068): on, with a 5s dwell for each hop. */
export const DEFAULT_AUTO_ADVANCE = true;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;

/** Per-type answer-window (time-limit) defaults and bounds in seconds (spec 0074). */
export const DEFAULT_MC_TIME_LIMIT_SECONDS = 20;
export const DEFAULT_TF_TIME_LIMIT_SECONDS = 15;
export const DEFAULT_OPEN_TIME_LIMIT_SECONDS = 60;
export const MIN_TAP_TIME_LIMIT_SECONDS = 5;
export const MIN_OPEN_TIME_LIMIT_SECONDS = 10;
export const MAX_TIME_LIMIT_SECONDS = 180;

/** Legacy single-timer default (pre-0074), still honored as the open timer when supplied. */
export const DEFAULT_TIME_LIMIT_SECONDS = DEFAULT_OPEN_TIME_LIMIT_SECONDS;

/** Per-type scoring constants (spec 0074). Open is hardest, so it scores highest and keeps disputes. */
export const MC_POINTS = 100;
export const TF_POINTS = 75;
export const OPEN_POINTS = 150;
const DISPUTE_POINTS = 50;

const POINTS_BY_TYPE: Readonly<Record<RoundType, number>> = {
  'multiple-choice': MC_POINTS,
  'true-false': TF_POINTS,
  open: OPEN_POINTS,
};

/** The true/false answer strings the client submits and the reveal shows. */
export const TF_TRUE = 'True';
export const TF_FALSE = 'False';

/**
 * The categories a host may configure: the ten question categories plus `Random`. `Random` is a UI
 * convenience meaning "all categories" - on the wire it is the empty `categories` list.
 */
export const CONFIGURABLE_CATEGORIES: readonly string[] = [...CATEGORIES, RANDOM_CATEGORY];

/** Host-supplied configuration, validated by {@link validateConfig}. All fields optional (spec 0074). */
export interface TriviaConfig {
  /** A subset of the ten categories to draw from. Omitted or empty = Random (all categories). */
  categories?: string[];
  /**
   * Legacy single-category field (pre-0068). Still accepted for backward compatibility: `Random`
   * resolves to all categories (empty list), any other value to that one category.
   */
  category?: string;
  /** The duration preset (spec 0074). Default `standard`. `custom` requires `custom` counts. */
  duration?: Duration;
  /** Custom composition, required iff `duration === 'custom'`: each count 0-30, total 1-60. */
  custom?: { multipleChoice: number; trueFalse: number; open: number };
  /** Difficulty range floor, integer 1-10, default 3. Must be <= `difficultyMax`. */
  difficultyMin?: number;
  /** Difficulty range ceiling, integer 1-10, default 6. Must be >= `difficultyMin`. */
  difficultyMax?: number;
  /** Auto-advance the answer screen -> leaderboard -> next round. Default true. */
  autoAdvance?: boolean;
  /** Dwell before each auto-advance hop, in seconds. Default 5, range 1-60. */
  advanceAfterSeconds?: number;
  /** Multiple-choice answer window, in seconds. Default 20, range 5-180. */
  mcTimeLimitSeconds?: number;
  /** True/false answer window, in seconds. Default 15, range 5-180. */
  tfTimeLimitSeconds?: number;
  /** Open answer window, in seconds. Default 60, range 10-180. */
  openTimeLimitSeconds?: number;
  /**
   * Legacy round count (pre-0074). Tolerated: maps to a Custom open-only plan of N rounds when no
   * `duration` is given, so a bookmarked or in-flight config never hard-fails.
   */
  rounds?: number;
  /** Legacy single answer window (pre-0074). Tolerated: maps to `openTimeLimitSeconds`. */
  timeLimitSeconds?: number;
}

/** A validated, defaulted configuration. Durations are resolved to a composition + ms windows. */
export interface ResolvedTriviaConfig {
  /** The resolved category subset; an EMPTY list means Random (all categories). */
  categories: string[];
  /** The resolved round composition (MC / TF / open counts). */
  composition: Composition;
  /** Total rounds = the composition sum. */
  rounds: number;
  difficultyMin: number;
  difficultyMax: number;
  autoAdvance: boolean;
  /** Resolved dwell in ms (`advanceAfterSeconds * 1000`). */
  advanceAfterMs: number;
  /** Resolved per-type answer windows in ms. */
  mcWindowMs: number;
  tfWindowMs: number;
  openWindowMs: number;
}

/** A question snapshot persisted per round so reveal can score without re-drawing. */
interface StoredQuestion {
  id: string;
  type: RoundType;
  category: string;
  prompt: string;
  /** Canonical/accepted answers: recall answers for open, `[canonical]` for MC, `['True']`/`['False']` for TF. */
  answers: string[];
  /** The 4 shuffled options for a multiple-choice round; absent otherwise. */
  choices?: string[];
  difficulty: number;
}

interface TriviaScratch {
  /** The category subset to draw from; an empty list means Random (all categories). */
  categories: string[];
  difficultyMin: number;
  difficultyMax: number;
  rounds: number;
  /** The ordered round-type plan built at configure time (spec 0074). */
  plan: RoundType[];
  /** Per-type answer windows in ms, so startRound can return the round's window. */
  mcWindowMs: number;
  tfWindowMs: number;
  openWindowMs: number;
  /** Ids drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  // Per-round working state, keyed by round number. Only the current round is ever read, so
  // startRound prunes finalized rounds to keep the persisted blob and the clone cost O(1round).
  questions: Record<string, StoredQuestion>;
  submitted: Record<string, Record<string, string>>;
  /** Players who submitted an answer that was marked wrong: the dispute-eligible set (open rounds only). */
  wrong: Record<string, string[]>;
  disputers: Record<string, string[]>;
  ballots: Record<string, Record<string, Record<string, boolean>>>;
}

function emptyScratch(cfg: ResolvedTriviaConfig, plan: RoundType[]): TriviaScratch {
  return {
    categories: [...cfg.categories],
    difficultyMin: cfg.difficultyMin,
    difficultyMax: cfg.difficultyMax,
    rounds: plan.length,
    plan: [...plan],
    mcWindowMs: cfg.mcWindowMs,
    tfWindowMs: cfg.tfWindowMs,
    openWindowMs: cfg.openWindowMs,
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
  const rounds = s.rounds ?? DEFAULT_ROUNDS;
  // A pre-0074 in-progress game persisted no `plan`; degrade to an all-open plan of `rounds` so the
  // draw and scoring keep working across the deploy (the game was all open-answer before 0074).
  const plan = Array.isArray(s.plan)
    ? (s.plan.filter((t): t is RoundType => typeof t === 'string') as RoundType[])
    : (Array.from({ length: rounds }, () => 'open' as RoundType) as RoundType[]);
  return {
    categories: scratchCategories(s),
    difficultyMin: s.difficultyMin ?? legacyBand ?? DEFAULT_DIFFICULTY_MIN,
    difficultyMax: s.difficultyMax ?? legacyBand ?? DEFAULT_DIFFICULTY_MAX,
    rounds,
    plan,
    // Windows may be absent on a degraded scratch; leave them undefined-as-0 so startRound omits the
    // per-round override and the engine keeps its configure-time window.
    mcWindowMs: s.mcWindowMs ?? 0,
    tfWindowMs: s.tfWindowMs ?? 0,
    openWindowMs: s.openWindowMs ?? 0,
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
 * Resolve the round composition from the config, tolerating the legacy `rounds` alias. Precedence:
 *   1. an explicit `duration` (custom -> the `custom` counts; a preset -> its fixed composition),
 *   2. else a legacy `rounds` -> a Custom open-only plan of N,
 *   3. else the default duration (`standard`).
 */
function resolveComposition(cfg: Partial<TriviaConfig>): Composition {
  const duration = cfg.duration;
  if (duration !== undefined && !DURATIONS.includes(duration)) {
    throw new Error(
      `trivia duration must be one of ${DURATIONS.join(', ')}, got ${JSON.stringify(duration)}`,
    );
  }

  if (duration === 'custom') {
    const custom = cfg.custom;
    if (custom === null || typeof custom !== 'object') {
      throw new Error(
        'trivia custom duration requires a { multipleChoice, trueFalse, open } object',
      );
    }
    const mc = resolveIntInRange(
      custom.multipleChoice,
      0,
      MIN_CUSTOM_COUNT,
      MAX_CUSTOM_COUNT,
      'custom.multipleChoice',
    );
    const tf = resolveIntInRange(
      custom.trueFalse,
      0,
      MIN_CUSTOM_COUNT,
      MAX_CUSTOM_COUNT,
      'custom.trueFalse',
    );
    const open = resolveIntInRange(
      custom.open,
      0,
      MIN_CUSTOM_COUNT,
      MAX_CUSTOM_COUNT,
      'custom.open',
    );
    const total = mc + tf + open;
    if (total < MIN_CUSTOM_TOTAL || total > MAX_CUSTOM_TOTAL) {
      throw new Error(
        `trivia custom counts must total ${MIN_CUSTOM_TOTAL}-${MAX_CUSTOM_TOTAL} rounds, got ${total}`,
      );
    }
    return { multipleChoice: mc, trueFalse: tf, open };
  }

  if (duration !== undefined) {
    return DURATION_COMPOSITIONS[duration];
  }

  // Legacy `rounds` alias: an open-only Custom plan of N rounds.
  if (cfg.rounds !== undefined) {
    const rounds = resolveIntInRange(cfg.rounds, DEFAULT_ROUNDS, MIN_ROUNDS, MAX_ROUNDS, 'rounds');
    return { multipleChoice: 0, trueFalse: 0, open: rounds };
  }

  return DURATION_COMPOSITIONS[DEFAULT_DURATION];
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's `configure` handoff rejects a bad start rather than launching a broken game. Resolves the
 * duration to a composition and the per-type timers to ms; the ordered plan itself is built in
 * `configure` (it needs the rng).
 */
export function validateConfig(config: unknown): ResolvedTriviaConfig {
  const cfg = (config ?? {}) as Partial<TriviaConfig>;

  const categories = resolveCategories(cfg);
  const composition = resolveComposition(cfg);

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

  const mcTimeLimitSeconds = resolveIntInRange(
    cfg.mcTimeLimitSeconds,
    DEFAULT_MC_TIME_LIMIT_SECONDS,
    MIN_TAP_TIME_LIMIT_SECONDS,
    MAX_TIME_LIMIT_SECONDS,
    'mcTimeLimitSeconds',
  );
  const tfTimeLimitSeconds = resolveIntInRange(
    cfg.tfTimeLimitSeconds,
    DEFAULT_TF_TIME_LIMIT_SECONDS,
    MIN_TAP_TIME_LIMIT_SECONDS,
    MAX_TIME_LIMIT_SECONDS,
    'tfTimeLimitSeconds',
  );
  // The open timer falls back to the legacy single `timeLimitSeconds` when the new field is absent.
  const openTimeLimitSeconds = resolveIntInRange(
    cfg.openTimeLimitSeconds ?? cfg.timeLimitSeconds,
    DEFAULT_OPEN_TIME_LIMIT_SECONDS,
    MIN_OPEN_TIME_LIMIT_SECONDS,
    MAX_TIME_LIMIT_SECONDS,
    'openTimeLimitSeconds',
  );

  return {
    categories,
    composition,
    rounds: composition.multipleChoice + composition.trueFalse + composition.open,
    difficultyMin,
    difficultyMax,
    autoAdvance,
    advanceAfterMs: advanceAfterSeconds * 1000,
    mcWindowMs: mcTimeLimitSeconds * 1000,
    tfWindowMs: tfTimeLimitSeconds * 1000,
    openWindowMs: openTimeLimitSeconds * 1000,
  };
}

/** Count the per-type supply in a category pool (difficulty ignored - the draw widens past it). */
function poolCounts(pool: readonly TriviaQuestion[]): {
  recall: number;
  mcCapable: number;
  trueFalse: number;
} {
  let recall = 0;
  let mcCapable = 0;
  let trueFalse = 0;
  for (const q of pool) {
    if (isTrueFalseQuestion(q)) trueFalse += 1;
    else if (isRecallQuestion(q)) {
      recall += 1;
      if (isMultipleChoiceCapable(q)) mcCapable += 1;
    }
  }
  return { recall, mcCapable, trueFalse };
}

/**
 * The accept-predicate CHAIN for a round type's draw (spec 0074), tried in order so an earlier, more
 * specific pool is preferred. Open rounds prefer open-ONLY recall (reserving the choice-bearing,
 * MC-capable recall for the multiple-choice rounds that require it), and only fall back to any recall
 * once the open-only pool is exhausted. This keeps the draw from starving a later MC round: because
 * open borrows an MC-capable item only after open-only is gone, at most `max(0, open - openOnly)` are
 * borrowed, leaving `min(mcCapable, recall - open) >= mc` for MC whenever configure's guard
 * (`mcCapable >= mc` and `recall >= mc + open`) held - so a game that passed configure never dies
 * mid-play (engineer/architect/tester review, PR #174).
 */
function acceptChainFor(type: RoundType): Array<(q: TriviaQuestion) => boolean> {
  if (type === 'true-false') return [isTrueFalseQuestion];
  if (type === 'multiple-choice') return [isMultipleChoiceCapable];
  // open: open-only recall first, then any recall as a fallback.
  return [(q) => isRecallQuestion(q) && !isMultipleChoiceCapable(q), isRecallQuestion];
}

/** Build the persisted per-round question snapshot from a drawn bank item, per its round type. */
function storeQuestion(
  type: RoundType,
  question: TriviaQuestion,
  rng: () => number,
): StoredQuestion {
  if (type === 'true-false') {
    const tf = question as Extract<TriviaQuestion, { type: 'true-false' }>;
    return {
      id: tf.id,
      type,
      category: tf.category,
      prompt: tf.prompt,
      answers: [tf.isTrue ? TF_TRUE : TF_FALSE],
      difficulty: tf.difficulty,
    };
  }
  const recall = question as RecallQuestion;
  if (type === 'multiple-choice') {
    const canonical = recall.answers[0]!;
    // 4 options = canonical + the first three distractors, shuffled deterministically by the rng.
    const options = shuffleInPlace([canonical, ...(recall.choices ?? []).slice(0, 3)], rng);
    return {
      id: recall.id,
      type,
      category: recall.category,
      prompt: recall.prompt,
      answers: [canonical],
      choices: options,
      difficulty: recall.difficulty,
    };
  }
  // open: keep the full accepted-answers array for the fuzzy matcher.
  return {
    id: recall.id,
    type,
    category: recall.category,
    prompt: recall.prompt,
    answers: [...recall.answers],
    difficulty: recall.difficulty,
  };
}

/**
 * Build a Trivia module bound to a question bank. `rng` (defaulting to `Math.random`) drives the plan
 * shuffle, the in-range question pick, and the MC option shuffle; inject a seeded rng to make a whole
 * game deterministic in tests. The bank is indexed once here, not per round.
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
      const { multipleChoice: mc, trueFalse: tf, open } = cfg.composition;
      // The draw never repeats a question, so the chosen pool must supply the plan per type: enough
      // recall for the open+MC rounds combined, enough choice-bearing recall for the MC rounds, and
      // enough true/false items for the TF rounds. Reject up front here rather than let `startRound`
      // throw partway through a live game, after players have already invested rounds.
      const counts = poolCounts(poolFor(index, cfg.categories));
      const label = cfg.categories.length === 0 ? RANDOM_CATEGORY : cfg.categories.join(', ');
      if (counts.trueFalse < tf) {
        throw new Error(
          `trivia categories "${label}" have only ${counts.trueFalse} true/false question(s), ` +
            `fewer than the ${tf} true/false round(s) this duration needs`,
        );
      }
      if (counts.mcCapable < mc) {
        throw new Error(
          `trivia categories "${label}" have only ${counts.mcCapable} multiple-choice-capable ` +
            `question(s), fewer than the ${mc} multiple-choice round(s) this duration needs`,
        );
      }
      if (counts.recall < mc + open) {
        throw new Error(
          `trivia categories "${label}" have only ${counts.recall} recall question(s), fewer than ` +
            `the ${mc + open} open + multiple-choice round(s) this duration needs`,
        );
      }
      const plan = buildRoundPlan(cfg.composition, rng);
      // Pacing (spec 0068/0074): the answer window is per-round (returned from startRound); the
      // dispute/answer-screen dwell and the leaderboard auto-advance dwell are the advance-after delay
      // when auto-advance is on, and 0 (host-advanced) when it is off.
      const dwellMs = cfg.autoAdvance ? cfg.advanceAfterMs : 0;
      return {
        scratch: toRecord(emptyScratch(cfg, plan)),
        rounds: plan.length,
        disputeWindowMs: dwellMs,
        // Configure-time fallback window; each round overrides it with its type's window via
        // StartRoundResult.moveWindowMs (spec 0074). Use the open window (the longest) as the default.
        moveWindowMs: cfg.openWindowMs,
        leaderboardWindowMs: dwellMs,
      };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const type = scratch.plan[ctx.round - 1] ?? 'open';
      const used = new Set(scratch.usedIds);
      // Try each accepted pool in preference order (open: open-only recall, then any recall).
      let question: TriviaQuestion | null = null;
      for (const accept of acceptChainFor(type)) {
        question = pickQuestion(
          index,
          scratch.categories,
          scratch.difficultyMin,
          scratch.difficultyMax,
          used,
          rng,
          accept,
        );
        if (question) break;
      }
      if (!question) {
        const label =
          scratch.categories.length === 0 ? RANDOM_CATEGORY : scratch.categories.join(', ');
        throw new Error(`trivia ran out of ${type} questions for categories "${label}"`);
      }
      scratch.usedIds.push(question.id);
      const stored = storeQuestion(type, question, rng);
      // Prior rounds are finalized (their scores already applied on the engine); only the current
      // round's working state is ever read again, so drop the rest. This keeps the Redis-persisted
      // scratch and the per-frame clone cost flat instead of growing with every round played.
      scratch.questions = { [key]: stored };
      scratch.submitted = { [key]: {} };
      scratch.wrong = {};
      scratch.disputers = {};
      scratch.ballots = {};
      const windowMs =
        type === 'multiple-choice'
          ? scratch.mcWindowMs
          : type === 'true-false'
            ? scratch.tfWindowMs
            : scratch.openWindowMs;
      return {
        scratch: toRecord(scratch),
        prompt: {
          round: ctx.round,
          type,
          category: stored.category,
          difficulty: stored.difficulty,
          question: stored.prompt,
          // Only a multiple-choice round streams its options; open/TF omit `choices`.
          ...(stored.choices ? { choices: stored.choices } : {}),
        },
        // Per-round answer window (spec 0074). Omit it on a degraded pre-0074 scratch (window 0) so
        // the engine keeps its configure-time window.
        ...(windowMs > 0 ? { moveWindowMs: windowMs } : {}),
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
      const type: RoundType = question?.type ?? 'open';
      const isOpen = type === 'open';

      const correct: string[] = [];
      const wrong: string[] = [];
      // Every player's submitted answer, so the reveal can show the whole table what each other
      // person said (spec 0017), with its correct/wrong verdict.
      const submissions: { player: string; answer: string; correct: boolean }[] = [];
      for (const [player, answer] of Object.entries(submitted)) {
        // Open rounds fuzzy-match against the accepted answers; MC/TF are exact against the single
        // canonical answer (the chosen option / the True/False string), bypassing the fuzzy matcher.
        const isCorrect = question
          ? isOpen
            ? isCorrectAnswer(answer, question.answers)
            : answer === question.answers[0]
          : false;
        if (isCorrect) {
          correct.push(player);
        } else if (isOpen && answer.trim() !== '') {
          // A wrong OPEN answer is dispute-eligible. MC/TF are unambiguous, so they never populate the
          // dispute-eligible `wrong` set (no dispute affordance off open rounds). A blank give-up
          // ("I don't know", WS16) is never dispute-eligible either.
          wrong.push(player);
        }
        submissions.push({ player, answer, correct: isCorrect });
      }
      // Only `wrong` is persisted - it gates dispute eligibility. `correct` is streamed in the
      // reveal payload but never read back, so it is not kept in scratch.
      scratch.wrong[key] = wrong;

      const points = POINTS_BY_TYPE[type];
      const scores: ScoreEvent[] = correct.map((player) => ({
        player,
        points,
        reason: 'correct answer',
      }));

      return {
        scratch: toRecord(scratch),
        reveal: {
          round: ctx.round,
          type,
          question: question?.prompt ?? null,
          answers: question?.answers ?? [],
          // MC options ride along so the reveal can highlight the right button; absent for open/TF.
          ...(question?.choices ? { choices: question.choices } : {}),
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
        // Only a player who submitted an answer and was marked wrong may raise a dispute. `wrong` is
        // populated only on open rounds, so MC/TF rounds have no disputers (spec 0074).
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
 * Trivial Matters as a plugin the engine registers. `create` loads the question bank once through the
 * injected asset loader (rooted at this package via `import.meta.url`) and builds the module with the
 * injected rng; `validateConfig` is the manifest's config schema, run at the start-handoff boundary.
 * The id stays `trivia` (spec 0074 rename is display-only), so no route, saved game, or data path
 * breaks.
 */
export const triviaPlugin: GamePlugin<ResolvedTriviaConfig> = {
  manifest: {
    id: TRIVIA_GAME_ID,
    name: 'Trivial Matters',
    version: '1.0.0',
    configSchema: validateConfig,
  },
  create: async (services) =>
    createTriviaGame(
      await loadQuestionBank(services.assets.forModule(import.meta.url)),
      services.rng,
    ),
};
