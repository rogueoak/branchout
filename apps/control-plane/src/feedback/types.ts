/**
 * Shared feedback types (spec 0048). Kept in their own module so both the route (which reads and caps
 * the context off the request) and the renderer (which formats it) depend on this, not on each other -
 * the dependency graph flows route -> render -> types, never route <-> render.
 */

/**
 * Auto-captured context the web dialog attaches to a feedback note (spec 0048). Every field is
 * optional and untrusted - it comes from the browser - so the route treats it as best-effort
 * annotation, never as anything it authorizes on. No PII and no session token: just enough for the
 * recipient to act (which room, which game, where in the game, that the sender was the host).
 */
export interface FeedbackContext {
  /** The room join code. */
  code?: string;
  /** The selected game id (the engine/registry plugin id). */
  game?: string;
  /** The current game phase/status. */
  phase?: string;
  /** Whether the sender is the host (the button is host-only, so this is normally true). */
  isHost?: boolean;
  /** ISO timestamp the browser stamped when the host submitted. */
  at?: string;
}
