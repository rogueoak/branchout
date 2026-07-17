// Whispergrove's host config shape + validator for the web lobby (spec 0062, spec 0023). Mirrors the
// engine's parse-or-throw normalizer (packages/games/whispergrove/src/config.ts): the one option is
// which word categories fill the grove. The engine re-checks, so this is a friendly pre-check that
// gates the host's Start button.

/** The word categories a host may fill the grove from (mirrors the engine's CATEGORIES). */
export const CATEGORIES = ['nature', 'places', 'objects', 'creatures'] as const;

export type WhispergroveCategory = (typeof CATEGORIES)[number];

/** The host's opaque config blob: which categories the grove is drawn from. */
export interface WhispergroveHostConfig {
  categories: WhispergroveCategory[];
}

/** The default config a fresh lobby starts from: every category in play. */
export function defaultConfig(): WhispergroveHostConfig {
  return { categories: [...CATEGORIES] };
}

/** True when `value` is a non-empty list of known category slugs. */
export function isCategoryList(value: unknown): value is WhispergroveCategory[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const known = new Set<string>(CATEGORIES);
  return value.every((v) => typeof v === 'string' && known.has(v));
}

/** Validate a host config, returning `{ ok, error? }` for the shell's Start gating. */
export function validateWhispergroveConfig(value: unknown): { ok: boolean; error?: string } {
  if (value == null) return { ok: true };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Config must be an object.' };
  }
  const raw = value as { categories?: unknown };
  if (raw.categories === undefined) return { ok: true };
  if (!Array.isArray(raw.categories)) {
    return { ok: false, error: 'Pick at least one word category.' };
  }
  const known = new Set<string>(CATEGORIES);
  if (raw.categories.some((c) => typeof c !== 'string' || !known.has(c))) {
    return { ok: false, error: 'Unknown word category selected.' };
  }
  if (raw.categories.length === 0) {
    return { ok: false, error: 'Pick at least one word category.' };
  }
  return { ok: true };
}

/** A title-cased category label ("nature" -> "Nature"). */
export function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}
