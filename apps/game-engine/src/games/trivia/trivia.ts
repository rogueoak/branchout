// The Trivia game module (spec 0008). Pure game logic over the engine's GameModule lifecycle:
// the engine owns phase sequencing, the 10s dispute-window timer, streaming, and persistence;
// this module owns Trivia's rules - config validation, question draw, answer scoring, and
// dispute resolution. Everything here is a pure callback over `RoundContext`; the only injected
// state is the pre-indexed question bank and an rng, both fixed when the module is built.

import { rankStandings, type ScoreEvent, type Standing } from '@branchout/protocol';
import { CATEGORIES, type Difficulty, type TriviaQuestion } from '../../question-bank';
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
  DEFAULT_DIFFICULTY,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  isValidDifficulty,
  sampleTier,
} from './difficulty';
import { isCorrectAnswer } from './matching';
import { RANDOM_CATEGORY, indexQuestions, pickQuestion, type QuestionIndex } from './selection';

export const TRIVIA_GAME_ID = 'trivia';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;

/** The 10-second dispute window the spec mandates, in milliseconds. */
export const DISPUTE_WINDOW_MS = 10_000;

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
  /** 1-10, default 5. */
  difficulty?: number;
}

/** A validated, defaulted configuration. */
export interface ResolvedTriviaConfig {
  category: string;
  rounds: number;
  difficulty: number;
}

/** A question snapshot persisted per round so reveal can score without re-drawing. */
interface StoredQuestion {
  id: string;
  category: string;
  prompt: string;
  answers: string[];
  difficulty: Difficulty;
}

interface TriviaScratch {
  category: string;
  difficulty: number;
  rounds: number;
  /** Ids drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  /** Per round (string key): the drawn question and the play state. */
  questions: Record<string, StoredQuestion>;
  submitted: Record<string, Record<string, string>>;
  correct: Record<string, string[]>;
  /** Players who submitted an answer that was marked wrong: the dispute-eligible set. */
  wrong: Record<string, string[]>;
  disputers: Record<string, string[]>;
  ballots: Record<string, Record<string, Record<string, boolean>>>;
}

function emptyScratch(cfg: ResolvedTriviaConfig): TriviaScratch {
  return {
    category: cfg.category,
    difficulty: cfg.difficulty,
    rounds: cfg.rounds,
    usedIds: [],
    questions: {},
    submitted: {},
    correct: {},
    wrong: {},
    disputers: {},
    ballots: {},
  };
}

function asScratch(scratch: Readonly<Record<string, unknown>>): TriviaScratch {
  const s = scratch as Partial<TriviaScratch>;
  return {
    category: s.category ?? RANDOM_CATEGORY,
    difficulty: s.difficulty ?? DEFAULT_DIFFICULTY,
    rounds: s.rounds ?? DEFAULT_ROUNDS,
    usedIds: s.usedIds ?? [],
    questions: s.questions ?? {},
    submitted: s.submitted ?? {},
    correct: s.correct ?? {},
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

  const difficulty = cfg.difficulty ?? DEFAULT_DIFFICULTY;
  if (!isValidDifficulty(difficulty)) {
    throw new Error(
      `trivia difficulty must be an integer ${MIN_DIFFICULTY}-${MAX_DIFFICULTY}, got ${difficulty}`,
    );
  }

  return { category: cfg.category, rounds, difficulty };
}

/**
 * Build a Trivia module bound to a question bank. `rng` (defaulting to `Math.random`) drives the
 * difficulty draw and in-tier pick; inject a seeded rng to make a whole game deterministic in
 * tests. The bank is indexed once here, not per round.
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
      return {
        scratch: toRecord(emptyScratch(cfg)),
        rounds: cfg.rounds,
        disputeWindowMs: DISPUTE_WINDOW_MS,
      };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const tier = sampleTier(scratch.difficulty, rng);
      const used = new Set(scratch.usedIds);
      const question = pickQuestion(index, scratch.category, tier, used, rng);
      if (!question) {
        throw new Error(`trivia ran out of questions for category "${scratch.category}"`);
      }
      scratch.usedIds.push(question.id);
      scratch.questions[key] = {
        id: question.id,
        category: question.category,
        prompt: question.prompt,
        answers: [...question.answers],
        difficulty: question.difficulty,
      };
      scratch.submitted[key] ??= {};
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

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      const key = String(ctx.round);
      const question = scratch.questions[key];
      const submitted = scratch.submitted[key] ?? {};

      const correct: string[] = [];
      const wrong: string[] = [];
      for (const [player, answer] of Object.entries(submitted)) {
        if (question && isCorrectAnswer(answer, question.answers)) correct.push(player);
        else wrong.push(player);
      }
      scratch.correct[key] = correct;
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
        // Denominator is every *other* player (eligible voters), not just those who voted, so a
        // silent player counts against the dispute - a strict majority of the others must agree.
        const otherPlayers = ctx.players.filter((p) => p.player !== disputer).length;
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
