import { describe, expect, it } from 'vitest';
import { asWhispergroveSim, asWhispererSecret, seatOf } from './protocol';
import type { LeafRole } from './protocol';

function leaf(index: number, word: string, revealed = false, shown: LeafRole | null = null) {
  return { index, word, revealed, shown };
}

function sim(overrides: Record<string, unknown> = {}) {
  const leaves = Array.from({ length: 25 }, (_, i) => leaf(i, `W${i}`));
  return {
    leaves,
    turn: 'violet',
    phase: 'whispering',
    whisper: null,
    guessesLeft: 0,
    violetLeft: 9,
    amberLeft: 8,
    winner: null,
    endReason: null,
    seats: [
      { player: 'p0', team: 'violet', role: 'whisperer' },
      { player: 'p1', team: 'amber', role: 'whisperer' },
      { player: 'p2', team: 'violet', role: 'seeker' },
      { player: 'p3', team: 'amber', role: 'seeker' },
    ],
    ...overrides,
  };
}

describe('asWhispergroveSim', () => {
  it('decodes a valid sim', () => {
    const decoded = asWhispergroveSim(sim());
    expect(decoded).not.toBeNull();
    expect(decoded?.leaves).toHaveLength(25);
    expect(decoded?.turn).toBe('violet');
    expect(decoded?.seats).toHaveLength(4);
  });

  it('decodes a guessing sim with a whisper', () => {
    const decoded = asWhispergroveSim(
      sim({
        phase: 'guessing',
        whisper: { word: 'canopy', count: 2, team: 'violet' },
        guessesLeft: 3,
      }),
    );
    expect(decoded?.whisper?.word).toBe('canopy');
    expect(decoded?.guessesLeft).toBe(3);
  });

  it('decodes an over sim with a winner', () => {
    const decoded = asWhispergroveSim(
      sim({ phase: 'over', winner: 'amber', endReason: 'deadwood' }),
    );
    expect(decoded?.winner).toBe('amber');
    expect(decoded?.endReason).toBe('deadwood');
  });

  it('rejects a malformed sim (bad turn, missing seats)', () => {
    expect(asWhispergroveSim(sim({ turn: 'green' }))).toBeNull();
    expect(asWhispergroveSim(sim({ seats: 'nope' }))).toBeNull();
    expect(asWhispergroveSim(null)).toBeNull();
    expect(asWhispergroveSim('nope')).toBeNull();
  });

  it('never carries a secret key field - the broadcast sim has no key', () => {
    // A leaf revealed as violet shows its role, but there is no top-level `key` on the sim shape.
    const decoded = asWhispergroveSim(sim());
    expect(decoded && 'key' in decoded).toBe(false);
    expect(JSON.stringify(decoded)).not.toContain('"key"');
  });
});

describe('asWhispererSecret', () => {
  it('decodes a full 25-role key', () => {
    const key: LeafRole[] = Array.from({ length: 25 }, () => 'sapling');
    const decoded = asWhispererSecret({ key });
    expect(decoded?.key).toHaveLength(25);
  });

  it('rejects a malformed key', () => {
    expect(asWhispererSecret({ key: ['sapling', 'bogus'] })).toBeNull();
    expect(asWhispererSecret({})).toBeNull();
    expect(asWhispererSecret(null)).toBeNull();
  });
});

describe('seatOf', () => {
  it('resolves the local player seat, or undefined for a spectator', () => {
    const decoded = asWhispergroveSim(sim())!;
    expect(seatOf(decoded, 'p0')?.role).toBe('whisperer');
    expect(seatOf(decoded, 'p2')?.role).toBe('seeker');
    expect(seatOf(decoded, 'ghost')).toBeUndefined();
    expect(seatOf(decoded, undefined)).toBeUndefined();
  });
});
