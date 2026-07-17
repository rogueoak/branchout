// Whispergrove module tests (spec 0062). These prove the rules the game stands on: the key deals
// exactly 9/8/7/1, whispers validate (single token, not a board word, N in range, only the active
// Whisperer), taps resolve (own leaf keeps going, sapling/enemy ends the turn, the Deadwood loses
// instantly), turn + role enforcement, the secret key reaches ONLY the two Whisperers (never a
// seeker) over the private channel, and a team win maps to shared per-player standings.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@branchout/game-sdk/testing';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import {
  createWhispergroveGame,
  dealKey,
  pickWords,
  assignSeats,
  whispererOf,
  standingsFor,
  parseMove,
  GRID_SIZE,
  START_TEAM_LEAVES,
  OTHER_TEAM_LEAVES,
  SAPLING_LEAVES,
  DEADWOOD_LEAVES,
} from './whispergrove';
import type { LeafRole, Team, WhispergroveSim, WhispererSecret } from './types';

/** Four players: two per grove. Seat order => violet: v-whisperer(p0), v-seeker(p2); amber: a-whisperer(p1), a-seeker(p3). */
const PLAYERS: SessionPlayer[] = [
  { player: 'p0', nickname: 'P0', connected: true },
  { player: 'p1', nickname: 'P1', connected: true },
  { player: 'p2', nickname: 'P2', connected: true },
  { player: 'p3', nickname: 'P3', connected: true },
];

/** A 40-word letters-only bank so `pickWords` always has enough to fill the grove (no digits, so a
 * board word is itself a legal single token - lets the "whisper is a board word" test use one). */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BANK = Array.from(
  { length: 40 },
  (_, i) => `WORD${LETTERS[i % 26]}${LETTERS[Math.floor(i / 26)]}`,
);

function ctxFrom(scratch: Record<string, unknown>): RoundContext {
  return {
    room: 'r',
    game: 'whispergrove',
    phase: 'collecting',
    round: 1,
    players: PLAYERS,
    scores: {},
    scratch,
    config: {},
  };
}

/** Configure a fresh game and return the module + its initial scratch. */
function freshGame(seed = 1) {
  const game = createWhispergroveGame(mulberry32(seed), BANK);
  const { scratch } = game.configure({}, PLAYERS);
  return { game, scratch };
}

describe('dealKey', () => {
  it('deals exactly 9 / 8 / 7 / 1 roles over 25 leaves', () => {
    const key = dealKey(mulberry32(42), 'violet');
    expect(key).toHaveLength(GRID_SIZE);
    const count = (role: LeafRole) => key.filter((r) => r === role).length;
    expect(count('violet')).toBe(START_TEAM_LEAVES);
    expect(count('amber')).toBe(OTHER_TEAM_LEAVES);
    expect(count('sapling')).toBe(SAPLING_LEAVES);
    expect(count('deadwood')).toBe(DEADWOOD_LEAVES);
    expect(START_TEAM_LEAVES + OTHER_TEAM_LEAVES + SAPLING_LEAVES + DEADWOOD_LEAVES).toBe(
      GRID_SIZE,
    );
  });

  it('is deterministic under a fixed seed', () => {
    expect(dealKey(mulberry32(7), 'violet')).toEqual(dealKey(mulberry32(7), 'violet'));
  });
});

describe('pickWords', () => {
  it('picks 25 distinct words from the bank', () => {
    const words = pickWords(mulberry32(3), BANK);
    expect(words).toHaveLength(GRID_SIZE);
    expect(new Set(words).size).toBe(GRID_SIZE);
  });

  it('throws when the bank is too small', () => {
    expect(() => pickWords(mulberry32(1), ['A', 'B'])).toThrow(/at least/);
  });
});

describe('assignSeats', () => {
  it('splits by seat order into two groves, first of each is the Whisperer', () => {
    const seats = assignSeats(PLAYERS);
    expect(seats.find((s) => s.player === 'p0')).toEqual({
      player: 'p0',
      team: 'violet',
      role: 'whisperer',
    });
    expect(seats.find((s) => s.player === 'p2')).toEqual({
      player: 'p2',
      team: 'violet',
      role: 'seeker',
    });
    expect(seats.find((s) => s.player === 'p1')).toEqual({
      player: 'p1',
      team: 'amber',
      role: 'whisperer',
    });
    expect(seats.find((s) => s.player === 'p3')).toEqual({
      player: 'p3',
      team: 'amber',
      role: 'seeker',
    });
    expect(whispererOf(seats, 'violet')).toBe('p0');
    expect(whispererOf(seats, 'amber')).toBe('p1');
  });
});

describe('parseMove', () => {
  it('parses a whisper and a tap; rejects malformed', () => {
    expect(parseMove(JSON.stringify({ kind: 'whisper', word: 'tree', count: 2 }))).toEqual({
      kind: 'whisper',
      word: 'tree',
      count: 2,
    });
    expect(parseMove(JSON.stringify({ kind: 'tap', index: 5 }))).toEqual({ kind: 'tap', index: 5 });
    expect(parseMove('not json')).toBeNull();
    expect(parseMove(JSON.stringify({ kind: 'whisper', word: 'x', count: 1.5 }))).toBeNull();
    expect(parseMove(JSON.stringify({ kind: 'bogus' }))).toBeNull();
  });
});

/** Read a leaf index whose true role is `role` from a scratch's key. */
function indexOfRole(scratch: Record<string, unknown>, role: LeafRole): number {
  const key = (scratch as { key: LeafRole[] }).key;
  const i = key.findIndex((r) => r === role);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

/** An unrevealed leaf whose role is `role`, from live scratch. */
function unrevealedIndexOfRole(scratch: Record<string, unknown>, role: LeafRole): number {
  const key = (scratch as { key: LeafRole[] }).key;
  const revealed = (scratch as { revealed: boolean[] }).revealed;
  const i = key.findIndex((r, idx) => r === role && !revealed[idx]);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe('whisper validation', () => {
  it('accepts a single-token whisper with N in range and starts guessing with N+1 taps', () => {
    const { game, scratch } = freshGame();
    const res = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'canopy', count: 2 }),
    );
    expect(res.rejected).toBeUndefined();
    const s = res.scratch as { phase: string; guessesLeft: number; whisper: { count: number } };
    expect(s.phase).toBe('guessing');
    expect(s.guessesLeft).toBe(3);
    expect(s.whisper.count).toBe(2);
  });

  it('rejects a multi-word whisper', () => {
    const { game, scratch } = freshGame();
    const res = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'two words', count: 1 }),
    );
    expect(res.rejected?.reason).toMatch(/single word/);
  });

  it('rejects a whisper that is a word on the grove', () => {
    const { game, scratch } = freshGame();
    const boardWord = (scratch as { words: string[] }).words[0] as string;
    const res = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: boardWord.toLowerCase(), count: 1 }),
    );
    expect(res.rejected?.reason).toMatch(/cannot be a word on the grove/);
  });

  it('rejects N out of range', () => {
    const { game, scratch } = freshGame();
    const tooBig = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'grove', count: 99 }),
    );
    expect(tooBig.rejected?.reason).toMatch(/between 1 and/);
    const tooSmall = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'grove', count: 0 }),
    );
    expect(tooSmall.rejected?.reason).toMatch(/between 1 and/);
  });

  it('rejects a whisper from the wrong grove / a non-Whisperer', () => {
    const { game, scratch } = freshGame();
    // p1 is the amber Whisperer, but violet starts.
    const wrongTeam = game.collectMove(
      ctxFrom(scratch),
      'p1',
      JSON.stringify({ kind: 'whisper', word: 'grove', count: 1 }),
    );
    expect(wrongTeam.rejected?.reason).toMatch(/not your grove turn/);
    // p2 is a violet SEEKER, not the Whisperer.
    const seeker = game.collectMove(
      ctxFrom(scratch),
      'p2',
      JSON.stringify({ kind: 'whisper', word: 'grove', count: 1 }),
    );
    expect(seeker.rejected?.reason).toMatch(/only the Whisperer/);
  });
});

describe('tap outcomes', () => {
  /** Whisper as violet (p0), then return the guessing-phase scratch. */
  function afterWhisper(seed = 1, count = 3) {
    const { game, scratch } = freshGame(seed);
    const res = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'canopy', count }),
    );
    return { game, scratch: res.scratch as Record<string, unknown> };
  }

  it('an own-grove leaf keeps the turn going (still guessing, taps decremented)', () => {
    const { game, scratch } = afterWhisper();
    const own = unrevealedIndexOfRole(scratch, 'violet');
    const res = game.collectMove(
      ctxFrom(scratch),
      'p2',
      JSON.stringify({ kind: 'tap', index: own }),
    );
    const s = res.scratch as {
      phase: string;
      turn: Team;
      guessesLeft: number;
      revealed: boolean[];
    };
    expect(res.rejected).toBeUndefined();
    expect(s.revealed[own]).toBe(true);
    expect(s.phase).toBe('guessing');
    expect(s.turn).toBe('violet');
    expect(s.guessesLeft).toBe(3); // started at 4 (count 3 + 1), one tap spent
  });

  it('a sapling ends the turn and passes to the other grove', () => {
    const { game, scratch } = afterWhisper();
    const sapling = unrevealedIndexOfRole(scratch, 'sapling');
    const res = game.collectMove(
      ctxFrom(scratch),
      'p2',
      JSON.stringify({ kind: 'tap', index: sapling }),
    );
    const s = res.scratch as { phase: string; turn: Team };
    expect(s.turn).toBe('amber');
    expect(s.phase).toBe('whispering');
  });

  it('an enemy leaf ends the turn and passes', () => {
    const { game, scratch } = afterWhisper();
    const enemy = unrevealedIndexOfRole(scratch, 'amber');
    const res = game.collectMove(
      ctxFrom(scratch),
      'p2',
      JSON.stringify({ kind: 'tap', index: enemy }),
    );
    const s = res.scratch as { phase: string; turn: Team; revealed: boolean[] };
    expect(s.revealed[enemy]).toBe(true);
    expect(s.turn).toBe('amber');
    expect(s.phase).toBe('whispering');
  });

  it('the Deadwood loses instantly - the other grove wins', () => {
    const { game, scratch } = afterWhisper();
    const deadwood = indexOfRole(scratch, 'deadwood');
    const res = game.collectMove(
      ctxFrom(scratch),
      'p2',
      JSON.stringify({ kind: 'tap', index: deadwood }),
    );
    const s = res.scratch as { phase: string; winner: Team; endReason: string };
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('amber'); // violet tapped the Deadwood, so amber wins
    expect(s.endReason).toBe('deadwood');
  });

  it('running out of taps on an own leaf passes the turn', () => {
    // Whisper count 1 => 2 taps. Two own leaves in a row exhausts the budget and passes.
    const { game, scratch } = afterWhisper(1, 1);
    const own1 = unrevealedIndexOfRole(scratch, 'violet');
    const r1 = game.collectMove(
      ctxFrom(scratch),
      'p2',
      JSON.stringify({ kind: 'tap', index: own1 }),
    );
    const s1 = r1.scratch as Record<string, unknown>;
    const own2 = unrevealedIndexOfRole(s1, 'violet');
    const r2 = game.collectMove(ctxFrom(s1), 'p2', JSON.stringify({ kind: 'tap', index: own2 }));
    const s2 = r2.scratch as { turn: Team; phase: string; guessesLeft: number };
    expect(s2.guessesLeft).toBe(0);
    expect(s2.turn).toBe('amber');
    expect(s2.phase).toBe('whispering');
  });
});

describe('turn + role enforcement on taps', () => {
  it('rejects a tap before a whisper, a tap from the wrong grove, and a tap from the Whisperer', () => {
    const { game, scratch } = freshGame();
    // No whisper yet -> seeker cannot tap.
    const early = game.collectMove(
      ctxFrom(scratch),
      'p2',
      JSON.stringify({ kind: 'tap', index: 0 }),
    );
    expect(early.rejected?.reason).toMatch(/wait for your Whisperer/);

    // Whisper, then guessing.
    const w = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'canopy', count: 2 }),
    );
    const guessing = w.scratch as Record<string, unknown>;

    // Amber seeker taps on violet's turn.
    const wrong = game.collectMove(
      ctxFrom(guessing),
      'p3',
      JSON.stringify({ kind: 'tap', index: 0 }),
    );
    expect(wrong.rejected?.reason).toMatch(/not your grove turn/);

    // The violet Whisperer (who sees the key) may not tap.
    const whisp = game.collectMove(
      ctxFrom(guessing),
      'p0',
      JSON.stringify({ kind: 'tap', index: 0 }),
    );
    expect(whisp.rejected?.reason).toMatch(/Whisperer cannot tap/);
  });

  it('rejects a tap on an already-revealed leaf and an out-of-range index', () => {
    const { game, scratch } = freshGame();
    const w = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'canopy', count: 3 }),
    );
    const guessing = w.scratch as Record<string, unknown>;
    const own = unrevealedIndexOfRole(guessing, 'violet');
    const r1 = game.collectMove(
      ctxFrom(guessing),
      'p2',
      JSON.stringify({ kind: 'tap', index: own }),
    );
    const s1 = r1.scratch as Record<string, unknown>;
    const again = game.collectMove(ctxFrom(s1), 'p2', JSON.stringify({ kind: 'tap', index: own }));
    expect(again.rejected?.reason).toMatch(/already revealed/);
    const oob = game.collectMove(ctxFrom(s1), 'p2', JSON.stringify({ kind: 'tap', index: 99 }));
    expect(oob.rejected?.reason).toMatch(/not on the grove/);
  });
});

describe('secrecy: the key reaches ONLY the two Whisperers (spec 0052)', () => {
  it('startRound delivers the key to both Whisperers and to NO seeker', () => {
    const { game, scratch } = freshGame();
    const start = game.startRound(ctxFrom(scratch));
    const priv = start.private as Record<string, WhispererSecret> | undefined;
    expect(priv).toBeDefined();
    // Both Whisperers get the full key.
    expect(priv?.p0?.key).toHaveLength(GRID_SIZE);
    expect(priv?.p1?.key).toHaveLength(GRID_SIZE);
    // Neither seeker is even a key in the private map -> the engine never sends them the key.
    expect(priv && 'p2' in priv).toBe(false);
    expect(priv && 'p3' in priv).toBe(false);
  });

  it('the broadcast prompt/sim never contains the secret key of a hidden leaf', () => {
    const { game, scratch } = freshGame();
    const start = game.startRound(ctxFrom(scratch));
    const sim = start.prompt as WhispergroveSim;
    // Nothing is revealed yet, so every public leaf hides its role.
    for (const leaf of sim.leaves) {
      expect(leaf.revealed).toBe(false);
      expect(leaf.shown).toBeNull();
    }
    // Defense in depth: the serialized broadcast has no `key` field at all.
    expect(JSON.stringify(sim)).not.toContain('"key"');
  });

  it('tick re-emits the key to the Whisperers only (join catch-up), never to a seeker', () => {
    const { game, scratch } = freshGame();
    const t = (game.tick as (ctx: RoundContext) => { private?: unknown; sim: unknown })(
      ctxFrom(scratch),
    );
    const priv = t.private as Record<string, WhispererSecret> | undefined;
    expect(priv?.p0?.key).toHaveLength(GRID_SIZE);
    expect(priv?.p1?.key).toHaveLength(GRID_SIZE);
    expect(priv && 'p2' in priv).toBe(false);
    expect(priv && 'p3' in priv).toBe(false);
    // The broadcast sim carries no key.
    expect(JSON.stringify(t.sim)).not.toContain('"key"');
  });
});

describe('team result -> shared standings', () => {
  it('the whole winning grove shares the top rank; the losing grove shares the next', () => {
    const { game, scratch } = freshGame();
    const w = game.collectMove(
      ctxFrom(scratch),
      'p0',
      JSON.stringify({ kind: 'whisper', word: 'canopy', count: 3 }),
    );
    const guessing = w.scratch as Record<string, unknown>;
    const deadwood = indexOfRole(guessing, 'deadwood');
    const over = game.collectMove(
      ctxFrom(guessing),
      'p2',
      JSON.stringify({ kind: 'tap', index: deadwood }),
    );
    const finalCtx = ctxFrom(over.scratch as Record<string, unknown>);
    const standings = game.endGame(finalCtx);
    const rankOf = (p: string) => standings.find((s) => s.player === p)?.rank;
    // Violet tapped the Deadwood -> amber (p1, p3) wins and shares rank 1; violet (p0, p2) shares rank 3.
    expect(rankOf('p1')).toBe(1);
    expect(rankOf('p3')).toBe(1);
    expect(rankOf('p0')).toBe(3);
    expect(rankOf('p2')).toBe(3);
  });

  it('a full clear wins for the clearing grove', () => {
    const { game, scratch } = freshGame();
    // Drive violet to reveal all 9 of its leaves via repeated whisper+tap turns.
    let cur: Record<string, unknown> = scratch;
    for (let guard = 0; guard < 50; guard++) {
      const sim = (game.tick as (c: RoundContext) => { sim: WhispergroveSim }).call(
        game,
        ctxFrom(cur),
      ).sim;
      if (sim.phase === 'over') break;
      if (sim.phase === 'whispering' && sim.turn === 'violet') {
        const own = cur as { key: LeafRole[]; revealed: boolean[] };
        const left = own.key.filter((r, i) => r === 'violet' && !own.revealed[i]).length;
        const w = game.collectMove(
          ctxFrom(cur),
          'p0',
          JSON.stringify({ kind: 'whisper', word: 'canopy', count: Math.min(left, 9) }),
        );
        cur = w.scratch as Record<string, unknown>;
        continue;
      }
      if (sim.phase === 'guessing' && sim.turn === 'violet') {
        const own = cur as { key: LeafRole[]; revealed: boolean[] };
        const idx = own.key.findIndex((r, i) => r === 'violet' && !own.revealed[i]);
        if (idx < 0) break;
        const r = game.collectMove(ctxFrom(cur), 'p2', JSON.stringify({ kind: 'tap', index: idx }));
        cur = r.scratch as Record<string, unknown>;
        continue;
      }
      // Amber's turn: pass by whispering then tapping a sapling (or just skip via a losing tap).
      if (sim.turn === 'amber') {
        if (sim.phase === 'whispering') {
          const w = game.collectMove(
            ctxFrom(cur),
            'p1',
            JSON.stringify({ kind: 'whisper', word: 'canopy', count: 1 }),
          );
          cur = w.scratch as Record<string, unknown>;
        } else {
          const own = cur as { key: LeafRole[]; revealed: boolean[] };
          const sap = own.key.findIndex((r, i) => r === 'sapling' && !own.revealed[i]);
          const r = game.collectMove(
            ctxFrom(cur),
            'p3',
            JSON.stringify({ kind: 'tap', index: sap }),
          );
          cur = r.scratch as Record<string, unknown>;
        }
        continue;
      }
      break;
    }
    const s = cur as { phase: string; winner: Team; endReason: string };
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('violet');
    expect(s.endReason).toBe('cleared');
    const standings = standingsFor(ctxFrom(cur));
    expect(standings.find((x) => x.player === 'p0')?.rank).toBe(1);
    expect(standings.find((x) => x.player === 'p2')?.rank).toBe(1);
  });
});
