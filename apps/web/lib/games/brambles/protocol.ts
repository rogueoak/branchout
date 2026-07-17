// Brambles payload decoders for the game-pluggable client (spec 0061, spec 0023). The engine streams
// an opaque `sim` frame (the shared sprint state everyone watches) and, targeted to the active Guide
// alone, an opaque `private` frame (the bloom + thorns). This module decodes each shape defensively
// at the render boundary - an unrecognized shape is null (a skipped render, never a throw). The `sim`
// never carries the secret; only `BramblesSecret` does, and only the Guide's device receives it.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** One entry in the sprint's public clue/guess/prick log. */
export interface BramblesLogEntry {
  kind: 'clue' | 'guess' | 'prick' | 'skip';
  text: string;
  player: string;
}

function asLogEntry(value: unknown): BramblesLogEntry | null {
  if (!isRecord(value)) return null;
  const { kind, text, player } = value;
  if (kind !== 'clue' && kind !== 'guess' && kind !== 'prick' && kind !== 'skip') return null;
  if (typeof text !== 'string' || typeof player !== 'string') return null;
  return { kind, text, player };
}

/** The broadcast sprint snapshot everyone watches - never carries the bloom or thorns. */
export interface BramblesSim {
  over: boolean;
  sprint: number;
  totalSprints: number;
  activeTeam: 0 | 1;
  guide: string;
  teamScores: [number, number];
  bloomsThisSprint: number;
  pricksThisSprint: number;
  secondsLeft: number;
  log: BramblesLogEntry[];
}

export function asBramblesSim(value: unknown): BramblesSim | null {
  if (!isRecord(value)) return null;
  const {
    over,
    sprint,
    totalSprints,
    activeTeam,
    guide,
    teamScores,
    bloomsThisSprint,
    pricksThisSprint,
    secondsLeft,
    log,
  } = value;
  if (
    typeof over !== 'boolean' ||
    !isNum(sprint) ||
    !isNum(totalSprints) ||
    (activeTeam !== 0 && activeTeam !== 1) ||
    typeof guide !== 'string' ||
    !Array.isArray(teamScores) ||
    teamScores.length !== 2 ||
    !isNum(teamScores[0]) ||
    !isNum(teamScores[1]) ||
    !isNum(bloomsThisSprint) ||
    !isNum(pricksThisSprint) ||
    !isNum(secondsLeft) ||
    !Array.isArray(log)
  ) {
    return null;
  }
  const decodedLog = log.map(asLogEntry);
  if (decodedLog.some((e) => e === null)) return null;
  return {
    over,
    sprint,
    totalSprints,
    activeTeam,
    guide,
    teamScores: [teamScores[0], teamScores[1]],
    bloomsThisSprint,
    pricksThisSprint,
    secondsLeft,
    log: decodedLog as BramblesLogEntry[],
  };
}

/**
 * The Guide's secret for the current card, delivered ONLY to the active Guide's device (spec 0052).
 * Decoded from `state.private`; a non-Guide has no private payload, so this returns null for them.
 */
export interface BramblesSecret {
  bloom: string;
  thorns: string[];
}

export function asBramblesSecret(value: unknown): BramblesSecret | null {
  if (!isRecord(value)) return null;
  const { bloom, thorns } = value;
  if (typeof bloom !== 'string' || !Array.isArray(thorns)) return null;
  if (thorns.some((t) => typeof t !== 'string')) return null;
  return { bloom, thorns: thorns as string[] };
}
