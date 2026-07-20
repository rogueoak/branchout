import type {
  LeaderboardMessage,
  PromptMessage,
  RevealMessage,
  StateMessage,
} from '@branchout/protocol';
import { describe, expect, it } from 'vitest';
import {
  clearRejected,
  initialGameState,
  isComplete,
  reduceGameState,
  starsForRank,
  withConnection,
} from './game-state';

const ROOM = 'room1';
const GAME = 'trivia';

function state(overrides: Partial<StateMessage> = {}): StateMessage {
  return {
    v: 1,
    type: 'state',
    room: ROOM,
    game: GAME,
    phase: 'collecting',
    paused: false,
    round: 1,
    players: [
      { player: 'p1', nickname: 'Ada', connected: true },
      { player: 'p2', nickname: 'Bo', connected: true },
    ],
    scores: { p1: 100, p2: 0 },
    disputes: [],
    ...overrides,
  };
}

function prompt(): PromptMessage {
  return {
    v: 1,
    type: 'prompt',
    room: ROOM,
    game: GAME,
    round: 2,
    phase: 'collecting',
    prompt: { round: 2, category: 'Science', difficulty: 5, question: 'What is H2O?' },
  };
}

describe('reduceGameState', () => {
  it('folds a state frame into phase, round, players, scores, and disputers', () => {
    const next = reduceGameState(
      initialGameState(),
      state({ phase: 'voting', round: 3, disputes: ['p2'] }),
    );
    expect(next.joined).toBe(true);
    expect(next.phase).toBe('voting');
    expect(next.round).toBe(3);
    expect(next.players).toHaveLength(2);
    expect(next.scores).toEqual({ p1: 100, p2: 0 });
    expect(next.disputes).toEqual(['p2']);
  });

  it('folds the new guessing phase (spec 0020) like any other phase', () => {
    const next = reduceGameState(initialGameState(), state({ phase: 'guessing' }));
    expect(next.phase).toBe('guessing');
  });

  it('folds the spec 0069 pacing fields (window total, auto-advance, dwell, answered)', () => {
    const next = reduceGameState(
      initialGameState(),
      state({
        phase: 'collecting',
        moveMsRemaining: 42_000,
        moveWindowMs: 60_000,
        autoAdvance: true,
        autoAdvanceMsRemaining: 5_000,
        answered: 1,
      }),
    );
    expect(next.moveWindowMs).toBe(60_000);
    expect(next.autoAdvance).toBe(true);
    expect(next.autoAdvanceMsRemaining).toBe(5_000);
    expect(next.answered).toBe(1);
  });

  it('defaults the spec 0069 pacing fields to null when a peer omits them (backward compatible)', () => {
    const next = reduceGameState(initialGameState(), state({ phase: 'collecting' }));
    expect(next.moveWindowMs).toBeNull();
    expect(next.autoAdvance).toBeNull();
    expect(next.autoAdvanceMsRemaining).toBeNull();
    expect(next.answered).toBeNull();
  });

  it('folds the live flag (a turn/continuous game marks itself live - WS13)', () => {
    const next = reduceGameState(initialGameState(), state({ live: true }));
    expect(next.live).toBe(true);
  });

  it('defaults live to false when a peer omits it (a round game keeps its host controls in reach)', () => {
    const next = reduceGameState(initialGameState(), state({ phase: 'collecting' }));
    expect(next.live).toBe(false);
  });

  it('defaults disputers to empty when a peer omits the field (backward compatible)', () => {
    const legacy = state();
    delete (legacy as { disputes?: string[] }).disputes;
    const next = reduceGameState(initialGameState(), legacy);
    expect(next.disputes).toEqual([]);
  });

  it('stores the opaque prompt raw and clears the prior round results and rejection', () => {
    const withRound = {
      ...initialGameState(),
      reveals: [{ round: 1, question: 'a', answers: ['a'], correct: ['p1'], wrong: [] }],
      standings: [{ player: 'p1', nickname: 'Ada', score: 100, rank: 1 }],
      rejected: 'someone already submitted that',
    };
    const next = reduceGameState(withRound, prompt());
    // The reducer stores the payload opaque; the game module decodes it at render time.
    expect(next.prompt).toEqual({
      round: 2,
      category: 'Science',
      difficulty: 5,
      question: 'What is H2O?',
    });
    expect(next.reveals).toEqual([]);
    expect(next.standings).toEqual([]);
    expect(next.rejected).toBeNull();
  });

  it('appends each reveal payload to the reveals list (a round can stream several)', () => {
    const roundReveal: RevealMessage = {
      v: 1,
      type: 'reveal',
      room: ROOM,
      game: GAME,
      round: 1,
      reveal: {
        round: 1,
        question: 'Water',
        answers: ['Water', 'H2O'],
        correct: ['p1'],
        wrong: ['p2'],
      },
    };
    const disputeReveal: RevealMessage = {
      v: 1,
      type: 'reveal',
      room: ROOM,
      game: GAME,
      round: 1,
      reveal: { round: 1, upheld: ['p2'] },
    };
    let next = reduceGameState(initialGameState(), roundReveal);
    next = reduceGameState(next, disputeReveal);
    expect(next.reveals).toEqual([roundReveal.reveal, disputeReveal.reveal]);
  });

  it('records a targeted move_rejected reason, and a new prompt clears it', () => {
    let next = reduceGameState(initialGameState(), {
      type: 'move_rejected',
      round: 1,
      reason: 'someone already submitted that',
    });
    expect(next.rejected).toBe('someone already submitted that');
    next = reduceGameState(next, prompt());
    expect(next.rejected).toBeNull();
  });

  it('clearRejected drops a stale rejection locally', () => {
    const seeded = reduceGameState(initialGameState(), {
      type: 'move_rejected',
      round: 1,
      reason: 'nope',
    });
    expect(clearRejected(seeded).rejected).toBeNull();
  });

  it('replaces (never accumulates) the sim state across two frames (spec 0044)', () => {
    // A live game streams a fresh full snapshot each tick; the reducer must REPLACE `sim`, not merge
    // or append, so the client always renders the newest live tower and never a stale accumulation.
    const first = reduceGameState(initialGameState(), {
      v: 1,
      type: 'sim',
      room: ROOM,
      game: GAME,
      sim: { bodies: [{ id: 1 }], height: 10 },
    });
    expect(first.sim).toEqual({ bodies: [{ id: 1 }], height: 10 });

    const second = reduceGameState(first, {
      v: 1,
      type: 'sim',
      room: ROOM,
      game: GAME,
      sim: { bodies: [{ id: 2 }], height: 20 },
    });
    // The second frame wholly replaces the first - no merged bodies, no accumulated height.
    expect(second.sim).toEqual({ bodies: [{ id: 2 }], height: 20 });
  });

  it('stores the local private payload, clears it on a new round, and a reconnect frame restores it (spec 0052)', () => {
    // The engine already targeted this frame to this device, so the reducer just stores its payload.
    let next = reduceGameState(initialGameState('p1'), {
      v: 1,
      type: 'private',
      room: ROOM,
      game: GAME,
      round: 1,
      player: 'p1',
      private: { key: ['red', 'blue'] },
    });
    expect(next.private).toEqual({ key: ['red', 'blue'] });

    // A new round (prompt) supersedes the secret: it must clear so nothing bleeds into the question.
    next = reduceGameState(next, prompt());
    expect(next.private).toBeNull();

    // A reconnect replays the catch-up private frame, re-hydrating the local secret.
    const restored = reduceGameState(next, {
      v: 1,
      type: 'private',
      room: ROOM,
      game: GAME,
      round: 2,
      player: 'p1',
      private: { key: ['green'] },
    });
    expect(restored.private).toEqual({ key: ['green'] });
  });

  it('ignores a private frame addressed to another player (defense-in-depth, spec 0052)', () => {
    // Delivery is targeted server-side, but if a mis-targeted or replayed frame ever names a DIFFERENT
    // recipient than the local player, the reducer must drop it so another player's secret never paints
    // into this device's UI. The local player id is seeded via initialGameState.
    const start = initialGameState('p1');
    const next = reduceGameState(start, {
      v: 1,
      type: 'private',
      room: ROOM,
      game: GAME,
      round: 1,
      player: 'p2', // NOT us
      private: { key: ['victims-secret'] },
    });
    expect(next.private).toBeNull();
    // Same object back (no-op) - nothing about the state changed.
    expect(next).toBe(start);
  });

  it('falls back to trusting server targeting when the local player is unknown (spec 0052)', () => {
    // A reducer constructed without a local id (e.g. some unit paths) still stores a targeted frame -
    // the extra check only hardens the common case, it never blocks the server-side guarantee.
    const next = reduceGameState(initialGameState(), {
      v: 1,
      type: 'private',
      room: ROOM,
      game: GAME,
      round: 1,
      player: 'p2',
      private: { key: ['ok'] },
    });
    expect(next.private).toEqual({ key: ['ok'] });
  });

  it('folds the leaderboard standings', () => {
    const leaderboard: LeaderboardMessage = {
      v: 1,
      type: 'leaderboard',
      room: ROOM,
      game: GAME,
      standings: [
        { player: 'p1', nickname: 'Ada', score: 100, rank: 1 },
        { player: 'p2', nickname: 'Bo', score: 50, rank: 2 },
      ],
    };
    const next = reduceGameState(initialGameState(), leaderboard);
    expect(next.standings).toHaveLength(2);
    expect(next.standings[0]!.rank).toBe(1);
  });

  it('captures an error frame without disturbing the game state', () => {
    const seeded = reduceGameState(initialGameState(), state());
    const next = reduceGameState(seeded, { type: 'error', message: 'join a session first' });
    expect(next.error).toBe('join a session first');
    expect(next.phase).toBe(seeded.phase);
  });

  it('never mutates the input state', () => {
    const before = initialGameState();
    const snapshot = JSON.stringify(before);
    reduceGameState(before, state());
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('drives a full round: prompt -> reveal -> leaderboard -> complete', () => {
    let s = initialGameState();
    s = reduceGameState(s, prompt());
    expect(s.phase).toBe('collecting');
    expect((s.prompt as { question?: string }).question).toBe('What is H2O?');

    s = reduceGameState(s, {
      v: 1,
      type: 'reveal',
      room: ROOM,
      game: GAME,
      round: 2,
      reveal: { round: 2, question: 'Water', answers: ['Water'], correct: ['p1'], wrong: ['p2'] },
    });
    s = reduceGameState(s, state({ phase: 'disputing', round: 2 }));
    expect(s.phase).toBe('disputing');
    expect(s.reveals).toHaveLength(1);

    s = reduceGameState(s, state({ phase: 'complete', round: 2 }));
    expect(isComplete(s)).toBe(true);
  });
});

describe('withConnection', () => {
  it('sets only the connection status', () => {
    const next = withConnection(initialGameState(), 'reconnecting');
    expect(next.connection).toBe('reconnecting');
  });
});

describe('starsForRank', () => {
  it('awards 3/2/1 for the podium and none below', () => {
    expect([1, 2, 3, 4].map(starsForRank)).toEqual([3, 2, 1, 0]);
  });
});
