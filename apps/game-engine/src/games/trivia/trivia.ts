// The Trivia game module (spec 0008). Pure game logic over the engine's GameModule lifecycle:
// the engine owns phase sequencing, the 10s dispute-window timer, streaming, and persistence;
// this module owns Trivia's rules - config validation, question draw, answer scoring, and
// dispute resolution. Everything here is a pure callback over `RoundContext`; the only injected
// state is the pre-indexed question bank and an rng, both fixed when the module is built.

import { rankStandings, type ScoreEvent, type Standing } from '@branchout/protocol';
import type { GamePlugin } from '@branchout/game-sdk';
import { CATEGORIES, loadQuestionBank, type TriviaQuestion } from './question-bank';
import type {
  AdvanceResult,
  ConfigureResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  RevealResult,
  RoundContext,
  ScratchResult,
  StartRoundResult,
  VoteInput,
} from '../../lifecycle';
import {
  DEFAULT_DIFFICULTY_MAX,
  DEFAULT_DIFFICULTY_MIN,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  isValidDifficultyRange,
} from './difficulty';
import { isCorrectAnswer } from './matching';
import { RANDOM_CATEGORY, indexQuestions, pickQuestion, type QuestionIndex } from './selection';

export const TRIVIA_GAME_ID = 'trivia';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;

/** The 10-second dispute window the spec mandates, in milliseconds. */
export const DISPUTE_WINDOW_MS = 10_000;

/** The 60-second answer window: a round auto-closes to reveal when it expires (spec 0017). */
export const ANSWER_WINDOW_MS = 60_000;

const CORRECT_POINTS = 100;
const DISPUTE_POINTS = 50;

/** The categories a host may configure: the eight question categories plus `Random`. */
export const CONFIGURABLE_CATEGORIES: readonly string[] = [...CATEGORIES, RANDOM_CATEGORY];

/** Host-supplied configuration, validated by {@link validateConfig}. */
export interface TriviaConfig {
  /** One of the eight categories or `Random`. */
  category: string;
  /** 1-100, default 10. */
  rounds?: number;
  /** Difficulty range floor, integer 1-10, default 4. Must be <= `difficultyMax`. */
  difficultyMin?: number;
  /** Difficulty range ceiling, integer 1-10, default 6. Must be >= `difficultyMin`. */
  difficultyMax?: number;
}

/** A validated, defaulted configuration. */
export interface ResolvedTriviaConfig {
  category: string;
  rounds: number;
  difficultyMin: number;
  difficultyMax: number;
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
  category: string;
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
    category: cfg.category,
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

function asScratch(scratch: Readonly<Record<string, unknown>>): TriviaScratch {
  const s = scratch as Partial<TriviaScratch>;
  // Degrade a pre-0016 scratch (a single numeric `difficulty`) to a single-rating band rather than
  // silently resetting a game-in-progress to the default range across an engine deploy (spec 0016).
  const legacy = (scratch as { difficulty?: unknown }).difficulty;
  const legacyBand = typeof legacy === 'number' ? legacy : undefined;
  return {
    category: s.category ?? RANDOM_CATEGORY,
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

/** Total questions available for a category (the `Random` pool spans all categories). */
function poolSize(index: QuestionIndex, category: string): number {
  return index.byCategory.get(category)?.length ?? 0;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's `configure` handoff rejects a bad start rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedTriviaConfig {
  const cfg = (config ?? {}) as Partial<TriviaConfig>;

  if (typeof cfg.category !== 'string' || !CONFIGURABLE_CATEGORIES.includes(cfg.category)) {
    throw new Error(
      `trivia category must be one of ${CONFIGURABLE_CATEGORIES.join(', ')}, got ` +
        `${JSON.stringify(cfg.category)}`,
    );
  }

  const rounds = cfg.rounds ?? DEFAULT_ROUNDS;
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new Error(`trivia rounds must be an integer ${MIN_ROUNDS}-${MAX_ROUNDS}, got ${rounds}`);
  }

  const difficultyMin = cfg.difficultyMin ?? DEFAULT_DIFFICULTY_MIN;
  const difficultyMax = cfg.difficultyMax ?? DEFAULT_DIFFICULTY_MAX;
  if (!isValidDifficultyRange(difficultyMin, difficultyMax)) {
    throw new Error(
      `trivia difficulty range must be integers ${MIN_DIFFICULTY}-${MAX_DIFFICULTY} with min <= max, ` +
        `got ${JSON.stringify(difficultyMin)}-${JSON.stringify(difficultyMax)}`,
    );
  }

  return { category: cfg.category, rounds, difficultyMin, difficultyMax };
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
      const available = poolSize(index, cfg.category);
      if (available < cfg.rounds) {
        throw new Error(
          `trivia category "${cfg.category}" has only ${available} question(s), fewer than the ` +
            `configured ${cfg.rounds} round(s)`,
        );
      }
      return {
        scratch: toRecord(emptyScratch(cfg)),
        rounds: cfg.rounds,
        disputeWindowMs: DISPUTE_WINDOW_MS,
        answerWindowMs: ANSWER_WINDOW_MS,
      };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const used = new Set(scratch.usedIds);
      const question = pickQuestion(
        index,
        scratch.category,
        scratch.difficultyMin,
        scratch.difficultyMax,
        used,
        rng,
      );
      if (!question) {
        throw new Error(`trivia ran out of questions for category "${scratch.category}"`);
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

    collectAnswer(ctx: RoundContext, player: string, answer: string): ScratchResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const round = (scratch.submitted[key] ??= {});
      round[player] = answer;
      return { scratch: toRecord(scratch) };
    },

    // The round is complete once every connected player has an answer this round. Only connected
    // players count, so a dropped device never holds the round open; the empty-table guard keeps a
    // roster with nobody connected from reading as "all answered".
    allAnswered(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const round = scratch.submitted[String(ctx.round)] ?? {};
      const connected = ctx.players.filter((p) => p.connected);
      return connected.length > 0 && connected.every((p) => round[p.player] !== undefined);
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
        if (isCorrect) correct.push(player);
        else wrong.push(player);
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
 * Trivia as a plugin the engine registers. `create` loads the question bank once (via the injected
 * services' rng) and builds the module; `validateConfig` is the manifest's config schema, run at the
 * start-handoff boundary. The bank still self-locates its data for now; a later spec moves Trivia
 * into its own package and reads through the injected asset loader.
 */
export const triviaPlugin: GamePlugin<ResolvedTriviaConfig> = {
  manifest: {
    id: TRIVIA_GAME_ID,
    name: 'Trivia',
    version: '1.0.0',
    configSchema: validateConfig,
  },
  create: async (services) => createTriviaGame(await loadQuestionBank(), services.rng),
};
