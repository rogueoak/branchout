// The Lone Leaf game module (spec 0057). A COOPERATIVE single-clue word game on the engine's generic
// decision lifecycle (spec 0020) with per-player private payloads (spec 0052). Each round one player
// is the Seeker (rotating); the OTHER players see a secret seed word the Seeker must NOT see and each
// writes ONE one-word leaf for it; matching or invalid leaves "wilt" (are cleared) before the Seeker
// sees the survivors; the Seeker makes one guess. Scoring is co-op: everyone shares the round result.
//
// The seed is a SECRET the Seeker must never receive. It is delivered to every NON-Seeker via the
// engine's `private` channel (spec 0052) - never in the broadcast prompt/reveal - so the Seeker's
// device never sees it until the guess resolves. A unit test proves the Seeker is absent from the
// private map and the prompt carries no seed.
//
// Lifecycle mapping onto spec 0020's hooks:
//   configure       -> the answer window (leaf writing), the guess window, and the auto-advance dwell
//                      are all host-configured (spec 0057 pacing); defaults 60s / 60s / auto-advance 5s
//   startRound      -> draw an unused seed; pick the Seeker; deliver the seed privately to non-Seekers
//   collectMove     -> record a non-Seeker's one-word leaf, or `rejected` (the Seeker / blank / two words)
//   allSubmitted    -> every connected non-Seeker submitted a leaf
//   reveal          -> wilt matching/invalid leaves; the survivors are the Seeker's clues; `decision` (guess window)
//   collectVote     -> the Seeker's guess (free text carried in the vote target) during `guessing`
//   allDecided      -> the Seeker has guessed
//   resolveDecision -> co-op: a correct guess banks +1 for everyone; the seed is revealed here

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
  SessionPlayer,
  StartRoundResult,
  VoteInput,
} from '@branchout/game-sdk';
import {
  DEFAULT_DIFFICULTY_MAX,
  DEFAULT_DIFFICULTY_MIN,
  DEFAULT_GUESS_SECONDS,
  DEFAULT_ROUNDS,
  validateConfig,
  type ResolvedLoneLeafConfig,
} from './config';
import { isSingleWord, leafKey, leafRevealsSeed, normalizeLeaf, sameLeaf } from './matching';
import { pickSeedInBand } from './selection';
import { loadSeedBank, validateSeedBank, type LoneLeafSeed } from './seeds';

export const LONE_LEAF_GAME_ID = 'lone-leaf';

/** A correct guess banks this for every player (co-op: the whole grove shares the result). */
export const BANK_POINTS = 1;

/** True when the seed belongs to the configured categories (`random` spans all). */
function inCategories(seed: LoneLeafSeed, categories: string[] | 'random'): boolean {
  return categories === 'random' || categories.includes(seed.category);
}

/** A seed snapshot persisted for the round in play so reveal/resolve need no re-draw. */
interface RoundSeed {
  id: string;
  category: string;
  word: string;
  aliases: string[];
}

/** One submitted leaf and whether it survived the wilt. Streamed at reveal (never with the seed). */
export interface LeafResult {
  /** The submitting player's id. */
  player: string;
  /** The word they wrote. */
  word: string;
  /** True when the leaf survived (unique + valid); false when it wilted (a match or the seed). */
  survived: boolean;
}

interface LoneLeafScratch {
  categories: string[] | 'random';
  rounds: number;
  /** The obscurity band the round draw stays within, widening to nearest when the band is exhausted. */
  difficultyMin: number;
  difficultyMax: number;
  /** The Seeker's guess window in ms, carried from configure so reveal can set the decision window. */
  guessMs: number;
  /** Seed ids drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  // Per-round working state. Only the current round is ever read, so startRound resets it.
  round: number;
  seed: RoundSeed | null;
  /** The Seeker for the round in play (rotates by round). */
  seeker: string | null;
  /** player -> their (trimmed) submitted leaf. Non-Seekers only. */
  leaves: Record<string, string>;
  /** The wilt outcome computed at reveal: every leaf with its survived flag, and the survivors' words. */
  results: LeafResult[];
  survivors: string[];
  /** The Seeker's guess for the round, set during the guess phase. */
  guess: string | null;
  /** Whether the round's guess was correct, set at resolve. */
  correct: boolean;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): LoneLeafScratch {
  const s = scratch as Partial<LoneLeafScratch>;
  return {
    categories: s.categories ?? 'random',
    rounds: s.rounds ?? DEFAULT_ROUNDS,
    difficultyMin: s.difficultyMin ?? DEFAULT_DIFFICULTY_MIN,
    difficultyMax: s.difficultyMax ?? DEFAULT_DIFFICULTY_MAX,
    guessMs: s.guessMs ?? DEFAULT_GUESS_SECONDS * 1000,
    usedIds: s.usedIds ?? [],
    round: s.round ?? 0,
    seed: s.seed ?? null,
    seeker: s.seeker ?? null,
    leaves: s.leaves ?? {},
    results: s.results ?? [],
    survivors: s.survivors ?? [],
    guess: s.guess ?? null,
    correct: s.correct ?? false,
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: LoneLeafScratch): LoneLeafScratch {
  return JSON.parse(JSON.stringify(scratch)) as LoneLeafScratch;
}

function toRecord(scratch: LoneLeafScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/**
 * The Seeker for a round, rotating by seat order so every player takes the role in turn. Seat order is
 * the roster order the engine passes (stable across a game). `round` is 1-based, so round 1 -> seat 0.
 */
export function seekerForRound(players: readonly SessionPlayer[], round: number): string | null {
  if (players.length === 0) return null;
  const index = (round - 1) % players.length;
  return players[index]!.player;
}

/**
 * Run the wilt: a leaf survives only when it is a single valid word, does not match the seed, and no
 * OTHER player wrote a leaf with the same stem. Matching leaves ALL wilt (both of a duplicate pair),
 * mirroring the real rule. Returns each leaf with its survived flag, in the given player order.
 */
export function wiltLeaves(
  leaves: Record<string, string>,
  seedWord: string,
  order: readonly string[],
): LeafResult[] {
  // Count how many players share each stem key, so a key seen more than once wilts all its leaves.
  const keyCounts = new Map<string, number>();
  for (const word of Object.values(leaves)) {
    const key = leafKey(word);
    if (key.length === 0) continue; // invalid (empty stem) never counts toward a collision
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const results: LeafResult[] = [];
  for (const player of order) {
    const word = leaves[player];
    if (word === undefined) continue;
    const key = leafKey(word);
    const valid = isSingleWord(word);
    // A leaf wilts if it gives the seed away: the whole seed, or any single token of a multi-word
    // seed (so "einstein" cannot survive against "albert einstein" and leak the answer).
    const matchesSeed = leafRevealsSeed(word, seedWord);
    const collides = (keyCounts.get(key) ?? 0) > 1;
    results.push({ player, word, survived: valid && !matchesSeed && !collides });
  }
  return results;
}

export function createLoneLeafGame(
  bank: readonly LoneLeafSeed[],
  rng: () => number = Math.random,
): GameModule {
  /**
   * Draw one unused seed from the configured categories, preferring the host's difficulty band and
   * widening to the nearest rating when the band is exhausted (see selection.ts). The category filter
   * is the hard boundary; the band only orders the draw within it.
   */
  function pickSeed(scratch: LoneLeafScratch): LoneLeafSeed {
    const used = new Set(scratch.usedIds);
    const pool = bank.filter((s) => inCategories(s, scratch.categories) && !used.has(s.id));
    const seed = pickSeedInBand(pool, scratch.difficultyMin, scratch.difficultyMax, rng);
    if (!seed) {
      throw new Error('lone-leaf: ran out of unused seeds for the chosen categories');
    }
    return seed;
  }

  return {
    id: LONE_LEAF_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      const cfg = validateConfig(config);
      const available = bank.filter((s) => inCategories(s, cfg.categories)).length;
      if (available < cfg.rounds) {
        throw new Error(
          `lone-leaf: only ${available} seeds for the chosen categories, need ${cfg.rounds} rounds`,
        );
      }
      void players;
      const scratch: LoneLeafScratch = {
        categories: cfg.categories,
        rounds: cfg.rounds,
        difficultyMin: cfg.difficultyMin,
        difficultyMax: cfg.difficultyMax,
        guessMs: cfg.guessMs,
        usedIds: [],
        round: 0,
        seed: null,
        seeker: null,
        leaves: {},
        results: [],
        survivors: [],
        guess: null,
        correct: false,
      };
      // Pacing (spec 0057): the leaf-writing window is the clue time; the reveal/leaderboard dwell is
      // the advance-after delay when auto-advance is on, and 0 (host-advanced) when it is off - the
      // generic engine reports auto-advance = (leaderboardWindowMs > 0), so no extra field is needed.
      return {
        scratch: toRecord(scratch),
        rounds: cfg.rounds,
        moveWindowMs: cfg.clueMs,
        leaderboardWindowMs: cfg.autoAdvance ? cfg.advanceAfterMs : 0,
      };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const prev = asScratch(ctx.scratch);
      const seed = pickSeed(prev);
      const seeker = seekerForRound(ctx.players, ctx.round);
      const scratch: LoneLeafScratch = {
        categories: prev.categories,
        rounds: prev.rounds,
        difficultyMin: prev.difficultyMin,
        difficultyMax: prev.difficultyMax,
        guessMs: prev.guessMs,
        usedIds: [...prev.usedIds, seed.id],
        round: ctx.round,
        seed: {
          id: seed.id,
          category: seed.category,
          word: seed.word,
          aliases: seed.aliases ?? [],
        },
        seeker,
        leaves: {},
        results: [],
        survivors: [],
        guess: null,
        correct: false,
      };
      // The seed is a SECRET the Seeker must never receive. Deliver it ONLY to every NON-Seeker via the
      // per-player private channel (spec 0052); the broadcast prompt carries the round, category, and
      // WHO the Seeker is - never the seed word. The Seeker is absent from the private map entirely.
      const secret: Record<string, unknown> = {};
      for (const p of ctx.players) {
        if (p.player === seeker) continue;
        secret[p.player] = { round: ctx.round, seed: seed.word, category: seed.category };
      }
      return {
        scratch: toRecord(scratch),
        prompt: { round: ctx.round, category: seed.category, seeker },
        private: secret,
      };
    },

    collectMove(ctx: RoundContext, player: string, leaf: string): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      if (!current.seed) return { scratch: unchanged }; // no active round: ignore quietly
      // The Seeker does not write a leaf - they are the one guessing. Refuse their submission.
      if (player === current.seeker) {
        return { scratch: unchanged, rejected: { reason: 'you are the Seeker this round' } };
      }
      const trimmed = leaf.trim();
      if (normalizeLeaf(trimmed).length === 0) {
        return { scratch: unchanged, rejected: { reason: 'write one word' } };
      }
      // A leaf must be a single word - the whole clue is one word.
      if (!isSingleWord(trimmed)) {
        return { scratch: unchanged, rejected: { reason: 'one word only' } };
      }
      const scratch = clone(current);
      scratch.leaves[player] = trimmed;
      return { scratch: toRecord(scratch) };
    },

    allSubmitted(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      // Every connected NON-Seeker must have written a leaf (the Seeker writes none). If nobody but the
      // Seeker is connected this stays false and the round does not auto-complete - that is intentional;
      // the host-configured clue (move) window is the backstop that advances the round, so it is not a hang.
      const writers = ctx.players.filter((p) => p.connected && p.player !== scratch.seeker);
      return writers.length > 0 && writers.every((p) => scratch.leaves[p.player] !== undefined);
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      const seed = scratch.seed;
      if (!seed) throw new Error('lone-leaf: reveal with no active seed');
      // Wilt matching/invalid leaves; the survivors are the clues the Seeker will guess from. Order by
      // the roster so the outcome is deterministic regardless of submission order.
      const order = ctx.players.map((p) => p.player);
      const results = wiltLeaves(scratch.leaves, seed.word, order);
      const survivors = results.filter((r) => r.survived).map((r) => r.word);
      scratch.results = results;
      scratch.survivors = survivors;
      scratch.guess = null;
      scratch.correct = false;
      return {
        scratch: toRecord(scratch),
        // The reveal shows the SURVIVING leaves to everyone (the Seeker guesses from them) - but NEVER
        // the seed word. A wilted leaf can EQUAL the seed (a player wrote it, so it wilted), so its raw
        // word must not ride this broadcast frame to the Seeker's device. Only survivors are emitted
        // here (they can never equal the seed); the full wilted-vs-survived breakdown is deferred to the
        // final leaderboard reveal, where the seed is already public.
        reveal: {
          round: ctx.round,
          category: seed.category,
          seeker: scratch.seeker,
          survivors,
          leaves: results.filter((r) => r.survived),
        },
        scores: [],
        decision: { windowMs: scratch.guessMs },
      };
    },

    collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      if (!current.seed) return { scratch: unchanged };
      // Only the Seeker guesses. Ignore anyone else's vote frame.
      if (vote.player !== current.seeker) return { scratch: unchanged };
      const guess = vote.target.trim();
      if (normalizeLeaf(guess).length === 0) return { scratch: unchanged }; // empty guess: ignore
      const scratch = clone(current);
      scratch.guess = guess;
      return { scratch: toRecord(scratch) };
    },

    allDecided(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      // The round's decision is complete once the Seeker has guessed (the only decider).
      return scratch.guess !== null;
    },

    resolveDecision(ctx: RoundContext): DecisionResult {
      const scratch = clone(asScratch(ctx.scratch));
      const seed = scratch.seed;
      if (!seed) throw new Error('lone-leaf: resolve with no active seed');
      const guess = scratch.guess ?? '';
      // A correct guess matches the seed word or one of its aliases (using the same generous leaf
      // matching, so a plural or a case variant still counts).
      const correct = [seed.word, ...seed.aliases].some((accepted) => sameLeaf(guess, accepted));
      scratch.correct = correct;

      // Co-op scoring: a correct guess banks +1 for EVERY player, so the whole grove shares the round
      // result (a shared standing). A miss banks nothing for anyone.
      const scores: ScoreEvent[] = [];
      if (correct) {
        for (const p of ctx.players) {
          scores.push({ player: p.player, points: BANK_POINTS, reason: 'the grove banked a leaf' });
        }
      }
      return {
        scratch: toRecord(scratch),
        scores,
        // The final reveal names the seed (safe now the guess is in), the Seeker's guess, whether it
        // banked, and the surviving/wilted leaves with their authors.
        reveal: {
          round: ctx.round,
          category: seed.category,
          seeker: scratch.seeker,
          seed: seed.word,
          guess,
          correct,
          survivors: scratch.survivors,
          leaves: scratch.results,
        },
      };
    },

    // Lone Leaf always takes the guess (decision) path, so the dispute hooks are never reached; the
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

/** The Lone Leaf plugin: the manifest + a factory that loads its seed bank via the injected loader. */
export const loneLeafPlugin: GamePlugin<ResolvedLoneLeafConfig> = {
  manifest: {
    id: LONE_LEAF_GAME_ID,
    name: 'Lone Leaf',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 3, maxPlayers: 7 },
    visibility: 'insider',
  },
  create: async (services) => {
    const bank = await loadSeedBank(services.assets.forModule(import.meta.url));
    // Fail fast on malformed shipped data: abort boot with a clear error rather than crashing
    // mid-game. Structural per-item checks only - no category-count gate (the bank grows over time).
    validateSeedBank(bank);
    return createLoneLeafGame(bank, services.rng);
  },
};
