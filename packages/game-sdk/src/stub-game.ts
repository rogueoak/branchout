// A minimal stub game for tests and local smoke runs. It is NOT a real game - it exists only to
// drive the full generic lifecycle end to end, including the dispute paths and end-game ranking, so
// the engine (harness) can be tested without any real game. It lives in the SDK's `./testing` entry
// and never ships in a production bundle.
//
// Rules: each round has a secret answer. A player whose submitted answer equals the secret scores
// 100. A wrong player may dispute (a `vote` during the dispute window, targeting themselves); the
// other players then vote, and a strict majority of them upholding the dispute awards it 50.

import { rankStandings, type ScoreEvent, type Standing } from '@branchout/protocol';
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
} from './lifecycle';
import type { GamePlugin } from './plugin';

export const STUB_GAME_ID = 'stub';

export interface StubConfig {
  rounds?: number;
  disputeWindowMs?: number;
  moveWindowMs?: number;
  /** The correct answer for each round; the last entry repeats if there are more rounds. */
  secrets?: string[];
  /**
   * Per-player private (hidden-information) payloads to hand out at each round's start (spec 0052),
   * indexed by round (0-based). `startRound` returns `privates[round - 1]` as its `private` map, so a
   * test can prove the engine delivers `{ A: secretA, B: secretB }` to A and B alone. Omitted by the
   * default stub, which returns no `private` and exercises the unchanged (no-secret) path.
   */
  privates?: Record<string, unknown>[];
}

interface StubScratch {
  secrets: string[];
  privates: Record<string, unknown>[];
  submitted: Record<string, Record<string, string>>;
  correct: Record<string, string[]>;
  disputers: Record<string, string[]>;
  ballots: Record<string, Record<string, Record<string, boolean>>>;
}

const CORRECT_POINTS = 100;
const DISPUTE_POINTS = 50;

function asScratch(scratch: Readonly<Record<string, unknown>>): StubScratch {
  const s = scratch as Partial<StubScratch>;
  return {
    secrets: s.secrets ?? [],
    privates: s.privates ?? [],
    submitted: s.submitted ?? {},
    correct: s.correct ?? {},
    disputers: s.disputers ?? {},
    ballots: s.ballots ?? {},
  };
}

/** Deep clone through JSON so a mutation never leaks back into the persisted state. */
function clone(scratch: StubScratch): StubScratch {
  return JSON.parse(JSON.stringify(scratch)) as StubScratch;
}

function secretFor(scratch: StubScratch, round: number): string {
  const secrets = scratch.secrets;
  if (secrets.length === 0) return 'answer';
  return secrets[Math.min(round, secrets.length) - 1] ?? secrets[secrets.length - 1] ?? 'answer';
}

export const stubGame: GameModule = {
  id: STUB_GAME_ID,

  configure(config: unknown): ConfigureResult {
    const cfg = (config ?? {}) as StubConfig;
    const rounds = cfg.rounds ?? cfg.secrets?.length ?? 3;
    if (!Number.isInteger(rounds) || rounds < 1) {
      throw new Error(`stub game needs at least 1 round, got ${String(rounds)}`);
    }
    const secrets = cfg.secrets ?? Array.from({ length: rounds }, () => 'answer');
    const scratch: StubScratch = {
      secrets,
      privates: cfg.privates ?? [],
      submitted: {},
      correct: {},
      disputers: {},
      ballots: {},
    };
    return {
      scratch: scratch as unknown as Record<string, unknown>,
      rounds,
      disputeWindowMs: cfg.disputeWindowMs ?? 0,
      moveWindowMs: cfg.moveWindowMs ?? 0,
    };
  },

  startRound(ctx: RoundContext): StartRoundResult {
    const scratch = clone(asScratch(ctx.scratch));
    const key = String(ctx.round);
    scratch.submitted[key] ??= {};
    // Deal this round's per-player secret map when the config supplied one (spec 0052). Omitted (the
    // default) leaves `private` undefined, so the stub still drives the unchanged no-secret path.
    const privatePayloads = scratch.privates[ctx.round - 1];
    return {
      scratch: scratch as unknown as Record<string, unknown>,
      prompt: { round: ctx.round, question: `stub round ${ctx.round}` },
      ...(privatePayloads ? { private: privatePayloads } : {}),
    };
  },

  collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
    const scratch = clone(asScratch(ctx.scratch));
    const key = String(ctx.round);
    const round = (scratch.submitted[key] ??= {});
    round[player] = move;
    return { scratch: scratch as unknown as Record<string, unknown> };
  },

  // Mirror the generic "everyone submitted" predicate the engine auto-advances on (feedback 0015):
  // true once every connected player has submitted this round.
  allSubmitted(ctx: RoundContext): boolean {
    const scratch = asScratch(ctx.scratch);
    const round = scratch.submitted[String(ctx.round)] ?? {};
    const connected = ctx.players.filter((p) => p.connected);
    return connected.length > 0 && connected.every((p) => round[p.player] !== undefined);
  },

  reveal(ctx: RoundContext): RevealResult {
    const scratch = clone(asScratch(ctx.scratch));
    const key = String(ctx.round);
    const secret = secretFor(scratch, ctx.round);
    const submitted = scratch.submitted[key] ?? {};
    const correct = Object.entries(submitted)
      .filter(([, answer]) => answer.trim().toLowerCase() === secret.trim().toLowerCase())
      .map(([player]) => player);
    scratch.correct[key] = correct;
    const scores: ScoreEvent[] = correct.map((player) => ({
      player,
      points: CORRECT_POINTS,
      reason: 'correct answer',
    }));
    return {
      scratch: scratch as unknown as Record<string, unknown>,
      reveal: { round: ctx.round, secret, correct },
      scores,
    };
  },

  collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
    const scratch = clone(asScratch(ctx.scratch));
    const key = String(ctx.round);
    if (ctx.phase === 'disputing') {
      // A wrong player disputes their own result.
      const correct = scratch.correct[key] ?? [];
      if (!correct.includes(vote.player)) {
        const disputers = (scratch.disputers[key] ??= []);
        if (!disputers.includes(vote.player)) disputers.push(vote.player);
      }
    } else if (ctx.phase === 'voting') {
      // A ballot on a disputer, from anyone who is not that disputer.
      if (vote.target !== vote.player) {
        const perRound = (scratch.ballots[key] ??= {});
        const perTarget = (perRound[vote.target] ??= {});
        perTarget[vote.player] = vote.agree;
      }
    }
    return { scratch: scratch as unknown as Record<string, unknown> };
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
      const otherPlayers = ctx.players.filter((p) => p.player !== disputer).length;
      const perTarget = ballots[disputer] ?? {};
      const agrees = Object.values(perTarget).filter((agree) => agree).length;
      // Strict majority of the *other* players must uphold it.
      if (otherPlayers > 0 && agrees * 2 > otherPlayers) {
        upheld.push(disputer);
        scores.push({ player: disputer, points: DISPUTE_POINTS, reason: 'dispute upheld' });
      }
    }
    return {
      scratch: scratch as unknown as Record<string, unknown>,
      scores,
      reveal: { round: ctx.round, upheld },
    };
  },

  leaderboard(ctx: RoundContext): Standing[] {
    return rankStandings(ctx.players, ctx.scores);
  },

  advance(ctx: RoundContext): AdvanceResult {
    const scratch = asScratch(ctx.scratch);
    return { done: ctx.round >= scratch.secrets.length };
  },

  endGame(ctx: RoundContext): Standing[] {
    return rankStandings(ctx.players, ctx.scores);
  },
};

/** The stub wrapped as a plugin, for exercising the engine's plugin runtime in tests. */
export const stubPlugin: GamePlugin<StubConfig> = {
  manifest: {
    id: STUB_GAME_ID,
    name: 'Stub',
    version: '1.0.0',
    configSchema: (raw: unknown) => (raw ?? {}) as StubConfig,
  },
  create: () => stubGame,
};
