// Display-only title casing for revealed answers (feedback 0015). The question bank stores answers
// all-lowercase (the matcher normalizes both sides to lowercase, so comparison is case-insensitive
// and unchanged by this). That is correct for matching but shouty on screen - `the beatles`,
// `carbon dioxide` - so the viewer runs the canonical answer through this before showing it.
//
// Casing is reconstructed from lowercase, so it is best-effort. A small allowlist (`STYLIZED`) fixes
// the common trivia forms plain title-casing would mangle - acronyms (`co2` -> `CO2`, `nasa` ->
// `NASA`) and stylized brands (`iphone` -> `iPhone`). Anything not on the list falls through to the
// generic word caser, which cannot recover an unlisted acronym; the in-play dispute vote remains the
// human fallback. This is presentation only; never write the result back into the bank or comparison.

// Lowercase token -> its canonical display form. Keep this to genuinely common, unambiguous trivia
// answers; when in doubt leave a token off and let the generic caser handle it.
const STYLIZED: Readonly<Record<string, string>> = {
  co2: 'CO2',
  h2o: 'H2O',
  dna: 'DNA',
  rna: 'RNA',
  ph: 'pH',
  uv: 'UV',
  usa: 'USA',
  us: 'US',
  uk: 'UK',
  un: 'UN',
  eu: 'EU',
  ussr: 'USSR',
  nasa: 'NASA',
  fbi: 'FBI',
  cia: 'CIA',
  nato: 'NATO',
  wwi: 'WWI',
  wwii: 'WWII',
  tv: 'TV',
  dc: 'DC',
  led: 'LED',
  hiv: 'HIV',
  aids: 'AIDS',
  iphone: 'iPhone',
  ipad: 'iPad',
  ipod: 'iPod',
  imac: 'iMac',
  macos: 'macOS',
  ios: 'iOS',
};

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
      // A known stylized form (acronym or brand) wins over generic casing.
      const styled = STYLIZED[word.toLowerCase()];
      if (styled) return styled;
      // Respect an author-supplied interior capital rather than flattening it.
      if (/[A-Z]/.test(word.slice(1))) return word;
      if (!isEdge && MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return capitalize(word);
    })
    .join(' ');
}
