// Trivia's payload decoders for the game-pluggable client (spec 0023). The base guards
// (asTriviaPrompt / asTriviaRoundReveal / asTriviaDisputeReveal) live in lib/game-protocol.ts; this
// module re-exports them for the trivia UI module and adds pickers over the reducer's opaque
// `reveals: unknown[]` list - a round can stream several reveals, so the UI reads whichever shape it
// recognizes rather than a single last-write-wins slot.

import {
  asTriviaRoundReveal,
  asTriviaDisputeReveal,
  type TriviaRoundReveal,
  type TriviaDisputeReveal,
} from '../../game-protocol';

export {
  asTriviaPrompt,
  asTriviaRoundReveal,
  asTriviaDisputeReveal,
  type TriviaPrompt,
  type TriviaRoundReveal,
  type TriviaDisputeReveal,
  type TriviaSubmission,
} from '../../game-protocol';

/** The most recent answer-round reveal in the round's streamed reveals, or null. */
export function pickTriviaRoundReveal(reveals: readonly unknown[]): TriviaRoundReveal | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asTriviaRoundReveal(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}

/** The post-dispute reveal in the round's streamed reveals, or null. */
export function pickTriviaDisputeReveal(reveals: readonly unknown[]): TriviaDisputeReveal | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asTriviaDisputeReveal(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
