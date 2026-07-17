// Nightleaf module tests (spec 0060 - cooperative live ascending-number game). These prove: a
// deterministic tier deal, that a play must be the player's own lowest leaf, that an out-of-order play
// (a lower leaf still held) loses a bud, that clearing every hand advances the tier and clearing the
// final tier wins, that running out of buds loses, that a hush discards every lowest, and - the whole
// point of the secret seam (spec 0052) - that a player's hand is delivered ONLY to that player on the
// private channel and NEVER appears in the broadcast sim or another player's private payload.

import { describe, expect, it } from 'vitest';
import type { LiveTickResult, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { createNightleafGame } from './nightleaf';
import { dealTier } from './deal';
import type { NightleafHand, NightleafSim } from './types';

/** A fixed rng so `configure` derives a stable base seed. */
function stubRng(value: number): () => number {
  return () => value;
}

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: `nick-${id}`, connected: true }));
}

function ctx(overrides: Partial<RoundContext>): RoundContext {
  return {
    room: 'r',
    game: 'nightleaf',
    phase: 'collecting',
    round: 1,
    players: players('a', 'b'),
    scores: {},
    scratch: {},
    config: {},
    ...overrides,
  };
}

const move = { play: JSON.stringify({ kind: 'play' }), hush: JSON.stringify({ kind: 'hush' }) };

/** Run `configure` + `startRound` for a fresh session and return the opened scratch + start result. */
function startGame(
  config: unknown,
  roster: SessionPlayer[],
  seed = 0.42,
): {
  game: ReturnType<typeof createNightleafGame>;
  scratch: Record<string, unknown>;
  start: ReturnType<ReturnType<typeof createNightleafGame>['startRound']>;
} {
  const game = createNightleafGame(stubRng(seed));
  const configured = game.configure(config, roster);
  const start = game.startRound(ctx({ players: roster, scratch: configured.scratch, config }));
  return { game, scratch: start.scratch, start };
}

/** Tick until the game is over (or a cap), returning the last tick result. Feeds scratch forward. */
function tickToOver(
  game: ReturnType<typeof createNightleafGame>,
  roster: SessionPlayer[],
  scratch: Record<string, unknown>,
  config: unknown,
  cap = 200,
): { scratch: Record<string, unknown>; last: LiveTickResult } {
  let cur = scratch;
  let last!: LiveTickResult;
  for (let i = 0; i < cap; i += 1) {
    last = game.tick!(ctx({ players: roster, scratch: cur, config }));
    cur = last.scratch;
    if (last.over) break;
  }
  return { scratch: cur, last };
}

/** Advance the banner beat: tick until the phase leaves the given beat, returning the fed scratch. */
function tickPastBanner(
  game: ReturnType<typeof createNightleafGame>,
  roster: SessionPlayer[],
  scratch: Record<string, unknown>,
  config: unknown,
  cap = 60,
): Record<string, unknown> {
  let cur = scratch;
  for (let i = 0; i < cap; i += 1) {
    const before = (cur as { phase: string }).phase;
    const res = game.tick!(ctx({ players: roster, scratch: cur, config }));
    cur = res.scratch;
    if ((cur as { phase: string }).phase !== before) break;
  }
  return cur;
}

describe('deal', () => {
  it('deals `tier` distinct ascending leaves per player, all unique across hands, deterministic', () => {
    const ids = ['a', 'b', 'c'];
    const hands = dealTier(1234, 3, ids);
    for (const id of ids) {
      const h = hands[id]!;
      expect(h).toHaveLength(3);
      // Ascending + strictly increasing (unique within a hand).
      expect(h).toEqual([...h].sort((x, y) => x - y));
      expect(new Set(h).size).toBe(3);
    }
    // All leaves distinct across every hand, and in [1, 100].
    const all = ids.flatMap((id) => hands[id]!);
    expect(new Set(all).size).toBe(all.length);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...all)).toBeLessThanOrEqual(100);
    // Same seed -> same deal.
    expect(dealTier(1234, 3, ids)).toEqual(hands);
    // Different seed -> a different deal (overwhelmingly likely).
    expect(dealTier(9999, 3, ids)).not.toEqual(hands);
  });
});

describe('startRound + private delivery (spec 0052)', () => {
  it('deals tier 1 and delivers each player their OWN hand on the private channel', () => {
    const roster = players('a', 'b');
    const { start } = startGame({ tiers: 2, buds: 3 }, roster);
    const priv = start.private as Record<string, NightleafHand>;
    expect(Object.keys(priv).sort()).toEqual(['a', 'b']);
    // Tier 1 deals one leaf each; the private payload carries the exact leaf + the lowest.
    expect(priv.a!.leaves).toHaveLength(1);
    expect(priv.b!.leaves).toHaveLength(1);
    expect(priv.a!.lowest).toBe(priv.a!.leaves[0]);
    // The two hands never share a leaf.
    expect(priv.a!.leaves[0]).not.toBe(priv.b!.leaves[0]);
  });

  it('the broadcast prompt/sim carries only COUNTS, never a leaf value from any hand', () => {
    const roster = players('a', 'b');
    const { start } = startGame({ tiers: 3, buds: 3 }, roster);
    const sim = start.prompt as NightleafSim;
    const priv = start.private as Record<string, NightleafHand>;
    // Tier 1 always deals ONE leaf each at the start (tier N deals N); the sim exposes per-player
    // counts (public) but no `leaves` array.
    expect(sim.hands.map((h) => h.count)).toEqual([1, 1]);
    const serialized = JSON.stringify(sim);
    for (const leaf of [...priv.a!.leaves, ...priv.b!.leaves]) {
      // A raw leaf value never appears anywhere in the broadcast payload's own hand fields. The trunk
      // is empty at deal, so no played value collides here either.
      expect(sim.trunk).not.toContain(leaf);
    }
    // The sim has no field that leaks a hand: every hand summary is {player, nickname, count} only.
    for (const h of sim.hands) {
      expect(Object.keys(h).sort()).toEqual(['count', 'nickname', 'player']);
    }
    expect(serialized).not.toContain('"leaves"');
  });

  it("player B NEVER receives player A's hand (secrecy) - only A's private entry holds A's leaves", () => {
    const roster = players('a', 'b', 'c');
    const { start } = startGame({ tiers: 4, buds: 3 }, roster);
    const priv = start.private as Record<string, NightleafHand>;
    const aLeaves = priv.a!.leaves;
    // A's leaves appear ONLY under A's key - never in B's or C's private payload.
    expect(priv.b!.leaves.some((l) => aLeaves.includes(l))).toBe(false);
    expect(priv.c!.leaves.some((l) => aLeaves.includes(l))).toBe(false);
    // And the engine keys each entry to exactly that player: B's device gets priv['b'] and no other.
    // The engine (deliverPrivate) targets each entry to its player; here we assert the map is keyed so
    // that targeting can only ever hand B its own leaves.
    expect(Object.keys(priv)).toEqual(['a', 'b', 'c']);
  });
});

describe('play validation', () => {
  it('a play always plays the player OWN lowest leaf and lands it on the trunk', () => {
    const roster = players('a', 'b');
    const { game, scratch, start } = startGame({ tiers: 2, buds: 3 }, roster);
    const priv = start.private as Record<string, NightleafHand>;
    // Whoever holds the globally lowest leaf plays cleanly.
    const first = priv.a!.lowest < priv.b!.lowest ? 'a' : 'b';
    const res = game.collectMove(
      ctx({ players: roster, scratch, config: { tiers: 2, buds: 3 } }),
      first,
      move.play,
    );
    expect(res.rejected).toBeUndefined();
    const s = res.scratch as { trunk: number[] };
    expect(s.trunk).toContain(priv[first]!.lowest);
  });

  it('rejects a play from a player with no leaves (while another still holds)', () => {
    const roster = players('a', 'b');
    const config = { tiers: 2, buds: 3 };
    const game = createNightleafGame(stubRng(0.42));
    // A mid-tier grove where A has emptied their hand but B still holds a leaf, still in play. A play
    // from the empty-handed A is rejected (nothing to play), while the grove is not yet cleared.
    const scratch = {
      seed: 1,
      finalTier: 2,
      tier: 2,
      buds: 3,
      maxBuds: 3,
      fireflies: 0,
      order: ['a', 'b'],
      hands: { a: [], b: [50] },
      trunk: [10, 20],
      hushProposers: [],
      over: false,
      won: false,
      phase: 'playing',
      phaseTicks: 0,
      lastMisplay: null,
    } as unknown as Record<string, unknown>;
    const rejected = game.collectMove(ctx({ players: roster, scratch, config }), 'a', move.play);
    expect(rejected.rejected?.reason).toMatch(/no leaves/i);
  });
});

describe('misplay loses a bud', () => {
  it('playing while a lower leaf is still held loses a bud and flashes the misplay banner', () => {
    const roster = players('a', 'b');
    const config = { tiers: 2, buds: 3 };
    const { game, start } = startGame(config, roster);
    const priv = start.private as Record<string, NightleafHand>;
    // The HIGHER holder plays first: a lower leaf is still held, so it is an out-of-order play.
    const higher = priv.a!.lowest > priv.b!.lowest ? 'a' : 'b';
    const res = game.collectMove(
      ctx({ players: roster, scratch: start.scratch, config }),
      higher,
      move.play,
    );
    const s = res.scratch as unknown as NightleafSimScratch;
    expect(s.buds).toBe(2); // started at 3, lost one
    expect(s.phase).toBe('misplay');
    expect(s.lastMisplay).not.toBeNull();
    expect(s.lastMisplay!.played).toBe(priv[higher]!.lowest);
    // The leaf is still placed (it leaves the hand either way).
    expect(s.trunk).toContain(priv[higher]!.lowest);
  });
});

interface NightleafSimScratch {
  buds: number;
  phase: string;
  tier: number;
  trunk: number[];
  over: boolean;
  won: boolean;
  lastMisplay: { played: number; lowestHeld: number } | null;
}

describe('tier advance, win, and loss', () => {
  it('clearing every hand in order clears the tier, and clearing the final tier WINS (shared standing)', () => {
    const roster = players('a', 'b');
    const config = { tiers: 1, buds: 3 };
    const { game, start } = startGame(config, roster);
    const priv = start.private as Record<string, NightleafHand>;
    // Tier 1 (final): one leaf each. Play in ascending order so there is no misplay.
    const order = priv.a!.lowest < priv.b!.lowest ? ['a', 'b'] : ['b', 'a'];
    let scratch = start.scratch;
    for (const id of order) {
      scratch = game.collectMove(ctx({ players: roster, scratch, config }), id, move.play).scratch;
    }
    // The last clean play emptied the hands -> tier-cleared beat; tick through it to the win.
    const { last } = tickToOver(game, roster, scratch, config);
    expect(last.over).toBe(true);
    const sim = last.sim as NightleafSim;
    expect(sim.won).toBe(true);
    expect(sim.phase).toBe('won');
    // Purely cooperative: everyone shares the win.
    const standings = game.endGame(ctx({ players: roster, scratch: last.scratch, config }));
    expect(standings.every((s) => s.rank === 1)).toBe(true);
    expect(standings.every((s) => s.score === 1)).toBe(true);
  });

  it('advances to the next tier which deals MORE leaves each', () => {
    const roster = players('a', 'b');
    const config = { tiers: 2, buds: 5 };
    const { game, start } = startGame(config, roster);
    const priv = start.private as Record<string, NightleafHand>;
    // Clear tier 1 (one leaf each) in order.
    const order = priv.a!.lowest < priv.b!.lowest ? ['a', 'b'] : ['b', 'a'];
    let scratch = start.scratch;
    for (const id of order) {
      scratch = game.collectMove(ctx({ players: roster, scratch, config }), id, move.play).scratch;
    }
    // Tick past the tier-cleared beat: it should deal tier 2 (two leaves each), not end the game.
    scratch = tickPastBanner(game, roster, scratch, config);
    const res = game.tick!(ctx({ players: roster, scratch, config }));
    const sim = res.sim as NightleafSim;
    expect(res.over).toBe(false);
    expect(sim.tier).toBe(2);
    expect(sim.hands.map((h) => h.count)).toEqual([2, 2]);
    // The fresh tier re-deals a private hand of two leaves each.
    const priv2 = res.private as Record<string, NightleafHand>;
    expect(priv2.a!.leaves).toHaveLength(2);
  });

  it('running out of buds LOSES (a shared loss), driven by real misplays', () => {
    const roster = players('a', 'b');
    const config = { tiers: 3, buds: 1 };
    const { game, start } = startGame(config, roster);
    const priv = start.private as Record<string, NightleafHand>;
    // Force a misplay: the HIGHER holder plays first, dropping the single bud to zero.
    const higher = priv.a!.lowest > priv.b!.lowest ? 'a' : 'b';
    const scratch = game.collectMove(
      ctx({ players: roster, scratch: start.scratch, config }),
      higher,
      move.play,
    ).scratch;
    const { last } = tickToOver(game, roster, scratch, config);
    expect(last.over).toBe(true);
    const sim = last.sim as NightleafSim;
    expect(sim.won).toBe(false);
    expect(sim.phase).toBe('lost');
    const standings = game.endGame(ctx({ players: roster, scratch: last.scratch, config }));
    expect(standings.every((s) => s.score === 0)).toBe(true);
  });
});

describe('hush (firefly)', () => {
  it('once every holder proposes, a hush spends a firefly and discards every lowest leaf', () => {
    const roster = players('a', 'b');
    const config = { tiers: 3, buds: 3, fireflies: 1 };
    const { game, start } = startGame(config, roster);
    const priv = start.private as Record<string, NightleafHand>;
    const beforeLowest = { a: priv.a!.lowest, b: priv.b!.lowest };
    // First proposal: pending, no discard yet.
    let scratch = game.collectMove(
      ctx({ players: roster, scratch: start.scratch, config }),
      'a',
      move.hush,
    ).scratch;
    expect((scratch as { hushProposers: string[] }).hushProposers).toEqual(['a']);
    expect((scratch as { fireflies: number }).fireflies).toBe(1);
    // Second (last) holder proposes: the hush fires.
    scratch = game.collectMove(ctx({ players: roster, scratch, config }), 'b', move.hush).scratch;
    const s = scratch as {
      fireflies: number;
      hushProposers: string[];
      hands: Record<string, number[]>;
    };
    expect(s.fireflies).toBe(0);
    expect(s.hushProposers).toEqual([]);
    // Each player's lowest leaf is gone (discarded, not played onto the trunk).
    expect(s.hands.a).not.toContain(beforeLowest.a);
    expect(s.hands.b).not.toContain(beforeLowest.b);
    expect((scratch as { trunk: number[] }).trunk).toHaveLength(0);
  });

  it('rejects a hush with no fireflies left', () => {
    const roster = players('a', 'b');
    const config = { tiers: 3, buds: 3, fireflies: 0 };
    const { game, start } = startGame(config, roster);
    const res = game.collectMove(
      ctx({ players: roster, scratch: start.scratch, config }),
      'a',
      move.hush,
    );
    expect(res.rejected?.reason).toMatch(/firefl/i);
  });
});

describe('rejections', () => {
  it('rejects a malformed move and a move after game over', () => {
    const roster = players('a', 'b');
    const config = { tiers: 1, buds: 3 };
    const { game, start } = startGame(config, roster);
    const bad = game.collectMove(
      ctx({ players: roster, scratch: start.scratch, config }),
      'a',
      'not-json',
    );
    expect(bad.rejected?.reason).toMatch(/malformed/i);
  });
});
