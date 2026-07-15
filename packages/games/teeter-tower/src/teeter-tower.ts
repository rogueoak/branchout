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
import { LEVELS, levelAt, PAR_PENALTY, TOTAL_ROUNDS } from './levels';
import {
  addPieceToWorld,
  clampDropX,
  clampDropY,
  clampDropYToLine,
  COMPLETE_TICKS,
  createWorld,
  heightToScore,
  heldBodyAt,
  INTRO_TICKS,
  lineYFor,
  MAX_PLACED_BODIES,
  MAX_SETTLE_TICKS,
  overlapsScene,
  pieceForIndex,
  requiredDropHeight,
  sceneSettled,
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
import type { TeeterMove, TeeterPhase, TeeterSim } from './types';

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
  /** Last SETTLED tower height (px) - the reported height, refreshed only at rest (feedback 0026). */
  stableHeight: number;
  /** Pieces dropped this round (resets each level) - drives the over-par penalty (feedback 0026). */
  piecesThisLevel: number;
  /** Cumulative game score across levels (never resets; the HUD + standings read it). Can go negative. */
  totalScore: number;
  /** Monotonic index of the NEXT piece to spawn (also the next body id). */
  pieceIndex: number;
  /** The placed tower bodies (local geometry + world transform + cosmetics). */
  bodies: StoredBody[];
  /** The current aim piece, or null once the game is over. */
  next: StoredPiece | null;
  /** True once the final level cleared - the game is over. */
  over: boolean;
  /**
   * The round-transition phase (feedback 0032), persisted so a reconnect mid-transition rebuilds into
   * the same beat and shows the right banner. `'playing'` outside a transition.
   */
  phase: TeeterPhase;
  /** Ticks remaining in the current transition beat (feedback 0032); 0 while `'playing'`. */
  phaseTicks: number;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): TeeterScratch {
  const s = scratch as Partial<TeeterScratch>;
  return {
    seed: s.seed ?? 0,
    levelIndex: s.levelIndex ?? 0,
    bestHeight: s.bestHeight ?? 0,
    stableHeight: s.stableHeight ?? 0,
    piecesThisLevel: s.piecesThisLevel ?? 0,
    totalScore: s.totalScore ?? 0,
    pieceIndex: s.pieceIndex ?? 0,
    bodies: s.bodies ?? [],
    next: s.next ?? null,
    over: s.over ?? false,
    // Default to normal play (feedback 0032): a legacy snapshot without a phase rebuilds as `'playing'`.
    phase: s.phase ?? 'playing',
    phaseTicks: s.phaseTicks ?? 0,
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
      stableHeight: scratch.stableHeight,
      piecesThisLevel: scratch.piecesThisLevel,
      totalScore: scratch.totalScore,
      pieceIndex: scratch.pieceIndex,
      bodies: scratch.bodies,
      next: scratch.next,
      // Thread `over` through, or a world rebuilt from a snapshot with over:true would come back
      // over:false and keep stepping past game end.
      over: scratch.over,
      target: level.target,
      pendulum: level.pendulum,
      platformWidth: level.platformWidth,
      walls: level.walls,
      // Thread the transition beat through so a reconnect mid-transition resumes it (feedback 0032).
      phase: scratch.phase,
      phaseTicks: scratch.phaseTicks,
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
    stableHeight: world.stableHeight,
    piecesThisLevel: world.piecesThisLevel,
    totalScore: world.totalScore,
    pieceIndex: world.pieceIndex,
    bodies: toStoredBodies(world),
    next: world.next,
    over: world.over,
    phase: world.phase,
    phaseTicks: world.phaseTicks,
  });

  /** The streamable TeeterSim snapshot for the current world. */
  const toSim = (world: LiveWorld, players: readonly SessionPlayer[]): TeeterSim => {
    const level = levelAt(world.levelIndex);
    // The reported height is the SETTLED height (feedback 0026), so the streamed line does not jump.
    const height = world.stableHeight;
    return {
      bodies: toBodyPayloads(world),
      next: world.next ? toPiecePayload(world.next) : null,
      activePlayer: activePlayerFor(world.pieceIndex, players),
      height,
      score: world.totalScore,
      level: world.levelIndex,
      target: level.target,
      // Par + the pieces dropped this round drive the client's par HUD + the over-par penalty warning.
      par: level.par,
      pieces: world.piecesThisLevel,
      requiredLine: requiredLineY(level.target, height),
      // The client draws the platform + walls and clamps drop-x from this authoritative config, so a
      // per-level platform (level 1 is wider + walled) is honored client-side without a hardcoded width.
      platform: { width: level.platformWidth, walls: level.walls },
      over: world.over,
      // Round-transition beat (feedback 0032): the client paints the "Complete!"/"Round X" banner.
      phase: world.phase,
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
        stableHeight: 0,
        piecesThisLevel: 0,
        totalScore: 0,
        pieceIndex: 0,
        bodies: [],
        next: null,
        over: false,
        // Round 1 opens directly in normal play (feedback 0032): the transition beat is only BETWEEN
        // rounds, so the game-start flow (and the single-drop e2e) is unchanged.
        phase: 'playing',
        phaseTicks: 0,
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
        // Between-piece pause (feedback 0027): the tower is still settling, so no aim piece is offered
        // yet. A well-behaved client cannot submit (it gates aiming on `next`), but reject a lagging or
        // scripted drop server-side rather than regenerating the piece and dropping onto a moving tower.
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'wait for the tower to settle' },
        };
      }

      // Hard cap the tower: v1 has no lose state, so without a bound `world.placed` could grow
      // unbounded (a player spamming legal drops) and swell the sim/snapshot. Refuse a drop at the cap.
      if (world.placed.length >= MAX_PLACED_BODIES) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'tower is full' },
        };
      }

      // Legality: the piece is placed at the client's chosen transform (angle, dropX, dropY). dropX and
      // dropY are clamped to the legal world range before the solver sees them (the client aims the
      // height; the clamp guards a malformed or wildly out-of-range value).
      const level = levelAt(world.levelIndex);
      // Gate the drop against the SETTLED tower height (feedback 0026), so the min-drop line the player
      // aimed at (the streamed, stable line) is the one the server enforces - not a mid-tumble value.
      const height = world.stableHeight;
      const dropX = clampDropX(parsed.dropX, world.platformWidth);
      let dropY = clampDropY(parsed.dropY);
      // Min-drop line as a world-y: the bottom of the piece must sit above it. Once every line is
      // cleared, `lineYFor` is null and there is no line to clamp against.
      const lineY = lineYFor(level.target, height);
      // Below-the-line drop -> CLAMP up, don't block (feedback 0032): shift the piece up so its bottom
      // rests just above the line, then rebuild it there. Clamping UP moves it AWAY from the tower, so
      // it cannot introduce an overlap. The line is now satisfied by construction; only the overlap
      // rule can still reject a genuinely blocked spot.
      let held = heldBodyAt(piece.verts, dropX, dropY, parsed.angle);
      const clampedY = clampDropYToLine(held, lineY);
      if (clampedY !== dropY) {
        dropY = clampedY;
        held = heldBodyAt(piece.verts, dropX, dropY, parsed.angle);
      }
      const placedBodies = world.placed.map((p) => p.body);
      if (overlapsScene(held, world.platform, placedBodies, world.pendulum, world.walls)) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'piece overlaps the tower' },
        };
      }

      // Success: add the piece as a DYNAMIC body, advance the piece index. No re-aim: once added it is
      // in the live world.
      addPieceToWorld(world, piece, dropX, dropY, parsed.angle);
      world.pieceIndex += 1;
      // Over-par penalty (feedback 0026): once this round's drops exceed par, each further piece costs
      // PAR_PENALTY points. The running total can go negative. Counted per DROP: a piece later culled at
      // DEATH_Y (it fell off) keeps its debit - you spent the drop - so this is not decremented on cull.
      world.piecesThisLevel += 1;
      if (world.piecesThisLevel > level.par) world.totalScore -= PAR_PENALTY;
      // Pause between pieces (feedback 0027): clear the aim piece; the tick offers the next one only once
      // the tower settles (or the settle-wait cap), so a piece is never presented while the last falls.
      world.next = null;
      world.settleWaitTicks = 0;

      return { scratch: toRecord(snapshot(world)) };
    },

    tick(ctx: RoundContext): LiveTickResult {
      const world = worldFor(ctx);
      if (world.over) {
        // Terminal: no more stepping. Re-emit the final snapshot so a late frame stays consistent.
        return { scratch: toRecord(snapshot(world)), sim: toSim(world, ctx.players), over: true };
      }

      stepWorld(world);

      // Refresh the reported height ONLY when the whole scene is at rest (feedback 0026): while a piece
      // falls or the tower tumbles, `stableHeight` holds its last settled value, so the height / score /
      // level-clear / min-drop line never react to motion. A just-dropped body has been stepped once
      // above, so it reads as moving here and cannot settle the height at its release point. Kept alive
      // during the transition beat too, so the held tower stays visually settled while "Complete!" shows.
      if (sceneSettled(world)) world.stableHeight = worldHeight(world);

      const level = levelAt(world.levelIndex);

      // Round-transition beat (feedback 0032). During `'complete'`/`'intro'` the scoring/clear block is
      // SKIPPED entirely and no piece is offered - the tower just holds while the banner shows. A
      // perceivable pause has to be server-authoritative: it holds the sim and gates the next input.
      if (world.phase === 'complete') {
        world.phaseTicks -= 1;
        if (world.phaseTicks <= 0) {
          if (world.levelIndex < LEVELS.length - 1) {
            // The post-clear beat elapsed: advance to the fresh round and play the "Round X" intro.
            advanceLevel(world);
            world.phase = 'intro';
            world.phaseTicks = INTRO_TICKS;
          } else {
            // The FINAL round routed through `'complete'` (so "Complete!" shows), and its beat has now
            // elapsed: the game is over. No lose state in v1.
            world.over = true;
            world.next = null;
          }
        }
        const over = world.over;
        const result: LiveTickResult = {
          scratch: toRecord(snapshot(world)),
          sim: toSim(world, ctx.players),
          over,
        };
        if (over) worlds.delete(keyFor(ctx)); // retire the world so a restart rebuilds cleanly
        return result;
      }

      if (world.phase === 'intro') {
        world.phaseTicks -= 1;
        if (world.phaseTicks <= 0) {
          // The intro beat elapsed: resume play. The next `'playing'` tick offers the first piece via
          // the existing settle block (the fresh tower is empty/settled, so it appears at once).
          world.phase = 'playing';
          world.settleWaitTicks = 0;
        }
        return {
          scratch: toRecord(snapshot(world)),
          sim: toSim(world, ctx.players),
          over: false,
        };
      }

      // ---- 'playing': the normal scoring / clear / offer-next block ----

      // Score off the settled height. The per-drop delta is this level's band gain (heightToScore of the
      // new best minus the prior best); it accumulates into the cumulative total across levels.
      const height = world.stableHeight;
      const priorScore = heightToScore(world.bestHeight, level.target);
      world.bestHeight = Math.max(world.bestHeight, height);
      const newScore = heightToScore(world.bestHeight, level.target);
      world.totalScore += newScore - priorScore;

      if (height >= level.target) {
        // Round cleared: enter the "Complete!" beat (feedback 0032). Do NOT advance or set `over` here -
        // the `'complete'` tick handles it once the countdown elapses. Withhold the next piece so the
        // held tower reads as a deliberate pause. This routes BOTH a non-final and the final round.
        world.phase = 'complete';
        world.phaseTicks = COMPLETE_TICKS;
        world.next = null;
        return {
          scratch: toRecord(snapshot(world)),
          sim: toSim(world, ctx.players),
          over: false,
        };
      }

      // Pause between pieces (feedback 0027): while `next` is null (just after a drop) hold off offering
      // the next piece until the tower has settled - or a max wait, so a never-resting scene (e.g. the
      // pendulum) can't withhold it forever. An empty/settled scene (game start, fresh level) offers it
      // at once.
      if (!world.next && !world.over) {
        world.settleWaitTicks += 1;
        if (sceneSettled(world) || world.settleWaitTicks >= MAX_SETTLE_TICKS) ensureNext(world);
      }
      return { scratch: toRecord(snapshot(world)), sim: toSim(world, ctx.players), over: false };
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

    disposeLive(ctx: RoundContext): void {
      // Release the in-process Matter world for this session (spec 0044): the engine calls this on
      // endGame / host exit / host restart so the world does not leak and a restart rebuilds fresh.
      worlds.delete(keyFor(ctx));
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
  // Fresh round: the tower is empty again, so the reported height and the per-round piece count reset.
  world.stableHeight = 0;
  world.piecesThisLevel = 0;
  world.settleWaitTicks = 0;
  const level = levelAt(world.levelIndex);
  const fresh = createWorld({
    seed: world.seed,
    levelIndex: world.levelIndex,
    bestHeight: 0,
    stableHeight: 0,
    piecesThisLevel: 0,
    totalScore: world.totalScore,
    pieceIndex: world.pieceIndex,
    bodies: [],
    next: world.next,
    target: level.target,
    pendulum: level.pendulum,
    platformWidth: level.platformWidth,
    walls: level.walls,
  });
  // Swap the fresh world's matter state in place so the caller's reference stays valid.
  world.engine = fresh.engine;
  world.platform = fresh.platform;
  world.walls = fresh.walls;
  world.platformWidth = fresh.platformWidth;
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
