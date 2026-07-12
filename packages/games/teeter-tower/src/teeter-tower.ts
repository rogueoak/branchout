// The Teeter Tower game module (spec 0043). A deterministic, headless GameModule: the engine owns
// phase sequencing, timers, streaming, and persistence; this module owns the physics stacking rules.
// One piece-drop is one engine round; the settle is simulated once, server-side and authoritative,
// and streamed as a keyframe track in the reveal so every client renders the identical tower.
//
// Determinism: services.rng is consumed exactly once (to derive the base seed); every reproducible
// value after that - each round's piece shape + spin - comes from a seeded PRNG keyed on
// (baseSeed, round). The settle runs at a fixed timestep with a hard step cap. No Math.random, no
// wall-clock: the whole sim is a pure function of (seed, moves).

import { rankStandings, type ScoreEvent, type Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  GamePlugin,
  GameServices,
  RevealResult,
  RoundContext,
  ScratchResult,
  SessionPlayer,
  StartRoundResult,
} from '@branchout/game-sdk';
import { LEVELS, TOTAL_ROUNDS } from './levels';
import { createRng, deriveSeed } from './rng';
import {
  buildWorld,
  dropYFor,
  evaluatePlacement,
  heightToScore,
  heldBodyAt,
  levelAt,
  makePiece,
  pieceToDrop,
  requiredDropHeight,
  simulateDrop,
  storedTowerHeight,
  toBodyPayloads,
  toPiecePayload,
  towerHeight,
  type StoredBody,
} from './physics';
import type { TeeterMove, TeeterPrompt, TeeterReveal } from './types';

export const TEETER_TOWER_GAME_ID = 'teeter-tower';

/**
 * A small dispute window (ms) so the empty `disputing` phase auto-closes to `leaderboard` without a
 * host tap - the "tower settled, next piece ready" rest state.
 */
export const DISPUTE_WINDOW_MS = 150;

/** Host-supplied configuration. Teeter starts on defaults; there is nothing to tune yet. */
export type TeeterConfig = Record<string, never>;

/** Validate + default the config. Teeter takes no options, so any object (or nothing) is accepted. */
export function validateConfig(config: unknown): TeeterConfig {
  if (config != null && typeof config !== 'object') {
    throw new Error(`teeter-tower config must be an object or empty, got ${typeof config}`);
  }
  return {};
}

/** The module's persisted state: the authoritative tower, level progress, and the base seed. */
interface TeeterScratch {
  /** The base seed, derived once from services.rng, that every round's piece stream keys on. */
  seed: number;
  /** Current level index (0-2). Internal progression the engine need not know about. */
  levelIndex: number;
  /** The authoritative settled tower (local geometry + world transforms + cosmetics). */
  tower: StoredBody[];
  /** Best height reached this level (px above the platform) - the scoring basis. */
  bestHeight: number;
  /**
   * The cumulative game score: the running total of every emitted score delta so far. Because
   * bestHeight resets to 0 on a level clear, the per-level band (heightToScore) alone would disagree
   * with the engine's accumulated scores across levels; this running total is the single scale both
   * the Viewer HUD (reveal.score) and the leaderboard/FinalResults (accumulated scores) read.
   */
  totalScore: number;
  /** Monotonic id for the next dropped piece. */
  nextId: number;
  /** The active player's pending move for the current round, or null until submitted. */
  pending: TeeterMove | null;
}

function emptyScratch(seed: number): TeeterScratch {
  return { seed, levelIndex: 0, tower: [], bestHeight: 0, totalScore: 0, nextId: 1, pending: null };
}

function asScratch(scratch: Readonly<Record<string, unknown>>): TeeterScratch {
  const s = scratch as Partial<TeeterScratch>;
  return {
    seed: s.seed ?? 0,
    levelIndex: s.levelIndex ?? 0,
    tower: s.tower ?? [],
    bestHeight: s.bestHeight ?? 0,
    totalScore: s.totalScore ?? 0,
    nextId: s.nextId ?? 1,
    pending: s.pending ?? null,
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: TeeterScratch): TeeterScratch {
  return JSON.parse(JSON.stringify(scratch)) as TeeterScratch;
}

function toRecord(scratch: TeeterScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** The active player for a round: `round % players.length` (spec's turn model). */
function activePlayerFor(ctx: RoundContext): string {
  const players = ctx.players;
  if (players.length === 0) return '';
  const idx = ((ctx.round % players.length) + players.length) % players.length;
  return (players[idx] as SessionPlayer).player;
}

/**
 * Regenerate the piece for a round deterministically. The piece stream is keyed on
 * (baseSeed, round), so startRound, collectMove (legality), and reveal all produce the *same* piece
 * for a given round without persisting the shape - the seed is the single source of truth.
 */
function pieceForRound(seed: number, round: number): ReturnType<typeof makePiece> {
  const rng = createRng(deriveSeed(seed, round));
  return makePiece(rng);
}

/** Parse a `move` string into a validated `{ angle, dropX }`, or return null if malformed. */
function parseMove(move: string): TeeterMove | null {
  let raw: unknown;
  try {
    raw = JSON.parse(move);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const m = raw as Partial<TeeterMove>;
  if (typeof m.angle !== 'number' || !Number.isFinite(m.angle)) return null;
  if (typeof m.dropX !== 'number' || !Number.isFinite(m.dropX)) return null;
  // Defense-in-depth: normalize the angle into (-PI, PI]. Rotation is periodic, so a huge or tiny
  // value is legal but noisy; wrapping keeps the settle geometry identical while bounding the input
  // (dropX is already clamped downstream by clampDropX).
  return { angle: normalizeAngle(m.angle), dropX: m.dropX };
}

/** Wrap an angle (radians) into the canonical (-PI, PI] range. */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a > Math.PI) a -= twoPi;
  else if (a <= -Math.PI) a += twoPi;
  return a;
}

/**
 * Build a Teeter Tower module. Optionally seeded for tests; in production `create` derives the seed
 * from the injected rng. All simulation is a pure function of the seed + the moves played.
 */
export function createTeeterTowerGame(rng: () => number = Math.random): GameModule {
  return {
    id: TEETER_TOWER_GAME_ID,

    configure(config: unknown): ConfigureResult {
      validateConfig(config);
      // Derive the base seed once from the injected rng; everything reproducible flows from it.
      const seed = Math.floor(rng() * 0xffffffff) >>> 0;
      // v1 has NO fail state on purpose. TOTAL_ROUNDS is the sum of every level's `pieces` budget
      // (11 + 20 + 22 in levels.ts), but that budget is not enforced as an "out of pieces" loss: a
      // level ends only on reaching its target, and the game runs the fixed round count regardless.
      // An out-of-pieces / retry lose flow (the prototype has one) is a deliberate follow-up.
      return {
        scratch: toRecord(emptyScratch(seed)),
        rounds: TOTAL_ROUNDS,
        disputeWindowMs: DISPUTE_WINDOW_MS,
        moveWindowMs: 0,
      };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const scratch = clone(asScratch(ctx.scratch));
      scratch.pending = null;
      const level = levelAt(scratch.levelIndex);
      const piece = pieceForRound(scratch.seed, ctx.round);
      const height = storedTowerHeight(scratch.tower);
      const prompt: TeeterPrompt = {
        round: ctx.round,
        level: scratch.levelIndex,
        target: level.target,
        height,
        activePlayer: activePlayerFor(ctx),
        tower: toBodyPayloads(scratch.tower),
        piece: toPiecePayload(piece),
      };
      return { scratch: toRecord(scratch), prompt };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const scratch = clone(asScratch(ctx.scratch));

      // Only the active player may move (turn model). A non-active submission is rejected outright.
      if (player !== activePlayerFor(ctx)) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'not your turn' },
        };
      }

      const parsed = parseMove(move);
      if (!parsed) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'malformed move' },
        };
      }

      // Legality: rebuild the world + the held piece at the chosen transform and evaluate the same
      // overlap + min-drop-line rules the prototype enforces. Reject an illegal drop to the sender.
      const level = levelAt(scratch.levelIndex);
      const world = buildWorld(scratch.tower, level.target, level.pendulum);
      const height = towerHeight(world.placed);
      const piece = pieceForRound(scratch.seed, ctx.round);
      const requiredLine = requiredDropHeight(level.target, height);
      const dropY = dropYFor(toPiecePayload(piece).verts, parsed.angle, requiredLine, height);
      const drop = pieceToDrop(scratch.nextId, piece, parsed.angle, parsed.dropX, dropY);
      const held = heldBodyAt(drop.verts, drop.x, drop.y, drop.angle);
      const verdict = evaluatePlacement(
        held,
        level.target,
        height,
        world.platform,
        world.placed,
        world.pendulum,
      );
      if (!verdict.ok) {
        const reason =
          verdict.reason === 'line' ? 'drop above the required line' : 'piece overlaps the tower';
        return { scratch: ctx.scratch as Record<string, unknown>, rejected: { reason } };
      }

      scratch.pending = { angle: parsed.angle, dropX: parsed.dropX };
      return { scratch: toRecord(scratch) };
    },

    // The round closes once the active player's single move is stored.
    allSubmitted(ctx: RoundContext): boolean {
      return asScratch(ctx.scratch).pending != null;
    },

    reveal(ctx: RoundContext): RevealResult {
      const scratch = clone(asScratch(ctx.scratch));
      const active = activePlayerFor(ctx);
      const move = scratch.pending;
      const level = levelAt(scratch.levelIndex);

      // Defensive: reveal without a stored move (host force-close) yields a no-op settle so the game
      // never wedges. It re-emits the current tower with an empty track.
      if (!move) {
        const height = storedTowerHeight(scratch.tower);
        const reveal: TeeterReveal = {
          track: [],
          tower: toBodyPayloads(scratch.tower),
          height,
          // No settle ran, so the cumulative game score is unchanged. Report the running total (the
          // same scale the leaderboard reads), not the per-level band.
          score: scratch.totalScore,
          level: scratch.levelIndex,
          target: level.target,
          cleared: false,
        };
        return { scratch: toRecord(scratch), reveal, scores: [] };
      }

      const piece = pieceForRound(scratch.seed, ctx.round);
      const id = scratch.nextId;
      scratch.nextId += 1;
      // Compute the drop origin exactly as collectMove did (the tower is unchanged between them), so
      // the simulated settle matches the placement the move was validated against.
      const height = storedTowerHeight(scratch.tower);
      const requiredLine = requiredDropHeight(level.target, height);
      const dropY = dropYFor(toPiecePayload(piece).verts, move.angle, requiredLine, height);
      const drop = pieceToDrop(id, piece, move.angle, move.dropX, dropY);

      const settle = simulateDrop(scratch.tower, drop, level.target, level.pendulum);
      scratch.tower = settle.tower;

      // Score is a running total across all levels. Each drop's delta is this level's band gain
      // (heightToScore of the new best minus the prior best); we add it to the cumulative total so
      // reveal.score (the Viewer HUD) and the accumulated engine scores (the leaderboard) agree.
      const priorScore = heightToScore(scratch.bestHeight, level.target);
      scratch.bestHeight = Math.max(scratch.bestHeight, settle.height);
      const newScore = heightToScore(scratch.bestHeight, level.target);
      const delta = newScore - priorScore;
      scratch.totalScore += delta;

      // Level cleared when the tower reaches the target: advance the internal level and reset the
      // tower for the next one. bestHeight resets to 0 for the new level, but totalScore carries the
      // 100 already banked for this cleared level (the running total never resets).
      let cleared = false;
      if (settle.height >= level.target && scratch.levelIndex < LEVELS.length - 1) {
        cleared = true;
        scratch.levelIndex += 1;
        scratch.tower = [];
        scratch.bestHeight = 0;
      } else if (settle.height >= level.target) {
        // Final level cleared: keep the tower but mark it cleared.
        cleared = true;
      }

      scratch.pending = null;

      const revealLevel = levelAt(scratch.levelIndex);
      const reveal: TeeterReveal = {
        track: settle.track,
        tower: toBodyPayloads(scratch.tower),
        height: cleared && scratch.tower.length === 0 ? 0 : settle.height,
        // The cumulative game score (sum of all emitted deltas), so the HUD matches the leaderboard.
        score: scratch.totalScore,
        level: scratch.levelIndex,
        target: revealLevel.target,
        cleared,
      };

      const scores: ScoreEvent[] =
        delta > 0 ? [{ player: active, points: delta, reason: 'tower height' }] : [];

      return { scratch: toRecord(scratch), reveal, scores };
    },

    collectVote(ctx: RoundContext): ScratchResult {
      // Teeter has no disputes or ballots; votes are ignored.
      return { scratch: ctx.scratch as Record<string, unknown> };
    },

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
      return { done: ctx.round >= TOTAL_ROUNDS };
    },

    endGame(ctx: RoundContext): Standing[] {
      return rankStandings(ctx.players, ctx.scores);
    },
  };
}

/**
 * Teeter Tower as a plugin the engine registers. `create` builds the module with the injected rng
 * (consumed once to seed determinism). `validateConfig` is the manifest's config schema, run at the
 * start-handoff boundary. The manifest is marked `insider` so the game stays off the public catalog.
 */
export const teeterTowerPlugin: GamePlugin<TeeterConfig, TeeterPrompt, TeeterReveal> = {
  manifest: {
    id: TEETER_TOWER_GAME_ID,
    name: 'Teeter Tower',
    version: '0.1.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 1 },
    visibility: 'insider',
  },
  create: (services: GameServices) => createTeeterTowerGame(services.rng),
};
