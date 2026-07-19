import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_LIMITS, PLAYER_LIMITS, playerLimits } from './games';

describe('player limits (spec 0050)', () => {
  it('has the specified ranges for each shipped game', () => {
    expect(PLAYER_LIMITS.trivia).toEqual({ min: 1, max: 8 });
    expect(PLAYER_LIMITS['liar-liar']).toEqual({ min: 2, max: 8 });
    expect(PLAYER_LIMITS['teeter-tower']).toEqual({ min: 1, max: 4 });
    // Reversi is strictly two players (exactly 2 seats, no more, no fewer).
    expect(PLAYER_LIMITS.reversi).toEqual({ min: 2, max: 2 });
  });

  it('resolves a known game to its limits', () => {
    expect(playerLimits('liar-liar')).toEqual({ min: 2, max: 8 });
    expect(playerLimits('reversi')).toEqual({ min: 2, max: 2 });
  });

  it('falls back to the permissive default for an unknown game', () => {
    expect(playerLimits('nope')).toEqual(DEFAULT_PLAYER_LIMITS);
    expect(DEFAULT_PLAYER_LIMITS).toEqual({ min: 1, max: 8 });
  });
});
