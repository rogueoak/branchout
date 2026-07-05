import { describe, expect, it } from 'vitest';
import { InMemorySessionStore, sessionKey, type SessionState } from './session';

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    room: 'r1',
    game: 'stub',
    runId: 1,
    phase: 'collecting',
    paused: false,
    round: 1,
    rounds: 3,
    disputeWindowMs: 0,
    players: [{ player: 'p1', nickname: 'Ada', connected: true }],
    scores: { p1: 0 },
    roundScores: [],
    disputes: [],
    scratch: {},
    config: {},
    reportedRounds: [],
    completeReported: false,
    ...overrides,
  };
}

describe('sessionKey', () => {
  it('keys by room and game', () => {
    expect(sessionKey('r1', 'stub')).toBe('session:r1:stub');
  });
});

describe('InMemorySessionStore', () => {
  it('round-trips a session and returns null for a missing one', async () => {
    const store = new InMemorySessionStore();
    expect(await store.load('r1', 'stub')).toBeNull();
    await store.save(makeState({ round: 2 }));
    expect(await store.load('r1', 'stub')).toMatchObject({ round: 2 });
  });

  it('isolates the stored copy from the caller (mimics Redis serialization)', async () => {
    const store = new InMemorySessionStore();
    const state = makeState();
    await store.save(state);
    state.scores.p1 = 999; // mutate after save
    const loaded = await store.load('r1', 'stub');
    expect(loaded?.scores.p1).toBe(0);
  });

  it('deletes a session', async () => {
    const store = new InMemorySessionStore();
    await store.save(makeState());
    await store.delete('r1', 'stub');
    expect(await store.load('r1', 'stub')).toBeNull();
  });
});
