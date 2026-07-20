'use client';

// Lone Leaf's round reveal (WS17): once the round resolves, the HIDDEN WORD is the focus, mirroring
// Trivia's AnswerReveal. The word is large and coloured by the outcome - green when the Seeker got it,
// red when they missed. The Seeker's guess sits below, and every player's clue lands in a
// Player | Clue table with a check / x per row: kept (unique) clues are green with a check, clues that
// matched another and cancelled out are red, struck through, with an x. Reads engine state only.
//
// It cannot reuse Trivia's AnswerReveal directly (Lone Leaf's reveal shape differs - a hidden word +
// per-player clues, not a canonical answer + submissions), so it is a thin Lone-Leaf-shaped component
// built from the same canopy Card / Table primitives and the shared check / x icons.

import type { PlayerView } from '@branchout/protocol';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@rogueoak/canopy/branches';
import { Card, CardContent } from '@rogueoak/canopy/twigs';
import type { LoneLeafResult } from './protocol';
import { CheckIcon, CrossIcon } from '../../../components/game/icons';

interface ResultRevealProps {
  result: LoneLeafResult;
  players: PlayerView[];
  /** Whole seconds left in the auto-advance dwell, or null when auto-advance is off / no dwell. */
  dwellSecondsLeft?: number | null;
}

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function ResultReveal({ result, players, dwellSecondsLeft = null }: ResultRevealProps) {
  const seekerName = nicknameOf(players, result.seeker);
  const correct = result.correct;
  // The word's own emphasis: green when the Seeker guessed it, red when they missed - the "draw
  // attention, more colour" the reveal is about.
  const tone = correct ? 'text-success' : 'text-danger';
  const border = correct ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5';

  let continuing = null;
  if (dwellSecondsLeft !== null) {
    continuing = (
      <p className="text-center text-body-sm text-text-muted" role="status" aria-live="polite">
        Continuing in {dwellSecondsLeft} {dwellSecondsLeft === 1 ? 'second' : 'seconds'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className={`w-full border ${border}`}>
        <CardContent className="flex flex-col items-center gap-1 py-5 text-center">
          <span className="text-caption uppercase tracking-wide text-text-subtle">
            Round {result.round} - the hidden word
          </span>
          <span className={`text-h1 font-semibold ${tone}`} data-testid="reveal-word">
            {result.seed}
          </span>
          <span className="text-body text-text">
            {seekerName} guessed <strong className={tone}>{result.guess || '(nothing)'}</strong>.
          </span>
          <span className={`text-body-sm font-medium ${tone}`}>
            {correct ? 'Your group guessed it.' : 'No one guessed it.'}
          </span>
        </CardContent>
      </Card>

      {result.leaves.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Clue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.leaves.map((leaf) => {
              const name = nicknameOf(players, leaf.player);
              const rowTone = leaf.survived ? 'text-success' : 'text-danger';
              const icon = leaf.survived ? <CheckIcon /> : <CrossIcon />;
              const verdict = leaf.survived ? 'kept' : 'removed';
              const wordClass = leaf.survived ? '' : 'line-through';
              return (
                <TableRow key={leaf.player}>
                  <TableCell className="font-medium text-text">{name}</TableCell>
                  <TableCell>
                    <span
                      className={`flex items-center gap-2 ${rowTone}`}
                      aria-label={`${name}'s clue ${leaf.word}, ${verdict}`}
                    >
                      <span aria-hidden className="shrink-0">
                        {icon}
                      </span>
                      <span className={`min-w-0 break-words ${wordClass}`}>{leaf.word}</span>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      {continuing}
    </div>
  );
}
