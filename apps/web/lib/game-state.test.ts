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

  it('records a targeted answer_rejected reason, and a new prompt clears it', () => {
    let next = reduceGameState(initialGameState(), {
      type: 'answer_rejected',
      round: 1,
      reason: 'someone already submitted that',
    });
    expect(next.rejected).toBe('someone already submitted that');
    next = reduceGameState(next, prompt());
    expect(next.rejected).toBeNull();
  });

  it('clearRejected drops a stale rejection locally', () => {
    const seeded = reduceGameState(initialGameState(), {
      type: 'answer_rejected',
      round: 1,
      reason: 'nope',
    });
    expect(clearRejected(seeded).rejected).toBeNull();
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
