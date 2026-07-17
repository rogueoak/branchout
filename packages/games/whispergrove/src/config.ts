// Whispergrove host config (spec 0062). The board is always a 5x5 grove with the fixed 9/8/7/1 key
// split, so there is nothing numeric to tune; the one option is which word categories the grove is
// filled from. Kept as a parse-or-throw schema so the engine and the web mirror the same normalizer.

import { CATEGORIES, type WhispergroveCategory } from './words';

/** Normalized host config: the categories the grove's 25 words are drawn from. */
export interface WhispergroveConfig {
  /** Non-empty subset of {@link CATEGORIES}; `random` (all categories) when the host picks nothing. */
  categories: WhispergroveCategory[];
}

/** The default config a fresh lobby starts from: every category in play. */
export function defaultConfig(): WhispergroveConfig {
  return { categories: [...CATEGORIES] };
}

/**
 * Validate + normalize an opaque host config into a {@link WhispergroveConfig}. Throws on an invalid
 * shape (matching the engine's parse-or-throw contract). An empty/absent categories list defaults to
 * every category, so a host who tunes nothing gets the full bank.
 */
export function validateConfig(config: unknown): WhispergroveConfig {
  if (config == null) return defaultConfig();
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`whispergrove config must be an object, got ${typeof config}`);
  }
  const raw = config as { categories?: unknown };
  if (raw.categories === undefined) return defaultConfig();
  if (!Array.isArray(raw.categories)) {
    throw new Error('whispergrove config.categories must be an array of category names');
  }
  const known = new Set<string>(CATEGORIES);
  const seen = new Set<string>();
  const categories: WhispergroveCategory[] = [];
  for (const value of raw.categories) {
    if (typeof value !== 'string' || !known.has(value)) {
      throw new Error(
        `whispergrove config.categories has ${JSON.stringify(value)}, expected one of ${CATEGORIES.join(', ')}`,
      );
    }
    if (!seen.has(value)) {
      seen.add(value);
      categories.push(value as WhispergroveCategory);
    }
  }
  // An empty list (host cleared every box) falls back to the full bank rather than dealing no words.
  return categories.length > 0 ? { categories } : defaultConfig();
}
