// Shared building blocks for both protocol channels: the version stamp every envelope carries,
// the game-agnostic domain shapes (phases, standings, scoring events), and small validation
// helpers the message and reporting parsers reuse.

/**
 * Wire-format version. Every envelope on either channel carries `v` so a shape can change
 * without breaking older peers: a reader checks the version before trusting the rest. Bump this
 * when a breaking change lands and teach the parsers to accept both for a transition window.
 */
export const PROTOCOL_VERSION = 2 as const;

/**
 * The generic round lifecycle phases the engine sequences. A game module fills in what each
 * phase means; the engine only tracks which one a session is in and streams it to devices.
 *
 * `configuring -> collecting -> disputing -> voting -> leaderboard` cycles per round (reveal is
 * published on the collecting -> disputing transition), then `complete` is terminal.
 */
export type Phase =
  'configuring' | 'collecting' | 'disputing' | 'voting' | 'guessing' | 'leaderboard' | 'complete';

const PHASES: readonly Phase[] = [
  'configuring',
  'collecting',
  'disputing',
  'voting',
  'guessing',
  'leaderboard',
  'complete',
];

/** A player as seen by other devices: identity, display name, and live connection state. */
export interface PlayerView {
  player: string;
  nickname: string;
  connected: boolean;
}

/** One row of a leaderboard or final standings. Ties share a rank (see `rankStandings`). */
export interface Standing {
  player: string;
  nickname: string;
  score: number;
  rank: number;
}

/**
 * A single award of points to a player with a human-readable reason (e.g. "correct answer",
 * "dispute upheld"). Games emit these; the engine applies them to scores and forwards them to
 * the control-plane for billing and stars.
 */
export interface ScoreEvent {
  player: string;
  points: number;
  reason: string;
}

/** Thrown when raw bytes off either channel are not a valid protocol envelope. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Assert an envelope's version is one this build understands. */
export function assertVersion(value: unknown): void {
  if (value !== PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported protocol version: ${String(value)}`);
  }
}

export function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtocolError(`"${key}" must be a non-empty string`);
  }
  return value;
}

/** Characters allowed in an identity field (room/game/player/target). */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validate an identity field. These are concatenated into pub/sub channel names and idempotency
 * keys (`stream:room:game`, `room:game:runId:round`), so an embedded `:` or oversized value could
 * collide distinct sessions or reports. Restrict them to a safe, bounded charset at the boundary.
 */
export function requireId(source: Record<string, unknown>, key: string): string {
  const value = requireString(source, key);
  if (!ID_PATTERN.test(value)) {
    throw new ProtocolError(`"${key}" must match ${ID_PATTERN} (letters, digits, _ or -, <= 64)`);
  }
  return value;
}

export function requireInt(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ProtocolError(`"${key}" must be an integer`);
  }
  return value;
}

export function requireBool(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new ProtocolError(`"${key}" must be a boolean`);
  }
  return value;
}

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}

/**
 * Rank players by score, highest first. Ties share a rank and the next rank skips accordingly
 * (standard "1224" competition ranking), so two winners are both rank 1 and the next is rank 3.
 */
export function rankStandings(
  players: readonly PlayerView[],
  scores: Readonly<Record<string, number>>,
): Standing[] {
  const rows = players.map((p) => ({
    player: p.player,
    nickname: p.nickname,
    score: scores[p.player] ?? 0,
  }));
  rows.sort((a, b) => b.score - a.score || a.player.localeCompare(b.player));

  let lastScore: number | null = null;
  let lastRank = 0;
  return rows.map((row, index) => {
    const rank = lastScore !== null && row.score === lastScore ? lastRank : index + 1;
    lastScore = row.score;
    lastRank = rank;
    return { ...row, rank };
  });
}
