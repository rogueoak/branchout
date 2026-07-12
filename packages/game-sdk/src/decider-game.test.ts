import { describe, expect, it } from 'vitest';
import { deciderGame, DECIDER_GAME_ID } from './decider-game';
import type { RoundContext, SessionPlayer } from './lifecycle';

const players: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

function ctx(
  phase: RoundContext['phase'],
  scratch: Record<string, unknown>,
  round = 1,
): RoundContext {
  return {
    room: 'r',
    game: DECIDER_GAME_ID,
    phase,
    round,
    players,
    scores: {},
    scratch,
    config: {},
  };
}

describe('deciderGame', () => {
  it('collects fakes, rejecting the truth and a duplicate of another player', () => {
    let s = deciderGame.configure({ truths: ['blue'] }, players).scratch;
    s = deciderGame.startRound(ctx('collecting', s)).scratch;

    s = deciderGame.collectMove(ctx('collecting', s), 'p1', 'red').scratch;
    s = deciderGame.collectMove(ctx('collecting', s), 'p2', 'green').scratch;

    // The truth is refused.
    const truth = deciderGame.collectMove(ctx('collecting', s), 'p3', 'Blue');
    expect(truth.rejected?.reason).toBe('taken');
    // A duplicate of p1's fake is refused (and nothing was recorded for p3).
    const dup = deciderGame.collectMove(ctx('collecting', s), 'p3', 'RED');
    expect(dup.rejected?.reason).toBe('taken');

    // A fresh fake is accepted.
    s = deciderGame.collectMove(ctx('collecting', s), 'p3', 'yellow').scratch;
    expect(deciderGame.allSubmitted?.(ctx('collecting', s))).toBe(true);
  });

  it('reveals the options and requests a guess window', () => {
    let s = deciderGame.configure({ truths: ['blue'], windowMs: 15000 }, players).scratch;
    s = deciderGame.startRound(ctx('collecting', s)).scratch;
    s = deciderGame.collectMove(ctx('collecting', s), 'p1', 'red').scratch;
    s = deciderGame.collectMove(ctx('collecting', s), 'p2', 'green').scratch;

    const revealed = deciderGame.reveal(ctx('collecting', s));
    expect(revealed.decision).toEqual({ windowMs: 15000 });
    expect(revealed.scores).toEqual([]);
    const reveal = revealed.reveal as { truth: string; options: string[] };
    expect(reveal.truth).toBe('blue');
    expect([...reveal.options].sort()).toEqual(['blue', 'green', 'red']);
  });

  it('scores a correct guess 100 and a fooled author 50 per guesser', () => {
    let s = deciderGame.configure({ truths: ['blue'] }, players).scratch;
    s = deciderGame.startRound(ctx('collecting', s)).scratch;
    s = deciderGame.collectMove(ctx('collecting', s), 'p1', 'red').scratch;
    s = deciderGame.collectMove(ctx('collecting', s), 'p2', 'green').scratch;
    s = deciderGame.collectMove(ctx('collecting', s), 'p3', 'yellow').scratch;
    s = deciderGame.reveal(ctx('collecting', s)).scratch;

    // p1 guesses the truth; p2 picks p1's fake; p3 picks p2's fake.
    s = deciderGame.collectVote(ctx('guessing', s), {
      player: 'p1',
      target: 'blue',
      agree: true,
    }).scratch;
    s = deciderGame.collectVote(ctx('guessing', s), {
      player: 'p2',
      target: 'red',
      agree: true,
    }).scratch;
    s = deciderGame.collectVote(ctx('guessing', s), {
      player: 'p3',
      target: 'green',
      agree: true,
    }).scratch;
    expect(deciderGame.allDecided?.(ctx('guessing', s))).toBe(true);

    const scores = deciderGame.resolveDecision!(ctx('guessing', s)).scores;
    expect(scores).toContainEqual({ player: 'p1', points: 100, reason: 'correct guess' });
    expect(scores).toContainEqual({ player: 'p1', points: 50, reason: 'fooled a player' });
    expect(scores).toContainEqual({ player: 'p2', points: 50, reason: 'fooled a player' });
    // p3 fooled no one and did not guess the truth.
    expect(scores.filter((e) => e.player === 'p3')).toEqual([]);
  });

  it('ignores a guess a player makes for their own fake', () => {
    let s = deciderGame.configure({ truths: ['blue'] }, players).scratch;
    s = deciderGame.startRound(ctx('collecting', s)).scratch;
    s = deciderGame.collectMove(ctx('collecting', s), 'p1', 'red').scratch;
    // p1 tries to guess its own fake -> not recorded.
    s = deciderGame.collectVote(ctx('guessing', s), {
      player: 'p1',
      target: 'red',
      agree: true,
    }).scratch;
    const guesses = (s.guesses as Record<string, Record<string, string>>)['1'] ?? {};
    expect(guesses.p1).toBeUndefined();
  });
});
