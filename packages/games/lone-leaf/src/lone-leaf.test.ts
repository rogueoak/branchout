import { describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import { createTestServices, mulberry32 } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import {
  createLoneLeafGame,
  seekerForRound,
  wiltLeaves,
  BANK_POINTS,
  loneLeafPlugin,
  type LeafResult,
} from './lone-leaf';
import type { LoneLeafSeed } from './seeds';

const roster: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

// A single-seed bank makes the drawn seed deterministic regardless of the rng, so the tests can
// assert the exact seed word delivered/guessed. Seeker rotation is covered separately via the roster.
const bank: LoneLeafSeed[] = [{ id: 'nature-001', category: 'nature', word: 'river' }];

function ctx(
  round: number,
  phase: RoundContext['phase'],
  scratch: Record<string, unknown>,
  players: readonly SessionPlayer[] = roster,
): RoundContext {
  return {
    room: 'r',
    game: 'lone-leaf',
    phase,
    round,
    players,
    scores: {},
    scratch,
    config: {},
  };
}

describe('seekerForRound', () => {
  it('rotates the Seeker by seat order across rounds', () => {
    expect(seekerForRound(roster, 1)).toBe('p1');
    expect(seekerForRound(roster, 2)).toBe('p2');
    expect(seekerForRound(roster, 3)).toBe('p3');
    expect(seekerForRound(roster, 4)).toBe('p1');
    expect(seekerForRound([], 1)).toBeNull();
  });
});

describe('wiltLeaves', () => {
  it('wilts matching leaves (both of a duplicate pair) and keeps unique survivors', () => {
    const results = wiltLeaves({ p2: 'water', p3: 'Waters', p4: 'flow' }, 'river', [
      'p2',
      'p3',
      'p4',
    ]);
    const byPlayer = Object.fromEntries(results.map((r) => [r.player, r.survived]));
    // "water" and "Waters" share a stem -> both wilt; "flow" is unique -> survives.
    expect(byPlayer.p2).toBe(false);
    expect(byPlayer.p3).toBe(false);
    expect(byPlayer.p4).toBe(true);
  });

  it('wilts a leaf that matches the seed', () => {
    const results = wiltLeaves({ p2: 'River', p3: 'flow' }, 'river', ['p2', 'p3']);
    expect(results.find((r) => r.player === 'p2')?.survived).toBe(false);
    expect(results.find((r) => r.player === 'p3')?.survived).toBe(true);
  });

  it('wilts a leaf matching any token of a MULTI-WORD seed (no partial answer leak)', () => {
    // "einstein" alone would otherwise survive against "albert einstein" and reveal the answer.
    const results = wiltLeaves({ p2: 'einstein', p3: 'Albert', p4: 'physics' }, 'albert einstein', [
      'p2',
      'p3',
      'p4',
    ]);
    const byPlayer = Object.fromEntries(results.map((r) => [r.player, r.survived]));
    expect(byPlayer.p2).toBe(false);
    expect(byPlayer.p3).toBe(false);
    expect(byPlayer.p4).toBe(true);
  });
});

describe('Lone Leaf module', () => {
  function game(): GameModule {
    return createLoneLeafGame(bank, mulberry32(3));
  }

  it('delivers the seed ONLY to non-Seekers via the private channel, never in the prompt', () => {
    const g = game();
    const scratch = g.configure({ categories: ['nature'], rounds: 1 }, roster).scratch;
    const started = g.startRound(ctx(1, 'collecting', scratch));

    // Round 1 Seeker is p1 (seat 0). The prompt (broadcast to EVERY device) carries no seed word.
    expect(started.prompt).toMatchObject({ round: 1, seeker: 'p1' });
    expect(JSON.stringify(started.prompt)).not.toMatch(/river|forest|mountain/);

    // The private map delivers the seed to the two non-Seekers - and the Seeker is absent entirely.
    const secret = started.private!;
    expect(Object.keys(secret).sort()).toEqual(['p2', 'p3']);
    expect(secret.p1).toBeUndefined();
    expect((secret.p2 as { seed: string }).seed).toBe('river');
    expect((secret.p3 as { seed: string }).seed).toBe('river');
  });

  it('the seed NEVER appears in any frame the Seeker receives before the guess resolves', () => {
    const g = game();
    let scratch = g.configure({ categories: ['nature'], rounds: 1 }, roster).scratch;
    const started = g.startRound(ctx(1, 'collecting', scratch));
    scratch = started.scratch;
    const seekerId = 'p1';

    // startRound: the Seeker gets the broadcast prompt (no seed) and NO private entry.
    expect(JSON.stringify(started.prompt)).not.toContain('river');
    expect((started.private ?? {})[seekerId]).toBeUndefined();

    // Non-Seekers submit; the Seeker submitting is refused (they must not write a leaf).
    const seekerMove = g.collectMove(ctx(1, 'collecting', scratch), seekerId, 'river');
    expect(seekerMove.rejected).toBeDefined();
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'water').scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p3', 'flow').scratch;

    // reveal: the frame broadcast to EVERY device (including the Seeker) carries no seed word.
    const revealed = g.reveal(ctx(1, 'collecting', scratch));
    scratch = revealed.scratch;
    expect(JSON.stringify(revealed.reveal)).not.toContain('river');
    // The reveal has no private channel at all here (nothing new is secret at reveal time).
    expect(revealed.private).toBeUndefined();
  });

  it('a wilted leaf equal to the seed never rides the broadcast reveal to the Seeker', () => {
    const g = game();
    let scratch = g.configure({ categories: ['nature'], rounds: 1 }, roster).scratch;
    scratch = g.startRound(ctx(1, 'collecting', scratch)).scratch;
    // A non-Seeker writes the SEED word itself (it will wilt as a seed match). Its raw word must not
    // then leak in the broadcast reveal frame the Seeker (p1) receives.
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'river').scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p3', 'flow').scratch;
    const revealed = g.reveal(ctx(1, 'collecting', scratch));
    // The leaf equal to the seed wilted, so its word is absent from the streamed reveal entirely.
    expect(JSON.stringify(revealed.reveal)).not.toContain('river');
    const leaves = (revealed.reveal as { leaves: LeafResult[] }).leaves;
    expect(leaves.every((l) => l.survived)).toBe(true);
    // The unique survivor is still there for the Seeker to guess from.
    expect((revealed.reveal as { survivors: string[] }).survivors).toEqual(['flow']);
  });

  it('configure defaults the windows: 60s clue (move), auto-advance dwell 5s', () => {
    const g = game();
    const result = g.configure({ categories: ['nature'], rounds: 1 }, roster);
    expect(result.rounds).toBe(1);
    expect(result.moveWindowMs).toBe(60_000);
    // Auto-advance on by default -> leaderboardWindowMs > 0 (the engine infers auto-advance from it).
    expect(result.leaderboardWindowMs).toBe(5_000);
  });

  it('configure applies host pacing: clue window, guess window, and auto-advance off', () => {
    const g = game();
    const result = g.configure(
      {
        categories: ['nature'],
        rounds: 1,
        autoAdvance: false,
        advanceAfterSeconds: 9,
        clueSeconds: 45,
        guessSeconds: 90,
      },
      roster,
    );
    // Clue time drives the move window.
    expect(result.moveWindowMs).toBe(45_000);
    // Auto-advance off -> host-advanced (leaderboardWindowMs = 0), regardless of advanceAfterSeconds.
    expect(result.leaderboardWindowMs).toBe(0);
    // The guess window rides scratch to the reveal.
    let scratch = result.scratch;
    scratch = g.startRound(ctx(1, 'collecting', scratch)).scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'water').scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p3', 'flow').scratch;
    const revealed = g.reveal(ctx(1, 'collecting', scratch));
    expect(revealed.decision?.windowMs).toBe(90_000);
  });

  it('runs a full co-op round: a correct guess banks +1 for everyone', () => {
    const g = game();
    let scratch = g.configure({ categories: ['nature'], rounds: 1 }, roster).scratch;
    scratch = g.startRound(ctx(1, 'collecting', scratch)).scratch;

    // p2 and p3 write DISTINCT leaves (p1 is the Seeker).
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'water').scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p3', 'flow').scratch;
    expect(g.allSubmitted?.(ctx(1, 'collecting', scratch))).toBe(true);

    const revealed = g.reveal(ctx(1, 'collecting', scratch));
    scratch = revealed.scratch;
    const results = (revealed.reveal as { leaves: LeafResult[] }).leaves;
    // Both leaves are unique -> both survive.
    expect(results.every((r) => r.survived)).toBe(true);
    expect(revealed.decision?.windowMs).toBe(60_000);

    // A non-Seeker's vote is ignored; only the Seeker's guess counts.
    scratch = g.collectVote(ctx(1, 'guessing', scratch), {
      player: 'p2',
      target: 'lake',
      agree: true,
    }).scratch;
    expect(g.allDecided?.(ctx(1, 'guessing', scratch))).toBe(false);

    // The Seeker guesses correctly (a case/plural variant still counts).
    scratch = g.collectVote(ctx(1, 'guessing', scratch), {
      player: 'p1',
      target: 'Rivers',
      agree: true,
    }).scratch;
    expect(g.allDecided?.(ctx(1, 'guessing', scratch))).toBe(true);

    const resolved = g.resolveDecision!(ctx(1, 'guessing', scratch));
    // Co-op: every player banks the point.
    expect(resolved.scores).toHaveLength(3);
    expect(resolved.scores.every((s) => s.points === BANK_POINTS)).toBe(true);
    expect(new Set(resolved.scores.map((s) => s.player))).toEqual(new Set(['p1', 'p2', 'p3']));
    expect((resolved.reveal as { correct: boolean; seed: string }).correct).toBe(true);
    // The seed is finally named in the resolved reveal, now the guess is in.
    expect((resolved.reveal as { seed: string }).seed).toBe('river');
  });

  it('displays a Title Case seed as stored to non-Seekers, yet a lowercase guess still counts', () => {
    // The bank stores words in Title Case; non-Seekers must SEE the word exactly as stored, while the
    // Seeker's guess resolves case-insensitively via sameLeaf (normalizeLeaf lowercases both sides).
    const titleBank: LoneLeafSeed[] = [
      { id: 'celebrities-001', category: 'celebrities', word: 'Taylor Swift' },
    ];
    const g = createLoneLeafGame(titleBank, mulberry32(3));
    let scratch = g.configure({ categories: ['celebrities'], rounds: 1 }, roster).scratch;

    // Non-Seekers (p2, p3) receive the seed verbatim in Title Case; the Seeker (p1) is absent.
    const started = g.startRound(ctx(1, 'collecting', scratch));
    scratch = started.scratch;
    expect((started.private!.p2 as { seed: string }).seed).toBe('Taylor Swift');
    expect((started.private!.p3 as { seed: string }).seed).toBe('Taylor Swift');

    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'singer').scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p3', 'pop').scratch;
    scratch = g.reveal(ctx(1, 'collecting', scratch)).scratch;

    // The Seeker guesses in lowercase; the case-insensitive match still banks the co-op point.
    scratch = g.collectVote(ctx(1, 'guessing', scratch), {
      player: 'p1',
      target: 'taylor swift',
      agree: true,
    }).scratch;
    const resolved = g.resolveDecision!(ctx(1, 'guessing', scratch));
    expect((resolved.reveal as { correct: boolean }).correct).toBe(true);
    expect(resolved.scores.every((s) => s.points === BANK_POINTS)).toBe(true);
    // The resolved reveal names the seed exactly as stored (Title Case).
    expect((resolved.reveal as { seed: string }).seed).toBe('Taylor Swift');
  });

  it('a wrong guess banks nothing for anyone (shared miss)', () => {
    const g = game();
    let scratch = g.configure({ categories: ['nature'], rounds: 1 }, roster).scratch;
    scratch = g.startRound(ctx(1, 'collecting', scratch)).scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'water').scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p3', 'flow').scratch;
    scratch = g.reveal(ctx(1, 'collecting', scratch)).scratch;
    scratch = g.collectVote(ctx(1, 'guessing', scratch), {
      player: 'p1',
      target: 'ocean',
      agree: true,
    }).scratch;
    const resolved = g.resolveDecision!(ctx(1, 'guessing', scratch));
    expect(resolved.scores).toHaveLength(0);
    expect((resolved.reveal as { correct: boolean }).correct).toBe(false);
  });

  it('rejects a two-word leaf and a blank leaf', () => {
    const g = game();
    let scratch = g.configure({ categories: ['nature'], rounds: 1 }, roster).scratch;
    scratch = g.startRound(ctx(1, 'collecting', scratch)).scratch;
    expect(g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'two words').rejected).toBeDefined();
    expect(g.collectMove(ctx(1, 'collecting', scratch), 'p2', '   ').rejected).toBeDefined();
  });

  it('draws seeds from the host difficulty band, widening only when exhausted', () => {
    // A bank spread across the scale; the band [4, 6] should only ever surface the mid seed.
    const banded: LoneLeafSeed[] = [
      { id: 'nature-001', category: 'nature', word: 'river', difficulty: 1 },
      { id: 'nature-002', category: 'nature', word: 'meadow', difficulty: 5 },
      { id: 'nature-003', category: 'nature', word: 'canyon', difficulty: 10 },
    ];
    const g = createLoneLeafGame(banded, mulberry32(11));
    let scratch = g.configure(
      { categories: ['nature'], rounds: 1, difficultyMin: 4, difficultyMax: 6 },
      roster,
    ).scratch;
    scratch = g.startRound(ctx(1, 'collecting', scratch)).scratch;
    expect((scratch as { seed: { word: string } }).seed.word).toBe('meadow');
  });

  it('accepts and matches a multi-word proper-noun seed end to end', () => {
    const proper: LoneLeafSeed[] = [
      { id: 'historical-001', category: 'historical', word: 'albert einstein', difficulty: 2 },
    ];
    const g = createLoneLeafGame(proper, mulberry32(4));
    let scratch = g.configure(
      { categories: ['historical'], rounds: 1, difficultyMin: 1, difficultyMax: 10 },
      roster,
    ).scratch;
    scratch = g.startRound(ctx(1, 'collecting', scratch)).scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p2', 'physics').scratch;
    scratch = g.collectMove(ctx(1, 'collecting', scratch), 'p3', 'relativity').scratch;
    scratch = g.reveal(ctx(1, 'collecting', scratch)).scratch;
    // The Seeker types the name with different casing/spacing - it still resolves as correct.
    scratch = g.collectVote(ctx(1, 'guessing', scratch), {
      player: 'p1',
      target: 'Albert Einstein',
      agree: true,
    }).scratch;
    const resolved = g.resolveDecision!(ctx(1, 'guessing', scratch));
    expect((resolved.reveal as { correct: boolean }).correct).toBe(true);
    expect(resolved.scores).toHaveLength(3);
  });

  it('the plugin manifest is a 3-7 player public game (promoted from insider, spec 0073)', () => {
    expect(loneLeafPlugin.manifest.visibility).toBe('public');
    expect(loneLeafPlugin.manifest.capabilities?.minPlayers).toBe(3);
    expect(loneLeafPlugin.manifest.capabilities?.maxPlayers).toBe(7);
  });

  it('builds from the plugin with the shipped seed bank and runs a round', async () => {
    const built = await loneLeafPlugin.create(
      createTestServices({ rng: mulberry32(7), assets: createFsAssetLoaderFactory() }),
    );
    let scratch = built.configure({ categories: 'random', rounds: 2 }, roster).scratch;
    scratch = built.startRound(ctx(1, 'collecting', scratch)).scratch;
    // Round 2 rotates the Seeker to p2.
    scratch = built.startRound(ctx(2, 'collecting', scratch)).scratch;
    expect((scratch as { seeker: string }).seeker).toBe('p2');
  });
});
