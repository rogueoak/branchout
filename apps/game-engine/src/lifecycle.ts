// The game-facing lifecycle contract now lives in @branchout/game-sdk (the harness<->game seam).
// This module re-exports it so the engine's internal callers keep importing from './lifecycle'.

export type {
  SessionPlayer,
  RoundContext,
  VoteInput,
  ConfigureResult,
  StartRoundResult,
  RevealResult,
  DisputeWindowResult,
  DisputeVoteResult,
  AdvanceResult,
  ScratchResult,
  GameModule,
} from '@branchout/game-sdk';
