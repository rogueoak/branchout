// The narrow write port RoomService depends on to record per-account plays (spec 0027). Owned by
// `rooms` (the consumer) per dependency inversion, so the rooms domain no longer imports from its
// peer `profiles` domain - the profiles `PlaysRepository` structurally satisfies this port and is
// wired in at the composition root. Kept to the single method the game-complete seam actually calls,
// so it ages without trending toward a rooms<->profiles cycle (architect review, PR #47).

/** A completed-game play the room service hands off to be recorded (shape mirrors a profiles play). */
export interface RoomGamePlay {
  accountId: string;
  gameId: string;
  game: string;
  rank: number;
  stars: number;
}

/** What RoomService needs of the plays store: record a batch from one completed game (idempotent). */
export interface PlaysRecorder {
  recordPlays(plays: readonly RoomGamePlay[]): Promise<void>;
}
