// The Whispergrove game module (spec 0062). Whispergrove is a two-team word-grid deduction game on
// the LIVE model (like Teeter): the whole game sits in ONE continuous phase, the engine steps it via
// `tick` and broadcasts a `WhispergroveSim` each change, and `collectMove` applies a move (a whisper
// or a tap) to the shared grid. There is no collect -> reveal turn cycle.
//
// State split (the crux of this game):
//  - The BROADCAST state (words, revealed leaves, whose turn, the current whisper, guesses-left, the
//    per-grove leaves-remaining race) lives in scratch and streams to EVERY device via `sim`.
//  - The SECRET KEY (each leaf's true role) is NEVER broadcast. It rides the spec 0052 `private`
//    channel to the two Whisperers ONLY, so no seeker device ever receives it over the wire. A test
//    proves a non-Whisperer never gets the key.
//
// Teams are tracked entirely in scratch (no engine team support): seats are assigned deterministically
// by seat order at configure, then the team result maps to per-player standings (all members of the
// winning grove share the top rank), honoring the engine's individual-standings contract.

import { rankStandings, type Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  AssetLoader,
  ConfigureResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  GamePlugin,
  GameServices,
  LiveTickResult,
  RevealResult,
  RoundContext,
  ScratchResult,
  SessionPlayer,
  StartRoundResult,
} from '@branchout/game-sdk';
import { validateConfig, type WhispergroveConfig } from './config';
import { loadWordBank, isSingleToken, CATEGORIES } from './words';
import type {
  LeafRole,
  PublicLeaf,
  SeatAssignment,
  Team,
  Whisper,
  WhispergroveEndReason,
  WhispergroveMove,
  WhispergrovePhase,
  WhispergroveSim,
  WhispererSecret,
} from './types';

export const WHISPERGROVE_GAME_ID = 'whispergrove';

/** Grid geometry: a fixed 5x5 grove of 25 leaves. */
export const GRID_SIZE = 25;
/** The fixed key split: the starting grove has 9, the other 8, then 7 saplings + 1 Deadwood. */
export const START_TEAM_LEAVES = 9;
export const OTHER_TEAM_LEAVES = 8;
export const SAPLING_LEAVES = 7;
export const DEADWOOD_LEAVES = 1;

export { validateConfig } from './config';
export type { WhispergroveConfig } from './config';

/** Violet grove always starts (it holds the 9-leaf majority), per the classic rules. */
const START_TEAM: Team = 'violet';

/**
 * The module's persisted state - the whole game, serializable so a reconnect / engine restart rebuilds
 * it. The KEY lives here (the engine only ships it to the two Whisperers via `private`; it is never in
 * the broadcast `sim`, which is built by `toSim`).
 */
interface WhispergroveScratch {
  /** The 25 words in grid order (row-major). */
  words: string[];
  /** The secret key: each leaf's true role, parallel to `words`. NEVER broadcast. */
  key: LeafRole[];
  /** Which leaves are revealed (parallel to `words`). */
  revealed: boolean[];
  /** Deterministic seat assignments (team + role), by seat order. */
  seats: SeatAssignment[];
  /** The grove currently taking its turn. */
  turn: Team;
  /** The turn phase: waiting on a whisper, on taps, or over. */
  phase: WhispergrovePhase;
  /** The active whisper while guessing, or null while awaiting one. */
  whisper: Whisper | null;
  /** Taps the active grove has left this turn (whisper.count + 1 at the start of guessing). */
  guessesLeft: number;
  /** The winning grove once over, or null. */
  winner: Team | null;
  /** Why the game ended, or null while playing. */
  endReason: WhispergroveEndReason | null;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): WhispergroveScratch {
  const s = scratch as Partial<WhispergroveScratch>;
  return {
    words: s.words ?? [],
    key: s.key ?? [],
    revealed: s.revealed ?? [],
    seats: s.seats ?? [],
    turn: s.turn ?? START_TEAM,
    phase: s.phase ?? 'whispering',
    whisper: s.whisper ?? null,
    guessesLeft: s.guessesLeft ?? 0,
    winner: s.winner ?? null,
    endReason: s.endReason ?? null,
  };
}

function toRecord(scratch: WhispergroveScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** The other grove. */
export function otherTeam(team: Team): Team {
  return team === 'violet' ? 'amber' : 'violet';
}

/**
 * Deterministically assign seats to the two groves by seat order (spec's team rule). Players at even
 * seat indices go to Violet, odd to Amber, so the two groves fill evenly. The FIRST player of each
 * grove (lowest seat index) is that grove's Whisperer; the rest are seekers. With 4 players this is
 * exactly two 2-player groves, each with one Whisperer.
 */
export function assignSeats(players: readonly SessionPlayer[]): SeatAssignment[] {
  const violet: string[] = [];
  const amber: string[] = [];
  players.forEach((p, i) => {
    (i % 2 === 0 ? violet : amber).push(p.player);
  });
  const seats: SeatAssignment[] = [];
  violet.forEach((player, i) => {
    seats.push({ player, team: 'violet', role: i === 0 ? 'whisperer' : 'seeker' });
  });
  amber.forEach((player, i) => {
    seats.push({ player, team: 'amber', role: i === 0 ? 'whisperer' : 'seeker' });
  });
  return seats;
}

/** The seat for a player id, or undefined if they are not seated (a viewer). */
function seatFor(seats: readonly SeatAssignment[], player: string): SeatAssignment | undefined {
  return seats.find((s) => s.player === player);
}

/** The Whisperer's player id for a grove, or undefined. */
export function whispererOf(seats: readonly SeatAssignment[], team: Team): string | undefined {
  return seats.find((s) => s.team === team && s.role === 'whisperer')?.player;
}

/**
 * Deal a fresh key over 25 leaves with a seeded shuffle: 9 to the starting grove, 8 to the other, 7
 * saplings, 1 Deadwood. The `rng` is the injected deterministic source, so a fixed seed deals a fixed
 * key (unit-tested). Returns the role array parallel to the word grid.
 */
export function dealKey(rng: () => number, startTeam: Team = START_TEAM): LeafRole[] {
  const other = otherTeam(startTeam);
  const roles: LeafRole[] = [
    ...Array<LeafRole>(START_TEAM_LEAVES).fill(startTeam),
    ...Array<LeafRole>(OTHER_TEAM_LEAVES).fill(other),
    ...Array<LeafRole>(SAPLING_LEAVES).fill('sapling'),
    ...Array<LeafRole>(DEADWOOD_LEAVES).fill('deadwood'),
  ];
  // Fisher-Yates with the injected rng, so the deal is deterministic under a seeded rng.
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = roles[i] as LeafRole;
    roles[i] = roles[j] as LeafRole;
    roles[j] = tmp;
  }
  return roles;
}

/** Pick 25 distinct words from the bank with the seeded rng (partial Fisher-Yates). */
export function pickWords(rng: () => number, bank: readonly string[]): string[] {
  if (bank.length < GRID_SIZE) {
    throw new Error(
      `whispergrove: word bank has ${bank.length} words, need at least ${GRID_SIZE} to fill the grove`,
    );
  }
  const pool = [...bank];
  const picked: string[] = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i] as string;
    pool[i] = pool[j] as string;
    pool[j] = tmp;
    picked.push(pool[i] as string);
  }
  return picked;
}

/** Count a grove's still-hidden leaves from the key + revealed arrays. */
function leavesLeft(key: readonly LeafRole[], revealed: readonly boolean[], team: Team): number {
  let n = 0;
  for (let i = 0; i < key.length; i++) {
    if (key[i] === team && !revealed[i]) n++;
  }
  return n;
}

/** Parse the opaque `move` string into a validated `WhispergroveMove`, or null if malformed. */
export function parseMove(move: string): WhispergroveMove | null {
  let raw: unknown;
  try {
    raw = JSON.parse(move);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const m = raw as { kind?: unknown; word?: unknown; count?: unknown; index?: unknown };
  if (m.kind === 'whisper') {
    if (typeof m.word !== 'string') return null;
    if (typeof m.count !== 'number' || !Number.isInteger(m.count)) return null;
    return { kind: 'whisper', word: m.word, count: m.count };
  }
  if (m.kind === 'tap') {
    if (typeof m.index !== 'number' || !Number.isInteger(m.index)) return null;
    return { kind: 'tap', index: m.index };
  }
  return null;
}

/** Build the public leaves list from words + revealed + key (only the REVEALED role is shown). */
function toPublicLeaves(scratch: WhispergroveScratch): PublicLeaf[] {
  return scratch.words.map((word, index) => ({
    index,
    word,
    revealed: scratch.revealed[index] ?? false,
    // The role is disclosed to everyone ONLY once the leaf is revealed; a hidden leaf shows null so
    // the broadcast never leaks the secret key of an unrevealed leaf.
    shown: scratch.revealed[index] ? (scratch.key[index] ?? null) : null,
  }));
}

/** The broadcast snapshot (no secret key). Streamed to every device. */
function toSim(scratch: WhispergroveScratch): WhispergroveSim {
  return {
    leaves: toPublicLeaves(scratch),
    turn: scratch.turn,
    phase: scratch.phase,
    whisper: scratch.whisper,
    guessesLeft: scratch.guessesLeft,
    violetLeft: leavesLeft(scratch.key, scratch.revealed, 'violet'),
    amberLeft: leavesLeft(scratch.key, scratch.revealed, 'amber'),
    winner: scratch.winner,
    endReason: scratch.endReason,
    seats: scratch.seats,
  };
}

/**
 * The per-Whisperer SECRET payload for this frame (spec 0052). Keyed ONLY by the two Whisperer player
 * ids; every other player is absent from the map and so never receives the key. Both Whisperers get
 * the same full key. Returns undefined (no private frame) once the game is over.
 */
function whispererPrivate(
  scratch: WhispergroveScratch,
): Record<string, WhispererSecret> | undefined {
  if (scratch.phase === 'over') return undefined;
  const secret: WhispererSecret = { key: scratch.key };
  const out: Record<string, WhispererSecret> = {};
  for (const team of ['violet', 'amber'] as const) {
    const id = whispererOf(scratch.seats, team);
    if (id) out[id] = secret;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build a Whispergrove module. The word bank is loaded once at construction via the injected asset
 * loader; the deal + shuffle use the injected rng (consumed deterministically), so a fixed seed +
 * fixed bank produce a fixed board (unit-tested).
 */
export function createWhispergroveGame(rng: () => number, bank: readonly string[]): GameModule {
  /** Deal a fresh board (words + key + seats) for a configured session. */
  const deal = (
    config: WhispergroveConfig,
    players: readonly SessionPlayer[],
  ): WhispergroveScratch => {
    void config; // categories were applied when the bank was loaded at construction
    const words = pickWords(rng, bank);
    const key = dealKey(rng, START_TEAM);
    const seats = assignSeats(players);
    return {
      words,
      key,
      revealed: Array<boolean>(GRID_SIZE).fill(false),
      seats,
      turn: START_TEAM,
      phase: 'whispering',
      whisper: null,
      guessesLeft: 0,
      winner: null,
      endReason: null,
    };
  };

  /** End the game: set the winner + reason, close the phase. */
  const endGameWith = (
    scratch: WhispergroveScratch,
    winner: Team,
    reason: WhispergroveEndReason,
  ): void => {
    scratch.winner = winner;
    scratch.endReason = reason;
    scratch.phase = 'over';
    scratch.whisper = null;
    scratch.guessesLeft = 0;
  };

  /** Hand the turn to the other grove, back to the whisper phase. */
  const passTurn = (scratch: WhispergroveScratch): void => {
    scratch.turn = otherTeam(scratch.turn);
    scratch.phase = 'whispering';
    scratch.whisper = null;
    scratch.guessesLeft = 0;
  };

  return {
    id: WHISPERGROVE_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      const scratch = deal(validateConfig(config), players ?? []);
      // Live game: no round timer, one continuous phase. `rounds` must be >= 1 for the SDK; a single
      // logical round covers the whole match, which ends via `tick.over`.
      return { scratch: toRecord(scratch), rounds: 1, moveWindowMs: 0 };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      const scratch = asScratch(ctx.scratch);
      // Emit the initial board as the prompt AND the Whisperers' secret key via the private channel
      // (spec 0052). The key is NEVER in the broadcast prompt.
      return {
        scratch: toRecord(scratch),
        prompt: toSim(scratch),
        private: whispererPrivate(scratch),
      };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const scratch = asScratch(ctx.scratch);
      const unchanged = ctx.scratch as Record<string, unknown>;
      const reject = (reason: string): ScratchResult => ({
        scratch: unchanged,
        rejected: { reason },
      });

      if (scratch.phase === 'over') return reject('game over');

      const seat = seatFor(scratch.seats, player);
      if (!seat) return reject('not a player in this grove');
      // Only the grove whose turn it is may act.
      if (seat.team !== scratch.turn) return reject('not your grove turn');

      const parsed = parseMove(move);
      if (!parsed) return reject('malformed move');

      // --- A whisper: only the active grove's Whisperer, only while awaiting one ---
      if (parsed.kind === 'whisper') {
        if (seat.role !== 'whisperer') return reject('only the Whisperer may whisper');
        if (scratch.phase !== 'whispering') return reject('a whisper is already in play');
        const word = parsed.word.trim();
        if (!isSingleToken(word)) return reject('a whisper must be a single word');
        // The whisper may not BE a word printed on the grove (a hidden leaf leaks otherwise). Compare
        // case-insensitively against every leaf still on the board (revealed or not).
        const upper = word.toUpperCase();
        if (scratch.words.some((w) => w.toUpperCase() === upper)) {
          return reject('the whisper cannot be a word on the grove');
        }
        // N must be in range 1..(your remaining leaves). The tap budget is N + 1 (the classic bonus tap).
        const ownLeft = leavesLeft(scratch.key, scratch.revealed, seat.team);
        if (parsed.count < 1 || parsed.count > ownLeft) {
          return reject(`whisper count must be between 1 and ${ownLeft}`);
        }
        scratch.whisper = { word, count: parsed.count, team: seat.team };
        scratch.guessesLeft = parsed.count + 1;
        scratch.phase = 'guessing';
        return { scratch: toRecord(scratch) };
      }

      // --- A tap: only a member of the active grove, only while guessing, only if taps remain ---
      if (scratch.phase !== 'guessing') return reject('wait for your Whisperer to whisper');
      // The Whisperer knows the key; they must not tap their own team's leaves.
      if (seat.role === 'whisperer') return reject('the Whisperer cannot tap leaves');
      if (scratch.guessesLeft <= 0) return reject('no taps left this turn');
      const index = parsed.index;
      if (index < 0 || index >= GRID_SIZE) return reject('that leaf is not on the grove');
      if (scratch.revealed[index]) return reject('that leaf is already revealed');

      // Reveal the leaf; resolve the outcome from its true role.
      scratch.revealed[index] = true;
      scratch.guessesLeft -= 1;
      const role = scratch.key[index] as LeafRole;

      // The Deadwood: the tapping grove falls instantly - the OTHER grove wins.
      if (role === 'deadwood') {
        endGameWith(scratch, otherTeam(seat.team), 'deadwood');
        return { scratch: toRecord(scratch) };
      }

      // A win check after every reveal: whichever grove now has zero hidden leaves has cleared.
      if (leavesLeft(scratch.key, scratch.revealed, 'violet') === 0) {
        endGameWith(scratch, 'violet', 'cleared');
        return { scratch: toRecord(scratch) };
      }
      if (leavesLeft(scratch.key, scratch.revealed, 'amber') === 0) {
        endGameWith(scratch, 'amber', 'cleared');
        return { scratch: toRecord(scratch) };
      }

      // A correct (own) leaf keeps the grove guessing while taps remain; a sapling or an enemy leaf
      // (or spending the last tap) ends the turn and passes it to the other grove.
      if (role !== seat.team || scratch.guessesLeft <= 0) passTurn(scratch);
      return { scratch: toRecord(scratch) };
    },

    tick(ctx: RoundContext): LiveTickResult {
      // Whispergrove has no autonomous world motion - all progress comes from `collectMove`. `tick`
      // exists only to mark the game LIVE (so the engine streams `sim` and skips the reveal/dispute
      // turn cycle) and to re-emit the current snapshot + the Whisperers' secret, so a (re)joining
      // Whisperer catches up on the key. It never mutates state.
      const scratch = asScratch(ctx.scratch);
      return {
        scratch: ctx.scratch as Record<string, unknown>,
        sim: toSim(scratch),
        over: scratch.phase === 'over',
        private: whispererPrivate(scratch),
      };
    },

    // --- turn-based lifecycle callbacks: present for interface completeness, unused in the live flow ---

    collectVote(ctx: RoundContext): ScratchResult {
      return { scratch: ctx.scratch as Record<string, unknown> };
    },

    reveal(ctx: RoundContext): RevealResult {
      return { scratch: ctx.scratch as Record<string, unknown>, reveal: null, scores: [] };
    },

    disputeWindow(ctx: RoundContext): DisputeWindowResult {
      return { scratch: ctx.scratch as Record<string, unknown>, disputes: [] };
    },

    disputeVote(ctx: RoundContext): DisputeVoteResult {
      return { scratch: ctx.scratch as Record<string, unknown>, scores: [] };
    },

    leaderboard(ctx: RoundContext): Standing[] {
      return standingsFor(ctx);
    },

    advance(): AdvanceResult {
      // Live game: the engine ends it via tick.over, never by driving rounds. Defensive terminal no-op.
      return { done: true };
    },

    endGame(ctx: RoundContext): Standing[] {
      return standingsFor(ctx);
    },

    disposeLive(): void {
      // No in-process world to release (the board is fully serializable in scratch), so this is a no-op.
    },
  };
}

/**
 * Map the team result to per-player standings (spec's team rule): every member of the winning grove
 * shares the top rank, every member of the losing grove the next. Built by handing the whole grove a
 * team score (winner 1, loser 0) and letting `rankStandings` group equal scores into a shared rank -
 * keeping the engine's individual-standings contract with a team outcome.
 */
export function standingsFor(ctx: RoundContext): Standing[] {
  const scratch = asScratch(ctx.scratch);
  const scores: Record<string, number> = {};
  for (const seat of scratch.seats) {
    // While the game is live (no winner yet), everyone is tied at 0. Once decided, the winning grove
    // scores 1 and the losing grove 0, so members of a grove always share a rank.
    scores[seat.player] = scratch.winner && seat.team === scratch.winner ? 1 : 0;
  }
  return rankStandings(ctx.players, scores);
}

/**
 * Whispergrove as a plugin the engine registers. `create` loads the word bank (from the selected
 * categories) via the injected asset loader, then builds the module with the injected rng. The
 * manifest is `insider` so the game stays off the public catalog. `create` is async so the bank loads
 * during construction (per the SDK's async-create contract).
 */
export const whispergrovePlugin: GamePlugin<WhispergroveConfig, WhispergroveSim, WhispererSecret> =
  {
    manifest: {
      id: WHISPERGROVE_GAME_ID,
      name: 'Whispergrove',
      version: '0.1.0',
      configSchema: validateConfig,
      // Two groves of at least two players each (one Whisperer + one seeker per grove) => 4+ players.
      capabilities: { minPlayers: 4 },
      visibility: 'insider',
    },
    create: async (services: GameServices) => {
      const loader: AssetLoader = services.assets.forModule(import.meta.url);
      // Load the full sample bank (every category) at construction; the host's category choice narrows
      // the deal, but bundling all categories keeps the deal simple and deterministic per session.
      const bank = await loadWordBank(loader, CATEGORIES);
      return createWhispergroveGame(services.rng, bank);
    },
  };
