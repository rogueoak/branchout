import { describe, expect, it, vi } from 'vitest';
import type { RedisClientType } from 'redis';
import {
  COMPLETE_SESSION_TTL_SECONDS,
  InMemorySessionStore,
  RedisSessionStore,
  sessionKey,
  type SessionState,
} from './session';

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    room: 'r1',
    game: 'stub',
    runId: 1,
    phase: 'collecting',
    paused: false,
    hostPaused: false,
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
    pendingRounds: [],
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

describe('RedisSessionStore', () => {
  it('persists a live session with no TTL and expires a completed one', async () => {
    const set = vi.fn(async () => 'OK');
    const client = { set } as unknown as RedisClientType;
    const store = new RedisSessionStore(client);

    await store.save(makeState({ phase: 'collecting' }));
    expect(set).toHaveBeenLastCalledWith('session:r1:stub', expect.any(String), undefined);

    await store.save(makeState({ phase: 'complete' }));
    expect(set).toHaveBeenLastCalledWith('session:r1:stub', expect.any(String), {
      EX: COMPLETE_SESSION_TTL_SECONDS,
    });
  });
});
