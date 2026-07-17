import { describe, expect, it } from 'vitest';
import { createTestServices, mulberry32 } from '@branchout/game-sdk/testing';
import type { GameModule, RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { bramblesPlugin, createBramblesGame, TICK_MS } from './brambles';
import type { BramblesCard } from './cards';
import { CATEGORIES } from './cards';
import type { BramblesSecret, BramblesSim } from './types';

// A deterministic mini bank: two nature cards, so a seeded rng draws them in a fixed order.
const BANK: BramblesCard[] = [
  {
    id: 'nature-001',
    category: 'nature',
    bloom: 'mountain',
    thorns: ['peak', 'climb', 'summit', 'high', 'range'],
  },
  {
    id: 'nature-002',
    category: 'nature',
    bloom: 'river',
    thorns: ['water', 'flow', 'stream', 'bank', 'boat'],
  },
  {
    id: 'nature-003',
    category: 'nature',
    bloom: 'ocean',
    thorns: ['sea', 'wave', 'salt', 'blue', 'deep'],
  },
];

// p1,p3 -> team 0 (Guide p1); p2,p4 -> team 1 (Guide p2).
const ROSTER: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
  { player: 'p4', nickname: 'Di', connected: true },
];

function ctx(
  scratch: Record<string, unknown>,
  overrides: Partial<RoundContext> = {},
): RoundContext {
  return {
    room: 'r',
    game: 'brambles',
    phase: 'collecting',
    round: 1,
    players: ROSTER,
    scores: {},
    scratch,
    config: {},
    ...overrides,
  };
}

function move(kind: 'clue' | 'guess' | 'skip', text?: string): string {
  return JSON.stringify({ kind, text });
}

function game(seed = 1): GameModule {
  return createBramblesGame(BANK, mulberry32(seed));
}

describe('configure', () => {
  it('assigns two teams by seat and starts a live game (rounds >= 1, no move window)', () => {
    const result = game().configure({ sprints: 2, sprintSeconds: 60 }, ROSTER);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.moveWindowMs ?? 0).toBe(0); // live: no move-window timer
  });

  it('rejects a config where a team would be empty', () => {
    const solo: SessionPlayer[] = [{ player: 'p1', nickname: 'Ada', connected: true }];
    expect(() => game().configure({ sprints: 2, sprintSeconds: 60 }, solo)).toThrow(
      /two players per team/,
    );
  });
});

describe('startRound + private secrecy (spec 0052)', () => {
  it('delivers the bloom + thorns ONLY to the active teams Guide - no one else', () => {
    const g = game();
    const scratch = g.configure({ sprints: 2, sprintSeconds: 60 }, ROSTER).scratch;
    const start = g.startRound(ctx(scratch));

    // Sprint 1 -> team 0, Guide p1. Only p1 is a key in the private map.
    expect(Object.keys(start.private ?? {})).toEqual(['p1']);
    const secret = (start.private as Record<string, BramblesSecret>).p1!;
    expect(secret.bloom).toBeTruthy();
    expect(secret.thorns).toHaveLength(5);

    // The opposing team (p2, p4) and the guessing teammate (p3) receive NOTHING private.
    expect(start.private).not.toHaveProperty('p2');
    expect(start.private).not.toHaveProperty('p3');
    expect(start.private).not.toHaveProperty('p4');

    // And the BROADCAST prompt (the sim) never carries the bloom or thorns.
    const sim = start.prompt as BramblesSim;
    expect(JSON.stringify(sim)).not.toContain(secret.bloom);
    for (const thorn of secret.thorns) {
      expect(JSON.stringify(sim)).not.toContain(thorn);
    }
    expect(sim.guide).toBe('p1');
    expect(sim.activeTeam).toBe(0);
  });

  it('the tick re-delivers the secret ONLY to the current Guide, and never broadcasts it', () => {
    const g = game();
    const scratch = g.configure({ sprints: 2, sprintSeconds: 60 }, ROSTER).scratch;
    const started = g.startRound(ctx(scratch)).scratch;
    const t = g.tick!(ctx(started));
    expect(Object.keys(t.private ?? {})).toEqual(['p1']);
    const secret = (t.private as Record<string, BramblesSecret>).p1!;
    // The broadcast sim never leaks it.
    expect(JSON.stringify(t.sim)).not.toContain(secret.bloom);
  });
});

describe('collectMove - the auto-referee and scoring', () => {
  function afterStart(seed = 1) {
    const g = game(seed);
    const scratch = g.configure({ sprints: 2, sprintSeconds: 60 }, ROSTER).scratch;
    // Read scratch AND the secret from the SAME startRound call (the rng is stateful, so a second
    // call would draw a different card and the secret would not match `started`).
    const start = g.startRound(ctx(scratch));
    const started = start.scratch;
    const secret = (start.private as Record<string, BramblesSecret>).p1!;
    return { g, started, secret };
  }

  it('scores a bloom on a fuzzy guess from a teammate and draws the next card', () => {
    const { g, started, secret } = afterStart();
    const res = g.collectMove(ctx(started), 'p3', move('guess', secret.bloom));
    expect(res.rejected).toBeUndefined();
    const sim = g.tick!(ctx(res.scratch)).sim as BramblesSim;
    expect(sim.teamScores[0]).toBe(1);
    expect(sim.bloomsThisSprint).toBe(1);
  });

  it('pricks the card when the Guides clue contains the bloom (no point, new card)', () => {
    const { g, started, secret } = afterStart();
    const res = g.collectMove(ctx(started), 'p1', move('clue', `a big ${secret.bloom}`));
    expect(res.rejected?.reason).toMatch(/pricked/);
    const sim = g.tick!(ctx(res.scratch)).sim as BramblesSim;
    expect(sim.pricksThisSprint).toBe(1);
    expect(sim.teamScores[0]).toBe(0);
  });

  it('accepts a clean clue and shows it in the public log', () => {
    const { g, started } = afterStart();
    const res = g.collectMove(ctx(started), 'p1', move('clue', 'it is very tall and rocky'));
    expect(res.rejected).toBeUndefined();
    const sim = g.tick!(ctx(res.scratch)).sim as BramblesSim;
    expect(sim.log.some((e) => e.kind === 'clue' && e.text === 'it is very tall and rocky')).toBe(
      true,
    );
  });

  it('lets the Guide skip a card (no point, new card)', () => {
    const { g, started } = afterStart();
    const res = g.collectMove(ctx(started), 'p1', move('skip'));
    expect(res.rejected).toBeUndefined();
    const sim = g.tick!(ctx(res.scratch)).sim as BramblesSim;
    expect(sim.log.some((e) => e.kind === 'skip')).toBe(true);
  });

  it('rejects a move from the opposing team', () => {
    const { g, started } = afterStart();
    const res = g.collectMove(ctx(started), 'p2', move('guess', 'mountain'));
    expect(res.rejected?.reason).toMatch(/not your grove/);
  });

  it('rejects a clue from a non-Guide teammate', () => {
    const { g, started } = afterStart();
    const res = g.collectMove(ctx(started), 'p3', move('clue', 'tall thing'));
    expect(res.rejected?.reason).toMatch(/only the Guide/);
  });

  it('rejects the Guide guessing their own card', () => {
    const { g, started, secret } = afterStart();
    const res = g.collectMove(ctx(started), 'p1', move('guess', secret.bloom));
    expect(res.rejected?.reason).toMatch(/cannot guess/);
  });

  it('a wrong guess is a quiet miss (no score, no reject)', () => {
    const { g, started } = afterStart();
    const res = g.collectMove(ctx(started), 'p3', move('guess', 'zzzzz'));
    expect(res.rejected).toBeUndefined();
    const sim = g.tick!(ctx(res.scratch)).sim as BramblesSim;
    expect(sim.teamScores[0]).toBe(0);
  });
});

describe('tick - sprint timer close and team handoff', () => {
  it('closes the sprint on the timer and hands off to the other team, then ends the game', () => {
    const g = game();
    // 2 sprints at the 30s minimum, then override sprintSeconds in scratch to a tiny window so the
    // test can run out the clock quickly (configure enforces a 30s floor; the tick math is what we
    // are exercising here).
    const scratch = g.configure({ sprints: 2, sprintSeconds: 30 }, ROSTER).scratch;
    const shortWindow = 1;
    let s = g.startRound(ctx({ ...scratch, sprintSeconds: shortWindow })).scratch;
    s = { ...s, sprintSeconds: shortWindow };

    const ticksPerSprint = Math.round((shortWindow * 1000) / TICK_MS);

    // Sprint 1 -> team 0, Guide p1.
    let sim = g.tick!(ctx(s)).sim as BramblesSim;
    expect(sim.sprint).toBe(1);
    expect(sim.guide).toBe('p1');

    // Run out sprint 1's clock; the next tick opens sprint 2 -> team 1, Guide p2.
    let last = g.tick!(ctx(s));
    for (let i = 0; i < ticksPerSprint + 1; i++) last = g.tick!(ctx(last.scratch));
    sim = last.sim as BramblesSim;
    expect(sim.sprint).toBe(2);
    expect(sim.guide).toBe('p2');
    expect(sim.activeTeam).toBe(1);
    // The new Guide (p2) now holds the secret; p1 does not.
    expect(Object.keys(last.private ?? {})).toEqual(['p2']);

    // Run out sprint 2's clock; the game ends.
    for (let i = 0; i < ticksPerSprint + 2; i++) last = g.tick!(ctx(last.scratch));
    expect(last.over).toBe(true);
    expect((last.sim as BramblesSim).over).toBe(true);
  });
});

describe('endGame + leaderboard - team result to per-player standings', () => {
  it('ranks the higher-scoring teams members together at the top, reached through real play', () => {
    const g = game();
    const scratch = g.configure({ sprints: 2, sprintSeconds: 60 }, ROSTER).scratch;
    const start = g.startRound(ctx(scratch));
    let s = start.scratch;

    // Team 0 (Guide p1) scores a bloom via teammate p3, using THIS sprint's secret.
    const secret1 = (start.private as Record<string, BramblesSecret>).p1!;
    s = g.collectMove(ctx(s), 'p3', move('guess', secret1.bloom)).scratch;

    const standings = g.endGame(ctx(s));
    const rankOf = Object.fromEntries(standings.map((x) => [x.player, x.rank]));
    // Team 0 (p1, p3) is ahead; both share rank 1. Team 1 (p2, p4) share rank 3.
    expect(rankOf.p1).toBe(1);
    expect(rankOf.p3).toBe(1);
    expect(rankOf.p2).toBe(3);
    expect(rankOf.p4).toBe(3);
  });
});

describe('plugin.create + manifest', () => {
  it('loads and validates a bank through the factory without throwing', async () => {
    // Feed the plugin an in-memory bank (the disk resolution is covered by card-bank.test.ts).
    const files: Record<string, unknown> = {};
    for (const c of CATEGORIES) files[`data/brambles/${c}.json`] = [];
    files['data/brambles/nature.json'] = BANK;
    const module = await bramblesPlugin.create(createTestServices({ files, rng: mulberry32(3) }));
    expect(module.id).toBe('brambles');
    // Sanity: it can configure + start a real sprint and deal a secret to the Guide.
    const scratch = module.configure({ sprints: 2, sprintSeconds: 60 }, ROSTER).scratch;
    const start = module.startRound(ctx(scratch));
    expect(Object.keys(start.private ?? {})).toEqual(['p1']);
  });

  it('the manifest is insider with a 4-player minimum', () => {
    expect(bramblesPlugin.manifest.visibility).toBe('insider');
    expect(bramblesPlugin.manifest.capabilities?.minPlayers).toBe(4);
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });
});
