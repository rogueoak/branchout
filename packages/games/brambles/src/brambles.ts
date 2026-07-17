// The Brambles game module (spec 0061). Brambles is a two-team, forbidden-words describing game,
// built on the LIVE lifecycle (spec 0044): the whole game sits in one continuous `collecting` phase
// and the engine steps `tick` on a fixed cadence, streaming a `sim` snapshot of the current sprint.
// A round-based shape cannot fit this game - the Guide's clues must reach the guessing teammates in
// real time and a new card's secret must reach the Guide mid-sprint, and only `tick` streams `sim`
// AND re-delivers a per-player `private` payload every frame (spec 0052).
//
// How a sprint plays:
//   - One TEAM is on the clock for a timed sprint (one team turn). Teams alternate each sprint.
//   - That team's GUIDE alone receives the current card's bloom (target) + thorns (forbidden words)
//     via a targeted `private` frame - the opposing team and even the guessing teammates never get it.
//   - The Guide types CLUES. The engine auto-referees each clue: if it contains the bloom, a thorn,
//     or an obvious variant (a shared stem - a "near-stem"), the card is PRICKED (burned, no point)
//     and the next card is drawn (its new secret re-delivered to the Guide on the next tick).
//   - Teammates type GUESSES. The engine fuzzy-matches each guess against the bloom; a match scores
//     the team +1 and draws the next card. The Guide may SKIP a card (draws the next, no point).
//   - When the sprint timer runs out the turn passes to the other team's Guide with a fresh card.
//   - After all sprints, the team with the most blooms wins; every member shares the team's rank.
//
// State is fully serializable in `scratch` (no in-process world), so a reconnect / engine restart
// rebuilds from the snapshot and `disposeLive` is omitted (build kit: live board state is
// serializable -> no-op disposeLive).

import type { Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  GamePlugin,
  LiveTickResult,
  RevealResult,
  RoundContext,
  ScratchResult,
  SessionPlayer,
  StartRoundResult,
} from '@branchout/game-sdk';
import { loadCardBank, validateCardBank, type BramblesCard } from './cards';
import { DEFAULT_SPRINTS, validateConfig, type ResolvedBramblesConfig } from './config';
import { findPrick, isGuessMatch } from './matching';
import {
  activeTeamForSprint,
  assignTeams,
  guideOf,
  teamStandings,
  TEAM_NAMES,
  type TeamId,
} from './teams';
import type { BramblesLogEntry, BramblesMove, BramblesSim, TeamIndex } from './types';

export const BRAMBLES_GAME_ID = 'brambles';

/** The engine's live sim cadence (ms per tick), mirrored here to convert the sprint timer to seconds. */
export const TICK_MS = 40;

/** Cap the public log so a long sprint's snapshot stays bounded (most recent kept). */
const MAX_LOG = 12;

/** The module's persisted state - the full serializable game snapshot. */
interface BramblesScratch {
  /** Total sprints (team turns) across the game. */
  totalSprints: number;
  /** Seconds each sprint lasts. */
  sprintSeconds: number;
  /** playerId -> team index (0 or 1). */
  teamOf: Record<string, TeamId>;
  /** Ordered member lists per team; index 0 of each is that team's Guide. */
  members: [string[], string[]];
  /** Blooms scored by each team across the game: [team0, team1]. */
  teamScores: [number, number];
  /** The 1-indexed sprint in progress (0 before the first tick opens sprint 1). */
  sprint: number;
  /** Ticks elapsed in the current sprint (drives the countdown; frozen while paused with the loop). */
  sprintTicks: number;
  /** Ids of every card drawn so far this game - the no-repeat guarantee. */
  usedIds: string[];
  /** The current card the Guide is describing, or null between sprints / at game end. */
  card: BramblesCard | null;
  /** Blooms scored in the current sprint. */
  bloomsThisSprint: number;
  /** Cards pricked in the current sprint. */
  pricksThisSprint: number;
  /** The running public clue/guess/prick log for the current sprint. */
  log: BramblesLogEntry[];
  /** True once every sprint has been played - the game is over. */
  over: boolean;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): BramblesScratch {
  const s = scratch as Partial<BramblesScratch>;
  return {
    totalSprints: s.totalSprints ?? DEFAULT_SPRINTS,
    sprintSeconds: s.sprintSeconds ?? 60,
    teamOf: s.teamOf ?? {},
    members: s.members ?? [[], []],
    teamScores: s.teamScores ?? [0, 0],
    sprint: s.sprint ?? 0,
    sprintTicks: s.sprintTicks ?? 0,
    usedIds: s.usedIds ?? [],
    card: s.card ?? null,
    bloomsThisSprint: s.bloomsThisSprint ?? 0,
    pricksThisSprint: s.pricksThisSprint ?? 0,
    log: s.log ?? [],
    over: s.over ?? false,
  };
}

/** Deep clone so a mutation never leaks back into the engine's persisted state. */
function clone(scratch: BramblesScratch): BramblesScratch {
  return JSON.parse(JSON.stringify(scratch)) as BramblesScratch;
}

function toRecord(scratch: BramblesScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** The active team for the current sprint (0 or 1). */
function activeTeam(scratch: BramblesScratch): TeamId {
  return activeTeamForSprint(scratch.sprint);
}

/** The active team's Guide (player id), or '' if the team is empty. */
function activeGuide(scratch: BramblesScratch): string {
  return guideOf(scratch.members[activeTeam(scratch)]) ?? '';
}

/** Ticks that make up one sprint at the current cadence. */
function ticksPerSprint(scratch: BramblesScratch): number {
  return Math.max(1, Math.round((scratch.sprintSeconds * 1000) / TICK_MS));
}

/** Whole seconds left in the current sprint. */
function secondsLeft(scratch: BramblesScratch): number {
  const remaining = ticksPerSprint(scratch) - scratch.sprintTicks;
  return Math.max(0, Math.ceil((remaining * TICK_MS) / 1000));
}

/** Append a log entry, keeping only the most recent {@link MAX_LOG}. */
function pushLog(scratch: BramblesScratch, entry: BramblesLogEntry): void {
  scratch.log.push(entry);
  if (scratch.log.length > MAX_LOG) scratch.log = scratch.log.slice(-MAX_LOG);
}

export function createBramblesGame(
  bank: readonly BramblesCard[],
  rng: () => number = Math.random,
): GameModule {
  /** Draw one unused card, or null if the bank is exhausted (a huge game on a tiny sample). */
  function drawCard(scratch: BramblesScratch): BramblesCard | null {
    const used = new Set(scratch.usedIds);
    const pool = bank.filter((c) => !used.has(c.id));
    if (pool.length === 0) return null;
    return pool[Math.floor(rng() * pool.length)] ?? null;
  }

  /** Draw the next card into the current sprint (marks it used), or null when the bank runs dry. */
  function nextCard(scratch: BramblesScratch): BramblesCard | null {
    const card = drawCard(scratch);
    if (card) scratch.usedIds.push(card.id);
    scratch.card = card;
    return card;
  }

  /** Open a fresh sprint: bump the sprint number, reset its counters, draw the first card. */
  function openSprint(scratch: BramblesScratch): void {
    scratch.sprint += 1;
    scratch.sprintTicks = 0;
    scratch.bloomsThisSprint = 0;
    scratch.pricksThisSprint = 0;
    scratch.log = [];
    nextCard(scratch);
  }

  /** The per-player private payload map for THIS tick: only the active Guide gets the secret. */
  function privateForGuide(scratch: BramblesScratch): Record<string, unknown> {
    const guide = activeGuide(scratch);
    if (!scratch.card || guide === '') return {};
    return { [guide]: { bloom: scratch.card.bloom, thorns: scratch.card.thorns } };
  }

  /** Build the broadcast sim snapshot - NEVER carries the bloom or thorns. */
  function toSim(scratch: BramblesScratch): BramblesSim {
    return {
      over: scratch.over,
      sprint: scratch.sprint,
      totalSprints: scratch.totalSprints,
      activeTeam: activeTeam(scratch) as TeamIndex,
      guide: activeGuide(scratch),
      teamScores: [scratch.teamScores[0], scratch.teamScores[1]],
      bloomsThisSprint: scratch.bloomsThisSprint,
      pricksThisSprint: scratch.pricksThisSprint,
      secondsLeft: secondsLeft(scratch),
      log: scratch.log,
    };
  }

  return {
    id: BRAMBLES_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      const cfg = validateConfig(config);
      const { teamOf, members } = assignTeams(players);
      // Both teams need at least one member (a Guide); the manifest also gates minPlayers: 4.
      if (members[0].length === 0 || members[1].length === 0) {
        throw new Error('brambles needs at least two players per team');
      }
      const scratch: BramblesScratch = {
        totalSprints: cfg.sprints,
        sprintSeconds: cfg.sprintSeconds,
        teamOf,
        members,
        teamScores: [0, 0],
        sprint: 0,
        sprintTicks: 0,
        usedIds: [],
        card: null,
        bloomsThisSprint: 0,
        pricksThisSprint: 0,
        log: [],
        over: false,
      };
      // rounds is a formality for a live game (the sim loop drives it); keep it >= 1.
      return { scratch: toRecord(scratch), rounds: 1 };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      // A live game opens once into `collecting`; open the first sprint here so the initial prompt +
      // the Guide's first secret are ready before the sim loop begins.
      const scratch = clone(asScratch(ctx.scratch));
      openSprint(scratch);
      const sim = toSim(scratch);
      return {
        scratch: toRecord(scratch),
        prompt: sim,
        private: privateForGuide(scratch),
      };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const current = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      if (current.over || !current.card) return { scratch: unchanged };

      const parsed = parseMove(move);
      if (!parsed) return { scratch: unchanged, rejected: { reason: 'enter a clue or guess' } };

      const team = activeTeam(current);
      const guide = activeGuide(current);
      const onActiveTeam = current.teamOf[player] === team;

      // Only the active team may act this sprint; the opposing team is a silent audience.
      if (!onActiveTeam) {
        return { scratch: unchanged, rejected: { reason: 'it is not your grove on the clock' } };
      }

      const scratch = clone(current);

      if (parsed.kind === 'skip') {
        // Only the Guide may skip a card.
        if (player !== guide) {
          return { scratch: unchanged, rejected: { reason: 'only the Guide can skip' } };
        }
        pushLog(scratch, { kind: 'skip', text: 'skipped the card', player });
        nextCard(scratch);
        return { scratch: toRecord(scratch) };
      }

      const text = (parsed.text ?? '').trim();
      if (text.length === 0) {
        return { scratch: unchanged, rejected: { reason: 'enter a clue or guess' } };
      }

      if (parsed.kind === 'clue') {
        // Only the Guide may give clues.
        if (player !== guide) {
          return { scratch: unchanged, rejected: { reason: 'only the Guide can give clues' } };
        }
        const pricked = findPrick(text, scratch.card!.bloom, scratch.card!.thorns);
        if (pricked) {
          // A prick burns the card: no point, draw the next one. The offending word is NOT echoed to
          // the log (it would leak the secret to the guessing team); the Guide sees the reject reason.
          scratch.pricksThisSprint += 1;
          pushLog(scratch, { kind: 'prick', text: 'a thorn was touched - card wilts', player });
          nextCard(scratch);
          return {
            scratch: toRecord(scratch),
            rejected: { reason: 'that clue pricked a thorn - new card drawn' },
          };
        }
        // A clean clue is shown to everyone so the team can guess on it.
        pushLog(scratch, { kind: 'clue', text, player });
        return { scratch: toRecord(scratch) };
      }

      // A guess (from a teammate who is NOT the Guide).
      if (player === guide) {
        return {
          scratch: unchanged,
          rejected: { reason: 'the Guide cannot guess their own card' },
        };
      }
      if (isGuessMatch(text, scratch.card!.bloom)) {
        scratch.bloomsThisSprint += 1;
        scratch.teamScores[team] += 1;
        pushLog(scratch, { kind: 'guess', text: scratch.card!.bloom, player });
        nextCard(scratch);
        return { scratch: toRecord(scratch) };
      }
      // A wrong guess is a quiet miss (kept out of the log to avoid clutter); nothing changes.
      return { scratch: unchanged };
    },

    tick(ctx: RoundContext): LiveTickResult {
      const scratch = clone(asScratch(ctx.scratch));

      if (scratch.over) {
        return { scratch: toRecord(scratch), sim: toSim(scratch), over: true };
      }

      // Advance the sprint clock by one tick.
      scratch.sprintTicks += 1;

      // A dried-up bank ends the sprint early (a huge game on a tiny sample); otherwise the timer.
      const timeUp = scratch.sprintTicks >= ticksPerSprint(scratch);
      const exhausted = scratch.card === null;

      if (timeUp || exhausted) {
        if (scratch.sprint >= scratch.totalSprints) {
          // The final sprint just ended: the game is over.
          scratch.over = true;
          scratch.card = null;
          return {
            scratch: toRecord(scratch),
            sim: toSim(scratch),
            over: true,
          };
        }
        // Hand off to the next team's sprint with a fresh card + secret.
        openSprint(scratch);
      }

      return {
        scratch: toRecord(scratch),
        sim: toSim(scratch),
        over: false,
        // Re-deliver the active Guide's secret every tick so a new card (or a reconnect) re-sends it,
        // and ONLY the Guide ever receives it (spec 0052).
        private: privateForGuide(scratch),
      };
    },

    // The live path never enters reveal/dispute/guess; the contract still requires these, so they are
    // inert. A live game ends via `tick.over`, and `endGame` produces the standings.
    reveal(ctx: RoundContext): RevealResult {
      return { scratch: ctx.scratch as Record<string, unknown>, reveal: null, scores: [] };
    },

    collectVote(ctx: RoundContext): ScratchResult {
      return { scratch: ctx.scratch as Record<string, unknown> };
    },

    disputeWindow(ctx: RoundContext): DisputeWindowResult {
      return { scratch: ctx.scratch as Record<string, unknown>, disputes: [] };
    },

    disputeVote(ctx: RoundContext): DisputeVoteResult {
      return { scratch: ctx.scratch as Record<string, unknown>, scores: [] };
    },

    leaderboard(ctx: RoundContext): Standing[] {
      const scratch = asScratch(ctx.scratch);
      return teamStandings(ctx.players, scratch.teamOf, scratch.teamScores);
    },

    advance(ctx: RoundContext): AdvanceResult {
      return { done: asScratch(ctx.scratch).over };
    },

    endGame(ctx: RoundContext): Standing[] {
      const scratch = asScratch(ctx.scratch);
      return teamStandings(ctx.players, scratch.teamOf, scratch.teamScores);
    },
  };
}

/** Parse a `move` string into a validated {@link BramblesMove}, or null if malformed. */
function parseMove(move: string): BramblesMove | null {
  let raw: unknown;
  try {
    raw = JSON.parse(move);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const m = raw as Partial<BramblesMove>;
  if (m.kind !== 'clue' && m.kind !== 'guess' && m.kind !== 'skip') return null;
  if (m.text !== undefined && typeof m.text !== 'string') return null;
  return { kind: m.kind, text: m.text };
}

/** The Brambles plugin: the manifest + a factory that loads its card bank via the injected loader. */
export const bramblesPlugin: GamePlugin<ResolvedBramblesConfig> = {
  manifest: {
    id: BRAMBLES_GAME_ID,
    name: 'Brambles',
    version: '1.0.0',
    configSchema: validateConfig,
    // Two teams of two: 4 players minimum.
    capabilities: { minPlayers: 4 },
    visibility: 'insider',
  },
  create: async (services) => {
    const bank = await loadCardBank(services.assets.forModule(import.meta.url));
    validateCardBank(bank);
    return createBramblesGame(bank, services.rng);
  },
};

// A convenience re-export so callers can name the two groves without importing teams.ts.
export { TEAM_NAMES };
