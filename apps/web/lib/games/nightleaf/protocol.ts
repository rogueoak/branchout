// Nightleaf's wire decoders for the game-pluggable client (spec 0060, spec 0023). Nightleaf is a LIVE
// game: the engine streams a shared `NightleafSim` on the `sim` frame, and each player's SECRET hand
// on the `private` frame (spec 0052) - delivered only to that player. The web is a pure renderer that
// decodes those opaque `unknown` payloads here at the client boundary. A shape the renderer does not
// understand is a null (a skipped render), never a thrown one - the same "opaque payload, the game
// owns the shape" contract the engine uses. These types mirror packages/games/nightleaf/src/types.ts
// exactly; a drift breaks rendering, so they stay in lockstep with that authoritative wire contract.

/** A player's public standing in the sim: id, display name, and how many leaves they still hold. */
export interface HandSummary {
  player: string;
  nickname: string;
  count: number;
}

/** The banner beat painted over the shared board. `playing` is normal silent play. */
export type NightleafPhase = 'playing' | 'tier-cleared' | 'misplay' | 'won' | 'lost';

/** The SHARED, broadcast snapshot of the grove. Carries NO leaf value from any hand - only counts. */
export interface NightleafSim {
  tier: number;
  finalTier: number;
  buds: number;
  maxBuds: number;
  fireflies: number;
  trunk: number[];
  top: number;
  hands: HandSummary[];
  leavesLeft: number;
  hushProposers: string[];
  over: boolean;
  won: boolean;
  phase: NightleafPhase;
  lastMisplay: { played: number; lowestHeld: number } | null;
}

/** A player's SECRET hand, delivered only to that player via the private frame (spec 0052). */
export interface NightleafHand {
  leaves: number[];
  lowest: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Decode an array of finite numbers, or null if any element is not one. */
function asNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const item of value) {
    if (!isNum(item)) return null;
    out.push(item);
  }
  return out;
}

/** Decode an array of strings, or null if any element is not one. */
function asStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

/** Decode the per-player hand summaries (id, nickname, count); null if any is malformed. */
function asHands(value: unknown): HandSummary[] | null {
  if (!Array.isArray(value)) return null;
  const out: HandSummary[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.player !== 'string' ||
      typeof item.nickname !== 'string' ||
      !isNum(item.count)
    ) {
      return null;
    }
    out.push({ player: item.player, nickname: item.nickname, count: item.count });
  }
  return out;
}

/** Decode the banner phase; DEFAULTS to `playing` when absent or unknown, so a frame still renders. */
function asPhase(value: unknown): NightleafPhase {
  return value === 'tier-cleared' || value === 'misplay' || value === 'won' || value === 'lost'
    ? value
    : 'playing';
}

/** Decode the last-misplay detail `{ played, lowestHeld }`, or null. */
function asMisplay(value: unknown): { played: number; lowestHeld: number } | null {
  if (!isRecord(value)) return null;
  return isNum(value.played) && isNum(value.lowestHeld)
    ? { played: value.played, lowestHeld: value.lowestHeld }
    : null;
}

/** Decode a `sim` payload as a Nightleaf shared snapshot, or null if it is not one. */
export function asNightleafSim(value: unknown): NightleafSim | null {
  if (!isRecord(value)) return null;
  const trunk = asNumbers(value.trunk);
  const hands = asHands(value.hands);
  const hushProposers = asStrings(value.hushProposers);
  if (
    trunk &&
    hands &&
    hushProposers &&
    isNum(value.tier) &&
    isNum(value.finalTier) &&
    isNum(value.buds) &&
    isNum(value.maxBuds) &&
    isNum(value.fireflies) &&
    isNum(value.top) &&
    isNum(value.leavesLeft) &&
    typeof value.over === 'boolean' &&
    typeof value.won === 'boolean'
  ) {
    return {
      tier: value.tier,
      finalTier: value.finalTier,
      buds: value.buds,
      maxBuds: value.maxBuds,
      fireflies: value.fireflies,
      trunk,
      top: value.top,
      hands,
      leavesLeft: value.leavesLeft,
      hushProposers,
      over: value.over,
      won: value.won,
      phase: asPhase(value.phase),
      lastMisplay: value.lastMisplay == null ? null : asMisplay(value.lastMisplay),
    };
  }
  return null;
}

/** Decode a `private` payload as this player's own hand, or null if it is not one. */
export function asNightleafHand(value: unknown): NightleafHand | null {
  if (!isRecord(value)) return null;
  const leaves = asNumbers(value.leaves);
  if (leaves && isNum(value.lowest)) {
    return { leaves, lowest: value.lowest };
  }
  return null;
}

/** The move a client submits, as the `move` string. */
export type NightleafMove = { kind: 'play' } | { kind: 'hush' };

/** Serialize a Nightleaf move for the wire. */
export function encodeMove(move: NightleafMove): string {
  return JSON.stringify(move);
}
