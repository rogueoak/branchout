// Sketchy's payload decoders for the game-pluggable client (spec 0063). The engine streams opaque
// prompt/reveal/private payloads; the reducer stores them raw and this module decodes the shapes it
// recognizes at render time. A shape it does not recognize is a null - a skipped render, never a
// throw. There are two round shapes:
//   - a DRAW round: the prompt is `{ stage: 'draw' }`; the local player's own seed arrives ONLY in the
//     targeted `private` payload (`{ seed }`); the reveal is a gallery of everyone's sketches.
//   - a SKETCH round: the prompt is `{ stage: 'sketch', featured, sketch }`; the reveal first streams
//     the guessable OPTIONS (during `guessing`, no truth tell), then the final RESULT (during
//     `leaderboard`, with the true seed and who fooled whom).

import { parseSketch, type Sketch } from './strokes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The local player's own secret seed + their claimed palette for a draw round (spec 0052/0063). */
export interface SketchySeedSecret {
  seed: string;
  /** The player's OWN palette colors (spec 0063), delivered per-player so the toolbar shows only
   * these three. Absent/empty when the player had no claimed palette (the caller supplies a default). */
  palette: string[];
}

export function asSketchySeedSecret(value: unknown): SketchySeedSecret | null {
  if (!isRecord(value)) return null;
  if (typeof value.seed !== 'string') return null;
  const palette = Array.isArray(value.palette)
    ? value.palette.filter((c): c is string => typeof c === 'string')
    : [];
  return { seed: value.seed, palette };
}

/** The draw-round prompt (no seed - the seed is delivered privately). */
export interface SketchyDrawPrompt {
  round: number;
  stage: 'draw';
}

/** The sketch-round prompt: the featured player and their (serialized) sketch to guess on. */
export interface SketchySketchPrompt {
  round: number;
  stage: 'sketch';
  featured: string | null;
  sketch: Sketch | null;
}

export type SketchyPrompt = SketchyDrawPrompt | SketchySketchPrompt;

export function asSketchyPrompt(value: unknown): SketchyPrompt | null {
  if (!isRecord(value)) return null;
  const { round, stage } = value;
  if (typeof round !== 'number') return null;
  if (stage === 'draw') return { round, stage: 'draw' };
  if (stage === 'sketch') {
    const featured = typeof value.featured === 'string' ? value.featured : null;
    return { round, stage: 'sketch', featured, sketch: parseSketch(value.sketch) };
  }
  return null;
}

/** One entry in the draw-round gallery: a player and their sketch. */
export interface GalleryEntry {
  player: string;
  sketch: Sketch | null;
}

/** The draw-round reveal: everyone's sketches shown on the shared screen. */
export interface SketchyGallery {
  round: number;
  stage: 'draw';
  gallery: GalleryEntry[];
}

export function asSketchyGallery(value: unknown): SketchyGallery | null {
  if (!isRecord(value) || value.stage !== 'draw' || !Array.isArray(value.gallery)) return null;
  const round = typeof value.round === 'number' ? value.round : 0;
  const gallery = value.gallery
    .map((entry): GalleryEntry | null => {
      if (!isRecord(entry) || typeof entry.player !== 'string') return null;
      return { player: entry.player, sketch: parseSketch(entry.sketch) };
    })
    .filter((e): e is GalleryEntry => e !== null);
  return { round, stage: 'draw', gallery };
}

/** One guessable option: a stable id and its display text (a decoy or the true seed). */
export interface SketchyOption {
  id: string;
  text: string;
}

/** The sketch-round guess options: decoys + the true seed, shuffled, WITHOUT saying which. */
export interface SketchyOptions {
  round: number;
  stage: 'sketch';
  featured: string | null;
  sketch: Sketch | null;
  options: SketchyOption[];
}

function asOption(value: unknown): SketchyOption | null {
  if (!isRecord(value)) return null;
  const { id, text } = value;
  return typeof id === 'string' && typeof text === 'string' ? { id, text } : null;
}

export function asSketchyOptions(value: unknown): SketchyOptions | null {
  if (!isRecord(value) || value.stage !== 'sketch') return null;
  // The options reveal carries no `trueSeed`; that is what distinguishes it from the final result.
  if ('trueSeed' in value) return null;
  if (!Array.isArray(value.options)) return null;
  const decoded = value.options.map(asOption);
  if (decoded.some((o) => o === null)) return null;
  return {
    round: typeof value.round === 'number' ? value.round : 0,
    stage: 'sketch',
    featured: typeof value.featured === 'string' ? value.featured : null,
    sketch: parseSketch(value.sketch),
    options: decoded as SketchyOption[],
  };
}

/** One option in the final result: text, truth-or-decoy, its author, and who picked it. */
export interface SketchyResultOption {
  id: string;
  text: string;
  kind: 'truth' | 'decoy';
  author?: string;
  pickedBy: string[];
}

/** The final sketch-round reveal: the true seed named, decoys attributed, and who guessed right. */
export interface SketchyResult {
  round: number;
  featured: string | null;
  sketch: Sketch | null;
  trueSeed: string | null;
  options: SketchyResultOption[];
  correctGuessers: string[];
}

function asResultOption(value: unknown): SketchyResultOption | null {
  if (!isRecord(value)) return null;
  const { id, text, kind, author, pickedBy } = value;
  if (typeof id !== 'string' || typeof text !== 'string') return null;
  if (kind !== 'truth' && kind !== 'decoy') return null;
  if (!Array.isArray(pickedBy) || pickedBy.some((p) => typeof p !== 'string')) return null;
  return {
    id,
    text,
    kind,
    author: typeof author === 'string' ? author : undefined,
    pickedBy: pickedBy as string[],
  };
}

export function asSketchyResult(value: unknown): SketchyResult | null {
  if (!isRecord(value) || value.stage !== 'result') return null;
  const { round, options, correctGuessers } = value;
  if (
    typeof round !== 'number' ||
    !Array.isArray(options) ||
    !Array.isArray(correctGuessers) ||
    correctGuessers.some((g) => typeof g !== 'string')
  ) {
    return null;
  }
  const decoded = options.map(asResultOption);
  if (decoded.some((o) => o === null)) return null;
  return {
    round,
    featured: typeof value.featured === 'string' ? value.featured : null,
    sketch: parseSketch(value.sketch),
    trueSeed: typeof value.trueSeed === 'string' ? value.trueSeed : null,
    options: decoded as SketchyResultOption[],
    correctGuessers: correctGuessers as string[],
  };
}

/** The guessable options in the round's streamed reveals, or null (used during `guessing`). */
export function pickOptions(reveals: readonly unknown[]): SketchyOptions | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asSketchyOptions(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}

/** The final attributed result in the round's streamed reveals, or null (used at `leaderboard`). */
export function pickResult(reveals: readonly unknown[]): SketchyResult | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asSketchyResult(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}

/** The gallery in the round's streamed reveals, or null (used at a draw round's `leaderboard`). */
export function pickGallery(reveals: readonly unknown[]): SketchyGallery | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asSketchyGallery(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
