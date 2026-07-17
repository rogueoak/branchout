// Brambles wire payload shapes (spec 0061). The engine streams these as opaque `sim` frames (the
// shared sprint state everyone watches) and opaque `private` frames (the bloom + thorns, delivered
// ONLY to the active team's Guide). The web decodes them defensively at the render boundary. Nothing
// here ever carries the bloom or thorns in the broadcast `sim` - the secret travels only in
// `BramblesSecret`.

/** The two groves (teams), for display. Index 0 = Violet grove, index 1 = Amber grove. */
export type TeamIndex = 0 | 1;

/** One entry in the sprint's running clue/guess log, shown to everyone (never leaks the secret). */
export interface BramblesLogEntry {
  /** The kind of event: a clue the Guide typed, a correct guess, a prick, or a skip. */
  kind: 'clue' | 'guess' | 'prick' | 'skip';
  /** Display text: the clue, the guessed bloom, or a short note. */
  text: string;
  /** The player who caused it (Guide or guesser), for attribution. */
  player: string;
}

/** A player's move, JSON-encoded on the wire. The Guide sends `clue`/`skip`; teammates send `guess`. */
export interface BramblesMove {
  kind: 'clue' | 'guess' | 'skip';
  /** The typed clue or guess text (ignored for `skip`). */
  text?: string;
}

/**
 * The broadcast sprint snapshot everyone watches (the `sim` frame). Deliberately carries NO bloom and
 * NO thorns: the target is a secret held only by the Guide. It shows whose sprint it is, the running
 * score, the seconds left, and the public clue/guess log so the guessing team can play along.
 */
export interface BramblesSim {
  /** True once the game is over (all sprints played); the viewer shows final standings. */
  over: boolean;
  /** The 1-indexed sprint (team turn) in progress, and the total. */
  sprint: number;
  totalSprints: number;
  /** Which team is on the clock this sprint (0 or 1). */
  activeTeam: TeamIndex;
  /** The active team's Guide (player id), who alone sees the bloom + thorns. */
  guide: string;
  /** Blooms scored by each team so far this game: [team0, team1]. */
  teamScores: [number, number];
  /** Blooms scored in THIS sprint so far. */
  bloomsThisSprint: number;
  /** Cards pricked (burned on a thorn/bloom slip) this sprint so far. */
  pricksThisSprint: number;
  /** Whole seconds left in the current sprint (0 once time is up). */
  secondsLeft: number;
  /** The running public log of clues/guesses/pricks this sprint (most recent last). */
  log: BramblesLogEntry[];
}

/**
 * The Guide's secret for the current card (the `private` frame). Delivered ONLY to the active team's
 * Guide - never broadcast, never sent to the opposing team, never sent to the guessing teammates. The
 * engine (spec 0052) targets this to the Guide's device(s) and restores it on reconnect.
 */
export interface BramblesSecret {
  /** The target word the Guide must get their team to say. */
  bloom: string;
  /** The forbidden words that PRICK the card if the Guide types one. */
  thorns: string[];
}
