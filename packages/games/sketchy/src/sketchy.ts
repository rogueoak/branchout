// The Sketchy game module (spec 0063): a draw-and-guess-with-decoys party game on the engine's
// generic round lifecycle (spec 0020). Every callback is a pure function over `RoundContext`; the
// only injected state is the seed bank and an rng, both fixed when the module is built.
//
// STRUCTURE. The engine's round is fixed: `collecting -> reveal -> (guessing -> resolveDecision) ->
// leaderboard -> advance`, one collect + at most one guess per round, no looping. Sketchy's two
// stages (draw, then bluff-and-guess per sketch) map onto a CYCLE of engine rounds:
//   - a DRAW round (the cycle's first): every player is privately dealt a distinct `seed` and draws
//     it; `collectMove` records the serialized sketch. `reveal` returns NO decision, so the round
//     goes straight to the leaderboard - the drawings are just banked for the sketch rounds to come.
//   - N SKETCH rounds (one per player who drew), each featuring one sketch in a fixed order: every
//     OTHER player writes a decoy (`collectMove`), then `reveal` opens a guess phase whose options
//     are that sketch's true seed + the decoys (shuffled, Liar Liar shape). `resolveDecision` scores.
// A game runs `cycles` of {1 draw round + numPlayers sketch rounds}; `configure` computes the engine
// round count from the roster. The seed assignment, sketch order, and option shuffle all come off the
// injected rng, so a fixed seed pins the whole game in tests.
//
// SECRECY (spec 0052). A player's seed is dealt ONLY to that player via `startRound.private`; the
// broadcast `prompt` never carries any seed. A non-recipient never receives another player's seed.

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
import { DEFAULT_ROUNDS, validateConfig, type ResolvedSketchyConfig } from './config';
import { normalizeAnswer, sameAnswer } from './matching';
import { loadSeedBank, validateSeedBank, type SketchySeed } from './seeds';
import { isDrawn, parseSketch, serializeSketch, type Sketch } from './strokes';

export const SKETCHY_GAME_ID = 'sketchy';

/** Players have 90s to draw their seed (the draw round's move window). */
export const DRAW_WINDOW_MS = 90_000;
/** Players have 60s to write a decoy for the featured sketch. */
export const DECOY_WINDOW_MS = 60_000;
/** Players have 30s to guess which option is the true seed. */
export const GUESS_WINDOW_MS = 30_000;
/**
 * The draw round has no guess: `reveal` returns NO decision, so the engine takes the DISPUTE path
 * (spec 0020) - `collecting -> reveal -> disputing -> leaderboard`. Sketchy raises no disputes, so
 * its dispute window is a short, automatic bridge to the gallery leaderboard. It MUST be > 0: the
 * engine only arms the dispute-window timer when the window is positive (a 0 window means "the host
 * advances it manually"), so a 0 here would strand the draw round in `disputing` - a phase no Sketchy
 * client renders - until the host happened to press Next. A few seconds lets everyone see the "banked
 * the sketches" beat before the gallery, then the round finalizes on its own.
 */
export const DRAW_DISPUTE_WINDOW_MS = 4_000;

/** Guessing the true seed scores this. */
export const CORRECT_POINTS = 100;
/** A decoy's author scores this for each player their decoy fools. */
export const FOOL_POINTS = 50;

/** The vague rejection shown when a decoy collides with the true seed or another player's decoy. */
const TAKEN_REASON = 'someone already suggested that';

/** A guessable option streamed at reveal. The true seed is not identified until the guesses resolve. */
export interface SketchyOption {
  id: string;
  text: string;
}

type Attribution = { kind: 'truth' } | { kind: 'decoy'; author: string };

/** The two kinds of engine round in a Sketchy cycle. */
export type Stage = 'draw' | 'sketch';

interface SketchyScratch {
  /** Total engine rounds this game runs (`cycles * (1 + numPlayers)`). */
  rounds: number;
  /** Players (ids) in the fixed draw/feature order, set at configure from the roster seat order. */
  order: string[];
  /** Seed ids used across the whole game, so a redraw never repeats a prompt. */
  usedSeedIds: string[];
  /** The current engine round number. */
  round: number;
  /** What kind of round the current one is. */
  stage: Stage;

  // Draw-round working state (reset each draw round).
  /** player -> the seed dealt to them this cycle. */
  assignments: Record<string, SketchySeed>;
  /** player -> their submitted sketch (serialized strokes), banked for the sketch rounds. */
  sketches: Record<string, string>;

  // Sketch-round working state (reset each sketch round).
  /** The player whose sketch is featured this round. */
  featured: string | null;
  /** player -> their (trimmed) decoy for the featured sketch. */
  decoys: Record<string, string>;
  /** The shuffled options, set at reveal. */
  options: SketchyOption[];
  /** optionId -> what it is (the truth, or a player's decoy). */
  attribution: Record<string, Attribution>;
  /** player -> the option id they guessed. */
  guesses: Record<string, string>;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): SketchyScratch {
  const s = scratch as Partial<SketchyScratch>;
  return {
    rounds: s.rounds ?? DEFAULT_ROUNDS,
    order: s.order ?? [],
    usedSeedIds: s.usedSeedIds ?? [],
    round: s.round ?? 0,
    stage: s.stage ?? 'draw',
    assignments: s.assignments ?? {},
    sketches: s.sketches ?? {},
    featured: s.featured ?? null,
    decoys: s.decoys ?? {},
    options: s.options ?? [],
    attribution: s.attribution ?? {},
    guesses: s.guesses ?? {},
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: SketchyScratch): SketchyScratch {
  return JSON.parse(JSON.stringify(scratch)) as SketchyScratch;
}

function toRecord(scratch: SketchyScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
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
 * The stage of a round within a cycle. Each cycle is `1 + n` rounds: round-in-cycle 0 is the draw
 * round; 1..n each feature one player's sketch. `round` is 1-based.
 */
export function stageForRound(
  round: number,
  playerCount: number,
): {
  stage: Stage;
  cycle: number;
  featureIndex: number;
} {
  const perCycle = 1 + playerCount;
  const zero = round - 1;
  const cycle = Math.floor(zero / perCycle);
  const withinCycle = zero % perCycle;
  if (withinCycle === 0) return { stage: 'draw', cycle, featureIndex: -1 };
  return { stage: 'sketch', cycle, featureIndex: withinCycle - 1 };
}

export function createSketchyGame(
  bank: readonly SketchySeed[],
  rng: () => number = Math.random,
): GameModule {
  /** Draw one unused seed from the bank. */
  function pickSeed(used: Set<string>): SketchySeed {
    const pool = bank.filter((s) => !used.has(s.id));
    if (pool.length === 0) throw new Error('sketchy: ran out of unused seeds');
    return pool[Math.floor(rng() * pool.length)]!;
  }

  return {
    id: SKETCHY_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      const cfg = validateConfig(config);
      const n = players.length;
      if (n < 1) throw new Error('sketchy: needs at least one player');
      // Each cycle features every player once (1 draw round + n sketch rounds). Enough seeds must
      // exist for every player across every cycle (a redraw never repeats a prompt).
      const neededSeeds = cfg.rounds * n;
      if (bank.length < neededSeeds) {
        throw new Error(
          `sketchy: only ${bank.length} seeds, need ${neededSeeds} for ${cfg.rounds} cycles of ${n}`,
        );
      }
      const engineRounds = cfg.rounds * (1 + n);
      const scratch: SketchyScratch = {
        rounds: engineRounds,
        order: players.map((p) => p.player),
        usedSeedIds: [],
        round: 0,
        stage: 'draw',
        assignments: {},
        sketches: {},
        featured: null,
        decoys: {},
        options: [],
        attribution: {},
        guesses: {},
      };
      return {
        scratch: toRecord(scratch),
        rounds: engineRounds,
        moveWindowMs: DRAW_WINDOW_MS,
        // The draw round takes the no-decision dispute path; a positive window lets its empty dispute
        // stage auto-finalize to the gallery leaderboard instead of stranding the round in `disputing`
        // (which no Sketchy client renders) until the host manually advances. Sketch rounds open a
        // guess `decision` instead, so this window never applies to them.
        disputeWindowMs: DRAW_DISPUTE_WINDOW_MS,
      };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const prev = asScratch(ctx.scratch);
      const order = prev.order.length > 0 ? prev.order : ctx.players.map((p) => p.player);
      const n = order.length;
      const { stage, featureIndex } = stageForRound(ctx.round, n);
      const scratch = clone(prev);
      scratch.round = ctx.round;
      scratch.stage = stage;
      // Reset per-round working state.
      scratch.featured = null;
      scratch.decoys = {};
      scratch.options = [];
      scratch.attribution = {};
      scratch.guesses = {};

      if (stage === 'draw') {
        // Deal each player a fresh, distinct seed and bank the assignment. The seed goes out ONLY in
        // `private` (spec 0052); the broadcast prompt carries no seed.
        const used = new Set(scratch.usedSeedIds);
        const assignments: Record<string, SketchySeed> = {};
        const priv: Record<string, unknown> = {};
        for (const player of order) {
          const seed = pickSeed(used);
          used.add(seed.id);
          assignments[player] = seed;
          priv[player] = { seed: seed.text };
        }
        scratch.usedSeedIds = [...used];
        scratch.assignments = assignments;
        scratch.sketches = {};
        return {
          scratch: toRecord(scratch),
          prompt: { round: ctx.round, stage: 'draw' as const },
          private: priv,
        };
      }

      // A sketch round: feature one player's sketch (public prompt names no seed).
      const featured = order[featureIndex] ?? null;
      scratch.featured = featured;
      const featuredSketch = featured ? (scratch.sketches[featured] ?? null) : null;
      return {
        scratch: toRecord(scratch),
        prompt: {
          round: ctx.round,
          stage: 'sketch' as const,
          featured,
          sketch: featuredSketch,
        },
      };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;

      if (current.stage === 'draw') {
        // The move is a serialized sketch. Reject a malformed or blank drawing.
        const sketch = parseSketch(move);
        if (!sketch || !isDrawn(sketch)) {
          return { scratch: unchanged, rejected: { reason: 'draw something first' } };
        }
        const next = clone(current);
        // Re-serialize the parsed (bounded) sketch so the stored form is always canonical + capped.
        next.sketches[player] = serializeSketch(sketch);
        return { scratch: toRecord(next) };
      }

      // A sketch round: the move is a decoy for the featured sketch. The featured player writes no
      // decoy for their own sketch (they know the truth); ignore quietly.
      if (player === current.featured) return { scratch: unchanged };
      const trimmed = move.trim();
      if (normalizeAnswer(trimmed).length === 0) {
        return { scratch: unchanged, rejected: { reason: 'enter a guess at the seed' } };
      }
      const featured = current.featured;
      const trueSeed = featured ? current.assignments[featured]?.text : undefined;
      // Reject a decoy equal to the true seed: a player must not submit the truth.
      if (trueSeed && sameAnswer(trimmed, trueSeed)) {
        return { scratch: unchanged, rejected: { reason: TAKEN_REASON } };
      }
      // Reject a duplicate of another player's decoy (a player may freely change their own).
      for (const [other, decoy] of Object.entries(current.decoys)) {
        if (other !== player && sameAnswer(trimmed, decoy)) {
          return { scratch: unchanged, rejected: { reason: TAKEN_REASON } };
        }
      }
      const next = clone(current);
      next.decoys[player] = trimmed;
      return { scratch: toRecord(next) };
    },

    allSubmitted(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const connected = ctx.players.filter((p) => p.connected);
      if (connected.length === 0) return false;
      if (scratch.stage === 'draw') {
        return connected.every((p) => scratch.sketches[p.player] !== undefined);
      }
      // Every connected player EXCEPT the featured author must have written a decoy. If the featured
      // author is the ONLY connected player (everyone else dropped), there are no decoy-writers, so an
      // empty `.every` would falsely close collection into an unguessable single-option decision -
      // hold the round open (the move timer still bounds it) until a non-featured player is present.
      const writers = connected.filter((p) => p.player !== scratch.featured);
      if (writers.length === 0) return false;
      return writers.every((p) => scratch.decoys[p.player] !== undefined);
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));

      if (scratch.stage === 'draw') {
        // The draw round has no guess: bank the drawings and show them on the shared screen, then go
        // straight to the leaderboard (an empty dispute window). The reveal lists every sketch.
        const gallery = scratch.order
          .filter((player) => scratch.sketches[player] !== undefined)
          .map((player) => ({ player, sketch: scratch.sketches[player]! }));
        return {
          scratch: toRecord(scratch),
          reveal: { round: ctx.round, stage: 'draw' as const, gallery },
          scores: [],
        };
      }

      // A sketch round: options = the true seed + every decoy (shuffled). A duplicate decoy is
      // impossible (collectMove rejected it), so every entry is distinct.
      const featured = scratch.featured;
      const trueSeed = featured ? scratch.assignments[featured]?.text : undefined;
      if (!featured || !trueSeed) {
        // No featured player drew (e.g. everyone disconnected): nothing to guess, finalize the round.
        return {
          scratch: toRecord(scratch),
          reveal: { round: ctx.round, stage: 'sketch' as const, featured, options: [] },
          scores: [],
        };
      }
      const entries: { text: string; attr: Attribution }[] = [
        { text: trueSeed, attr: { kind: 'truth' } },
        ...Object.entries(scratch.decoys).map(
          ([author, decoy]): { text: string; attr: Attribution } => ({
            text: decoy,
            attr: { kind: 'decoy', author },
          }),
        ),
      ];
      shuffle(entries, rng);
      const options: SketchyOption[] = [];
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
        reveal: {
          round: ctx.round,
          stage: 'sketch' as const,
          featured,
          sketch: scratch.sketches[featured] ?? null,
          options,
        },
        scores: [],
        decision: { windowMs: GUESS_WINDOW_MS },
      };
    },

    collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      const attr = current.attribution[vote.target];
      if (!attr) return { scratch: unchanged }; // unknown option: ignore
      // A player cannot pick their own decoy.
      if (attr.kind === 'decoy' && attr.author === vote.player) return { scratch: unchanged };
      // The featured author does not guess on their own sketch (they know the truth).
      if (vote.player === current.featured) return { scratch: unchanged };
      const next = clone(current);
      next.guesses[vote.player] = vote.target;
      return { scratch: toRecord(next) };
    },

    allDecided(ctx: RoundContext): boolean {
      const scratch = asScratch(ctx.scratch);
      const connected = ctx.players.filter((p) => p.connected && p.player !== scratch.featured);
      return (
        connected.length > 0 && connected.every((p) => scratch.guesses[p.player] !== undefined)
      );
    },

    resolveDecision(ctx: RoundContext): DecisionResult {
      const scratch = clone(asScratch(ctx.scratch));
      const truthId = Object.keys(scratch.attribution).find(
        (id) => scratch.attribution[id]!.kind === 'truth',
      );

      const pickedBy: Record<string, string[]> = {};
      for (const [player, optionId] of Object.entries(scratch.guesses)) {
        (pickedBy[optionId] ??= []).push(player);
      }

      const scores: ScoreEvent[] = [];
      const correctGuessers = truthId ? (pickedBy[truthId] ?? []) : [];
      for (const player of correctGuessers) {
        scores.push({ player, points: CORRECT_POINTS, reason: 'guessed the true seed' });
      }
      for (const [optionId, attr] of Object.entries(scratch.attribution)) {
        if (attr.kind !== 'decoy') continue;
        const fooled = (pickedBy[optionId] ?? []).length;
        for (let k = 0; k < fooled; k++) {
          scores.push({ player: attr.author, points: FOOL_POINTS, reason: 'fooled a player' });
        }
      }

      const featured = scratch.featured;
      const options = scratch.options.map((o) => {
        const attr = scratch.attribution[o.id]!;
        return {
          id: o.id,
          text: o.text,
          kind: attr.kind,
          author: attr.kind === 'decoy' ? attr.author : undefined,
          pickedBy: pickedBy[o.id] ?? [],
        };
      });
      return {
        scratch: toRecord(scratch),
        scores,
        reveal: {
          round: ctx.round,
          stage: 'result' as const,
          featured,
          sketch: featured ? (scratch.sketches[featured] ?? null) : null,
          trueSeed: featured ? (scratch.assignments[featured]?.text ?? null) : null,
          options,
          correctGuessers,
        },
      };
    },

    // A draw round takes the dispute path with no disputes (straight to leaderboard); a sketch round
    // takes the guess (decision) path and never reaches these. Both are inert here.
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

/** The Sketchy plugin: the manifest + a factory that loads its seed bank via the injected loader. */
export const sketchyPlugin: GamePlugin<ResolvedSketchyConfig> = {
  manifest: {
    id: SKETCHY_GAME_ID,
    name: 'Sketchy',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 3, maxPlayers: 8 },
    visibility: 'insider',
  },
  create: async (services) => {
    const bank = await loadSeedBank(services.assets.forModule(import.meta.url));
    validateSeedBank(bank);
    return createSketchyGame(bank, services.rng);
  },
};

// Re-exported for tests + the web mirror.
export type { Sketch };
