// Trivia answer matching (spec 0008). Players type free-form text; we compare it against each
// accepted answer after normalizing both sides. Normalization and the fuzzy tolerance are the
// only automatic defense against false negatives from typos and formatting, with the dispute vote
// as the human fallback.
//
// Normalization (order matters):
//   1. lowercase
//   2. join numeric separators (punctuation between two digits: `1,000` -> `1000`)
//   3. drop remaining punctuation (anything that is not a letter, number, or whitespace)
//   4. collapse inner whitespace to single spaces and trim
//   5. strip a single leading article (`a` / `an` / `the`)
//   6. collapse/trim again
//
// Matching: exact after normalization, PLUS a Levenshtein distance of <= 1 when the accepted
// answer is 5+ characters (long enough that a single edit is far likelier a typo than a
// different word). Short answers require an exact normalized match to avoid "cat" ~ "cot". This
// is spec 0008's flagged decision, confirmed in review: keep the fuzzy tolerance - the dispute
// vote is the human fallback either way, and it cuts false negatives from typos.

const LEADING_ARTICLE = /^(?:an?|the)\s+/;
// Keep Unicode letters/numbers and whitespace; everything else (punctuation, symbols) is dropped.
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE = /\s+/g;
// Punctuation sitting between two digits is a numeric separator (thousands comma, decimal point),
// so it is removed to join the number - `1,000` -> `1000` - rather than split into `1 000`.
const NUMERIC_SEPARATOR = /(\d)[^\p{L}\p{N}\s]+(?=\d)/gu;

/** The minimum normalized answer length at which the Levenshtein-1 tolerance applies. */
export const FUZZY_MIN_LENGTH = 5;

/** Normalize a player answer or an accepted answer to its comparable canonical form. */
export function normalizeAnswer(raw: string): string {
  const stripped = raw
    .toLowerCase()
    .replace(NUMERIC_SEPARATOR, '$1')
    .replace(PUNCTUATION, ' ')
    .replace(WHITESPACE, ' ')
    .trim()
    .replace(LEADING_ARTICLE, '');
  return stripped.replace(WHITESPACE, ' ').trim();
}

/**
 * Levenshtein edit distance between two strings, short-circuiting once the running minimum of a
 * row exceeds `max` (we only ever care whether the distance is <= 1, so bailing keeps it cheap).
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  // |len difference| is a lower bound on the distance, so a big gap cannot be within `max`.
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** True when the normalized answers are equal, or within one edit for a 5+ char accepted answer. */
function answersMatch(normalizedPlayer: string, normalizedAccepted: string): boolean {
  if (normalizedPlayer === normalizedAccepted) return true;
  if (normalizedAccepted.length < FUZZY_MIN_LENGTH) return false;
  return levenshtein(normalizedPlayer, normalizedAccepted, 1) <= 1;
}

/**
 * True when `answer` matches any of `accepted` under normalization and the fuzzy tolerance. An
 * empty or blank answer never matches (a player who left it blank is not "close").
 */
export function isCorrectAnswer(answer: string, accepted: readonly string[]): boolean {
  const normalizedPlayer = normalizeAnswer(answer);
  if (normalizedPlayer.length === 0) return false;
  return accepted.some((candidate) => answersMatch(normalizedPlayer, normalizeAnswer(candidate)));
}
