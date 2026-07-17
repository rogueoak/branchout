// The Nightleaf game module (spec 0060). Nightleaf is a COOPERATIVE, real-time, SILENT ascending-
// number game and a LIVE module: instead of the discrete collect -> reveal -> advance turn cycle it
// holds one continuous phase, `collectMove` applies a move to the shared grove, and `tick` streams a
// `NightleafSim` snapshot so every device sees the trunk grow in real time.
//
// The secret seam (spec 0052). Each player holds a PRIVATE hand of leaves. That hand is the whole
// game - if it leaked, a player could just read the wire and never misplay. So a hand NEVER rides the
// broadcast sim: the sim carries only shared, safe state (the trunk, buds, tier, per-player leaf
// COUNTS). Each player's exact leaves are delivered ONLY to that player via the `private` frame
// (spec 0052): `startRound` and every `tick` return `private: { [playerId]: NightleafHand }`, and the
// engine targets each entry to that player's device(s) alone. A test proves player B never receives
// player A's hand.
//
// Everything is a pure function of a single base seed (the deal) plus the plays the group makes, so
// the whole grove is fully serializable in scratch - a reconnect / engine restart rebuilds it with no
// in-process world, so there is no `disposeLive`.

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
import { validateConfig, type ResolvedNightleafConfig } from './config';
import { ascending, dealTier } from './deal';
import type {
  HandSummary,
  NightleafHand,
  NightleafMove,
  NightleafPhase,
  NightleafSim,
} from './types';

export const NIGHTLEAF_GAME_ID = 'nightleaf';

/** How many ticks the tier-cleared / misplay / result banner beats hold before play resumes. */
const BANNER_TICKS = 20;

export type { ResolvedNightleafConfig };
export { validateConfig };

/**
 * The module's persisted, fully-serializable state. `hands` holds the SECRET leaves - it is persisted
 * (so a reconnect rebuilds the deal) but is NEVER put on the broadcast sim; only the per-player private
 * frame carries a hand.
 */
interface NightleafScratch {
  /** The base seed, derived once from services.rng, that the whole deal keys on. */
  seed: number;
  /** The final tier: clearing it wins. */
  finalTier: number;
  /** The current tier (1-based). Tier N deals N leaves to each player. */
  tier: number;
  /** Buds (lives) remaining; a misplay costs one, zero loses the game. */
  buds: number;
  /** The buds the group started with (the HUD's full track). */
  maxBuds: number;
  /** Fireflies (shared hushes) remaining. */
  fireflies: number;
  /** The stable seat order of player ids the deal + summaries iterate (deterministic). */
  order: string[];
  /** Each player's SECRET remaining hand this tier, ascending. NEVER broadcast. */
  hands: Record<string, number[]>;
  /** The leaves played onto the trunk this tier, ascending (the shared pile). */
  trunk: number[];
  /** Player ids who have proposed the current hush; a hush fires once every holder proposes. */
  hushProposers: string[];
  /** True once the game ended (a win or a loss). */
  over: boolean;
  /** True when the game ended in a win (final tier cleared). */
  won: boolean;
  /** The current banner beat. */
  phase: NightleafPhase;
  /** Ticks left in the current banner beat (tier-cleared / misplay); 0 while `playing`. */
  phaseTicks: number;
  /** The last misplay detail, for the misplay banner; null outside that beat. */
  lastMisplay: { played: number; lowestHeld: number } | null;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): NightleafScratch {
  const s = scratch as Partial<NightleafScratch>;
  return {
    seed: s.seed ?? 0,
    finalTier: s.finalTier ?? 1,
    tier: s.tier ?? 1,
    buds: s.buds ?? 0,
    maxBuds: s.maxBuds ?? 0,
    fireflies: s.fireflies ?? 0,
    order: s.order ?? [],
    hands: s.hands ?? {},
    trunk: s.trunk ?? [],
    hushProposers: s.hushProposers ?? [],
    over: s.over ?? false,
    won: s.won ?? false,
    phase: s.phase ?? 'playing',
    phaseTicks: s.phaseTicks ?? 0,
    lastMisplay: s.lastMisplay ?? null,
  };
}

function toRecord(scratch: NightleafScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** The stable seat order for a session: the player ids in roster order. */
function orderOf(players: readonly SessionPlayer[]): string[] {
  return players.map((p) => p.player);
}

/** The lowest leaf still held anywhere across all hands, or Infinity when every hand is empty. */
function globalLowest(hands: Record<string, number[]>): number {
  let min = Infinity;
  for (const leaves of Object.values(hands)) {
    const first = leaves[0];
    if (first !== undefined && first < min) min = first;
  }
  return min;
}

/** Total leaves still held across all hands. */
function leavesLeft(hands: Record<string, number[]>): number {
  let total = 0;
  for (const leaves of Object.values(hands)) total += leaves.length;
  return total;
}

/** Build each player's public hand summary (id, nickname, COUNT) - never their leaf values. */
function handSummaries(
  scratch: NightleafScratch,
  players: readonly SessionPlayer[],
): HandSummary[] {
  const nick = new Map(players.map((p) => [p.player, p.nickname] as const));
  return scratch.order.map((id) => ({
    player: id,
    nickname: nick.get(id) ?? id,
    count: (scratch.hands[id] ?? []).length,
  }));
}

/** The SHARED broadcast snapshot. Carries NO leaf values from any hand - only public counts. */
function toSim(scratch: NightleafScratch, players: readonly SessionPlayer[]): NightleafSim {
  const trunk = scratch.trunk;
  return {
    tier: scratch.tier,
    finalTier: scratch.finalTier,
    buds: scratch.buds,
    maxBuds: scratch.maxBuds,
    fireflies: scratch.fireflies,
    trunk: [...trunk],
    top: trunk.length > 0 ? (trunk[trunk.length - 1] as number) : 0,
    hands: handSummaries(scratch, players),
    leavesLeft: leavesLeft(scratch.hands),
    hushProposers: [...scratch.hushProposers],
    over: scratch.over,
    won: scratch.won,
    phase: scratch.phase,
    lastMisplay: scratch.lastMisplay ? { ...scratch.lastMisplay } : null,
  };
}

/** The SECRET per-player hand payloads for the private frame: playerId -> that player's own hand. */
function toPrivate(scratch: NightleafScratch): Record<string, NightleafHand> {
  const out: Record<string, NightleafHand> = {};
  for (const id of scratch.order) {
    const leaves = scratch.hands[id] ?? [];
    out[id] = { leaves: [...leaves], lowest: leaves[0] ?? 0 };
  }
  return out;
}

/** Deal a tier into a scratch: fresh hands, an empty trunk, and normal play. */
function dealInto(scratch: NightleafScratch): void {
  scratch.hands = dealTier(scratch.seed, scratch.tier, scratch.order);
  scratch.trunk = [];
  scratch.hushProposers = [];
  scratch.phase = 'playing';
  scratch.phaseTicks = 0;
  scratch.lastMisplay = null;
}

/**
 * Build a Nightleaf module. Optionally seeded for tests; in production `create` derives the seed from
 * the injected rng (consumed exactly once). No in-process world - the whole grove lives in scratch.
 */
export function createNightleafGame(rng: () => number = Math.random): GameModule {
  return {
    id: NIGHTLEAF_GAME_ID,

    configure(config: unknown): ConfigureResult {
      const resolved = validateConfig(config);
      // Derive the base seed once from the injected rng; the whole deal is reproducible from it.
      const seed = Math.floor(rng() * 0xffffffff) >>> 0;
      const scratch: NightleafScratch = {
        seed,
        finalTier: resolved.tiers,
        tier: 1,
        buds: resolved.buds,
        maxBuds: resolved.buds,
        fireflies: resolved.fireflies,
        order: [],
        hands: {},
        trunk: [],
        hushProposers: [],
        over: false,
        won: false,
        phase: 'playing',
        phaseTicks: 0,
        lastMisplay: null,
      };
      // `rounds` is unused for a live game (the engine ends it via tick.over) but the SDK requires it
      // >= 1; the tier count is a meaningful non-zero value. No move window - moves are accepted
      // continuously while the grove runs.
      return { scratch: toRecord(scratch), rounds: resolved.tiers, moveWindowMs: 0 };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      // Freeze the seat order from the live roster, deal tier 1, and return the shared prompt plus each
      // player's SECRET hand on the private channel (never in the prompt).
      const scratch = asScratch(ctx.scratch);
      scratch.order = orderOf(ctx.players);
      dealInto(scratch);
      return {
        scratch: toRecord(scratch),
        prompt: toSim(scratch, ctx.players),
        private: toPrivate(scratch),
      };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const scratch = asScratch(ctx.scratch);

      if (scratch.over) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'game over' },
        };
      }
      // No moves land during a banner beat (a tier-clear pause / a misplay flash); the grove holds.
      if (scratch.phase !== 'playing') {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'wait for the grove to settle' },
        };
      }

      const parsed = parseMove(move);
      if (!parsed) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'malformed move' },
        };
      }

      if (parsed.kind === 'hush') return resolveHush(ctx, scratch, player);
      return resolvePlay(ctx, scratch, player);
    },

    tick(ctx: RoundContext): LiveTickResult {
      const scratch = asScratch(ctx.scratch);

      if (scratch.over) {
        // Terminal: re-emit the final snapshot so a late frame stays consistent. Re-send the private
        // hands too so a reconnecting device catches up to an (empty) hand.
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          sim: toSim(scratch, ctx.players),
          over: true,
          private: toPrivate(scratch),
        };
      }

      // Banner beats (tier-cleared / misplay / result): count down, then resolve to the next state. The
      // grove holds and rejects moves while a banner shows (a server-authoritative, perceivable pause).
      if (scratch.phase !== 'playing') {
        scratch.phaseTicks -= 1;
        if (scratch.phaseTicks <= 0) {
          if (scratch.phase === 'tier-cleared') {
            // The cleared-tier pause elapsed: advance to the next tier and deal it, or win the game.
            if (scratch.tier >= scratch.finalTier) {
              scratch.over = true;
              scratch.won = true;
              scratch.phase = 'won';
              scratch.phaseTicks = BANNER_TICKS;
            } else {
              scratch.tier += 1;
              dealInto(scratch);
            }
          } else if (scratch.phase === 'misplay') {
            // The misplay flash elapsed: back to silent play (buds already debited), unless the group
            // is out of buds (a loss) or the misplay also emptied the last hands (a cleared tier).
            scratch.lastMisplay = null;
            if (scratch.buds <= 0) {
              scratch.over = true;
              scratch.won = false;
              scratch.phase = 'lost';
              scratch.phaseTicks = BANNER_TICKS;
            } else if (leavesLeft(scratch.hands) === 0) {
              scratch.phase = 'tier-cleared';
              scratch.phaseTicks = BANNER_TICKS;
            } else {
              scratch.phase = 'playing';
            }
          } else {
            // A won/lost banner elapsed: the game is already over above; nothing more to do.
            scratch.phase = 'playing';
          }
        }
      }

      return {
        scratch: toRecord(scratch),
        sim: toSim(scratch, ctx.players),
        over: scratch.over,
        // Re-emit each player's private hand every tick so a play / hush / fresh deal re-sends the
        // updated secret, and a reconnecting device catches up to its current hand.
        private: toPrivate(scratch),
      };
    },

    // --- turn-based lifecycle callbacks: present for interface completeness, unused in live flow ---

    collectVote(ctx: RoundContext): ScratchResult {
      return { scratch: ctx.scratch as Record<string, unknown> };
    },

    reveal(ctx: RoundContext): RevealResult {
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
      // Never drive rounds for a live game; a host `advance` is a defensive end.
      return { done: true };
    },

    endGame(ctx: RoundContext): Standing[] {
      return standingsFor(ctx);
    },
  };
}

/** Parse a `move` string into a validated Nightleaf move, or null if malformed. */
function parseMove(move: string): NightleafMove | null {
  let raw: unknown;
  try {
    raw = JSON.parse(move);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === 'play' || kind === 'hush') return { kind };
  return null;
}

/**
 * Resolve a "play my lowest leaf" move. The move carries no leaf value (the client cannot be trusted
 * with, and does not need, one): the engine plays the player's OWN lowest held leaf. A play with a
 * lower leaf still held ANYWHERE is a misplay - it costs a bud and flashes the misplay banner - but
 * the leaf is still placed (it leaves the hand either way, matching the real game). Purely cooperative,
 * so the standing is shared; nothing here scores a single player.
 */
function resolvePlay(ctx: RoundContext, scratch: NightleafScratch, player: string): ScratchResult {
  const hand = scratch.hands[player] ?? [];
  const leaf = hand[0];
  if (leaf === undefined) {
    return {
      scratch: ctx.scratch as Record<string, unknown>,
      rejected: { reason: 'you have no leaves left' },
    };
  }

  // Detect an out-of-order play: is a strictly lower leaf still held anywhere (including this player's
  // own hand, though their lowest is leaf[0], so it can only be another hand)? Compute BEFORE removing.
  const lowestEverywhere = globalLowest(scratch.hands);
  const misplay = lowestEverywhere < leaf;

  // Play the leaf: remove it from the hand and land it on the trunk. Any hush proposals are stale now.
  scratch.hands[player] = ascending(hand.slice(1));
  scratch.trunk = [...scratch.trunk, leaf];
  scratch.hushProposers = [];

  if (misplay) {
    scratch.buds -= 1;
    scratch.phase = 'misplay';
    scratch.phaseTicks = BANNER_TICKS;
    scratch.lastMisplay = { played: leaf, lowestHeld: lowestEverywhere };
    // The bud/loss/tier-clear resolution happens when the misplay banner elapses (in tick), so the
    // flash is always seen even when it also ends the game or clears the tier.
    return { scratch: toRecord(scratch) };
  }

  // A clean play. If it emptied the last hands, the tier is cleared - enter the cleared beat.
  if (leavesLeft(scratch.hands) === 0) {
    scratch.phase = 'tier-cleared';
    scratch.phaseTicks = BANNER_TICKS;
  }
  return { scratch: toRecord(scratch) };
}

/**
 * Resolve a hush proposal. A hush is a wordless, shared agreement: each holder proposes it, and once
 * EVERY player who still holds a leaf has proposed, the group spends one firefly and discards every
 * player's lowest leaf (no bud cost, no trunk change). Rejected when no firefly remains or the player
 * has already proposed. Discarding the lowest can clear the tier (emptying the last hands).
 */
function resolveHush(ctx: RoundContext, scratch: NightleafScratch, player: string): ScratchResult {
  if (scratch.fireflies <= 0) {
    return {
      scratch: ctx.scratch as Record<string, unknown>,
      rejected: { reason: 'no fireflies left' },
    };
  }
  if ((scratch.hands[player] ?? []).length === 0) {
    return {
      scratch: ctx.scratch as Record<string, unknown>,
      rejected: { reason: 'you have no leaves to hush' },
    };
  }
  if (scratch.hushProposers.includes(player)) {
    return {
      scratch: ctx.scratch as Record<string, unknown>,
      rejected: { reason: 'you already proposed a hush' },
    };
  }

  scratch.hushProposers = [...scratch.hushProposers, player];

  // A hush fires once every player who still holds a leaf has proposed it.
  const holders = scratch.order.filter((id) => (scratch.hands[id] ?? []).length > 0);
  const allProposed = holders.every((id) => scratch.hushProposers.includes(id));
  if (!allProposed) return { scratch: toRecord(scratch) };

  // Fire: spend a firefly, discard each holder's lowest leaf.
  scratch.fireflies -= 1;
  scratch.hushProposers = [];
  for (const id of holders) {
    scratch.hands[id] = ascending((scratch.hands[id] ?? []).slice(1));
  }
  if (leavesLeft(scratch.hands) === 0) {
    scratch.phase = 'tier-cleared';
    scratch.phaseTicks = BANNER_TICKS;
  }
  return { scratch: toRecord(scratch) };
}

/**
 * Cooperative standings: everyone shares one outcome. The whole group wins or loses together, so every
 * player gets the same score (1 for a win, 0 otherwise) and `rankStandings` ties them all at rank 1.
 */
function standingsFor(ctx: RoundContext): Standing[] {
  const scratch = asScratch(ctx.scratch);
  const win = scratch.over && scratch.won ? 1 : 0;
  const scores: Record<string, number> = {};
  for (const p of ctx.players) scores[p.player] = win;
  return rankStandings(ctx.players, scores);
}

/**
 * Nightleaf as a plugin the engine registers. `create` builds the module with the injected rng
 * (consumed once to seed the deal). `validateConfig` is the manifest's config schema, run at the
 * start-handoff boundary. Marked `insider` so the game stays off the public catalog.
 */
export const nightleafPlugin: GamePlugin<ResolvedNightleafConfig, NightleafSim, unknown> = {
  manifest: {
    id: NIGHTLEAF_GAME_ID,
    name: 'Nightleaf',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 2, maxPlayers: 6 },
    visibility: 'insider',
  },
  create: (services: GameServices) => createNightleafGame(services.rng),
};
