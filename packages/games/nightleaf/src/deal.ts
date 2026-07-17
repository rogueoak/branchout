// The deterministic leaf deal. Dealing a tier draws `tier * playerCount` DISTINCT leaves from
// [1, MAX_LEAF] and hands each player `tier` of them, sorted ascending. It is a pure function of
// (seed, tier, players): the same inputs deal the exact same hands on any machine, so the server is
// authoritative and a reconnect rebuilds the identical grove from scratch. No content bank - the
// numbers ARE the content.

import { MAX_LEAF } from './config';
import { createRng, deriveSeed } from './rng';

/** Ascending-sorted numeric copy of an array (leaves are always presented low-to-high). */
export function ascending(leaves: readonly number[]): number[] {
  return [...leaves].sort((a, b) => a - b);
}

/**
 * Draw `count` distinct integers from [1, MAX_LEAF] using a partial Fisher-Yates over the seeded rng,
 * so the draw is uniform and never repeats a leaf. Throws if the deck cannot supply `count` distinct
 * leaves (guarded by the caller's player/tier bounds, but fail loud rather than loop forever).
 */
export function drawDistinct(seed: number, count: number): number[] {
  if (count > MAX_LEAF) {
    throw new Error(`cannot draw ${count} distinct leaves from a deck of ${MAX_LEAF}`);
  }
  const rng = createRng(seed);
  // Build the full deck [1..MAX_LEAF] and Fisher-Yates the first `count` slots.
  const deck: number[] = [];
  for (let i = 1; i <= MAX_LEAF; i += 1) deck.push(i);
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(rng.next() * (deck.length - i));
    const a = deck[i] as number;
    const b = deck[j] as number;
    deck[i] = b;
    deck[j] = a;
  }
  return deck.slice(0, count);
}

/**
 * Deal one tier: each of `playerIds` gets `tier` distinct leaves (ascending), all leaves across all
 * hands distinct. Returns a map playerId -> ascending hand. Deterministic from (baseSeed, tier).
 */
export function dealTier(
  baseSeed: number,
  tier: number,
  playerIds: readonly string[],
): Record<string, number[]> {
  const total = tier * playerIds.length;
  const drawn = drawDistinct(deriveSeed(baseSeed, tier), total);
  const hands: Record<string, number[]> = {};
  // Deal round-robin, then sort each hand ascending. Round-robin keeps the split even and the deal a
  // pure function of the draw order; the ascending sort is what the player ever sees.
  const buckets: number[][] = playerIds.map(() => []);
  for (let i = 0; i < drawn.length; i += 1) {
    (buckets[i % playerIds.length] as number[]).push(drawn[i] as number);
  }
  playerIds.forEach((id, idx) => {
    hands[id] = ascending(buckets[idx] as number[]);
  });
  return hands;
}
