import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@branchout/game-sdk/testing';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { createZingerGame, CLEAN_SWEEP_BONUS, POINTS_PER_VOTE, ZINGER_GAME_ID } from './zinger';
import type { ZingerPrompt } from './prompts';

/** A synthetic bank of well-formed setups. */
function makeBank(count = 20): ZingerPrompt[] {
  const prompts: ZingerPrompt[] = [];
  for (let i = 1; i <= count; i++) {
    prompts.push({ id: `prompt-${String(i).padStart(3, '0')}`, setup: `Setup number ${i}: ___.` });
  }
  return prompts;
}

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: id, connected: true }));
}

/** A window into the module's opaque scratch, for arranging votes against real option ids. */
interface Peek {
  usedIds: string[];
  submissions: Record<string, string>;
  options: { id: string; text: string }[];
  authors: Record<string, string>;
  votes: Record<string, string>;
  setup: { setup: string } | null;
}

function peek(scratch: Record<string, unknown>): Peek {
  return scratch as unknown as Peek;
}

function ctxOf(
  scratch: Record<string, unknown>,
  round: number,
  roster: SessionPlayer[],
  phase: RoundContext['phase'] = 'collecting',
): RoundContext {
  return {
    room: 'r',
    game: ZINGER_GAME_ID,
    phase,
    round,
    players: roster,
    scores: {},
    scratch,
    config: {},
  };
}

describe('createZingerGame - setup draw', () => {
  it('never repeats a setup within a game', () => {
    const game = createZingerGame(makeBank(8), mulberry32(3));
    let scratch = game.configure({ rounds: 8 }, []).scratch;
    const drawn = new Set<string>();
    for (let round = 1; round <= 8; round++) {
      scratch = game.startRound(ctxOf(scratch, round, players('p1'))).scratch;
      const id = peek(scratch).usedIds.at(-1)!;
      expect(drawn.has(id)).toBe(false);
      drawn.add(id);
    }
    expect(drawn.size).toBe(8);
  });

  it('is deterministic for a fixed seed', () => {
    const a = createZingerGame(makeBank(), mulberry32(42));
    const b = createZingerGame(makeBank(), mulberry32(42));
    const sa = a.startRound(
      ctxOf(a.configure({ rounds: 3 }, []).scratch, 1, players('p1')),
    ).scratch;
    const sb = b.startRound(
      ctxOf(b.configure({ rounds: 3 }, []).scratch, 1, players('p1')),
    ).scratch;
    expect(peek(sa).setup?.setup).toBe(peek(sb).setup?.setup);
  });

  it('rejects a config that needs more setups than the bank has', () => {
    const game = createZingerGame(makeBank(3), mulberry32(1));
    expect(() => game.configure({ rounds: 4 }, [])).toThrow(/only 3 setups/);
  });
});

describe('createZingerGame - collecting zingers', () => {
  it('records a trimmed zinger and rejects an empty one', () => {
    const game = createZingerGame(makeBank(), mulberry32(1));
    const roster = players('p1', 'p2', 'p3');
    let scratch = game.startRound(
      ctxOf(game.configure({ rounds: 1 }, []).scratch, 1, roster),
    ).scratch;

    const ok = game.collectMove(ctxOf(scratch, 1, roster), 'p1', '  a funny thing  ');
    expect(ok.rejected).toBeUndefined();
    expect(peek(ok.scratch).submissions.p1).toBe('a funny thing');

    const empty = game.collectMove(ctxOf(scratch, 1, roster), 'p1', '   ');
    expect(empty.rejected?.reason).toMatch(/write a zinger/i);

    scratch = ok.scratch;
    // A player may change their own zinger freely.
    const changed = game.collectMove(ctxOf(scratch, 1, roster), 'p1', 'a different thing');
    expect(peek(changed.scratch).submissions.p1).toBe('a different thing');
  });

  it('allSubmitted is true only when every connected player answered', () => {
    const game = createZingerGame(makeBank(), mulberry32(1));
    const roster = players('p1', 'p2', 'p3');
    let scratch = game.startRound(
      ctxOf(game.configure({ rounds: 1 }, []).scratch, 1, roster),
    ).scratch;
    scratch = game.collectMove(ctxOf(scratch, 1, roster), 'p1', 'x').scratch;
    scratch = game.collectMove(ctxOf(scratch, 1, roster), 'p2', 'y').scratch;
    expect(game.allSubmitted!(ctxOf(scratch, 1, roster))).toBe(false);
    scratch = game.collectMove(ctxOf(scratch, 1, roster), 'p3', 'z').scratch;
    expect(game.allSubmitted!(ctxOf(scratch, 1, roster))).toBe(true);
  });
});

/** Arrange a round to the face-off (reveal) with the given zingers submitted, returning scratch. */
function toFaceOff(
  seed: number,
  bankSize: number,
  roster: SessionPlayer[],
  zingers: Record<string, string>,
): { game: ReturnType<typeof createZingerGame>; scratch: Record<string, unknown> } {
  const game = createZingerGame(makeBank(bankSize), mulberry32(seed));
  let scratch = game.startRound(
    ctxOf(game.configure({ rounds: 1 }, []).scratch, 1, roster),
  ).scratch;
  for (const [player, text] of Object.entries(zingers)) {
    scratch = game.collectMove(ctxOf(scratch, 1, roster), player, text).scratch;
  }
  scratch = game.reveal(ctxOf(scratch, 1, roster)).scratch;
  return { game, scratch };
}

describe('createZingerGame - the face-off + voting', () => {
  it('pits exactly two distinct authors head to head and hides authors on the reveal', () => {
    const roster = players('p1', 'p2', 'p3', 'p4');
    const game = createZingerGame(makeBank(), mulberry32(7));
    let scratch = game.startRound(
      ctxOf(game.configure({ rounds: 1 }, []).scratch, 1, roster),
    ).scratch;
    for (const p of ['p1', 'p2', 'p3', 'p4']) {
      scratch = game.collectMove(ctxOf(scratch, 1, roster), p, `zinger from ${p}`).scratch;
    }
    const revealed = game.reveal(ctxOf(scratch, 1, roster));
    const reveal = revealed.reveal as { options: { id: string; text: string }[] };
    expect(reveal.options).toHaveLength(2);
    // The reveal carries text but no author field.
    for (const option of reveal.options) {
      expect(option).not.toHaveProperty('author');
    }
    const authors = peek(revealed.scratch).authors;
    const pair = Object.values(authors);
    expect(new Set(pair).size).toBe(2);
  });

  it('rejects a vote from a face-off author and for an unknown option', () => {
    const roster = players('p1', 'p2', 'p3');
    const { game, scratch } = toFaceOff(2, 20, roster, {
      p1: 'zinger one',
      p2: 'zinger two',
      p3: 'zinger three',
    });
    const authors = Object.values(peek(scratch).authors);
    const optionId = peek(scratch).options[0]!.id;

    // An author of the face-off cannot vote.
    const authorVote = game.collectVote(ctxOf(scratch, 1, roster, 'guessing'), {
      player: authors[0]!,
      target: optionId,
      agree: true,
    });
    expect(peek(authorVote.scratch).votes[authors[0]!]).toBeUndefined();

    // An unknown option id is ignored.
    const nonAuthor = roster.find((p) => !authors.includes(p.player))!.player;
    const bad = game.collectVote(ctxOf(scratch, 1, roster, 'guessing'), {
      player: nonAuthor,
      target: '99',
      agree: true,
    });
    expect(peek(bad.scratch).votes[nonAuthor]).toBeUndefined();
  });

  it('allDecided is true only when every non-author voter has voted', () => {
    const roster = players('p1', 'p2', 'p3', 'p4');
    const { game, scratch } = toFaceOff(5, 20, roster, {
      p1: 'one',
      p2: 'two',
      p3: 'three',
      p4: 'four',
    });
    const authors = new Set(Object.values(peek(scratch).authors));
    const voters = roster.filter((p) => !authors.has(p.player)).map((p) => p.player);
    expect(voters).toHaveLength(2);
    const optionId = peek(scratch).options[0]!.id;

    let s = scratch;
    expect(game.allDecided!(ctxOf(s, 1, roster, 'guessing'))).toBe(false);
    s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
      player: voters[0]!,
      target: optionId,
      agree: true,
    }).scratch;
    expect(game.allDecided!(ctxOf(s, 1, roster, 'guessing'))).toBe(false);
    s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
      player: voters[1]!,
      target: optionId,
      agree: true,
    }).scratch;
    expect(game.allDecided!(ctxOf(s, 1, roster, 'guessing'))).toBe(true);
  });
});

describe('createZingerGame - scoring', () => {
  it('awards the winner one point per vote', () => {
    const roster = players('p1', 'p2', 'p3', 'p4', 'p5');
    const { game, scratch } = toFaceOff(11, 20, roster, {
      p1: 'a',
      p2: 'b',
      p3: 'c',
      p4: 'd',
      p5: 'e',
    });
    const authors = peek(scratch).authors; // { '0': X, '1': Y }
    const winnerOption = '0';
    const loserOption = '1';
    const voters = roster
      .filter((p) => !Object.values(authors).includes(p.player))
      .map((p) => p.player);
    // 3 voters, 2 for option 0, 1 for option 1 -> option 0 wins with 2 votes, no clean sweep.
    let s = scratch;
    s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
      player: voters[0]!,
      target: winnerOption,
      agree: true,
    }).scratch;
    s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
      player: voters[1]!,
      target: winnerOption,
      agree: true,
    }).scratch;
    s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
      player: voters[2]!,
      target: loserOption,
      agree: true,
    }).scratch;

    const resolved = game.resolveDecision!(ctxOf(s, 1, roster, 'guessing'));
    const winnerAuthor = authors[winnerOption]!;
    const winScores = resolved.scores.filter((e) => e.player === winnerAuthor);
    const total = winScores.reduce((sum, e) => sum + e.points, 0);
    expect(total).toBe(2 * POINTS_PER_VOTE);
    expect(resolved.scores.some((e) => e.reason === 'a clean sweep')).toBe(false);
    const reveal = resolved.reveal as { winner: string; cleanSweep: boolean };
    expect(reveal.winner).toBe(winnerOption);
    expect(reveal.cleanSweep).toBe(false);
  });

  it('adds the clean-sweep bonus for a unanimous vote', () => {
    const roster = players('p1', 'p2', 'p3', 'p4');
    const { game, scratch } = toFaceOff(3, 20, roster, {
      p1: 'a',
      p2: 'b',
      p3: 'c',
      p4: 'd',
    });
    const authors = peek(scratch).authors;
    const winnerOption = '0';
    const voters = roster
      .filter((p) => !Object.values(authors).includes(p.player))
      .map((p) => p.player);
    expect(voters).toHaveLength(2);
    let s = scratch;
    for (const v of voters) {
      s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
        player: v,
        target: winnerOption,
        agree: true,
      }).scratch;
    }
    const resolved = game.resolveDecision!(ctxOf(s, 1, roster, 'guessing'));
    const winnerAuthor = authors[winnerOption]!;
    const total = resolved.scores
      .filter((e) => e.player === winnerAuthor)
      .reduce((sum, e) => sum + e.points, 0);
    // 2 votes + clean sweep bonus.
    expect(total).toBe(2 * POINTS_PER_VOTE + CLEAN_SWEEP_BONUS);
    expect(resolved.scores.some((e) => e.reason === 'a clean sweep')).toBe(true);
    expect((resolved.reveal as { cleanSweep: boolean }).cleanSweep).toBe(true);
  });

  it('does NOT award a clean sweep at the MIN_SWEEP_VOTERS boundary (1 eligible voter, 1-0)', () => {
    // 2 authors + exactly 1 eligible voter, whose single vote is unanimous for one option. The bonus
    // needs at least MIN_SWEEP_VOTERS (2) eligible voters, so this 1-0 must score 1 point and NO
    // clean sweep - pinning the lower boundary the code comments claim.
    const roster = players('p1', 'p2', 'p3');
    const { game, scratch } = toFaceOff(2, 20, roster, {
      p1: 'a',
      p2: 'b',
      p3: 'c',
    });
    const authors = peek(scratch).authors;
    const winnerOption = '0';
    const voters = roster
      .filter((p) => !Object.values(authors).includes(p.player))
      .map((p) => p.player);
    expect(voters).toHaveLength(1);
    const s = game.collectVote(ctxOf(scratch, 1, roster, 'guessing'), {
      player: voters[0]!,
      target: winnerOption,
      agree: true,
    }).scratch;
    const resolved = game.resolveDecision!(ctxOf(s, 1, roster, 'guessing'));
    const winnerAuthor = authors[winnerOption]!;
    const total = resolved.scores
      .filter((e) => e.player === winnerAuthor)
      .reduce((sum, e) => sum + e.points, 0);
    expect(total).toBe(1 * POINTS_PER_VOTE);
    expect(resolved.scores.some((e) => e.reason === 'a clean sweep')).toBe(false);
    expect((resolved.reveal as { cleanSweep: boolean }).cleanSweep).toBe(false);
  });

  it('does NOT award a clean sweep on a partial-timeout vote (2 of 4 eligible, both to winner)', () => {
    // resolveDecision also runs on the vote-window timeout. With 4 eligible voters but only 2 having
    // voted - both for one option - the cast votes are "unanimous" but the eligible population is not,
    // so this must NOT be a sweep (the fix gates on eligibleVoterCount, not totalVotes).
    const roster = players('p1', 'p2', 'p3', 'p4', 'p5', 'p6');
    const { game, scratch } = toFaceOff(11, 20, roster, {
      p1: 'a',
      p2: 'b',
      p3: 'c',
      p4: 'd',
      p5: 'e',
      p6: 'f',
    });
    const authors = peek(scratch).authors;
    const winnerOption = '0';
    const voters = roster
      .filter((p) => !Object.values(authors).includes(p.player))
      .map((p) => p.player);
    expect(voters).toHaveLength(4);
    // Only 2 of the 4 eligible voters vote, both for the winner (a partial but "unanimous" cast).
    let s = scratch;
    for (const v of voters.slice(0, 2)) {
      s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
        player: v,
        target: winnerOption,
        agree: true,
      }).scratch;
    }
    const resolved = game.resolveDecision!(ctxOf(s, 1, roster, 'guessing'));
    const winnerAuthor = authors[winnerOption]!;
    const total = resolved.scores
      .filter((e) => e.player === winnerAuthor)
      .reduce((sum, e) => sum + e.points, 0);
    // 2 votes for the winner, but NOT a clean sweep (2 of 4 eligible voted).
    expect(total).toBe(2 * POINTS_PER_VOTE);
    expect(resolved.scores.some((e) => e.reason === 'a clean sweep')).toBe(false);
    expect((resolved.reveal as { cleanSweep: boolean }).cleanSweep).toBe(false);
  });

  it('splits no points on a tie', () => {
    const roster = players('p1', 'p2', 'p3', 'p4');
    const { game, scratch } = toFaceOff(9, 20, roster, {
      p1: 'a',
      p2: 'b',
      p3: 'c',
      p4: 'd',
    });
    const authors = peek(scratch).authors;
    const voters = roster
      .filter((p) => !Object.values(authors).includes(p.player))
      .map((p) => p.player);
    expect(voters).toHaveLength(2);
    let s = scratch;
    s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
      player: voters[0]!,
      target: '0',
      agree: true,
    }).scratch;
    s = game.collectVote(ctxOf(s, 1, roster, 'guessing'), {
      player: voters[1]!,
      target: '1',
      agree: true,
    }).scratch;
    const resolved = game.resolveDecision!(ctxOf(s, 1, roster, 'guessing'));
    expect(resolved.scores).toHaveLength(0);
    expect((resolved.reveal as { winner: string | null }).winner).toBeNull();
  });

  it('scores nothing when fewer than two players submitted', () => {
    const roster = players('p1', 'p2', 'p3');
    const game = createZingerGame(makeBank(), mulberry32(1));
    let scratch = game.startRound(
      ctxOf(game.configure({ rounds: 1 }, []).scratch, 1, roster),
    ).scratch;
    scratch = game.collectMove(ctxOf(scratch, 1, roster), 'p1', 'only one zinger').scratch;
    const revealed = game.reveal(ctxOf(scratch, 1, roster));
    expect((revealed.reveal as { options: unknown[] }).options).toHaveLength(0);
    expect(revealed.decision).toBeUndefined();
    expect(revealed.scores).toHaveLength(0);
  });
});

describe('createZingerGame - lifecycle end', () => {
  it('advances until the configured round count', () => {
    const game = createZingerGame(makeBank(), mulberry32(1));
    const scratch = game.configure({ rounds: 3 }, []).scratch;
    expect(game.advance(ctxOf(scratch, 2, players('p1'))).done).toBe(false);
    expect(game.advance(ctxOf(scratch, 3, players('p1'))).done).toBe(true);
  });

  it('ranks final standings by score', () => {
    const game = createZingerGame(makeBank(), mulberry32(1));
    const roster = players('p1', 'p2', 'p3');
    const ctx: RoundContext = {
      ...ctxOf(game.configure({ rounds: 1 }, []).scratch, 1, roster, 'complete'),
      scores: { p1: 5, p2: 2, p3: 0 },
    };
    const standings = game.endGame(ctx);
    expect(standings[0]!.player).toBe('p1');
    expect(standings[0]!.rank).toBe(1);
  });
});
