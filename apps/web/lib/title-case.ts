// Display-only title casing for revealed answers (feedback 0015). The question bank stores answers
// all-lowercase (the matcher normalizes both sides to lowercase, so comparison is case-insensitive
// and unchanged by this). That is correct for matching but shouty on screen - `the beatles`,
// `carbon dioxide` - so the viewer runs the canonical answer through this before showing it.
//
// Best-effort by nature: casing is being reconstructed from lowercase, so acronyms and stylized
// forms cannot be recovered (`co2` -> `Co2`, not `CO2`; `iphone` -> `Iphone`). Proper nouns and
// ordinary words come out right, and the in-play dispute vote remains the human fallback for the
// rest. This is presentation only; never write the result back into the bank or the comparison.

// Short function words kept lowercase inside a title (but capitalized if first or last, below).
const MINOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'vs',
  'via',
  'with',
]);

function capitalize(word: string): string {
  // Capitalize the first alphanumeric character, leaving any leading punctuation in place so
  // `(new)` -> `(New)`.
  return word.replace(/[\p{L}\p{N}]/u, (ch) => ch.toUpperCase());
}

/**
 * Title-case a single answer string for display. Splits on whitespace, capitalizes each word, and
 * keeps minor words (`the`, `of`, `and`, ...) lowercase unless they are the first or last word.
 * A word already containing an interior capital (someone typed `McQueen`) is left untouched.
 */
export function toDisplayAnswer(raw: string): string {
  const words = raw.trim().split(/\s+/);
  if (words.length === 1 && words[0] === '') return raw.trim();
  return words
    .map((word, i) => {
      const isEdge = i === 0 || i === words.length - 1;
      // Respect an author-supplied interior capital rather than flattening it.
      if (/[A-Z]/.test(word.slice(1))) return word;
      if (!isEdge && MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return capitalize(word);
    })
    .join(' ');
}
