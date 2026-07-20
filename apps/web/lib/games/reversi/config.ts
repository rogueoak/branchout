// Host-facing Reversi configuration for the lobby (spec 0054), mirroring the engine's config shape
// (packages/games/reversi/src/reversi.ts). Reversi is fixed 8x8 standard rules; the one host option is
// whether the board shows the legal-move hint dots. The engine re-validates on the start handoff and
// owns the authority; this mirror lets the lobby render a valid form and flow the choice through.

/** A host's Reversi choices. */
export interface ReversiHostConfig {
  /** Show the legal-move hint dots on the board. Default true; a host may turn it off. */
  showAvailableMoves: boolean;
}

/** The defaulted config a fresh lobby starts from: hints on. */
export function defaultReversiConfig(): ReversiHostConfig {
  return { showAvailableMoves: true };
}
