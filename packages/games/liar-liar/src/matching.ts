// Liar Liar answer matching (spec 0021). Fakes are free text, so two things need a canonical form:
// rejecting a fake that equals the real answer, and rejecting a duplicate of another player's fake.
// Matching is EXACT after normalization (no fuzzy/Levenshtein): two fakes built from different
// words never collapse, so a legitimate bluff is never wrongly rejected - the deliberate difference
// from Trivia's typo-tolerant scoring. Normalization does fold trivial variants (case, whitespace,
// punctuation, a single leading article), so "The Cat" and "a cat" count as the same fake -
// intended, to keep the revealed options free of confusing near-duplicates.
//
// Normalization order: lowercase -> collapse inner whitespace + trim -> strip a single leading
// article (a/an/the) -> drop punctuation -> collapse/trim again.

const LEADING_ARTICLE = /^(?:an?|the)\s+/;
// Keep Unicode letters/numbers and whitespace; drop everything else (punctuation, symbols).
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE = /\s+/g;

/** Normalize a fake or the real answer to its comparable canonical form. */
export function normalizeAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .replace(WHITESPACE, ' ')
    .trim()
    .replace(LEADING_ARTICLE, '')
    .replace(PUNCTUATION, '')
    .replace(WHITESPACE, ' ')
    .trim();
}

/** True when two answers are the same after normalization (exact, no fuzzy tolerance). */
export function sameAnswer(a: string, b: string): boolean {
  return normalizeAnswer(a) === normalizeAnswer(b);
}
