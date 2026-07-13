// The Teeter Tower game module (spec 0044). Teeter is a LIVE game: instead of the discrete
// collect -> reveal -> advance turn cycle, it holds a continuously-running physics world in process
// and the engine steps it every tick via `tick`, streaming a `TeeterSim` snapshot so a precarious
// tower sways in real time. `collectMove` doubles as "apply this move to the live world" - it adds
// the dropped piece as a dynamic body; there is no pending/reveal.
//
// State lives in two places, kept in sync: an in-process `LiveWorld` (the matter engine + bodies,
// the source of truth while a session is running) and a compact scratch snapshot (persisted every
// tick, so a reconnect / engine restart rebuilds the world). Piece SHAPES stay deterministic (a
// seeded PRNG keyed on (seed, pieceIndex)); the settle is now real-time, not a pure track.
//
// v1 has NO lose state on purpose (no out-of-pieces fail): a level ends only on reaching its target,
// and the game ends when the final level clears. An out-of-pieces / retry lose path is a follow-up.

import { rankStandings, type Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  GamePlugin,
  GameServices,
  LiveTickResult,
  RevealResult,
  RoundContext,
  ScratchResult,
  SessionPlayer,
  StartRoundResult,
} from '@branchout/game-sdk';
import { LEVELS, levelAt, TOTAL_ROUNDS } from './levels';
import {
  addPieceToWorld,
  clampDropX,
  createWorld,
  evaluatePlacement,
  heightToScore,
  heldBodyAt,
  pieceForIndex,
  requiredDropHeight,
  stepWorld,
  storedPieceFrom,
  toBodyPayloads,
  toPiecePayload,
  toStoredBodies,
  worldHeight,
  type LiveWorld,
  type StoredBody,
  type StoredPiece,
} from './physics';
import { GROUND_TOP } from './levels';
import type { TeeterMove, TeeterSim } from './types';

export const TEETER_TOWER_GAME_ID = 'teeter-tower';

/** Host-supplied configuration. Teeter starts on defaults; there is nothing to tune yet. */
export type TeeterConfig = Record<string, never>;

/** Validate + default the config. Teeter takes no options, so any object (or nothing) is accepted. */
export function validateConfig(config: unknown): TeeterConfig {
  if (config != null && typeof config !== 'object') {
    throw new Error(`teeter-tower config must be an object or empty, got ${typeof config}`);
  }
  return {};
}

/**
 * The module's persisted state: a compact snapshot of the live world, enough to rebuild it after a
 * reconnect / engine restart. Persisted by `tick` (every tick) and by `collectMove` (on a drop).
 */
interface TeeterScratch {
  /** The base seed, derived once from services.rng, that the piece stream keys on. */
  seed: number;
  /** Current level index (0-2). */
  levelIndex: number;
  /** Best height reached this level (px above the platform) - the per-level scoring basis. */
  bestHeight: number;
  /** Cumulative game score across levels (never resets; the HUD + standings read it). */
  totalScore: number;
  /** Monotonic index of the NEXT piece to spawn (also the next body id). */
  pieceIndex: number;
  /** The placed tower bodies (local geometry + world transform + cosmetics). */
  bodies: StoredBody[];
  /** The current aim piece, or null once the game is over. */
  next: StoredPiece | null;
  /** True once the final level cleared - the game is over. */
  over: boolean;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): TeeterScratch {
  const s = scratch as Partial<TeeterScratch>;
  return {
    seed: s.seed ?? 0,
    levelIndex: s.levelIndex ?? 0,
    bestHeight: s.bestHeight ?? 0,
    totalScore: s.totalScore ?? 0,
    pieceIndex: s.pieceIndex ?? 0,
    bodies: s.bodies ?? [],
    next: s.next ?? null,
    over: s.over ?? false,
  };
}

function toRecord(scratch: TeeterScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** The active player for the current piece: `pieceIndex % players.length` (spec's turn model). */
function activePlayerFor(pieceIndex: number, players: readonly SessionPlayer[]): string {
  if (players.length === 0) return '';
  const idx = ((pieceIndex % players.length) + players.length) % players.length;
  return (players[idx] as SessionPlayer).player;
}

/** Wrap an angle (radians) into the canonical (-PI, PI] range. */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a > Math.PI) a -= twoPi;
  else if (a <= -Math.PI) a += twoPi;
  return a;
}

/** Parse a `move` string into a validated `{ angle, dropX, dropY }`, or null if malformed. */
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
  if (typeof m.dropY !== 'number' || !Number.isFinite(m.dropY)) return null;
  return { angle: normalizeAngle(m.angle), dropX: m.dropX, dropY: m.dropY };
}

/**
 * Build a Teeter Tower module. The world lives in a per-session `Map`, keyed by `room:game`; if a
 * session's world is missing (a fresh process / engine restart) it is rebuilt from the scratch
 * snapshot. Optionally seeded for tests; in production `create` derives the seed from the injected
 * rng (consumed exactly once).
 */
export function createTeeterTowerGame(rng: () => number = Math.random): GameModule {
  const worlds = new Map<string, LiveWorld>();

  const keyFor = (ctx: RoundContext): string => `${ctx.room}:${ctx.game}`;

  /** The current required min-drop line, as a world-y (keyed off the tower's highest point). */
  const requiredLineY = (target: number, height: number): number => {
    const reqH = requiredDropHeight(target, height);
    // Once all lines are cleared, the "line" is the tower top itself.
    return GROUND_TOP - (reqH ?? height);
  };

  /** Rebuild the live world for a session from a scratch snapshot. */
  const rebuild = (scratch: TeeterScratch): LiveWorld => {
    const level = levelAt(scratch.levelIndex);
    return createWorld({
      seed: scratch.seed,
      levelIndex: scratch.levelIndex,
      bestHeight: scratch.bestHeight,
      totalScore: scratch.totalScore,
      pieceIndex: scratch.pieceIndex,
      bodies: scratch.bodies,
      next: scratch.next,
      target: level.target,
      pendulum: level.pendulum,
    });
  };

  /** Get the live world for this session, rebuilding it from scratch if the process lost it. */
  const worldFor = (ctx: RoundContext): LiveWorld => {
    const key = keyFor(ctx);
    let world = worlds.get(key);
    if (!world) {
      world = rebuild(asScratch(ctx.scratch));
      worlds.set(key, world);
    }
    return world;
  };

  /** Ensure the world has an aim piece; generate the next one deterministically if missing. */
  const ensureNext = (world: LiveWorld): void => {
    if (world.next || world.over) return;
    world.next = storedPieceFrom(world.pieceIndex, pieceForIndex(world.seed, world.pieceIndex));
  };

  /** Snapshot the live world into a persisted scratch record. */
  const snapshot = (world: LiveWorld): TeeterScratch => ({
    seed: world.seed,
    levelIndex: world.levelIndex,
    bestHeight: world.bestHeight,
    totalScore: world.totalScore,
    pieceIndex: world.pieceIndex,
    bodies: toStoredBodies(world),
    next: world.next,
    over: world.over,
  });

  /** The streamable TeeterSim snapshot for the current world. */
  const toSim = (world: LiveWorld, players: readonly SessionPlayer[]): TeeterSim => {
    const level = levelAt(world.levelIndex);
    const height = worldHeight(world);
    return {
      bodies: toBodyPayloads(world),
      next: world.next ? toPiecePayload(world.next) : null,
      activePlayer: activePlayerFor(world.pieceIndex, players),
      height,
      score: world.totalScore,
      level: world.levelIndex,
      target: level.target,
      requiredLine: requiredLineY(level.target, height),
      over: world.over,
    };
  };

  return {
    id: TEETER_TOWER_GAME_ID,

    configure(config: unknown): ConfigureResult {
      validateConfig(config);
      // Derive the base seed once from the injected rng; everything reproducible flows from it.
      const seed = Math.floor(rng() * 0xffffffff) >>> 0;
      const scratch: TeeterScratch = {
        seed,
        levelIndex: 0,
        bestHeight: 0,
        totalScore: 0,
        pieceIndex: 0,
        bodies: [],
        next: null,
        over: false,
      };
      // `rounds` is unused for a live game (the engine ends it via tick.over), but the SDK requires
      // it >= 1. TOTAL_ROUNDS keeps a meaningful non-zero value. There is NO out-of-pieces lose
      // state in v1 (a deliberate follow-up); a level ends only on reaching its target.
      // No move window either: moves are accepted continuously while the world runs.
      return { scratch: toRecord(scratch), rounds: TOTAL_ROUNDS, moveWindowMs: 0 };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      // Ensure the world exists for this session (fresh or rebuilt from scratch), seed the first aim
      // piece, and return the initial snapshot as the prompt so the client renders before tick 1.
      const world = worldFor(ctx);
      ensureNext(world);
      const scratch = snapshot(world);
      const prompt: TeeterSim = toSim(world, ctx.players);
      return { scratch: toRecord(scratch), prompt };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const world = worldFor(ctx);
      ensureNext(world);

      if (world.over) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'game over' },
        };
      }

      // Only the active player may drop (turn model): active = pieceIndex % players.length.
      const active = activePlayerFor(world.pieceIndex, ctx.players);
      if (player !== active) {
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

      const piece = world.next;
      if (!piece) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'game over' },
        };
      }

      // Legality: the piece is placed at the client's chosen transform (angle, dropX, dropY), then
      // the server re-checks both rules authoritatively: it must clear the scene AND (min-drop rule)
      // sit fully above the required line, computed off the tower's CURRENT highest point. dropX is
      // clamped to the legal horizontal range; dropY is honored as sent (the client aims the height).
      const level = levelAt(world.levelIndex);
      const height = worldHeight(world);
      const dropX = clampDropX(parsed.dropX);
      const dropY = parsed.dropY;
      const held = heldBodyAt(piece.verts, dropX, dropY, parsed.angle);
      const placedBodies = world.placed.map((p) => p.body);
      const verdict = evaluatePlacement(
        held,
        level.target,
        height,
        world.platform,
        placedBodies,
        world.pendulum,
      );
      if (!verdict.ok) {
        const reason =
          verdict.reason === 'line' ? 'drop above the required line' : 'piece overlaps the tower';
        return { scratch: ctx.scratch as Record<string, unknown>, rejected: { reason } };
      }

      // Success: add the piece as a DYNAMIC body, advance the piece index, and generate the next aim
      // piece deterministically. No re-aim: once added it is in the live world.
      addPieceToWorld(world, piece, dropX, dropY, parsed.angle);
      world.pieceIndex += 1;
      world.next = storedPieceFrom(world.pieceIndex, pieceForIndex(world.seed, world.pieceIndex));

      return { scratch: toRecord(snapshot(world)) };
    },

    tick(ctx: RoundContext): LiveTickResult {
      const world = worldFor(ctx);
      if (world.over) {
        // Terminal: no more stepping. Re-emit the final snapshot so a late frame stays consistent.
        return { scratch: toRecord(snapshot(world)), sim: toSim(world, ctx.players), over: true };
      }

      stepWorld(world);

      // Recompute height + score. The per-drop delta is this level's band gain (heightToScore of the
      // new best minus the prior best); it accumulates into the cumulative total across levels.
      const level = levelAt(world.levelIndex);
      const height = worldHeight(world);
      const priorScore = heightToScore(world.bestHeight, level.target);
      world.bestHeight = Math.max(world.bestHeight, height);
      const newScore = heightToScore(world.bestHeight, level.target);
      world.totalScore += newScore - priorScore;

      let over = false;
      if (height >= level.target) {
        if (world.levelIndex < LEVELS.length - 1) {
          // Level cleared: advance the internal level and reset the tower for the next one. The
          // banked score carries (totalScore never resets); bestHeight resets for the fresh level.
          advanceLevel(world);
        } else {
          // Final level cleared: the game is over. No lose state in v1. Clear the aim piece so the
          // final snapshot streams `next: null` (nothing left to drop).
          world.over = true;
          world.next = null;
          over = true;
        }
      }

      ensureNext(world);
      const scratch = snapshot(world);
      const sim = toSim(world, ctx.players);
      if (over) {
        // Drop the retired world so a restart rebuilds cleanly.
        worlds.delete(keyFor(ctx));
      }
      return { scratch: toRecord(scratch), sim, over };
    },

    // --- turn-based lifecycle callbacks: present for interface completeness, unused in live flow ---

    collectVote(ctx: RoundContext): ScratchResult {
      return { scratch: ctx.scratch as Record<string, unknown> };
    },

    reveal(ctx: RoundContext): RevealResult {
      // A live game never reveals; return the current tower defensively so nothing wedges.
      return { scratch: ctx.scratch as Record<string, unknown>, reveal: null, scores: [] };
    },

    disputeWindow(ctx: RoundContext): DisputeWindowResult {
      return { scratch: ctx.scratch as Record<string, unknown>, disputes: [] };
    },

    disputeVote(ctx: RoundContext): DisputeVoteResult {
      return { scratch: ctx.scratch as Record<string, unknown>, scores: [] };
    },

    leaderboard(ctx: RoundContext): Standing[] {
      return standingsFor(ctx);
    },

    advance(): AdvanceResult {
      // Never drive rounds for a live game; a host `advance` is a defensive no-op that ends it.
      return { done: true };
    },

    endGame(ctx: RoundContext): Standing[] {
      return standingsFor(ctx);
    },
  };

  /**
   * Final/interim standings for a live game. The engine applies no reveal scores (a live game has no
   * reveal), so the score lives in the world/sim; rank the active player by the world's totalScore
   * when it is available, falling back to the engine's accumulated scores. Multiplayer per-player
   * scoring is a later concern - solo is one player.
   */
  function standingsFor(ctx: RoundContext): Standing[] {
    const world = worlds.get(keyFor(ctx));
    const total = world?.totalScore ?? asScratch(ctx.scratch).totalScore;
    const scores: Record<string, number> = { ...ctx.scores };
    const active = activePlayerFor(
      world?.pieceIndex ?? asScratch(ctx.scratch).pieceIndex,
      ctx.players,
    );
    if (active) scores[active] = total;
    return rankStandings(ctx.players, scores);
  }
}

/** Reset the world's tower for the next level, keeping the cumulative score and seed. */
function advanceLevel(world: LiveWorld): void {
  world.levelIndex += 1;
  world.bestHeight = 0;
  const level = levelAt(world.levelIndex);
  const fresh = createWorld({
    seed: world.seed,
    levelIndex: world.levelIndex,
    bestHeight: 0,
    totalScore: world.totalScore,
    pieceIndex: world.pieceIndex,
    bodies: [],
    next: world.next,
    target: level.target,
    pendulum: level.pendulum,
  });
  // Swap the fresh world's matter state in place so the caller's reference stays valid.
  world.engine = fresh.engine;
  world.platform = fresh.platform;
  world.placed = fresh.placed;
  world.pendulum = fresh.pendulum;
  world.pendulumPhase = 0;
}

/**
 * Teeter Tower as a plugin the engine registers. `create` builds the module with the injected rng
 * (consumed once to seed determinism). `validateConfig` is the manifest's config schema, run at the
 * start-handoff boundary. The manifest is marked `insider` so the game stays off the public catalog.
 */
export const teeterTowerPlugin: GamePlugin<TeeterConfig, TeeterSim, unknown> = {
  manifest: {
    id: TEETER_TOWER_GAME_ID,
    name: 'Teeter Tower',
    version: '0.2.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 1 },
    visibility: 'insider',
  },
  create: (services: GameServices) => createTeeterTowerGame(services.rng),
};
