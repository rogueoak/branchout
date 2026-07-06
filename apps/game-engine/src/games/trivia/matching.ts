// Trivia answer matching (spec 0008). Players type free-form text; we compare it against each
// accepted answer after normalizing both sides. Normalization is the only automatic defense
// against false negatives from formatting; the dispute vote is the human fallback for the rest.
//
// Matching is EXACT after normalization - no fuzzy / edit-distance tolerance. Spec 0008 flagged
// this as a decision to confirm in review; review chose exact-only. The reasoning is asymmetry of
// harm: a false negative (a correct answer marked wrong) is recoverable through the dispute vote,
// but a false positive (a wrong answer awarded 100 points) has no correction path, so we never
// auto-award a near miss. `Paris` vs `Parts` is one edit apart - fuzzy would have scored it.
//
// Normalization (order matches the spec):
//   1. lowercase
//   2. join numeric separators (punctuation between two digits: `1,000` -> `1000`)
//   3. collapse inner whitespace to single spaces and trim
//   4. strip a single leading article (`a` / `an` / `the`) when whitespace-separated
//   5. drop remaining punctuation, then collapse/trim again
//
// The article is stripped before punctuation is dropped, so only a whitespace-separated leading
// article is removed (`the beatles` -> `beatles`); a punctuation-joined one is kept (`a-bomb` ->
// `a bomb`, `the-beatles` -> `the beatles`).

const LEADING_ARTICLE = /^(?:an?|the)\s+/;
// Keep Unicode letters/numbers and whitespace; everything else (punctuation, symbols) is dropped.
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE = /\s+/g;
// Punctuation sitting between two digits is a numeric separator (thousands comma, decimal point),
// so it is removed to join the number - `1,000` -> `1000` - rather than split into `1 000`.
const NUMERIC_SEPARATOR = /(\d)[^\p{L}\p{N}\s]+(?=\d)/gu;

/** Normalize a player answer or an accepted answer to its comparable canonical form. */
export function normalizeAnswer(raw: string): string {
  const withoutArticle = raw
    .toLowerCase()
    .replace(NUMERIC_SEPARATOR, '$1')
    .replace(WHITESPACE, ' ')
    .trim()
    .replace(LEADING_ARTICLE, '');
  return withoutArticle.replace(PUNCTUATION, ' ').replace(WHITESPACE, ' ').trim();
}

/**
 * True when `answer` exactly matches any of `accepted` under normalization. An empty or blank
 * answer never matches (a player who left it blank is not correct).
 */
export function isCorrectAnswer(answer: string, accepted: readonly string[]): boolean {
  const normalizedPlayer = normalizeAnswer(answer);
  if (normalizedPlayer.length === 0) return false;
  return accepted.some((candidate) => normalizeAnswer(candidate) === normalizedPlayer);
}
