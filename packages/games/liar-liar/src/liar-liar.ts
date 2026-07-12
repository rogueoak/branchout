// The Liar Liar game module (spec 0021). A Fibbage-style bluffing game on the engine's generic
// decision lifecycle (spec 0020): the engine owns the 90s submit window, the 30s guess window,
// streaming, and persistence; this module owns the rules - clue draw, rejecting a fake that equals
// the truth or a duplicate, building the shuffled option set, and scoring the guesses. Every callback
// is a pure function over `RoundContext`; the only injected state is the clue bank and an rng, both
// fixed when the module is built.
//
// Lifecycle mapping onto spec 0020's hooks:
//   configure     -> answer window = 90s
//   startRound    -> draw an unused clue; the viewer shows it
//   collectAnswer -> record a fake, or `rejected` a duplicate / the truth (a private reply)
//   allAnswered   -> every connected player submitted a fake (early-close the submit window)
//   reveal        -> options = all fakes + the truth (shuffled), returns `decision` (30s guess)
//   collectVote   -> a guess (an option id) during the `guessing` phase
//   allDecided    -> every connected player guessed (early-close the guess window)
//   resolveDecision -> 100 for guessing the truth, 50 to a fake's author per player it fooled

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
import { loadClueBank, validateClueBank, type LiarLiarClue } from './clues';
import { DEFAULT_ROUNDS, validateConfig, type ResolvedLiarLiarConfig } from './config';
import { normalizeAnswer, sameAnswer } from './matching';

export const LIAR_LIAR_GAME_ID = 'liar-liar';

/** Players have 90s to invent and submit a fake (spec's submit window). */
export const SUBMIT_WINDOW_MS = 90_000;
/** Players have 30s to guess which revealed answer is the truth. */
export const GUESS_WINDOW_MS = 30_000;

/** Guessing the real answer scores this. */
export const CORRECT_POINTS = 100;
/** A fake's author scores this for each player their fake fools. */
export const FOOL_POINTS = 50;

/** The vague rejection shown when a fake collides with the truth or another player's fake. */
const TAKEN_REASON = 'someone already submitted that';

/** A clue snapshot persisted for the round in play so reveal/resolve need no re-draw. */
interface RoundClue {
  id: string;
  category: string;
  clue: string;
  answer: string;
  aliases: string[];
}

/** A guessable option streamed at reveal. The truth is not identified until the guesses resolve. */
export interface LiarLiarOption {
  id: string;
  text: string;
}

type Attribution = { kind: 'truth' } | { kind: 'fake'; author: string };

interface LiarLiarScratch {
  categories: string[] | 'random';
  rounds: number;
  /** Clue ids drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  // Per-round working state. Only the current round is ever read, so startRound resets it - the
  // persisted blob and per-frame clone stay O(1 round) regardless of game length.
  round: number;
  clue: RoundClue | null;
  /** player -> their (trimmed) submitted fake. */
  submissions: Record<string, string>;
  /** The shuffled options, set at reveal. */
  options: LiarLiarOption[];
  /** optionId -> what it is (the truth, or a player's fake). */
  attribution: Record<string, Attribution>;
  /** player -> the option id they guessed. */
  guesses: Record<string, string>;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): LiarLiarScratch {
  const s = scratch as Partial<LiarLiarScratch>;
  return {
    categories: s.categories ?? 'random',
    rounds: s.rounds ?? DEFAULT_ROUNDS,
    usedIds: s.usedIds ?? [],
    round: s.round ?? 0,
    clue: s.clue ?? null,
    submissions: s.submissions ?? {},
    options: s.options ?? [],
    attribution: s.attribution ?? {},
    guesses: s.guesses ?? {},
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: LiarLiarScratch): LiarLiarScratch {
  return JSON.parse(JSON.stringify(scratch)) as LiarLiarScratch;
}

function toRecord(scratch: LiarLiarScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** True when the clue belongs to the configured categories (`random` spans all). */
function inCategories(clue: LiarLiarClue, categories: string[] | 'random'): boolean {
  return categories === 'random' || categories.includes(clue.category);
}

/** In-place Fisher-Yates shuffle off the injected rng, so a seeded test pins the option order. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

export function createLiarLiarGame(
  bank: readonly LiarLiarClue[],
  rng: () => number = Math.random,
): GameModule {
  /** Draw one unused clue from the configured categories. */
  function pickClue(scratch: LiarLiarScratch): LiarLiarClue {
    const used = new Set(scratch.usedIds);
    const pool = bank.filter((c) => inCategories(c, scratch.categories) && !used.has(c.id));
    if (pool.length === 0) {
      throw new Error('liar-liar: ran out of unused clues for the chosen categories');
    }
    return pool[Math.floor(rng() * pool.length)]!;
  }

  return {
    id: LIAR_LIAR_GAME_ID,

    configure(config: unknown): ConfigureResult {
      const cfg = validateConfig(config);
      const available = bank.filter((c) => inCategories(c, cfg.categories)).length;
      if (available < cfg.rounds) {
        throw new Error(
          `liar-liar: only ${available} clues for the chosen categories, need ${cfg.rounds} rounds`,
        );
      }
      const scratch: LiarLiarScratch = {
        categories: cfg.categories,
        rounds: cfg.rounds,
        usedIds: [],
        round: 0,
        clue: null,
        submissions: {},
        options: [],
        attribution: {},
        guesses: {},
      };
      return { scratch: toRecord(scratch), rounds: cfg.rounds, answerWindowMs: SUBMIT_WINDOW_MS };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const prev = asScratch(ctx.scratch);
      const clue = pickClue(prev);
      const scratch: LiarLiarScratch = {
        categories: prev.categories,
        rounds: prev.rounds,
        usedIds: [...prev.usedIds, clue.id],
        round: ctx.round,
        clue: {
          id: clue.id,
          category: clue.category,
          clue: clue.clue,
          answer: clue.answer,
          aliases: clue.aliases ?? [],
        },
        submissions: {},
        options: [],
        attribution: {},
        guesses: {},
      };
      return {
        scratch: toRecord(scratch),
        prompt: { round: ctx.round, clue: clue.clue, category: clue.category },
      };
    },

    collectAnswer(ctx: RoundContext, player: string, answer: string): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      const trimmed = answer.trim();
      // Reject anything that normalizes to nothing - blank, whitespace, or punctuation-only like
      // "!!!". Such a fake has no comparable form, so it can neither be a real bluff nor dedupe
      // correctly (two junk fakes would both normalize to "" and the second look like a duplicate).
      if (normalizeAnswer(trimmed).length === 0) {
        return { scratch: unchanged, rejected: { reason: 'enter an answer' } };
      }
      const clue = current.clue;
      if (!clue) return { scratch: unchanged }; // no active round: ignore quietly
      // Reject a fake equal to the real answer (or an alias): a player must not submit the truth.
      if ([clue.answer, ...clue.aliases].some((t) => sameAnswer(trimmed, t))) {
        return { scratch: unchanged, rejected: { reason: TAKEN_REASON } };
      }
      // Reject a duplicate of *another* player's fake (a player may freely change their own).
      for (const [other, fake] of Object.entries(current.submissions)) {
        if (other !== player && sameAnswer(trimmed, fake)) {
          return { scratch: unchanged, rejected: { reason: TAKEN_REASON } };
        }
      }
      const scratch = clone(current);
      scratch.submissions[player] = trimmed;
      return { scratch: toRecord(scratch) };
    },

    allAnswered(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const connected = ctx.players.filter((p) => p.connected);
      return (
        connected.length > 0 && connected.every((p) => scratch.submissions[p.player] !== undefined)
      );
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      const clue = scratch.clue;
      if (!clue) throw new Error('liar-liar: reveal with no active clue');
      // Options = the truth + every submitted fake; a duplicate fake is impossible (collectAnswer
      // rejected it), so every entry is distinct. Shuffle so the truth's position carries no tell.
      const entries: { text: string; attr: Attribution }[] = [
        { text: clue.answer, attr: { kind: 'truth' } },
        ...Object.entries(scratch.submissions).map(
          ([author, fake]): { text: string; attr: Attribution } => ({
            text: fake,
            attr: { kind: 'fake', author },
          }),
        ),
      ];
      shuffle(entries, rng);
      const options: LiarLiarOption[] = [];
      const attribution: Record<string, Attribution> = {};
      entries.forEach((entry, i) => {
        const id = String(i);
        options.push({ id, text: entry.text });
        attribution[id] = entry.attr;
      });
      scratch.options = options;
      scratch.attribution = attribution;
      scratch.guesses = {};
      return {
        scratch: toRecord(scratch),
        // The pre-guess reveal shows the options but never which is the truth.
        reveal: { round: ctx.round, clue: clue.clue, options },
        scores: [],
        decision: { windowMs: GUESS_WINDOW_MS },
      };
    },

    collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      const attr = current.attribution[vote.target];
      if (!attr) return { scratch: unchanged }; // unknown option: ignore
      // A player cannot pick their own fake.
      if (attr.kind === 'fake' && attr.author === vote.player) return { scratch: unchanged };
      const scratch = clone(current);
      scratch.guesses[vote.player] = vote.target;
      return { scratch: toRecord(scratch) };
    },

    allDecided(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const connected = ctx.players.filter((p) => p.connected);
      return (
        connected.length > 0 && connected.every((p) => scratch.guesses[p.player] !== undefined)
      );
    },

    resolveDecision(ctx: RoundContext): DecisionResult {
      const scratch = clone(asScratch(ctx.scratch));
      const truthId = Object.keys(scratch.attribution).find(
        (id) => scratch.attribution[id]!.kind === 'truth',
      );

      // Who picked each option.
      const pickedBy: Record<string, string[]> = {};
      for (const [player, optionId] of Object.entries(scratch.guesses)) {
        (pickedBy[optionId] ??= []).push(player);
      }

      const scores: ScoreEvent[] = [];
      const correctGuessers = truthId ? (pickedBy[truthId] ?? []) : [];
      for (const player of correctGuessers) {
        scores.push({ player, points: CORRECT_POINTS, reason: 'guessed the truth' });
      }
      // A fake's author scores 50 for each player it fooled.
      for (const [optionId, attr] of Object.entries(scratch.attribution)) {
        if (attr.kind !== 'fake') continue;
        const fooled = (pickedBy[optionId] ?? []).length;
        for (let k = 0; k < fooled; k++) {
          scores.push({ player: attr.author, points: FOOL_POINTS, reason: 'fooled a player' });
        }
      }

      const options = scratch.options.map((o) => {
        const attr = scratch.attribution[o.id]!;
        return {
          id: o.id,
          text: o.text,
          kind: attr.kind,
          author: attr.kind === 'fake' ? attr.author : undefined,
          pickedBy: pickedBy[o.id] ?? [],
        };
      });
      return {
        scratch: toRecord(scratch),
        scores,
        reveal: {
          round: ctx.round,
          clue: scratch.clue?.clue,
          truth: scratch.clue?.answer,
          options,
          correctGuessers,
        },
      };
    },

    // Liar Liar always takes the guess (decision) path, so the dispute hooks are never reached; the
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

/** The Liar Liar plugin: the manifest + a factory that loads its clue bank via the injected loader. */
export const liarLiarPlugin: GamePlugin<ResolvedLiarLiarConfig> = {
  manifest: {
    id: LIAR_LIAR_GAME_ID,
    name: 'Liar Liar',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 2 },
  },
  create: async (services) => {
    const bank = await loadClueBank(services.assets.forModule(import.meta.url));
    // Fail fast on malformed shipped data: abort boot with a clear error rather than crashing
    // mid-game. Structural per-item checks only - no category-count gate (the bank grows over time).
    validateClueBank(bank);
    return createLiarLiarGame(bank, services.rng);
  },
};
