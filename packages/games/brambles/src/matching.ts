// Brambles word matching (spec 0061). Two jobs live here:
//
//   1. PRICK detection - the auto-referee that burns a clue when the Guide's typed clue touches the
//      bloom (the target word) or any thorn (a forbidden word), OR an obvious variant of either (a
//      "near-stem": a shared word stem). This is what the human buzzer does in the tabletop game,
//      done in software so the opposing team never needs to see the secret.
//   2. GUESS matching - a teammate's typed guess is fuzzy-matched against the bloom so a small typo
//      or a plural/verb ending still counts, without the guesser needing an exact spelling.
//
// Both operate on a canonical form: lowercase, fold accents, drop punctuation, collapse whitespace.
// Prick detection is deliberately STRICT (a clue that even brushes a thorn wilts), while guess
// matching is deliberately LENIENT (a close-enough guess scores) - opposite tolerances by design.

const WHITESPACE = /\s+/g;
// Keep ASCII letters/digits and whitespace; drop everything else (punctuation, symbols).
const NON_WORD = /[^a-z0-9\s]/g;

/** Fold common accents to their ASCII base so "cafe" and an accented spelling canonicalize alike. */
function foldAccents(raw: string): string {
  // Decompose, then drop combining diacritical marks (the Unicode "Mark" category).
  return raw.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Normalize a clue/guess/word to its canonical comparable form. */
export function normalize(raw: string): string {
  return foldAccents(raw.toLowerCase())
    .replace(WHITESPACE, ' ')
    .trim()
    .replace(NON_WORD, ' ')
    .replace(WHITESPACE, ' ')
    .trim();
}

/** Split a normalized string into its word tokens (empty string -> no tokens). */
export function tokenize(raw: string): string[] {
  const norm = normalize(raw);
  return norm.length === 0 ? [] : norm.split(' ');
}

/**
 * Reduce a single word to a crude stem so obvious variants collapse together: strip a handful of
 * common English suffixes (plural, gerund, past tense, comparative, adverb). Deliberately simple -
 * it only needs to catch the "obvious variant" a describer would be pricked for out loud (say
 * "running" for the bloom "run"), not to be a linguistically correct stemmer. Short words (<= 3
 * letters) are left alone so we do not over-stem ("was" -> "wa").
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  // "-ies"/"-ied" restore a "y" ("berries" -> "berry", "carried" -> "carry") so the stem lines up
  // with the singular, which itself stems to the same base.
  if (w.length >= 5 && (w.endsWith('ies') || w.endsWith('ied'))) {
    return w.slice(0, w.length - 3) + 'y';
  }
  const suffixes = ['ingly', 'edly', 'ing', 'ers', 'er', 'est', 'ly', 'ed', 'es', 's'];
  for (const suffix of suffixes) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, w.length - suffix.length);
      // A doubled final consonant added before "-ing"/"-ed" (running -> runn, stopped -> stopp)
      // collapses back to the single consonant so the stem matches the base verb.
      if ((suffix === 'ing' || suffix === 'ed') && w.length >= 2) {
        const last = w[w.length - 1]!;
        if (last === w[w.length - 2] && !'aeiou'.includes(last)) {
          w = w.slice(0, w.length - 1);
        }
      }
      break;
    }
  }
  return w;
}

/** True when two single words share a stem (an "obvious variant" - a near-stem match). */
export function sameStem(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na === nb) return true;
  return stem(na) === stem(nb);
}

/**
 * Decide whether a Guide's clue PRICKS: it contains the bloom or any thorn, or an obvious variant
 * (a shared stem) of any of them. A forbidden phrase (multi-word thorn) pricks when its whole token
 * sequence appears in the clue; a single-word forbidden word pricks when any clue token shares its
 * stem. Returns the offending word (bloom or thorn) that was touched, or null when the clue is clean.
 */
export function findPrick(clue: string, bloom: string, thorns: readonly string[]): string | null {
  const clueTokens = tokenize(clue);
  if (clueTokens.length === 0) return null;
  const clueStems = clueTokens.map(stem);

  for (const forbidden of [bloom, ...thorns]) {
    const forbiddenTokens = tokenize(forbidden);
    if (forbiddenTokens.length === 0) continue;

    if (forbiddenTokens.length === 1) {
      // Single word: any clue token that shares its stem is a prick (catches plurals/tenses).
      const target = stem(forbiddenTokens[0]!);
      if (clueStems.includes(target)) return forbidden;
    } else {
      // Multi-word phrase: prick only when the whole stemmed sequence appears contiguously in the
      // clue, so a phrase thorn like "polar bear" is not tripped by an unrelated "bear" alone.
      const targetStems = forbiddenTokens.map(stem);
      if (containsSequence(clueStems, targetStems)) return forbidden;
    }
  }
  return null;
}

/** True when `needle` appears as a contiguous subsequence of `haystack`. */
function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** Levenshtein edit distance between two strings (used for a typo-tolerant guess match). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * True when a teammate's typed `guess` matches the `bloom` closely enough to score. Match is
 * intentionally lenient: an exact normalized match, a shared stem (plural/tense), or a small
 * typo (edit distance within a length-scaled budget) all count. The whole normalized guess is
 * compared to the whole normalized bloom, so "polar bear" must be typed in full for a two-word bloom.
 */
export function isGuessMatch(guess: string, bloom: string): boolean {
  const g = normalize(guess);
  const b = normalize(bloom);
  if (g.length === 0 || b.length === 0) return false;
  if (g === b) return true;
  // Single-word blooms tolerate a shared stem so "berries" matches the bloom "berry".
  if (!b.includes(' ') && !g.includes(' ') && sameStem(g, b)) return true;
  // Typo tolerance: allow ~1 edit per 4 characters of the bloom, at least 1, capped at 2. This
  // accepts a transposition ("mountian") on a mid-length word while still rejecting a different word.
  const budget = Math.min(2, Math.max(1, Math.floor(b.length / 4)));
  return editDistance(g, b) <= budget;
}
