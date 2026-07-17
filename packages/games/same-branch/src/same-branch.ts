// The Same Branch game module: a spectrum-guessing party game on the engine's generic round lifecycle.
// A branch spans two opposite ends; a hidden bud sits somewhere on it. One player - the Reader,
// rotating each round by seat - alone sees the bud and gives a one-line hunch that fits it; everyone
// else moves the sap line (a 0-100 dial) to guess where the bud is. The reveal shows the bud and
// scores each guesser by closeness (bullseye 4 / close 3 / near 2 / miss 0).
//
// THE BUD IS A SECRET. It is delivered ONLY to the Reader via the spec 0052 `private` channel and is
// NEVER placed in the broadcast prompt/reveal payloads until the round is scored. `startRound` returns
// `private: { [readerId]: { bud, ... } }`; the engine delivers that entry to the Reader's device(s)
// alone. A test proves no non-Reader ever receives the bud.
//
// Lifecycle mapping:
//   configure     -> per-round move window = 120s; round count from config
//   startRound    -> pick an unused spectrum + a hidden bud + the round's Reader; broadcast the branch
//                    ends (NO bud); deliver the bud privately to the Reader
//   collectMove -> the Reader submits a hunch (text); everyone else submits a dial position (0-100)
//   allSubmitted   -> the Reader gave a hunch AND every connected guesser set the sap line
//   reveal        -> reveal the bud + hunch + guesses, score each guesser by closeness (free or coop)
//   leaderboard   -> standings between rounds
//   advance/endGame -> done after `rounds`, final standings
//
// Every callback is a pure function over `RoundContext`; the only injected state is the spectrum bank
// and an rng, both fixed when the module is built.

import {
  rankStandings,
  type PlayerView,
  type ScoreEvent,
  type Standing,
} from '@branchout/protocol';
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
  SessionPlayer,
  StartRoundResult,
} from '@branchout/game-sdk';
import {
  DEFAULT_ROUNDS,
  validateConfig,
  type ResolvedSameBranchConfig,
  type SameBranchMode,
} from './config';
import { bandLabel, clampToBranch, scoreGuess } from './scoring';
import { loadSpectrumBank, validateSpectrumBank, type Spectrum } from './spectrums';

export const SAME_BRANCH_GAME_ID = 'same-branch';

/** Players have 120s to give a hunch / move the sap line (the round's move window). */
export const MOVE_WINDOW_MS = 120_000;

/** A spectrum snapshot persisted for the round in play so reveal needs no re-draw. */
interface RoundSpectrum {
  id: string;
  category: string;
  left: string;
  right: string;
}

/** One guesser's recorded sap-line position and the points it earned (points set at reveal). */
export interface SameBranchGuess {
  player: string;
  position: number;
}

interface SameBranchScratch {
  categories: string[] | 'random';
  rounds: number;
  mode: SameBranchMode;
  /** Player ids in seat order, frozen at configure so the Reader rotation is deterministic. */
  seats: string[];
  /** Spectrum ids drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  // Per-round working state. Only the current round is ever read, so startRound resets it.
  round: number;
  spectrum: RoundSpectrum | null;
  /** The hidden bud position (0-100) for the round. Persisted in scratch (server-side only, never
   * broadcast); revealed only at scoring. */
  bud: number | null;
  /** The seat index (into `seats`) of this round's Reader. */
  readerIndex: number;
  /** The Reader's submitted hunch text, or '' until given. */
  hunch: string;
  /** guesserId -> their (clamped) sap-line position. */
  guesses: Record<string, number>;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): SameBranchScratch {
  const s = scratch as Partial<SameBranchScratch>;
  return {
    categories: s.categories ?? 'random',
    rounds: s.rounds ?? DEFAULT_ROUNDS,
    mode: s.mode ?? 'free',
    seats: s.seats ?? [],
    usedIds: s.usedIds ?? [],
    round: s.round ?? 0,
    spectrum: s.spectrum ?? null,
    bud: s.bud ?? null,
    readerIndex: s.readerIndex ?? 0,
    hunch: s.hunch ?? '',
    guesses: s.guesses ?? {},
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: SameBranchScratch): SameBranchScratch {
  return JSON.parse(JSON.stringify(scratch)) as SameBranchScratch;
}

function toRecord(scratch: SameBranchScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** True when the spectrum belongs to the configured categories (`random` spans all). */
function inCategories(spectrum: Spectrum, categories: string[] | 'random'): boolean {
  return categories === 'random' || categories.includes(spectrum.category);
}

/** The Reader's player id for a round, resolved from the frozen seat order (rotates each round). */
export function readerFor(seats: readonly string[], readerIndex: number): string | null {
  if (seats.length === 0) return null;
  return seats[readerIndex % seats.length] ?? null;
}

/** Title-cased nickname lookup (falls back to the raw id). */
function nicknameOf(players: readonly PlayerView[], id: string): string {
  return players.find((p) => p.player === id)?.nickname ?? id;
}

export function createSameBranchGame(
  bank: readonly Spectrum[],
  rng: () => number = Math.random,
): GameModule {
  /** Draw one unused spectrum from the configured categories. */
  function pickSpectrum(scratch: SameBranchScratch): Spectrum {
    const used = new Set(scratch.usedIds);
    const pool = bank.filter((s) => inCategories(s, scratch.categories) && !used.has(s.id));
    if (pool.length === 0) {
      throw new Error('same-branch: ran out of unused spectrums for the chosen categories');
    }
    return pool[Math.floor(rng() * pool.length)]!;
  }

  /** Pick a hidden bud position on the branch. Kept off the ends so a clue always has room both ways. */
  function pickBud(): number {
    // 8..92 inclusive, integer - never pinned to an extreme, so a hunch is always meaningful.
    return 8 + Math.floor(rng() * 85);
  }

  return {
    id: SAME_BRANCH_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      const cfg = validateConfig(config);
      const available = bank.filter((s) => inCategories(s, cfg.categories)).length;
      if (available < cfg.rounds) {
        throw new Error(
          `same-branch: only ${available} spectrums for the chosen categories, need ${cfg.rounds} rounds`,
        );
      }
      const scratch: SameBranchScratch = {
        categories: cfg.categories,
        rounds: cfg.rounds,
        mode: cfg.mode,
        // Freeze the seat order now so the Reader rotation is deterministic and independent of who is
        // connected on any given round.
        seats: players.map((p) => p.player),
        usedIds: [],
        round: 0,
        spectrum: null,
        bud: null,
        readerIndex: 0,
        hunch: '',
        guesses: {},
      };
      return { scratch: toRecord(scratch), rounds: cfg.rounds, moveWindowMs: MOVE_WINDOW_MS };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const prev = asScratch(ctx.scratch);
      const spectrum = pickSpectrum(prev);
      const bud = pickBud();
      // The Reader rotates by seat each round: round 1 -> seat 0, round 2 -> seat 1, ...
      const readerIndex = ctx.round - 1;
      const reader = readerFor(prev.seats, readerIndex);
      const scratch: SameBranchScratch = {
        categories: prev.categories,
        rounds: prev.rounds,
        mode: prev.mode,
        seats: prev.seats,
        usedIds: [...prev.usedIds, spectrum.id],
        round: ctx.round,
        spectrum: {
          id: spectrum.id,
          category: spectrum.category,
          left: spectrum.left,
          right: spectrum.right,
        },
        bud,
        readerIndex,
        hunch: '',
        guesses: {},
      };
      // The broadcast prompt carries the branch ends and who the Reader is - but NEVER the bud. The bud
      // goes only to the Reader via the private channel below (spec 0052).
      return {
        scratch: toRecord(scratch),
        prompt: {
          round: ctx.round,
          category: spectrum.category,
          left: spectrum.left,
          right: spectrum.right,
          reader,
        },
        private: reader
          ? { [reader]: { round: ctx.round, bud, left: spectrum.left, right: spectrum.right } }
          : undefined,
      };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      if (!current.spectrum) return { scratch: unchanged }; // no active round: ignore quietly
      const reader = readerFor(current.seats, current.readerIndex);

      if (player === reader) {
        // The Reader submits a hunch: a one-line clue. Reject an empty one.
        const trimmed = move.trim();
        if (trimmed.length === 0) {
          return { scratch: unchanged, rejected: { reason: 'enter a hunch' } };
        }
        const scratch = clone(current);
        // Keep the hunch to a single readable line; the UI caps input length too.
        scratch.hunch = trimmed.slice(0, 120);
        return { scratch: toRecord(scratch) };
      }

      // A guesser submits a sap-line position. Parse an integer in [0, 100]; reject anything else so a
      // malformed move never scores.
      const position = Number(move);
      if (!Number.isFinite(position)) {
        return { scratch: unchanged, rejected: { reason: 'move the sap line first' } };
      }
      const scratch = clone(current);
      scratch.guesses[player] = clampToBranch(Math.round(position));
      return { scratch: toRecord(scratch) };
    },

    allSubmitted(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const reader = readerFor(scratch.seats, scratch.readerIndex);
      const connected = ctx.players.filter((p) => p.connected);
      if (connected.length === 0) return false;
      // The round is complete when the Reader has given a hunch AND every connected guesser has set
      // their sap line. A disconnected Reader cannot complete the round (the engine pauses on a host
      // drop; a non-host Reader drop waits on the host to advance).
      const readerConnected = connected.some((p) => p.player === reader);
      if (readerConnected && scratch.hunch.length === 0) return false;
      const guessers = connected.filter((p) => p.player !== reader);
      return guessers.every((p) => scratch.guesses[p.player] !== undefined);
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      const spectrum = scratch.spectrum;
      if (!spectrum || scratch.bud === null) {
        throw new Error('same-branch: reveal with no active spectrum');
      }
      const bud = scratch.bud;
      const reader = readerFor(scratch.seats, scratch.readerIndex);

      // Score every guesser by closeness. In coop mode the whole grove pools its points onto one
      // shared tally (attributed to each guesser as their own contribution so the standings still
      // list per player); the UI frames it as a shared grove score. In free mode each keeps their own.
      const guesses = Object.entries(scratch.guesses).map(([player, position]) => ({
        player,
        position,
        points: scoreGuess(bud, position),
        band: bandLabel(bud, position),
      }));

      const scores: ScoreEvent[] = guesses.map((g) => ({
        player: g.player,
        points: g.points,
        reason: g.band === 'miss' ? 'off the mark' : `landed ${g.band}`,
      }));

      return {
        scratch: toRecord(scratch),
        reveal: {
          round: ctx.round,
          category: spectrum.category,
          left: spectrum.left,
          right: spectrum.right,
          reader,
          hunch: scratch.hunch,
          bud,
          mode: scratch.mode,
          guesses: guesses.map((g) => ({
            player: g.player,
            position: g.position,
            points: g.points,
            band: g.band,
          })),
        },
        scores,
      };
    },

    // Same Branch never raises a dispute or a guess (decision) phase; the contract still requires
    // these hooks, so they are inert.
    collectVote(ctx: RoundContext): ScratchResult {
      return { scratch: ctx.scratch as Record<string, unknown> };
    },

    disputeWindow(ctx: RoundContext): DisputeWindowResult {
      return { scratch: ctx.scratch as Record<string, unknown>, disputes: [] };
    },

    disputeVote(ctx: RoundContext): DisputeVoteResult {
      return { scratch: ctx.scratch as Record<string, unknown>, scores: [] };
    },

    leaderboard(ctx: RoundContext): Standing[] {
      return standings(ctx, asScratch(ctx.scratch).mode);
    },

    advance(ctx: RoundContext): AdvanceResult {
      return { done: ctx.round >= asScratch(ctx.scratch).rounds };
    },

    endGame(ctx: RoundContext): Standing[] {
      return standings(ctx, asScratch(ctx.scratch).mode);
    },
  };

  /**
   * Build the standings. In `free` mode this is the ordinary per-player ranking by score. In `coop`
   * mode the grove wins or loses together: every player shares the pooled total as one rank, so the
   * board reads as a single team chasing a high score rather than a contest.
   */
  function standings(ctx: RoundContext, mode: SameBranchMode): Standing[] {
    if (mode !== 'coop') return rankStandings(ctx.players, ctx.scores);
    const total = ctx.players.reduce((sum, p) => sum + (ctx.scores[p.player] ?? 0), 0);
    // Everyone shares the pooled score and rank 1 - the grove stands or falls as one.
    return ctx.players.map((p) => ({
      player: p.player,
      nickname: nicknameOf(ctx.players, p.player),
      score: total,
      rank: 1,
    }));
  }
}

/** The Same Branch plugin: the manifest + a factory that loads its spectrum bank via the injected loader. */
export const sameBranchPlugin: GamePlugin<ResolvedSameBranchConfig> = {
  manifest: {
    id: SAME_BRANCH_GAME_ID,
    name: 'Same Branch',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 2, maxPlayers: 8 },
    visibility: 'insider',
  },
  create: async (services) => {
    const bank = await loadSpectrumBank(services.assets.forModule(import.meta.url));
    // Fail fast on malformed shipped data: abort boot with a clear error rather than crashing
    // mid-game. Structural per-item checks only - no category-count gate (the bank grows over time).
    validateSpectrumBank(bank);
    return createSameBranchGame(bank, services.rng);
  },
};
