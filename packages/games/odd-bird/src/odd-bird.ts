// The Odd Bird game module: a hidden-role location deduction game on the engine's generic decision
// lifecycle (spec 0020) with per-player private payloads (spec 0052). A roost (a shared location) is
// drawn; every player is a member of the flock and gets the SAME roost plus a DISTINCT perch (a role
// at it) - except one random player, the odd bird, who is told only that they are the odd bird. The
// flock asks pointed questions out loud (out of band); the app deals the secret cards, runs the long
// question window, then collects the accusation vote (the flush) and the odd bird's roost guess.
//
// The whole point is the secret: each player's card (roost + perch, or "you are the odd bird") is
// delivered ONLY to that player via the spec 0052 `private` channel and is NEVER placed in the
// broadcast prompt/reveal. A non-recipient must never learn another player's card, and the odd bird
// must never learn the roost.
//
// Lifecycle mapping onto the engine's hooks (a single location game = one round):
//   configure       -> the question window = a long timer; rounds = 1
//   startRound      -> draw a roost, pick the odd bird, deal perches; deliver each card via `private`
//   collectMove   -> a player calls the flush (ends the question window early); nothing else moves
//   allSubmitted    -> a flush was called (early-close the question window)
//   reveal          -> opens the flush: the accusation ballot + (for the odd bird) the roost guess
//   collectVote     -> a flock member accuses a player; the odd bird guesses a roost
//   allDecided      -> every connected player has cast their ballot/guess
//   resolveDecision -> tally the flush; resolve win/loss; award points; final reveal

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
import { loadRoostBank, validateRoostBank, type OddBirdRoost } from './roosts';
import { validateConfig, type ResolvedOddBirdConfig } from './config';

export const ODD_BIRD_GAME_ID = 'odd-bird';

/** The flock has a long window to question each other out loud before the flush opens (8 minutes). */
export const QUESTION_WINDOW_MS = 480_000;
/** Once the flush opens, the vote/guess window (2 minutes). */
export const FLUSH_WINDOW_MS = 120_000;

/** Each member of the flock scores this when the flock flushes the odd bird. */
export const FLOCK_WIN_POINTS = 100;
/** The odd bird scores this for surviving the flush (the flock fingered the wrong bird). */
export const SURVIVE_POINTS = 100;
/** The odd bird scores this for naming the roost, whether or not it was flushed. */
export const GUESS_POINTS = 150;

/** The prefix marking a vote target as the odd bird's roost guess (vs. an accusation of a player). */
export const ROOST_GUESS_PREFIX = 'roost:';

/** A player's private card. The flock sees the roost + their perch; the odd bird sees neither. */
export type PrivateCard = { role: 'flock'; roost: string; perch: string } | { role: 'odd-bird' };

/** A roost snapshot persisted for the round in play so reveal/resolve need no re-draw. */
interface RoundRoost {
  id: string;
  category: string;
  name: string;
}

/** One roost the odd bird may guess from at the flush. */
export interface RoostOption {
  id: string;
  name: string;
}

interface OddBirdScratch {
  categories: string[] | 'random';
  /** The drawn roost for this game, or null before it is drawn. */
  roost: RoundRoost | null;
  /** The player id of the odd bird, or null before roles are dealt. */
  oddBird: string | null;
  /** player -> their dealt perch (the odd bird is absent). */
  perches: Record<string, string>;
  /** True once a player has called the flush, so the question window auto-closes. */
  flushCalled: boolean;
  /** The roost options offered to the odd bird at the flush (ids + names, shuffled). */
  roostOptions: RoostOption[];
  /** A flock member's accusation: player -> the accused player id. */
  accusations: Record<string, string>;
  /** The odd bird's roost guess: the guessed roost id, or null if not yet guessed. */
  guess: string | null;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): OddBirdScratch {
  const s = scratch as Partial<OddBirdScratch>;
  return {
    categories: s.categories ?? 'random',
    roost: s.roost ?? null,
    oddBird: s.oddBird ?? null,
    perches: s.perches ?? {},
    flushCalled: s.flushCalled ?? false,
    roostOptions: s.roostOptions ?? [],
    accusations: s.accusations ?? {},
    guess: s.guess ?? null,
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: OddBirdScratch): OddBirdScratch {
  return JSON.parse(JSON.stringify(scratch)) as OddBirdScratch;
}

function toRecord(scratch: OddBirdScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** True when the roost belongs to the configured categories (`random` spans all). */
function inCategories(roost: OddBirdRoost, categories: string[] | 'random'): boolean {
  return categories === 'random' || categories.includes(roost.category);
}

/** In-place Fisher-Yates shuffle off the injected rng, so a seeded test pins the order. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

/**
 * Build the per-player private cards for a dealt round: the odd bird gets the bare "odd bird" card,
 * every other player gets the shared roost plus their distinct perch. NEVER goes in the broadcast
 * frame - the engine delivers each entry only to that player's device (spec 0052).
 */
function privateCards(scratch: OddBirdScratch): Record<string, PrivateCard> {
  const cards: Record<string, PrivateCard> = {};
  const roost = scratch.roost;
  if (!roost || !scratch.oddBird) return cards;
  cards[scratch.oddBird] = { role: 'odd-bird' };
  for (const [player, perch] of Object.entries(scratch.perches)) {
    cards[player] = { role: 'flock', roost: roost.name, perch };
  }
  return cards;
}

export function createOddBirdGame(
  bank: readonly OddBirdRoost[],
  rng: () => number = Math.random,
): GameModule {
  /** Draw one roost from the configured categories. */
  function pickRoost(categories: string[] | 'random'): OddBirdRoost {
    const pool = bank.filter((r) => inCategories(r, categories));
    if (pool.length === 0) {
      throw new Error('odd-bird: no roosts for the chosen categories');
    }
    return pool[Math.floor(rng() * pool.length)]!;
  }

  return {
    id: ODD_BIRD_GAME_ID,

    configure(config: unknown): ConfigureResult {
      const cfg = validateConfig(config);
      const available = bank.filter((r) => inCategories(r, cfg.categories)).length;
      if (available === 0) {
        throw new Error('odd-bird: no roosts for the chosen categories');
      }
      const scratch: OddBirdScratch = {
        categories: cfg.categories,
        roost: null,
        oddBird: null,
        perches: {},
        flushCalled: false,
        roostOptions: [],
        accusations: {},
        guess: null,
      };
      // One location game per session; the long question window is the timed phase.
      return { scratch: toRecord(scratch), rounds: 1, moveWindowMs: QUESTION_WINDOW_MS };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const prev = asScratch(ctx.scratch);
      const roost = pickRoost(prev.categories);

      // Deal roles off the injected rng: pick the odd bird, then a distinct perch per flock member.
      const playerIds = ctx.players.map((p) => p.player);
      const shuffledPlayers = [...playerIds];
      shuffle(shuffledPlayers, rng);
      const oddBird = shuffledPlayers[0]!;
      const flock = playerIds.filter((id) => id !== oddBird);

      const perchPool = [...roost.perches];
      shuffle(perchPool, rng);
      const perches: Record<string, string> = {};
      flock.forEach((player, i) => {
        perches[player] = perchPool[i]!;
      });

      const scratch: OddBirdScratch = {
        categories: prev.categories,
        roost: { id: roost.id, category: roost.category, name: roost.name },
        oddBird,
        perches,
        flushCalled: false,
        roostOptions: [],
        accusations: {},
        guess: null,
      };

      return {
        scratch: toRecord(scratch),
        // The broadcast prompt carries NO secret: just the table size and the phase framing.
        prompt: { round: ctx.round, players: playerIds.length, category: roost.category },
        // The secret card goes ONLY to each player (spec 0052) - never the broadcast frame.
        private: privateCards(scratch),
      };
    },

    collectMove(ctx: RoundContext, _player: string, move: string): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      // The only move is calling the flush - ending the question window early so the vote opens.
      if (move.trim() !== 'flush') return { scratch: unchanged };
      if (current.flushCalled) return { scratch: unchanged };
      const scratch = clone(current);
      scratch.flushCalled = true;
      return { scratch: toRecord(scratch) };
    },

    allSubmitted(ctx: RoundContext): boolean {
      // Any player calling the flush closes the question window; otherwise the long timer closes it.
      return asScratch(ctx.scratch).flushCalled;
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      if (!scratch.roost || !scratch.oddBird)
        throw new Error('odd-bird: reveal with no dealt round');

      // The odd bird guesses from a shuffled slate: the true roost plus decoys from the same bank.
      const decoyPool = bank
        .filter((r) => inCategories(r, scratch.categories) && r.id !== scratch.roost!.id)
        .map((r) => ({ id: r.id, name: r.name }));
      shuffle(decoyPool, rng);
      const options: RoostOption[] = [
        { id: scratch.roost.id, name: scratch.roost.name },
        ...decoyPool.slice(0, 7),
      ];
      shuffle(options, rng);
      scratch.roostOptions = options;
      scratch.accusations = {};
      scratch.guess = null;

      return {
        scratch: toRecord(scratch),
        // The flush frame lists who can be accused and the roost slate the odd bird guesses from; it
        // still names NO secret (not the roost, not who the odd bird is).
        reveal: {
          round: ctx.round,
          players: ctx.players.map((p) => p.player),
          roostOptions: options,
        },
        scores: [],
        decision: { windowMs: FLUSH_WINDOW_MS },
        // Re-emit each card so it survives into the flush phase (and a rejoin catches it up).
        private: privateCards(scratch),
      };
    },

    collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      if (!current.roost || !current.oddBird) return { scratch: unchanged };

      // A roost-prefixed target is the odd bird's location guess; only the odd bird may cast it.
      if (vote.target.startsWith(ROOST_GUESS_PREFIX)) {
        if (vote.player !== current.oddBird) return { scratch: unchanged };
        const roostId = vote.target.slice(ROOST_GUESS_PREFIX.length);
        if (!current.roostOptions.some((o) => o.id === roostId)) return { scratch: unchanged };
        const scratch = clone(current);
        scratch.guess = roostId;
        return { scratch: toRecord(scratch) };
      }

      // Otherwise it is an accusation: the target must be a real player, and only a flock member
      // accuses (the odd bird's ballot is their roost guess, never an accusation).
      if (vote.player === current.oddBird) return { scratch: unchanged };
      if (!ctx.players.some((p) => p.player === vote.target)) return { scratch: unchanged };
      const scratch = clone(current);
      scratch.accusations[vote.player] = vote.target;
      return { scratch: toRecord(scratch) };
    },

    allDecided(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      if (!scratch.oddBird) return false;
      const connected = ctx.players.filter((p) => p.connected);
      if (connected.length === 0) return false;
      return connected.every((p) =>
        p.player === scratch.oddBird
          ? scratch.guess !== null
          : scratch.accusations[p.player] !== undefined,
      );
    },

    resolveDecision(ctx: RoundContext): DecisionResult {
      const scratch = clone(asScratch(ctx.scratch));
      const oddBird = scratch.oddBird;
      const roost = scratch.roost;
      if (!oddBird || !roost) throw new Error('odd-bird: resolve with no dealt round');

      // Tally accusations. The flushed bird is the single most-accused player; a tie flushes no one.
      const tally: Record<string, number> = {};
      for (const target of Object.values(scratch.accusations)) {
        tally[target] = (tally[target] ?? 0) + 1;
      }
      let flushed: string | null = null;
      let top = 0;
      let tied = false;
      for (const [player, count] of Object.entries(tally)) {
        if (count > top) {
          top = count;
          flushed = player;
          tied = false;
        } else if (count === top) {
          tied = true;
        }
      }
      if (tied || top === 0) flushed = null;

      const flockFlushedOddBird = flushed === oddBird;
      const guessedRoost = scratch.guess === roost.id;

      const scores: ScoreEvent[] = [];
      if (flockFlushedOddBird) {
        // The flock exposed the odd bird: every member of the flock scores.
        for (const player of ctx.players) {
          if (player.player === oddBird) continue;
          scores.push({
            player: player.player,
            points: FLOCK_WIN_POINTS,
            reason: 'flushed the odd bird',
          });
        }
      } else {
        // The odd bird slipped the flush and scores for surviving.
        scores.push({ player: oddBird, points: SURVIVE_POINTS, reason: 'survived the flush' });
      }
      if (guessedRoost) {
        // Naming the roost scores the odd bird regardless of the flush outcome.
        scores.push({ player: oddBird, points: GUESS_POINTS, reason: 'named the roost' });
      }

      const guessedName = scratch.roostOptions.find((o) => o.id === scratch.guess)?.name ?? null;

      return {
        scratch: toRecord(scratch),
        scores,
        // The final reveal names the roost, who the odd bird was, and how the flush landed.
        reveal: {
          round: ctx.round,
          roost: roost.name,
          oddBird,
          flushed,
          guessedRoost,
          guessedName,
          flockWon: flockFlushedOddBird,
          accusations: scratch.accusations,
        },
      };
    },

    // Odd Bird always takes the decision (flush) path, so the dispute hooks are never reached; the
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

    advance(): AdvanceResult {
      // One location game per session.
      return { done: true };
    },

    endGame(ctx: RoundContext): Standing[] {
      return rankStandings(ctx.players, ctx.scores);
    },
  };
}

/** The Odd Bird plugin: the manifest + a factory that loads its roost bank via the injected loader. */
export const oddBirdPlugin: GamePlugin<ResolvedOddBirdConfig> = {
  manifest: {
    id: ODD_BIRD_GAME_ID,
    name: 'Odd Bird',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 3, maxPlayers: 8 },
    visibility: 'insider',
  },
  create: async (services) => {
    const bank = await loadRoostBank(services.assets.forModule(import.meta.url));
    // Fail fast on malformed shipped data: abort boot with a clear error rather than crashing
    // mid-game. Structural per-item checks only - no category-count gate (the bank grows over time).
    validateRoostBank(bank);
    return createOddBirdGame(bank, services.rng);
  },
};
