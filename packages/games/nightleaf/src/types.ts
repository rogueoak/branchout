// The wire shapes Nightleaf streams. Two payloads leave the engine:
//   - `NightleafSim`  - the SHARED, broadcast snapshot (the trunk, buds, tier, per-player leaf COUNTS,
//                       whose hush is pending). It carries NO leaf values from any hand, so it is safe
//                       to broadcast to every device.
//   - `NightleafHand` - a SECRET, per-player payload delivered ONLY to that player (spec 0052's
//                       `private` frame): the exact leaves this player still holds, ascending. It is
//                       NEVER placed in the broadcast sim.
//
// The web decoder in apps/web/lib/games/nightleaf/protocol.ts mirrors these exactly; a drift breaks
// rendering, so they stay in lockstep with that boundary.

/**
 * A player's public standing in the sim: their id, display name, and how many leaves they still hold.
 * The COUNT is public (everyone can see who still has leaves); the leaf VALUES are private and travel
 * only in that player's {@link NightleafHand}.
 */
export interface HandSummary {
  player: string;
  nickname: string;
  /** How many leaves this player still holds this tier. */
  count: number;
}

/** The banner beat the client paints over the shared board. `playing` is normal silent play. */
export type NightleafPhase = 'playing' | 'tier-cleared' | 'misplay' | 'won' | 'lost';

/**
 * The SHARED, broadcast snapshot of the grove, streamed each tick as the `sim` frame. Every device
 * renders the trunk, the buds, the tier, and each hand's COUNT from this - but never a leaf value from
 * another player's hand (those ride the private frame). The client REPLACES its state from the newest
 * snapshot.
 */
export interface NightleafSim {
  /** The current tier (1-based). Tier N deals N leaves to each player. */
  tier: number;
  /** The final tier: clearing it wins the game. */
  finalTier: number;
  /** Buds (lives) remaining. A misplay costs one; zero ends the game as a loss. */
  buds: number;
  /** The buds the group started with (the full bud track, for the HUD). */
  maxBuds: number;
  /** Fireflies remaining (each spends one shared hush). */
  fireflies: number;
  /** The leaves already played onto the trunk this tier, in the ascending order they landed. */
  trunk: number[];
  /** The value on top of the trunk (the last leaf played), or 0 when the trunk is empty. */
  top: number;
  /** Every player's public hand summary (id, nickname, leaf COUNT) - never their leaf values. */
  hands: HandSummary[];
  /** Total leaves still held across all hands this tier (0 clears the tier). */
  leavesLeft: number;
  /** The players who have proposed the current hush (a wordless agreement); empty when none pending. */
  hushProposers: string[];
  /** True once the final tier is cleared (a win) or the buds hit zero (a loss). */
  over: boolean;
  /** True when the game ended in a win (final tier cleared). Only meaningful once `over`. */
  won: boolean;
  /** The banner beat (feedback surface): a cleared tier, a misplay flash, or the end result. */
  phase: NightleafPhase;
  /**
   * The leaf just misplayed and the lowest leaf still held when it happened, for the misplay banner.
   * Null outside the `misplay` beat. The lowest-held value is only revealed AFTER a misplay (it is no
   * longer secret - the group already paid for it), so this never leaks a live hand.
   */
  lastMisplay: { played: number; lowestHeld: number } | null;
}

/**
 * A player's SECRET hand, delivered only to that player via the private frame (spec 0052). It carries
 * the exact leaves the player still holds this tier, ascending, plus the lowest (the only leaf they
 * may legally play). NEVER broadcast; the engine targets it to this player's device(s) alone.
 */
export interface NightleafHand {
  /** The leaves this player still holds this tier, ascending. */
  leaves: number[];
  /** The lowest leaf held (== leaves[0]), or 0 when the hand is empty. The only playable leaf. */
  lowest: number;
}

/** The move a client submits, as the `move` string: `JSON.stringify(NightleafMove)`. */
export type NightleafMove = { kind: 'play' } | { kind: 'hush' };
