// Per-player drawing palettes (spec 0063, Sketchy palettes). A palette is a stable id, a display
// name, and a fixed trio of hex colors that read well together and stay visible on a white canvas.
// Sketchy gives every player their OWN palette, claimed and reserved in the lobby so no two players
// share one; the player draws with only their three colors and the engine validates each stroke
// against them.
//
// These live in the shared protocol package (like PLAYER_LIMITS) so the three peers that need them -
// the web lobby + canvas, the game engine's stroke validation, and the control-plane's server-side
// reservation - all read ONE definition and can never drift. The 24 palettes step around the hue
// wheel so their dominant color is distinguishable palette-to-palette; each is a deep, a mid, and a
// bright shade of one hue family. With 24 palettes and at most 8 playing members, there are always
// enough distinct palettes for everyone.

/** One player palette: a stable id, a human display name, and its fixed trio of hex colors. */
export interface PlayerPalette {
  /** Stable, url-safe id stored on the roster and validated server-side (never renamed). */
  id: string;
  /** Human-facing name shown in the lobby picker (e.g. "Ember"). */
  name: string;
  /** The three hex colors a player draws with, deep -> mid -> bright. The first is the default twig. */
  colors: readonly [string, string, string];
}

/**
 * The 24 palettes, in a stable display order. Each is one hue family (deep/mid/bright), and the
 * families step around the wheel so adjacent picks still look different on white. Order is stable so
 * the lobby picker is deterministic; ids are stable so a stored claim never breaks.
 */
export const PLAYER_PALETTES: readonly PlayerPalette[] = [
  { id: 'ember', name: 'Ember', colors: ['#781717', '#c52020', '#e94949'] },
  { id: 'flame', name: 'Flame', colors: ['#782f17', '#c54920', '#e97149'] },
  { id: 'amber', name: 'Amber', colors: ['#784717', '#c57320', '#e99949'] },
  { id: 'honey', name: 'Honey', colors: ['#786017', '#c59c20', '#e9c149'] },
  { id: 'gold', name: 'Gold', colors: ['#787017', '#c5b820', '#e9db49'] },
  { id: 'citron', name: 'Citron', colors: ['#687817', '#aac520', '#cee949'] },
  { id: 'lime', name: 'Lime', colors: ['#4f7817', '#81c520', '#a6e949'] },
  { id: 'fern', name: 'Fern', colors: ['#377817', '#57c520', '#7ee949'] },
  { id: 'clover', name: 'Clover', colors: ['#177817', '#20c520', '#49e949'] },
  { id: 'jade', name: 'Jade', colors: ['#177837', '#20c557', '#49e97e'] },
  { id: 'pine', name: 'Pine', colors: ['#17784f', '#20c581', '#49e9a6'] },
  { id: 'spruce', name: 'Spruce', colors: ['#177860', '#20c59c', '#49e9c1'] },
  { id: 'teal', name: 'Teal', colors: ['#177878', '#20c5c5', '#49e9e9'] },
  { id: 'lagoon', name: 'Lagoon', colors: ['#176878', '#20aac5', '#49cee9'] },
  { id: 'cyan', name: 'Cyan', colors: ['#176078', '#209cc5', '#49c1e9'] },
  { id: 'sky', name: 'Sky', colors: ['#174f78', '#2081c5', '#49a6e9'] },
  { id: 'azure', name: 'Azure', colors: ['#173f78', '#2065c5', '#498ce9'] },
  { id: 'cobalt', name: 'Cobalt', colors: ['#172f78', '#2049c5', '#4971e9'] },
  { id: 'indigo', name: 'Indigo', colors: ['#1f1778', '#2e20c5', '#5749e9'] },
  { id: 'violet', name: 'Violet', colors: ['#3f1778', '#6520c5', '#8c49e9'] },
  { id: 'grape', name: 'Grape', colors: ['#581778', '#8e20c5', '#b449e9'] },
  { id: 'orchid', name: 'Orchid', colors: ['#781778', '#c520c5', '#e949e9'] },
  { id: 'magenta', name: 'Magenta', colors: ['#781758', '#c5208e', '#e949b4'] },
  { id: 'rose', name: 'Rose', colors: ['#781737', '#c52057', '#e9497e'] },
];

/** Every palette id, in display order. */
export const PLAYER_PALETTE_IDS: readonly string[] = PLAYER_PALETTES.map((p) => p.id);

const PALETTE_BY_ID: ReadonlyMap<string, PlayerPalette> = new Map(
  PLAYER_PALETTES.map((p) => [p.id, p]),
);

/** True when `id` names a real palette (a valid claim). */
export function isPaletteId(id: unknown): id is string {
  return typeof id === 'string' && PALETTE_BY_ID.has(id);
}

/** The palette for an id, or undefined when the id is unknown. */
export function getPalette(id: string): PlayerPalette | undefined {
  return PALETTE_BY_ID.get(id);
}

/** The three colors for a palette id, or an empty array when the id is unknown. */
export function paletteColors(id: string | undefined): readonly string[] {
  return id ? (PALETTE_BY_ID.get(id)?.colors ?? []) : [];
}

/**
 * The union of every color across every palette. Used as the lenient allowed-set when a drawing is
 * REPLAYED (any player's sketch may use any palette, so replay must accept them all) - the strict
 * per-player check happens only where a specific player's palette is known (the engine at collect).
 */
export const ALL_PALETTE_COLORS: ReadonlySet<string> = new Set(
  PLAYER_PALETTES.flatMap((p) => p.colors),
);

/**
 * Pick a random palette id not already taken, or `undefined` when every palette is claimed. The
 * control-plane calls this to hand a joining player a free palette (server-authoritative default);
 * `rng` is injectable so a test can pin the choice. `taken` is the set of ids other members hold.
 */
export function pickAvailablePalette(
  taken: Iterable<string>,
  rng: () => number = Math.random,
): string | undefined {
  const claimed = new Set(taken);
  const free = PLAYER_PALETTE_IDS.filter((id) => !claimed.has(id));
  if (free.length === 0) return undefined;
  return free[Math.floor(rng() * free.length)];
}
