// Lone Leaf clue (leaf) matching (spec 0057). Every non-Seeker writes ONE one-word leaf; before the
// Seeker sees them, matching leaves "wilt" - two players who wrote the same word both have their leaf
// cleared, so only the leaves nobody else thought of survive. Matching is the whole point of the
// mechanic, so two forms are compared: a leaf is a duplicate of another when they share a canonical
// stem, and a leaf that also matches the seed itself is invalid (it would just hand the Seeker the
// answer). Comparison is EXACT after normalization + a light stem fold - deliberately generous around
// trivial variants (case, a trailing plural / -ing / -ed) so "cat" and "cats", or "run" and
// "running", wilt together as the same idea, but distinct words never collapse.
//
// Normalization order: lowercase -> drop punctuation/symbols -> collapse whitespace + trim. A leaf is
// one word, so any inner whitespace (a stray two-word entry) is caught by the caller as invalid.

// Keep Unicode letters/numbers and whitespace; drop everything else (punctuation, symbols, apostrophes).
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE = /\s+/g;

/** Normalize a leaf (or the seed) to its comparable canonical form: lowercased, punctuation-free, trimmed. */
export function normalizeLeaf(raw: string): string {
  return raw.toLowerCase().replace(PUNCTUATION, '').replace(WHITESPACE, ' ').trim();
}

// A light, deterministic stem: fold a common English inflection off the end so obvious variants of the
// same word wilt together. Order matters - strip the longest suffix first. This is intentionally small
// and conservative (no full Porter stemmer): it never touches short stems, so it cannot over-collapse
// two genuinely different short words. It runs AFTER normalization, on a single lowercased token.
const MIN_STEM = 3;

/** Reduce a normalized single-word leaf to a comparison stem (folds a trailing plural / -ing / -ed). */
export function stemLeaf(normalized: string): string {
  let word = normalized;
  // -ing / -ed (verbs): "running" -> "runn" is undesirable, so only fold when a stem of length >=
  // MIN_STEM remains. We do not restore a doubled consonant; the fold just needs to be consistent, not
  // linguistically perfect, for two players' leaves to collide.
  if (word.length > MIN_STEM + 3 && word.endsWith('ing')) {
    word = word.slice(0, -3);
  } else if (word.length > MIN_STEM + 2 && word.endsWith('ed')) {
    word = word.slice(0, -2);
  }
  // Plurals: -ies -> -y ("berries" -> "berry"), -es, then a bare trailing -s.
  if (word.length > MIN_STEM + 1 && word.endsWith('ies')) {
    word = `${word.slice(0, -3)}y`;
  } else if (word.length > MIN_STEM + 1 && word.endsWith('es')) {
    word = word.slice(0, -2);
  } else if (word.length > MIN_STEM && word.endsWith('s')) {
    word = word.slice(0, -1);
  }
  return word;
}

/** The canonical comparison key for a leaf: normalized, then stem-folded. */
export function leafKey(raw: string): string {
  return stemLeaf(normalizeLeaf(raw));
}

/** True when two leaves match (share a canonical stem) - the pair that wilts. */
export function sameLeaf(a: string, b: string): boolean {
  const ka = leafKey(a);
  return ka.length > 0 && ka === leafKey(b);
}

/** True when a leaf is a single word (no inner whitespace after normalization) with a non-empty stem. */
export function isSingleWord(raw: string): boolean {
  const normalized = normalizeLeaf(raw);
  return normalized.length > 0 && !normalized.includes(' ');
}
