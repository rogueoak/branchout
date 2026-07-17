// The Zinger game module (spec 0053). A funny-answer prompt + head-to-head vote party game on the
// engine's generic decision lifecycle (spec 0020): the engine owns the 90s answer window, the 30s
// vote window, streaming, and persistence; this module owns the rules - the setup draw, collecting
// each zinger, pairing two of them into a face-off, and scoring the vote. Every callback is a pure
// function over `RoundContext`; the only injected state is the prompt bank and an rng, both fixed when
// the module is built. Terminology: prompt = "the setup", answer = "a zinger", head-to-head = "the
// face-off", a unanimous vote = "a clean sweep" (a bonus).
//
// Lifecycle mapping onto spec 0020's hooks:
//   configure     -> answer window = 90s
//   startRound    -> draw an unused setup; the viewer shows it
//   collectMove -> record a zinger, or `rejected` an empty one (a private reply)
//   allSubmitted   -> every connected player submitted a zinger (early-close the answer window)
//   reveal        -> pick two authors' zingers for the face-off, returns `decision` (30s vote)
//   collectVote   -> a vote for one face-off zinger (a non-author only)
//   allDecided    -> every eligible voter voted (early-close the vote window)
//   resolveDecision -> the winning zinger's author scores 1 per vote, + a clean-sweep bonus

import { rankStandings, type ScoreEvent, type Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DecisionResult,
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
import { loadPromptBank, validatePromptBank, type ZingerPrompt } from './prompts';
import { DEFAULT_ROUNDS, validateConfig, type ResolvedZingerConfig } from './config';

export const ZINGER_GAME_ID = 'zinger';

/** Players have 90s to write and submit their zinger (the spec's answer window). */
export const ANSWER_WINDOW_MS = 90_000;
/** Players have 30s to vote on the funnier zinger in the face-off. */
export const VOTE_WINDOW_MS = 30_000;

/** The winner scores this per vote their zinger drew. */
export const POINTS_PER_VOTE = 1;
/** A clean sweep (every eligible voter, at least two, picked the same zinger) adds this bonus. */
export const CLEAN_SWEEP_BONUS = 3;
/** A clean sweep needs at least this many eligible voters, so a 1-0 vote is not a "sweep". */
export const MIN_SWEEP_VOTERS = 2;

/** A setup snapshot persisted for the round in play so reveal/resolve need no re-draw. */
interface RoundSetup {
  id: string;
  setup: string;
}

/** One side of the face-off streamed at reveal: a stable id and the zinger text (author hidden). */
export interface ZingerOption {
  id: string;
  text: string;
}

interface ZingerScratch {
  rounds: number;
  /** Setup ids drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  // Per-round working state. Only the current round is read, so startRound resets it.
  round: number;
  setup: RoundSetup | null;
  /** player -> their (trimmed) submitted zinger. */
  submissions: Record<string, string>;
  /** The two face-off options, set at reveal. Empty when the round had fewer than two zingers. */
  options: ZingerOption[];
  /** optionId -> the author (player id) of that zinger. */
  authors: Record<string, string>;
  /** player -> the option id they voted for. */
  votes: Record<string, string>;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): ZingerScratch {
  const s = scratch as Partial<ZingerScratch>;
  return {
    rounds: s.rounds ?? DEFAULT_ROUNDS,
    usedIds: s.usedIds ?? [],
    round: s.round ?? 0,
    setup: s.setup ?? null,
    submissions: s.submissions ?? {},
    options: s.options ?? [],
    authors: s.authors ?? {},
    votes: s.votes ?? {},
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: ZingerScratch): ZingerScratch {
  return JSON.parse(JSON.stringify(scratch)) as ZingerScratch;
}

function toRecord(scratch: ZingerScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

export function createZingerGame(
  bank: readonly ZingerPrompt[],
  rng: () => number = Math.random,
): GameModule {
  /** Draw one unused setup from the bank. */
  function pickSetup(scratch: ZingerScratch): ZingerPrompt {
    const used = new Set(scratch.usedIds);
    const pool = bank.filter((p) => !used.has(p.id));
    if (pool.length === 0) {
      throw new Error('zinger: ran out of unused setups');
    }
    return pool[Math.floor(rng() * pool.length)]!;
  }

  return {
    id: ZINGER_GAME_ID,

    configure(config: unknown): ConfigureResult {
      const cfg = validateConfig(config);
      if (bank.length < cfg.rounds) {
        throw new Error(`zinger: only ${bank.length} setups available, need ${cfg.rounds} rounds`);
      }
      const scratch: ZingerScratch = {
        rounds: cfg.rounds,
        usedIds: [],
        round: 0,
        setup: null,
        submissions: {},
        options: [],
        authors: {},
        votes: {},
      };
      return { scratch: toRecord(scratch), rounds: cfg.rounds, moveWindowMs: ANSWER_WINDOW_MS };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const prev = asScratch(ctx.scratch);
      const setup = pickSetup(prev);
      const scratch: ZingerScratch = {
        rounds: prev.rounds,
        usedIds: [...prev.usedIds, setup.id],
        round: ctx.round,
        setup: { id: setup.id, setup: setup.setup },
        submissions: {},
        options: [],
        authors: {},
        votes: {},
      };
      return {
        scratch: toRecord(scratch),
        prompt: { round: ctx.round, setup: setup.setup },
      };
    },

    collectMove(ctx: RoundContext, player: string, answer: string): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      const trimmed = answer.trim();
      // Reject an empty zinger; a player may otherwise freely change their own before the window ends.
      if (trimmed.length === 0) {
        return { scratch: unchanged, rejected: { reason: 'write a zinger first' } };
      }
      if (!current.setup) return { scratch: unchanged }; // no active round: ignore quietly
      const scratch = clone(current);
      scratch.submissions[player] = trimmed;
      return { scratch: toRecord(scratch) };
    },

    allSubmitted(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const connected = ctx.players.filter((p) => p.connected);
      return (
        connected.length > 0 && connected.every((p) => scratch.submissions[p.player] !== undefined)
      );
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      const setup = scratch.setup;
      if (!setup) throw new Error('zinger: reveal with no active setup');

      // Pick two distinct authors' zingers for the face-off. Fewer than two zingers means no face-off
      // this round - reveal directly with no options and no vote (scores nothing).
      const authors = Object.keys(scratch.submissions);
      if (authors.length < 2) {
        scratch.options = [];
        scratch.authors = {};
        scratch.votes = {};
        return {
          scratch: toRecord(scratch),
          reveal: { round: ctx.round, setup: setup.setup, options: [] },
          scores: [],
        };
      }

      // Seeded pick of two distinct authors, so a test pins the pairing. Draw the first, then draw the
      // second from the rest.
      const pool = [...authors];
      const firstIdx = Math.floor(rng() * pool.length);
      const first = pool.splice(firstIdx, 1)[0]!;
      const secondIdx = Math.floor(rng() * pool.length);
      const second = pool.splice(secondIdx, 1)[0]!;

      const pair = [first, second];
      const options: ZingerOption[] = [];
      const authorsById: Record<string, string> = {};
      pair.forEach((author, i) => {
        const id = String(i);
        options.push({ id, text: scratch.submissions[author]! });
        authorsById[id] = author;
      });
      scratch.options = options;
      scratch.authors = authorsById;
      scratch.votes = {};
      return {
        scratch: toRecord(scratch),
        // The face-off shows both zingers but not their authors. `authorIds` reveals only WHICH TWO
        // PLAYERS are the contestants (so their remotes can gate the sit-out on identity, never on
        // text) - it is deliberately NOT keyed to the options, so the option->author mapping (whose
        // zinger is whose) stays hidden and anonymity holds.
        reveal: { round: ctx.round, setup: setup.setup, options, authorIds: pair },
        scores: [],
        decision: { windowMs: VOTE_WINDOW_MS },
      };
    },

    collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      if (!(vote.target in current.authors)) return { scratch: unchanged }; // unknown option: ignore
      // A face-off author cannot vote on their own face-off (either side).
      const authorIds = Object.values(current.authors);
      if (authorIds.includes(vote.player)) return { scratch: unchanged };
      const scratch = clone(current);
      scratch.votes[vote.player] = vote.target;
      return { scratch: toRecord(scratch) };
    },

    allDecided(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const authorIds = new Set(Object.values(scratch.authors));
      // Eligible voters are every connected player who is not one of the two face-off authors.
      const eligible = ctx.players.filter((p) => p.connected && !authorIds.has(p.player));
      return eligible.length > 0 && eligible.every((p) => scratch.votes[p.player] !== undefined);
    },

    resolveDecision(ctx: RoundContext): DecisionResult {
      const scratch = clone(asScratch(ctx.scratch));

      // Tally votes per option.
      const tally: Record<string, number> = {};
      for (const option of scratch.options) tally[option.id] = 0;
      for (const optionId of Object.values(scratch.votes)) {
        if (optionId in tally) tally[optionId] = (tally[optionId] ?? 0) + 1;
      }

      const scores: ScoreEvent[] = [];

      // The clean sweep is measured against every ELIGIBLE voter (connected non-authors), not merely
      // the votes actually cast: resolveDecision also runs on the vote-window timeout, so a partial
      // vote (say 2 of 4 eligible) that all landed on one option must NOT count as unanimous.
      const authorIds = new Set(Object.values(scratch.authors));
      const eligibleVoterCount = ctx.players.filter(
        (p) => p.connected && !authorIds.has(p.player),
      ).length;

      // The winner is the option with strictly more votes. A tie splits no points.
      let winnerId: string | null = null;
      if (scratch.options.length === 2) {
        const [a, b] = scratch.options;
        const av = tally[a!.id] ?? 0;
        const bv = tally[b!.id] ?? 0;
        if (av > bv) winnerId = a!.id;
        else if (bv > av) winnerId = b!.id;
      }

      let cleanSweep = false;
      if (winnerId !== null) {
        const winnerVotes = tally[winnerId] ?? 0;
        const winnerAuthor = scratch.authors[winnerId]!;
        if (winnerVotes > 0) {
          scores.push({
            player: winnerAuthor,
            points: winnerVotes * POINTS_PER_VOTE,
            reason: 'won the face-off',
          });
        }
        // A clean sweep: every eligible voter voted for the winner (not just every cast vote), and
        // there were enough eligible voters to make it count.
        if (winnerVotes === eligibleVoterCount && eligibleVoterCount >= MIN_SWEEP_VOTERS) {
          cleanSweep = true;
          scores.push({
            player: winnerAuthor,
            points: CLEAN_SWEEP_BONUS,
            reason: 'a clean sweep',
          });
        }
      }

      const options = scratch.options.map((o) => ({
        id: o.id,
        text: o.text,
        author: scratch.authors[o.id],
        votes: tally[o.id] ?? 0,
        winner: o.id === winnerId,
      }));

      return {
        scratch: toRecord(scratch),
        scores,
        reveal: {
          round: ctx.round,
          setup: scratch.setup?.setup,
          options,
          winner: winnerId,
          cleanSweep,
        },
      };
    },

    // Zinger always takes the vote (decision) path, so the dispute hooks are never reached; the
    // GameModule contract still requires them, so they are inert.
    disputeWindow(ctx: RoundContext): DisputeWindowResult {
      return { scratch: ctx.scratch as Record<string, unknown>, disputes: [] };
    },

    disputeVote(ctx: RoundContext): DisputeVoteResult {
      return { scratch: ctx.scratch as Record<string, unknown>, scores: [] };
    },

    leaderboard(ctx: RoundContext): Standing[] {
      return rankStandings(ctx.players, ctx.scores);
    },

    advance(ctx: RoundContext): AdvanceResult {
      return { done: ctx.round >= asScratch(ctx.scratch).rounds };
    },

    endGame(ctx: RoundContext): Standing[] {
      return rankStandings(ctx.players, ctx.scores);
    },
  };
}

/** The Zinger plugin: the manifest + a factory that loads its prompt bank via the injected loader. */
export const zingerPlugin: GamePlugin<ResolvedZingerConfig> = {
  manifest: {
    id: ZINGER_GAME_ID,
    name: 'Zinger',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 3 },
    visibility: 'insider',
  },
  create: async (services) => {
    const bank = await loadPromptBank(services.assets.forModule(import.meta.url));
    // Fail fast on malformed shipped data: abort boot with a clear error rather than crashing
    // mid-game. Structural per-item checks only - no count gate (the bank grows over time).
    validatePromptBank(bank);
    return createZingerGame(bank, services.rng);
  },
};
