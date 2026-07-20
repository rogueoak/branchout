'use client';

// The reveal / answer screen (spec 0069, WS5): once the round closes, the answer is the focus. The
// question shrinks to a caption; the canonical answer is large and coloured by the outcome - red
// when nobody got it, green when someone did. Every player's guess lands in a Player | Answer table
// with a check / x per row (correct rows green, the rest red). When auto-advance is on, a
// "Continuing in x seconds" line counts down the dwell before the next hop. Reads engine state only.

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
import type { TriviaDisputeReveal, TriviaRoundReveal } from './protocol';
import { CheckIcon, CrossIcon } from '../../../components/game/icons';

interface AnswerRevealProps {
  reveal: TriviaRoundReveal;
  players: PlayerView[];
  phase: string;
  disputeResult: TriviaDisputeReveal | null;
  /** Whole seconds left in the auto-advance dwell, or null when auto-advance is off / no dwell. */
  dwellSecondsLeft: number | null;
}

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function AnswerReveal({
  reveal,
  players,
  phase,
  disputeResult,
  dwellSecondsLeft,
}: AnswerRevealProps) {
  const answer = reveal.answers[0] ?? null;
  const nobodyCorrect = reveal.correct.length === 0;
  // The answer's own emphasis: red when the whole table missed it, green when at least one player
  // got it. This is the "draw attention, more colour" the reveal screen is about.
  const answerTone = nobodyCorrect ? 'text-danger' : 'text-success';
  const answerBorder = nobodyCorrect
    ? 'border-danger/40 bg-danger/5'
    : 'border-success/40 bg-success/5';

  const submissions = reveal.submissions ?? [];

  let continuing = null;
  if (dwellSecondsLeft !== null && phase !== 'voting') {
    continuing = (
      <p className="text-center text-body-sm text-text-muted" role="status" aria-live="polite">
        Continuing in {dwellSecondsLeft} {dwellSecondsLeft === 1 ? 'second' : 'seconds'}
      </p>
    );
  }

  let votingNote = null;
  if (phase === 'voting') {
    votingNote = (
      <p className="text-body-sm text-text-muted" role="status">
        A dispute is being voted on.
      </p>
    );
  }

  let upheldNote = null;
  if (disputeResult && disputeResult.upheld.length > 0) {
    upheldNote = (
      <p className="text-body-sm text-text">
        Dispute upheld: {disputeResult.upheld.map((id) => nicknameOf(players, id)).join(', ')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {reveal.question ? <p className="text-body-sm text-text-muted">{reveal.question}</p> : null}

      <Card className={`w-full border ${answerBorder}`}>
        <CardContent className="flex flex-col items-center gap-1 py-5 text-center">
          <span className="text-caption uppercase tracking-wide text-text-subtle">Answer</span>
          <span className={`text-h1 font-semibold ${answerTone}`} data-testid="reveal-answer">
            {answer ?? 'No answer'}
          </span>
          {reveal.answers.length > 1 ? (
            <span className="text-body-sm text-text-muted">
              Also accepted: {reveal.answers.slice(1).join(', ')}
            </span>
          ) : null}
          <span className={`text-body-sm font-medium ${answerTone}`}>
            {nobodyCorrect ? 'Nobody got it.' : `${reveal.correct.length} got it right`}
          </span>
        </CardContent>
      </Card>

      {submissions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Answer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((submission) => {
              const name = nicknameOf(players, submission.player);
              const rowTone = submission.correct ? 'text-success' : 'text-danger';
              const icon = submission.correct ? <CheckIcon /> : <CrossIcon />;
              const verdict = submission.correct ? 'correct' : 'wrong';
              // A blank submission is a give-up (WS16): the player passed, sending an empty answer that
              // scores wrong. Show it as "No answer" so the row reads plainly instead of an empty cell.
              const blank = submission.answer.trim() === '';
              const shown = blank ? 'No answer' : submission.answer;
              const answerNode = blank ? (
                <span className="italic text-text-muted">{shown}</span>
              ) : (
                shown
              );
              return (
                <TableRow key={submission.player}>
                  <TableCell className="font-medium text-text">{name}</TableCell>
                  <TableCell>
                    <span
                      className={`flex items-center gap-2 ${rowTone}`}
                      aria-label={`${name} answered ${shown}, ${verdict}`}
                    >
                      <span aria-hidden className="shrink-0">
                        {icon}
                      </span>
                      <span className="min-w-0 break-words">{answerNode}</span>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      {votingNote}
      {upheldNote}
      {continuing}
    </div>
  );
}
