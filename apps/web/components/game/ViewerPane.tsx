'use client';

// The viewer: the shared screen everyone watches. It renders the current phase of engine state -
// the prompt while answering, the reveal and scoring once the round closes, the dispute vote in
// progress, the between-round leaderboard, and the final results. It reads state; it never drives
// the game.

import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameState } from '../../lib/game-state';
import {
  asTriviaPrompt,
  pickTriviaRoundReveal,
  pickTriviaDisputeReveal,
} from '../../lib/games/trivia/protocol';
import { difficultyBand } from '../../lib/trivia-config';
import { toDisplayAnswer } from '../../lib/title-case';
import { useAnswerCountdown } from '../../lib/use-answer-countdown';
import { FinalResults } from './FinalResults';
import { Leaderboard } from './Leaderboard';

interface ViewerPaneProps {
  state: GameState;
  me?: string;
}

/** Map a player id to a nickname from the current roster, falling back to the id. */
function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function ViewerPane({ state, me }: ViewerPaneProps) {
  const { phase, standings, players } = state;
  // Decode the opaque prompt/reveals into Trivia shapes at the render boundary (spec 0023): the
  // reducer stores them raw; a shape this game does not recognize is a null, a skipped render.
  const prompt = asTriviaPrompt(state.prompt);
  const reveal = pickTriviaRoundReveal(state.reveals);
  const disputeResult = pickTriviaDisputeReveal(state.reveals);
  const secondsLeft = useAnswerCountdown(state.answerMsRemaining, state.round, state.paused);

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-5">
      {/* The paused banner lives once at the GameStage level (host-aware, honest for both a
          deliberate pause and a host disconnect), so the viewer pane does not carry its own. */}
      {phase === 'complete' ? (
        <FinalResults standings={standings} me={me} />
      ) : phase === 'leaderboard' ? (
        <div className="flex flex-col gap-3">
          <Leaderboard standings={standings} me={me} />
          <p className="text-body-sm text-text-muted">
            Waiting for the host to start the next round.
          </p>
        </div>
      ) : prompt ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">Round {prompt.round}</Badge>
            <Badge variant="neutral">{prompt.category}</Badge>
            <Badge variant="neutral">{difficultyBand(prompt.difficulty)}</Badge>
            {phase === 'collecting' && secondsLeft !== null ? (
              <Badge variant={secondsLeft <= 10 ? 'warning' : 'neutral'}>
                <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                  {secondsLeft}s left
                </span>
              </Badge>
            ) : null}
          </div>
          <h2 className="text-h2 text-text" data-testid="question-prompt">
            {prompt.question}
          </h2>

          {reveal ? (
            <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4">
              <p className="text-body-sm text-text-muted">Answer</p>
              <p className="text-h4 text-text" data-testid="reveal-answer">
                {reveal.answers[0] ? toDisplayAnswer(reveal.answers[0]) : 'No answer'}
              </p>
              {reveal.answers.length > 1 ? (
                <p className="text-body-sm text-text-muted">
                  Also accepted: {reveal.answers.slice(1).map(toDisplayAnswer).join(', ')}
                </p>
              ) : null}
              <p className="text-body-sm text-success">
                {reveal.correct.length === 0
                  ? 'Nobody got it.'
                  : `Correct: ${reveal.correct.map((id) => nicknameOf(players, id)).join(', ')}`}
              </p>
              {(reveal.submissions ?? []).length > 0 ? (
                <ul aria-label="Everyone's answers" className="flex flex-col gap-1">
                  {(reveal.submissions ?? []).map((s) => (
                    <li key={s.player} className="flex items-baseline justify-between gap-3">
                      <span className="shrink-0 text-body-sm text-text-muted">
                        {nicknameOf(players, s.player)}
                      </span>
                      {/* min-w-0 + break-words lets a long guess wrap instead of overflowing or
                          squashing the nickname at ~360px (mobile-first). */}
                      <span
                        className={`min-w-0 break-words text-right text-body-sm ${
                          s.correct ? 'text-success' : 'text-text'
                        }`}
                        aria-label={`${nicknameOf(players, s.player)} answered ${s.answer}, ${
                          s.correct ? 'correct' : 'wrong'
                        }`}
                      >
                        {s.correct ? '✓' : '✗'} {toDisplayAnswer(s.answer)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {phase === 'voting' ? (
                <p className="text-body-sm text-text-muted" role="status">
                  A dispute is being voted on.
                </p>
              ) : null}
              {disputeResult && disputeResult.upheld.length > 0 ? (
                <p className="text-body-sm text-text">
                  Dispute upheld:{' '}
                  {disputeResult.upheld.map((id) => nicknameOf(players, id)).join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-h3 text-text">Get ready</h2>
          <p className="text-body text-text-muted">The first question is on its way.</p>
        </div>
      )}
    </section>
  );
}
