// Full-lifecycle integration for Odd Bird. This drives the module by hand through the exact sequence
// the engine drives - configure -> startRound (deals the secret cards via `private`) -> collectMove
// (a flush call) -> allSubmitted -> reveal (opens the flush) -> collectVote (accusations + the odd
// bird's roost guess) -> allDecided -> resolveDecision -> leaderboard -> advance -> endGame - with a
// four-player table and a seeded rng, and builds the module via `oddBirdPlugin.create` so the injected
// asset loader (not disk) supplies the roosts. It reaches a scored terminal through the REAL round, not
// by hand-setting scratch, and proves the per-player secret is delivered only to each player.

import { describe, expect, it } from 'vitest';
import { createTestServices, mulberry32 } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import type { ScoreEvent, Standing } from '@branchout/protocol';
import {
  oddBirdPlugin,
  FLOCK_WIN_POINTS,
  ROOST_GUESS_PREFIX,
  type PrivateCard,
  type RoostOption,
} from './odd-bird';

function bankFiles(): Record<string, unknown> {
  return {
    'data/odd-bird/everyday.json': [
      {
        id: 'everyday-001',
        category: 'everyday',
        name: 'A busy coffee shop',
        perches: ['Barista', 'Regular', 'Newcomer', 'Baker', 'Manager', 'Courier', 'Inspector'],
      },
      {
        id: 'everyday-002',
        category: 'everyday',
        name: 'A public library',
        perches: ['Librarian', 'Student', 'Volunteer', 'Archivist', 'Napper', 'Clerk', 'Author'],
      },
    ],
    'data/odd-bird/outdoors.json': [],
    'data/odd-bird/travel.json': [],
    'data/odd-bird/events.json': [],
    'data/odd-bird/fantastical.json': [],
  };
}

const roster: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
  { player: 'p4', nickname: 'Di', connected: true },
];

describe('Odd Bird full game', () => {
  it('runs the whole lifecycle, delivers the secret privately, and flushes the odd bird', async () => {
    const game: GameModule = await oddBirdPlugin.create(
      createTestServices({ files: bankFiles(), rng: mulberry32(5) }),
    );

    const scores: Record<string, number> = { p1: 0, p2: 0, p3: 0, p4: 0 };
    const apply = (events: readonly ScoreEvent[]) => {
      for (const e of events) scores[e.player] = (scores[e.player] ?? 0) + e.points;
    };
    const ctx = (phase: RoundContext['phase'], scratch: Record<string, unknown>): RoundContext => ({
      room: 'r',
      game: 'odd-bird',
      phase,
      round: 1,
      players: roster,
      scores,
      scratch,
      config: {},
    });

    let scratch = game.configure({}, roster).scratch;

    // startRound deals the round and delivers each player's card ONLY to them (spec 0052).
    const started = game.startRound(ctx('collecting', scratch));
    scratch = started.scratch;
    const cards = started.private as Record<string, PrivateCard>;
    expect(Object.keys(cards).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    const oddBird = Object.keys(cards).find((id) => cards[id]!.role === 'odd-bird')!;
    // The broadcast prompt names no secret at all.
    const roost = Object.values(cards).find(
      (c): c is Extract<PrivateCard, { role: 'flock' }> => c.role === 'flock',
    )!.roost;
    expect(JSON.stringify(started.prompt)).not.toContain(roost);
    expect(JSON.stringify(started.prompt)).not.toContain(oddBird);

    // A flock member calls the flush, closing the question window.
    const flock = roster.map((p) => p.player).filter((id) => id !== oddBird);
    scratch = game.collectMove(ctx('collecting', scratch), flock[0]!, 'flush').scratch;
    expect(game.allSubmitted?.(ctx('collecting', scratch))).toBe(true);

    // reveal opens the flush and re-emits each secret card.
    const revealed = game.reveal(ctx('collecting', scratch));
    scratch = revealed.scratch;
    apply(revealed.scores);
    expect(revealed.decision?.windowMs).toBeGreaterThan(0);
    const revealPrivate = revealed.private as Record<string, PrivateCard>;
    expect(revealPrivate[oddBird]).toEqual({ role: 'odd-bird' });
    const options = (revealed.reveal as { roostOptions: RoostOption[] }).roostOptions;
    expect(options.length).toBeGreaterThan(1);

    // Every flock member accuses the odd bird; the odd bird guesses a wrong roost.
    for (const member of flock) {
      scratch = game.collectVote(ctx('guessing', scratch), {
        player: member,
        target: oddBird,
        agree: true,
      }).scratch;
    }
    const roostId = (scratch as { roost: { id: string } }).roost.id;
    const wrong = options.find((o) => o.id !== roostId)!;
    scratch = game.collectVote(ctx('guessing', scratch), {
      player: oddBird,
      target: `${ROOST_GUESS_PREFIX}${wrong.id}`,
      agree: true,
    }).scratch;
    expect(game.allDecided?.(ctx('guessing', scratch))).toBe(true);

    const resolved = game.resolveDecision!(ctx('guessing', scratch));
    scratch = resolved.scratch;
    apply(resolved.scores);
    expect((resolved.reveal as { flockWon: boolean }).flockWon).toBe(true);

    const board: Standing[] = game.leaderboard(ctx('leaderboard', scratch));
    expect(board).toHaveLength(4);
    expect(game.advance(ctx('leaderboard', scratch)).done).toBe(true);

    // Each flock member scored the win; the odd bird scored nothing.
    for (const member of flock) expect(scores[member]).toBe(FLOCK_WIN_POINTS);
    expect(scores[oddBird]).toBe(0);

    const final: Standing[] = game.endGame(ctx('complete', scratch));
    expect(final).toHaveLength(4);
    // The three flock members tie for the top rank; the odd bird trails last.
    const oddStanding = final.find((s) => s.player === oddBird)!;
    expect(oddStanding.rank).toBe(4);
    for (const member of flock) {
      expect(final.find((s) => s.player === member)!.rank).toBe(1);
    }
  });
});
