// A minimal decision-path fixture for tests and the engine's guess-phase coverage. It is NOT a real
// game - it exists to drive the generic reject + guess/decision lifecycle (spec 0020) end to end:
// players submit a fake, a duplicate (or the truth) is rejected, then everyone guesses which option
// is the truth, and scoring is Fibbage-shaped (100 for a correct guess, 50 per fooled author).

import { rankStandings, type ScoreEvent, type Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DecisionResult,
  GameModule,
  RevealResult,
  RoundContext,
  ScratchResult,
  StartRoundResult,
  VoteInput,
} from './lifecycle';
import type { GamePlugin } from './plugin';

export const DECIDER_GAME_ID = 'decider';

const CORRECT_POINTS = 100;
const FOOLED_POINTS = 50;
const DEFAULT_WINDOW_MS = 30_000;

export interface DeciderConfig {
  rounds?: number;
  /** The guess-window duration in ms (0 = host-advances). */
  windowMs?: number;
  /** The correct answer for each round; the last entry repeats if there are more rounds. */
  truths?: string[];
}

interface DeciderScratch {
  truths: string[];
  windowMs: number;
  /** round -> player -> their submitted fake. */
  submitted: Record<string, Record<string, string>>;
  /** round -> player -> the option string they guessed. */
  guesses: Record<string, Record<string, string>>;
}

const norm = (s: string): string => s.trim().toLowerCase();

function asScratch(scratch: Readonly<Record<string, unknown>>): DeciderScratch {
  const s = scratch as Partial<DeciderScratch>;
  return {
    truths: s.truths ?? [],
    windowMs: s.windowMs ?? DEFAULT_WINDOW_MS,
    submitted: s.submitted ?? {},
    guesses: s.guesses ?? {},
  };
}

function clone(scratch: DeciderScratch): DeciderScratch {
  return JSON.parse(JSON.stringify(scratch)) as DeciderScratch;
}

function truthFor(scratch: DeciderScratch, round: number): string {
  const t = scratch.truths;
  if (t.length === 0) return 'truth';
  return t[Math.min(round, t.length) - 1] ?? t[t.length - 1] ?? 'truth';
}

const toRecord = (s: DeciderScratch): Record<string, unknown> =>
  s as unknown as Record<string, unknown>;

export const deciderGame: GameModule = {
  id: DECIDER_GAME_ID,

  configure(config: unknown): ConfigureResult {
    const cfg = (config ?? {}) as DeciderConfig;
    const rounds = cfg.rounds ?? cfg.truths?.length ?? 1;
    if (!Number.isInteger(rounds) || rounds < 1) {
      throw new Error(`decider game needs at least 1 round, got ${String(rounds)}`);
    }
    const scratch: DeciderScratch = {
      truths: cfg.truths ?? Array.from({ length: rounds }, () => 'truth'),
      windowMs: cfg.windowMs ?? DEFAULT_WINDOW_MS,
      submitted: {},
      guesses: {},
    };
    return { scratch: toRecord(scratch), rounds };
  },

  startRound(ctx: RoundContext): StartRoundResult {
    const scratch = clone(asScratch(ctx.scratch));
    const key = String(ctx.round);
    scratch.submitted[key] ??= {};
    scratch.guesses[key] ??= {};
    return {
      scratch: toRecord(scratch),
      prompt: { round: ctx.round, clue: `decide ${ctx.round}` },
    };
  },

  collectAnswer(ctx: RoundContext, player: string, answer: string): ScratchResult {
    const scratch = clone(asScratch(ctx.scratch));
    const key = String(ctx.round);
    const round = (scratch.submitted[key] ??= {});
    const truth = truthFor(scratch, ctx.round);
    // Reject the truth or a fake another player already claimed - with a deliberately vague reason.
    if (norm(answer) === norm(truth)) {
      return { scratch: ctx.scratch as Record<string, unknown>, rejected: { reason: 'taken' } };
    }
    for (const [other, fake] of Object.entries(round)) {
      if (other !== player && norm(fake) === norm(answer)) {
        return { scratch: ctx.scratch as Record<string, unknown>, rejected: { reason: 'taken' } };
      }
    }
    round[player] = answer;
    return { scratch: toRecord(scratch) };
  },

  allAnswered(ctx: RoundContext): boolean {
    const scratch = asScratch(ctx.scratch);
    const round = scratch.submitted[String(ctx.round)] ?? {};
    const connected = ctx.players.filter((p) => p.connected);
    return connected.length > 0 && connected.every((p) => round[p.player] !== undefined);
  },

  reveal(ctx: RoundContext): RevealResult {
    const scratch = asScratch(ctx.scratch);
    const key = String(ctx.round);
    const truth = truthFor(scratch, ctx.round);
    const fakes = Object.values(scratch.submitted[key] ?? {});
    // Options = the truth plus every distinct fake (order is not important for the fixture).
    const options = [truth, ...fakes.filter((f) => norm(f) !== norm(truth))];
    return {
      scratch: ctx.scratch as Record<string, unknown>,
      reveal: { round: ctx.round, truth, options },
      scores: [],
      decision: { windowMs: scratch.windowMs },
    };
  },

  collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
    if (ctx.phase !== 'guessing') return { scratch: ctx.scratch as Record<string, unknown> };
    const scratch = clone(asScratch(ctx.scratch));
    const key = String(ctx.round);
    const guesses = (scratch.guesses[key] ??= {});
    const own = scratch.submitted[key]?.[vote.player];
    // A player cannot pick their own fake; ignore such a guess.
    if (own === undefined || norm(own) !== norm(vote.target)) {
      guesses[vote.player] = vote.target;
    }
    return { scratch: toRecord(scratch) };
  },

  allDecided(ctx: RoundContext): boolean {
    const scratch = asScratch(ctx.scratch);
    const guesses = scratch.guesses[String(ctx.round)] ?? {};
    const connected = ctx.players.filter((p) => p.connected);
    return connected.length > 0 && connected.every((p) => guesses[p.player] !== undefined);
  },

  resolveDecision(ctx: RoundContext): DecisionResult {
    const scratch = asScratch(ctx.scratch);
    const key = String(ctx.round);
    const truth = truthFor(scratch, ctx.round);
    const submitted = scratch.submitted[key] ?? {};
    const guesses = scratch.guesses[key] ?? {};
    const scores: ScoreEvent[] = [];
    for (const [player, choice] of Object.entries(guesses)) {
      if (norm(choice) === norm(truth)) {
        scores.push({ player, points: CORRECT_POINTS, reason: 'correct guess' });
        continue;
      }
      // A non-truth choice fools the author of the matching fake.
      for (const [author, fake] of Object.entries(submitted)) {
        if (author !== player && norm(fake) === norm(choice)) {
          scores.push({ player: author, points: FOOLED_POINTS, reason: 'fooled a player' });
        }
      }
    }
    return {
      scratch: ctx.scratch as Record<string, unknown>,
      scores,
      reveal: { round: ctx.round, truth, guesses },
    };
  },

  // The dispute hooks are unused by a decision game but the interface requires them.
  disputeWindow(ctx: RoundContext) {
    return { scratch: ctx.scratch as Record<string, unknown>, disputes: [] };
  },

  disputeVote(ctx: RoundContext) {
    return { scratch: ctx.scratch as Record<string, unknown>, scores: [] };
  },

  leaderboard(ctx: RoundContext): Standing[] {
    return rankStandings(ctx.players, ctx.scores);
  },

  advance(ctx: RoundContext): AdvanceResult {
    const scratch = asScratch(ctx.scratch);
    return { done: ctx.round >= scratch.truths.length };
  },

  endGame(ctx: RoundContext): Standing[] {
    return rankStandings(ctx.players, ctx.scores);
  },
};

export const deciderPlugin: GamePlugin<DeciderConfig> = {
  manifest: {
    id: DECIDER_GAME_ID,
    name: 'Decider',
    version: '1.0.0',
    configSchema: (raw) => (raw ?? {}) as DeciderConfig,
  },
  create: () => deciderGame,
};
