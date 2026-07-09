import { beforeEach, describe, expect, it } from 'vitest';
import { mulberry32 } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import type { ScoreEvent } from '@branchout/protocol';
import { createLiarLiarGame, CORRECT_POINTS, FOOL_POINTS } from './liar-liar';
import type { LiarLiarClue } from './clues';

// A synthetic bank: 5 people + 5 food clues; `people-001` carries an alias to test the truth guard.
function makeBank(): LiarLiarClue[] {
  const clues: LiarLiarClue[] = [];
  for (let i = 1; i <= 5; i++) {
    clues.push({
      id: `people-00${i}`,
      category: 'people',
      clue: `People clue ${i}`,
      answer: `Person ${i}`,
      ...(i === 1 ? { aliases: ['Person One'] } : {}),
    });
  }
  for (let i = 1; i <= 5; i++) {
    clues.push({
      id: `food-00${i}`,
      category: 'food',
      clue: `Food clue ${i}`,
      answer: `Food ${i}`,
    });
  }
  return clues;
}

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: id, connected: true }));
}

/** A window into the module's opaque scratch, for arranging guesses against real option ids. */
interface Peek {
  submissions: Record<string, string>;
  options: { id: string; text: string }[];
  attribution: Record<string, { kind: 'truth' | 'fake'; author?: string }>;
  clue: { answer: string } | null;
  usedIds: string[];
}

function peek(scratch: Record<string, unknown>): Peek {
  return scratch as unknown as Peek;
}

/** Locate the truth option and each author's fake option after a reveal. */
function introspect(scratch: Record<string, unknown>): {
  truthId: string;
  fakeOf: Record<string, string>;
} {
  const attribution = peek(scratch).attribution;
  const truthId = Object.keys(attribution).find((id) => attribution[id]!.kind === 'truth')!;
  const fakeOf: Record<string, string> = {};
  for (const [id, attr] of Object.entries(attribution)) {
    if (attr.kind === 'fake' && attr.author) fakeOf[attr.author] = id;
  }
  return { truthId, fakeOf };
}

describe('createLiarLiarGame - clue draw', () => {
  it('never repeats a clue within a game', () => {
    const game = createLiarLiarGame(makeBank(), mulberry32(3));
    let scratch = game.configure({ categories: 'random', rounds: 8 }, []).scratch;
    const drawn = new Set<string>();
    for (let round = 1; round <= 8; round++) {
      const ctx: RoundContext = {
        room: 'r',
        game: 'liar-liar',
        phase: 'collecting',
        round,
        players: players('p1'),
        scores: {},
        scratch,
        config: {},
      };
      scratch = game.startRound(ctx).scratch;
      const id = peek(scratch).usedIds.at(-1)!;
      expect(drawn.has(id)).toBe(false);
      drawn.add(id);
    }
    expect(drawn.size).toBe(8);
  });

  it('draws only from the chosen categories', () => {
    const game = createLiarLiarGame(makeBank(), mulberry32(9));
    let scratch = game.configure({ categories: ['food'], rounds: 5 }, []).scratch;
    for (let round = 1; round <= 5; round++) {
      const ctx: RoundContext = {
        room: 'r',
        game: 'liar-liar',
        phase: 'collecting',
        round,
        players: players('p1'),
        scores: {},
        scratch,
        config: {},
      };
      const result = game.startRound(ctx);
      scratch = result.scratch;
      expect((result.prompt as { category: string }).category).toBe('food');
    }
  });

  it('configure rejects when a category lacks enough clues for the round count', () => {
    const game = createLiarLiarGame(makeBank(), mulberry32(1));
    expect(() => game.configure({ categories: ['food'], rounds: 6 }, [])).toThrow(/only 5 clues/);
  });
});

describe('createLiarLiarGame - a round', () => {
  let game: GameModule;
  let scratch: Record<string, unknown>;

  function ctx(phase: RoundContext['phase'] = 'collecting'): RoundContext {
    return {
      room: 'r',
      game: 'liar-liar',
      phase,
      round: 1,
      players: players('p1', 'p2', 'p3'),
      scores: {},
      scratch,
      config: {},
    };
  }

  beforeEach(() => {
    // A single people clue so the draw is deterministic: the round's truth is always "Person 1"
    // (alias "Person One"), which the reject/scoring assertions below rely on.
    const soloBank: LiarLiarClue[] = [
      {
        id: 'people-001',
        category: 'people',
        clue: 'People clue',
        answer: 'Person 1',
        aliases: ['Person One'],
      },
      { id: 'food-001', category: 'food', clue: 'Food clue', answer: 'Food 1' },
    ];
    game = createLiarLiarGame(soloBank, mulberry32(42));
    scratch = game.configure({ categories: ['people'], rounds: 1 }, []).scratch;
    scratch = game.startRound(ctx()).scratch;
  });

  it('rejects the real answer and its alias, and a duplicate of another player fake', () => {
    const truth = peek(scratch).clue!.answer;
    // The truth is rejected, privately, with a vague reason, and nothing is written.
    const before = JSON.stringify(scratch);
    const rej = game.collectAnswer(ctx(), 'p1', truth);
    expect(rej.rejected?.reason).toBe('someone already submitted that');
    expect(JSON.stringify(rej.scratch)).toBe(before);

    // A distinct fake is accepted.
    scratch = game.collectAnswer(ctx(), 'p1', 'Napoleon').scratch;
    expect(peek(scratch).submissions.p1).toBe('Napoleon');

    // Another player submitting the same fake (normalized) is rejected.
    const dup = game.collectAnswer(ctx(), 'p2', 'napoleon!');
    expect(dup.rejected?.reason).toBe('someone already submitted that');
    expect(peek(dup.scratch).submissions.p2).toBeUndefined();

    // A player may change their own fake freely.
    scratch = game.collectAnswer(ctx(), 'p1', 'Cleopatra').scratch;
    expect(peek(scratch).submissions.p1).toBe('Cleopatra');
  });

  it('rejects the alias spelling of the truth', () => {
    const rej = game.collectAnswer(ctx(), 'p1', 'person one'); // alias of "Person 1"
    expect(rej.rejected?.reason).toBe('someone already submitted that');
  });

  it('reveals the truth plus every fake as shuffled options without naming the truth', () => {
    scratch = game.collectAnswer(ctx(), 'p1', 'Napoleon').scratch;
    scratch = game.collectAnswer(ctx(), 'p2', 'Cleopatra').scratch;
    scratch = game.collectAnswer(ctx(), 'p3', 'Gandhi').scratch;

    const result = game.reveal(ctx());
    scratch = result.scratch;
    const reveal = result.reveal as { options: { id: string; text: string }[]; clue: string };

    // 3 fakes + the truth = 4 options; the pre-guess reveal exposes no attribution.
    expect(reveal.options).toHaveLength(4);
    expect(reveal.options.every((o) => !('kind' in o))).toBe(true);
    const texts = reveal.options.map((o) => o.text).sort();
    expect(texts).toEqual(['Cleopatra', 'Gandhi', 'Napoleon', 'Person 1'].sort());
    // The guess phase is requested with the 30s window.
    expect(result.decision?.windowMs).toBe(30_000);
    expect(result.scores).toEqual([]);
  });

  it('scores 100 for the truth and 50 per fooled player to a fake author', () => {
    scratch = game.collectAnswer(ctx(), 'p1', 'Napoleon').scratch;
    scratch = game.collectAnswer(ctx(), 'p2', 'Cleopatra').scratch;
    scratch = game.collectAnswer(ctx(), 'p3', 'Gandhi').scratch;
    scratch = game.reveal(ctx()).scratch;

    const { truthId, fakeOf } = introspect(scratch);

    // p1 guesses the truth (+100). p2 and p3 both fall for p1's fake "Napoleon" (+50 each to p1).
    scratch = game.collectVote(ctx('guessing'), {
      player: 'p1',
      target: truthId,
      agree: true,
    }).scratch;
    scratch = game.collectVote(ctx('guessing'), {
      player: 'p2',
      target: fakeOf.p1!,
      agree: true,
    }).scratch;
    scratch = game.collectVote(ctx('guessing'), {
      player: 'p3',
      target: fakeOf.p1!,
      agree: true,
    }).scratch;

    const resolved = game.resolveDecision!(ctx('guessing'));
    const total: Record<string, number> = {};
    for (const e of resolved.scores as ScoreEvent[])
      total[e.player] = (total[e.player] ?? 0) + e.points;
    // p1: 100 (correct) + 2 * 50 (fooled p2 and p3) = 200.
    expect(total.p1).toBe(CORRECT_POINTS + 2 * FOOL_POINTS);
    expect(total.p2 ?? 0).toBe(0);
    expect(total.p3 ?? 0).toBe(0);

    const finalReveal = resolved.reveal as {
      truth: string;
      correctGuessers: string[];
      options: { id: string; kind: string; author?: string; pickedBy: string[] }[];
    };
    expect(finalReveal.truth).toBe('Person 1');
    expect(finalReveal.correctGuessers).toEqual(['p1']);
    const p1Fake = finalReveal.options.find((o) => o.author === 'p1')!;
    expect(p1Fake.pickedBy.sort()).toEqual(['p2', 'p3']);
  });

  it('ignores a player guessing their own fake', () => {
    scratch = game.collectAnswer(ctx(), 'p1', 'Napoleon').scratch;
    scratch = game.collectAnswer(ctx(), 'p2', 'Cleopatra').scratch;
    scratch = game.reveal(ctx()).scratch;
    const { fakeOf } = introspect(scratch);

    const after = game.collectVote(ctx('guessing'), {
      player: 'p1',
      target: fakeOf.p1!,
      agree: true,
    });
    expect(peek(after.scratch).submissions).toBeDefined();
    expect(
      (peek(after.scratch) as unknown as { guesses: Record<string, string> }).guesses.p1,
    ).toBeUndefined();
  });

  it('a player who submitted no fake earns nothing and fools no one', () => {
    // Only p1 and p2 submit; p3 stays silent.
    scratch = game.collectAnswer(ctx(), 'p1', 'Napoleon').scratch;
    scratch = game.collectAnswer(ctx(), 'p2', 'Cleopatra').scratch;
    scratch = game.reveal(ctx()).scratch;
    const { truthId, fakeOf } = introspect(scratch);
    expect(fakeOf.p3).toBeUndefined(); // no option attributed to p3

    // p3 guesses the truth (+100); nobody picks anyone else, so no fooling points.
    scratch = game.collectVote(ctx('guessing'), {
      player: 'p3',
      target: truthId,
      agree: true,
    }).scratch;
    const resolved = game.resolveDecision!(ctx('guessing'));
    const total: Record<string, number> = {};
    for (const e of resolved.scores as ScoreEvent[])
      total[e.player] = (total[e.player] ?? 0) + e.points;
    expect(total).toEqual({ p3: CORRECT_POINTS });
  });
});
