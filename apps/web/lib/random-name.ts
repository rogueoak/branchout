// A friendly random display name for a fresh anonymous joiner (spec 0066). When a player lands on
// /join with no remembered name and no gamer tag, the form seeds the field with a generated
// "adjective + noun" like "Prickly Ostrich" so joining is one tap instead of staring at a blank
// required field.
//
// The word lists lean into the brand's woodland-critter / bug / plant / party flavor so a generated
// name feels like it belongs next to the avatar set, not like a UUID. Everything here is ASCII and
// family-friendly (Trellis language rules), and every adjective + noun pair stays within the
// control-plane display-name limit (1-40 chars); the longest pair below is well under 40.

/** On-brand, family-friendly, ASCII adjectives. Kept short so any pairing stays under 40 chars. */
export const ADJECTIVES: readonly string[] = [
  'prickly',
  'mossy',
  'sleepy',
  'sunny',
  'breezy',
  'jolly',
  'fuzzy',
  'plucky',
  'cheery',
  'nimble',
  'dewy',
  'leafy',
  'perky',
  'snug',
  'wild',
  'merry',
  'brave',
  'spry',
  'cozy',
  'zippy',
];

/** On-brand, family-friendly, ASCII nouns: woodland critters, bugs, and plants. */
export const NOUNS: readonly string[] = [
  'ostrich',
  'hedgehog',
  'otter',
  'badger',
  'sparrow',
  'beetle',
  'cricket',
  'ladybug',
  'fern',
  'acorn',
  'clover',
  'thistle',
  'chipmunk',
  'robin',
  'newt',
  'toadstool',
  'firefly',
  'marmot',
  'bramble',
  'poppy',
];

/**
 * Deterministic randomness source: returns a float in [0, 1). Defaults to `Math.random`. Tests
 * inject a stub so a generated name is predictable.
 */
export type Rng = () => number;

/** Title-case a lowercase word ("ostrich" -> "Ostrich"), matching how names read elsewhere. */
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Pick one element from a non-empty list using the given rng, clamped to a valid index. */
function pick<T>(list: readonly T[], rng: Rng): T {
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  // The index is clamped into range for a non-empty list, so this element is always present.
  return list[index] as T;
}

/**
 * Build a friendly "Adjective Noun" display name (e.g. "Prickly Ostrich"). Pure: pass `rng` to make
 * the result deterministic in a test; defaults to `Math.random` in the app. Always ASCII and within
 * the 40-char display-name limit.
 */
export function generateRandomName(rng: Rng = Math.random): string {
  return `${titleCase(pick(ADJECTIVES, rng))} ${titleCase(pick(NOUNS, rng))}`;
}
