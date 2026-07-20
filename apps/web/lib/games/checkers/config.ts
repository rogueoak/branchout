// Host-facing Checkers configuration for the lobby (spec 0055, spec 0071), mirroring the engine's
// config shape (packages/games/checkers/src/checkers.ts). Checkers is fixed 8x8 standard English
// draughts; the one host option is whether the board shows the legal-move hints (the movable-source
// rings and destination dots). The engine re-validates on the start handoff and owns the authority;
// this mirror lets the lobby render a valid form and flow the choice through.

/** A host's Checkers choices. */
export interface CheckersHostConfig {
  /** Show the legal-move hints on the board. Default true; a host may turn it off. */
  showAvailableMoves: boolean;
}

/** The defaulted config a fresh lobby starts from: hints on. */
export function defaultCheckersConfig(): CheckersHostConfig {
  return { showAvailableMoves: true };
}
