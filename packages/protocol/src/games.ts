// Per-game player limits (spec 0050): the min/max number of PLAYING members (interactive + remote)
// a game supports. Viewers are observers and do NOT count toward these bounds. Shared by the web
// lobby (the mode picker's max clamp + the start gate's min) and the control-plane (join / mode
// enforcement) so the client UI and the server authority can never drift.

/** The inclusive playing-member range a game supports. Viewers are excluded from this count. */
export interface PlayerLimits {
  /** Fewest playing (interactive + remote) members required before a start is allowed. */
  min: number;
  /** Most playing members allowed; once reached, additional joiners must be viewers. */
  max: number;
}

/** Player limits by engine game id. A game absent here falls back to {@link DEFAULT_PLAYER_LIMITS}. */
export const PLAYER_LIMITS: Readonly<Record<string, PlayerLimits>> = {
  trivia: { min: 1, max: 8 },
  'liar-liar': { min: 2, max: 8 },
  'teeter-tower': { min: 1, max: 4 },
  // Reversi is a strict 2-player board game (spec 0054): exactly two seats, no viewers-as-players.
  reversi: { min: 2, max: 2 },
};

/** Permissive fallback (1-8) for an unknown or unregistered game id. */
export const DEFAULT_PLAYER_LIMITS: PlayerLimits = { min: 1, max: 8 };

/** The player limits for a game id, falling back to {@link DEFAULT_PLAYER_LIMITS}. */
export function playerLimits(gameId: string): PlayerLimits {
  return PLAYER_LIMITS[gameId] ?? DEFAULT_PLAYER_LIMITS;
}
