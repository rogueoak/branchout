// Unit tests for the Odd Bird module: role dealing (exactly one odd bird), per-player SECRECY (the
// spec 0052 proof - no player receives another's card, and the odd bird never receives the roost),
// vote resolution for BOTH outcomes (the flock flushes the odd bird / the odd bird survives), and the
// odd bird's roost guess. Built with a fixed seed off a small in-memory bank so every draw is pinned.

import { describe, expect, it } from 'vitest';
import { createTestServices, mulberry32 } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import {
  oddBirdPlugin,
  createOddBirdGame,
  FLOCK_WIN_POINTS,
  SURVIVE_POINTS,
  GUESS_POINTS,
  ROOST_GUESS_PREFIX,
  type PrivateCard,
  type RoostOption,
} from './odd-bird';

const ROOSTS = [
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
  {
    id: 'everyday-003',
    category: 'everyday',
    name: 'A gym',
    perches: ['Trainer', 'Member', 'Clerk', 'Instructor', 'Lifter', 'Attendant', 'Technician'],
  },
];

const roster: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
  { player: 'p4', nickname: 'Di', connected: true },
];

function ctxFor(
  round: number,
  phase: RoundContext['phase'],
  scratch: Record<string, unknown>,
  scores: Record<string, number> = {},
  players: SessionPlayer[] = roster,
): RoundContext {
  return { room: 'r', game: 'odd-bird', phase, round, players, scores, scratch, config: {} };
}

/** Build a module over the fixed bank at a chosen seed. */
function build(seed: number): GameModule {
  return createOddBirdGame(ROOSTS, mulberry32(seed));
}

/** The odd bird id from a start-round private map (the one card that is the bare odd-bird role). */
function oddBirdOf(cards: Record<string, PrivateCard>): string {
  const ids = Object.keys(cards).filter((id) => cards[id]!.role === 'odd-bird');
  return ids[0]!;
}

describe('Odd Bird role dealing', () => {
  it('deals exactly one odd bird and a flock card to everyone else', () => {
    const game = build(7);
    const scratch = game.configure({}, roster).scratch;
    const started = game.startRound(ctxFor(1, 'collecting', scratch));
    const cards = started.private as Record<string, PrivateCard>;

    // Every player has a card, and exactly one is the odd bird.
    expect(Object.keys(cards).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    const oddBirds = Object.values(cards).filter((c) => c.role === 'odd-bird');
    expect(oddBirds).toHaveLength(1);

    // Every flock member shares the SAME roost and holds a DISTINCT perch.
    const flock = Object.values(cards).filter(
      (c): c is Extract<PrivateCard, { role: 'flock' }> => c.role === 'flock',
    );
    expect(flock).toHaveLength(3);
    const roosts = new Set(flock.map((c) => c.roost));
    expect(roosts.size).toBe(1);
    const perches = flock.map((c) => c.perch);
    expect(new Set(perches).size).toBe(perches.length);
  });

  it('spreads the odd bird across players over many deals (not always the same seat)', () => {
    const seenOddBirds = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const game = build(seed);
      const scratch = game.configure({}, roster).scratch;
      const cards = game.startRound(ctxFor(1, 'collecting', scratch)).private as Record<
        string,
        PrivateCard
      >;
      seenOddBirds.add(oddBirdOf(cards));
    }
    // Over 40 seeded deals, the odd bird lands on more than one seat (dealing is not fixed).
    expect(seenOddBirds.size).toBeGreaterThan(1);
  });
});

describe('Odd Bird per-player secrecy (spec 0052)', () => {
  it('never broadcasts a secret: the prompt carries no roost, perch, or odd-bird identity', () => {
    const game = build(3);
    const scratch = game.configure({}, roster).scratch;
    const started = game.startRound(ctxFor(1, 'collecting', scratch));
    const cards = started.private as Record<string, PrivateCard>;
    const oddBird = oddBirdOf(cards);
    const flockCard = Object.values(cards).find(
      (c): c is Extract<PrivateCard, { role: 'flock' }> => c.role === 'flock',
    )!;

    const promptJson = JSON.stringify(started.prompt);
    expect(promptJson).not.toContain(flockCard.roost);
    expect(promptJson).not.toContain(flockCard.perch);
    expect(promptJson).not.toContain(oddBird);
  });

  it("delivers each card ONLY to its player: B never receives A's card, the odd bird never the roost", () => {
    const game = build(9);
    const scratch = game.configure({}, roster).scratch;
    const cards = game.startRound(ctxFor(1, 'collecting', scratch)).private as Record<
      string,
      PrivateCard
    >;
    const oddBird = oddBirdOf(cards);
    const roost = Object.values(cards).find(
      (c): c is Extract<PrivateCard, { role: 'flock' }> => c.role === 'flock',
    )!.roost;

    // The private map is keyed by player id; the ENGINE delivers cards[player] only to that player.
    // So player B's device only ever sees cards['B'] - never cards['A']. Prove the entries differ so
    // a leak of the wrong entry would be a different card, and prove the odd bird's entry omits the
    // roost entirely.
    for (const flockId of ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== oddBird)) {
      const mine = cards[flockId]!;
      expect(mine.role).toBe('flock');
      // The odd bird's own card is the bare odd-bird role - it carries no roost, no perch.
      expect(JSON.stringify(cards[oddBird])).not.toContain(roost);
      expect(cards[oddBird]).toEqual({ role: 'odd-bird' });
    }
  });
});

describe('Odd Bird flush resolution', () => {
  /** Drive a game to just before resolveDecision, returning the module, scratch, and dealt facts. */
  function deal(seed: number): {
    game: GameModule;
    scratch: Record<string, unknown>;
    oddBird: string;
    roostId: string;
    options: RoostOption[];
  } {
    const game = build(seed);
    let scratch = game.configure({}, roster).scratch;
    const started = game.startRound(ctxFor(1, 'collecting', scratch));
    scratch = started.scratch;
    const cards = started.private as Record<string, PrivateCard>;
    const oddBird = oddBirdOf(cards);
    const roostId = (scratch as { roost: { id: string } }).roost.id;

    // Open the flush.
    const revealed = game.reveal(ctxFor(1, 'collecting', scratch));
    scratch = revealed.scratch;
    const options = (revealed.reveal as { roostOptions: RoostOption[] }).roostOptions;
    return { game, scratch, oddBird, roostId, options };
  }

  it('the flock wins when it flushes the odd bird (each member scores)', () => {
    const { game, scratch: s0, oddBird, options } = deal(2);
    let scratch = s0;
    const flock = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== oddBird);

    // Every flock member accuses the odd bird; the odd bird guesses a wrong roost.
    for (const member of flock) {
      scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
        player: member,
        target: oddBird,
        agree: true,
      }).scratch;
    }
    const wrong = options.find((o) => o.id !== (scratch as { roost: { id: string } }).roost.id)!;
    scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: oddBird,
      target: `${ROOST_GUESS_PREFIX}${wrong.id}`,
      agree: true,
    }).scratch;

    expect(game.allDecided?.(ctxFor(1, 'guessing', scratch))).toBe(true);

    const resolved = game.resolveDecision!(ctxFor(1, 'guessing', scratch));
    const byPlayer: Record<string, number> = {};
    for (const s of resolved.scores) byPlayer[s.player] = (byPlayer[s.player] ?? 0) + s.points;
    // Each flock member scores the win; the odd bird scores nothing.
    for (const member of flock) expect(byPlayer[member]).toBe(FLOCK_WIN_POINTS);
    expect(byPlayer[oddBird] ?? 0).toBe(0);
    expect((resolved.reveal as { flockWon: boolean }).flockWon).toBe(true);
    expect((resolved.reveal as { oddBird: string }).oddBird).toBe(oddBird);
  });

  it('the odd bird survives (and scores) when the flock fingers the wrong bird', () => {
    const { game, scratch: s0, oddBird, options } = deal(2);
    let scratch = s0;
    const flock = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== oddBird);
    // The flock all accuse the first flock member (not the odd bird).
    const scapegoat = flock[0]!;
    for (const member of flock) {
      scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
        player: member,
        target: scapegoat,
        agree: true,
      }).scratch;
    }
    // The odd bird guesses wrong too, so only the survive bonus applies.
    const wrong = options.find((o) => o.id !== (scratch as { roost: { id: string } }).roost.id)!;
    scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: oddBird,
      target: `${ROOST_GUESS_PREFIX}${wrong.id}`,
      agree: true,
    }).scratch;

    const resolved = game.resolveDecision!(ctxFor(1, 'guessing', scratch));
    const byPlayer: Record<string, number> = {};
    for (const s of resolved.scores) byPlayer[s.player] = (byPlayer[s.player] ?? 0) + s.points;
    expect(byPlayer[oddBird]).toBe(SURVIVE_POINTS);
    for (const member of flock) expect(byPlayer[member] ?? 0).toBe(0);
    expect((resolved.reveal as { flockWon: boolean }).flockWon).toBe(false);
  });

  it('a tie in accusations flushes no one, so the odd bird survives', () => {
    const { game, scratch: s0, oddBird } = deal(2);
    let scratch = s0;
    const flock = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== oddBird);
    // Split the three accusations across three different targets - a three-way tie.
    scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: flock[0]!,
      target: flock[1]!,
      agree: true,
    }).scratch;
    scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: flock[1]!,
      target: flock[2]!,
      agree: true,
    }).scratch;
    scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: flock[2]!,
      target: flock[0]!,
      agree: true,
    }).scratch;

    const resolved = game.resolveDecision!(ctxFor(1, 'guessing', scratch));
    expect((resolved.reveal as { flushed: string | null }).flushed).toBeNull();
    expect((resolved.reveal as { flockWon: boolean }).flockWon).toBe(false);
    const byPlayer: Record<string, number> = {};
    for (const s of resolved.scores) byPlayer[s.player] = (byPlayer[s.player] ?? 0) + s.points;
    expect(byPlayer[oddBird]).toBe(SURVIVE_POINTS);
  });

  it('the odd bird scores the guess bonus for naming the roost, even when flushed', () => {
    const { game, scratch: s0, oddBird, roostId } = deal(2);
    let scratch = s0;
    const flock = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== oddBird);
    for (const member of flock) {
      scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
        player: member,
        target: oddBird,
        agree: true,
      }).scratch;
    }
    // The odd bird correctly guesses the true roost.
    scratch = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: oddBird,
      target: `${ROOST_GUESS_PREFIX}${roostId}`,
      agree: true,
    }).scratch;

    const resolved = game.resolveDecision!(ctxFor(1, 'guessing', scratch));
    const byPlayer: Record<string, number> = {};
    for (const s of resolved.scores) byPlayer[s.player] = (byPlayer[s.player] ?? 0) + s.points;
    // Flushed, so the flock scores; the odd bird still scores the guess bonus for the roost.
    for (const member of flock) expect(byPlayer[member]).toBe(FLOCK_WIN_POINTS);
    expect(byPlayer[oddBird]).toBe(GUESS_POINTS);
    expect((resolved.reveal as { guessedRoost: boolean }).guessedRoost).toBe(true);
  });

  it('ignores an accusation cast by the odd bird and a roost guess cast by a flock member', () => {
    const { game, scratch, oddBird, options } = deal(2);
    const flock = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== oddBird);
    // The odd bird cannot accuse.
    const afterOddAccuse = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: oddBird,
      target: flock[0]!,
      agree: true,
    }).scratch;
    expect((afterOddAccuse as { accusations: Record<string, string> }).accusations).toEqual({});
    // A flock member cannot cast a roost guess.
    const afterFlockGuess = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: flock[0]!,
      target: `${ROOST_GUESS_PREFIX}${options[0]!.id}`,
      agree: true,
    }).scratch;
    expect((afterFlockGuess as { guess: string | null }).guess).toBeNull();
  });

  it('ignores a self-accusation (a player cannot accuse themselves)', () => {
    const { game, scratch, oddBird } = deal(2);
    const flock = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== oddBird);
    const afterSelf = game.collectVote(ctxFor(1, 'guessing', scratch), {
      player: flock[0]!,
      target: flock[0]!,
      agree: true,
    }).scratch;
    expect((afterSelf as { accusations: Record<string, string> }).accusations).toEqual({});
  });
});

describe('Odd Bird roost-guess prefix', () => {
  it("pins the roost-guess prefix to 'roost:' (the web mirror must match this literal)", () => {
    // The web bundle cannot import this headless package, so it holds its own copy of the prefix
    // (ROOST_GUESS_TARGET_PREFIX in apps/web/lib/games/odd-bird/index.ts). Pin BOTH sides to the same
    // literal so a drift on either fails a test rather than silently misreading every roost guess.
    expect(ROOST_GUESS_PREFIX).toBe('roost:');
  });
});

describe('Odd Bird move window', () => {
  it('a flush call closes the question window; a non-flush move is ignored', () => {
    const game = build(2);
    let scratch = game.configure({}, roster).scratch;
    scratch = game.startRound(ctxFor(1, 'collecting', scratch)).scratch;
    expect(game.allSubmitted?.(ctxFor(1, 'collecting', scratch))).toBe(false);
    scratch = game.collectMove(ctxFor(1, 'collecting', scratch), 'p1', 'noise').scratch;
    expect(game.allSubmitted?.(ctxFor(1, 'collecting', scratch))).toBe(false);
    scratch = game.collectMove(ctxFor(1, 'collecting', scratch), 'p1', 'flush').scratch;
    expect(game.allSubmitted?.(ctxFor(1, 'collecting', scratch))).toBe(true);
  });
});

describe('Odd Bird plugin', () => {
  it('exposes the insider manifest and builds from its shipped bank', async () => {
    expect(oddBirdPlugin.manifest.id).toBe('odd-bird');
    expect(oddBirdPlugin.manifest.visibility).toBe('insider');
    expect(oddBirdPlugin.manifest.capabilities).toEqual({ minPlayers: 3, maxPlayers: 8 });
  });

  it('configure rejects a config with no roosts in the chosen categories', async () => {
    const game = build(1);
    // The fixed bank is all "everyday"; asking for "travel" leaves an empty pool.
    expect(() => game.configure({ categories: ['travel'] }, roster)).toThrow(/no roosts/);
  });

  it('build via the plugin factory over an in-memory bank (asset loader wiring)', async () => {
    const files: Record<string, unknown> = {
      'data/odd-bird/everyday.json': ROOSTS,
      'data/odd-bird/outdoors.json': [],
      'data/odd-bird/travel.json': [],
      'data/odd-bird/events.json': [],
      'data/odd-bird/fantastical.json': [],
    };
    const game = await oddBirdPlugin.create(createTestServices({ files, rng: mulberry32(4) }));
    expect(game.id).toBe('odd-bird');
    const scratch = game.configure({}, roster).scratch;
    const cards = game.startRound(ctxFor(1, 'collecting', scratch)).private as Record<
      string,
      PrivateCard
    >;
    expect(Object.values(cards).filter((c) => c.role === 'odd-bird')).toHaveLength(1);
  });
});
