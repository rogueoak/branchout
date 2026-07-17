import { describe, expect, it } from 'vitest';
import {
  asOddBirdCard,
  asOddBirdFlush,
  asOddBirdPrompt,
  asOddBirdResult,
  pickFlush,
  pickResult,
} from './protocol';
import { ROOST_GUESS_TARGET_PREFIX } from './index';

describe('Odd Bird roost-guess prefix', () => {
  it("pins the web roost-guess prefix to 'roost:' (must match the engine's ROOST_GUESS_PREFIX)", () => {
    // The web bundle cannot import the headless @branchout/game-odd-bird package, so it mirrors the
    // prefix here. Pin it to the same literal the engine pins, so a drift on either side fails a test
    // instead of silently parsing every roost guess as an accusation.
    expect(ROOST_GUESS_TARGET_PREFIX).toBe('roost:');
  });
});

describe('Odd Bird protocol decoders', () => {
  it('decodes the public prompt (no secret)', () => {
    expect(asOddBirdPrompt({ round: 1, players: 4, category: 'everyday' })).toEqual({
      round: 1,
      players: 4,
      category: 'everyday',
    });
    expect(asOddBirdPrompt({ round: 1 })).toBeNull();
    expect(asOddBirdPrompt(null)).toBeNull();
  });

  it('decodes the private card for each role', () => {
    expect(asOddBirdCard({ role: 'odd-bird' })).toEqual({ role: 'odd-bird' });
    expect(asOddBirdCard({ role: 'flock', roost: 'A beach', perch: 'Lifeguard' })).toEqual({
      role: 'flock',
      roost: 'A beach',
      perch: 'Lifeguard',
    });
    // A malformed flock card (missing perch) does not decode.
    expect(asOddBirdCard({ role: 'flock', roost: 'A beach' })).toBeNull();
    expect(asOddBirdCard(null)).toBeNull();
  });

  it('decodes the flush (accusable players + roost slate), rejecting the final result', () => {
    const flush = {
      round: 1,
      players: ['p1', 'p2', 'p3'],
      roostOptions: [
        { id: 'everyday-001', name: 'A coffee shop' },
        { id: 'everyday-002', name: 'A library' },
      ],
    };
    expect(asOddBirdFlush(flush)).toEqual(flush);
    // The final result carries `roost`, which must NOT decode as a flush.
    expect(asOddBirdFlush({ ...flush, roost: 'A library' })).toBeNull();
  });

  it('decodes the final result', () => {
    const result = {
      round: 1,
      roost: 'A library',
      oddBird: 'p2',
      flushed: 'p2',
      guessedRoost: false,
      guessedName: null,
      flockWon: true,
      accusations: { p1: 'p2', p3: 'p2' },
    };
    expect(asOddBirdResult(result)).toEqual(result);
    expect(asOddBirdResult({ ...result, flockWon: 'yes' })).toBeNull();
  });

  it('picks the flush and result out of a mixed reveals list', () => {
    const flush = { round: 1, players: ['p1'], roostOptions: [] };
    const result = {
      round: 1,
      roost: 'A gym',
      oddBird: 'p1',
      flushed: null,
      guessedRoost: false,
      guessedName: null,
      flockWon: false,
      accusations: {},
    };
    expect(pickFlush([flush, result])).toEqual(flush);
    expect(pickResult([flush, result])).toEqual(result);
    expect(pickResult([flush])).toBeNull();
  });
});
