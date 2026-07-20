'use client';

// Lone Leaf's viewer: the shared screen everyone watches. It never shows the hidden word while the
// round is live (the word is a per-player secret the Seeker must not see, delivered via the Remote's
// private channel), so the viewer is safe to broadcast to every device including the Seeker's. It
// renders who the Seeker is + the theme while clues are written, the remaining clues while the Seeker
// guesses, and the result (the word, the guess, whether the group got it) between rounds. It reads
// state; it never drives the game. Opaque prompt/reveals are decoded at the render boundary (spec
// 0023). The in-round prompt sits in a canopy Card with a countdown, and the result reuses the
// Lone Leaf reveal card, both matching Trivia's treatment (WS17).

import type { ReactNode } from 'react';
import type { GameViewProps } from '../registry';
import { useDwellCountdown } from '../../use-dwell-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asLoneLeafPrompt, pickResult, pickSurvivors } from './protocol';
import { LoneLeafPromptCard } from './PromptCard';
import { ResultReveal } from './ResultReveal';

export function LoneLeafViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const prompt = asLoneLeafPrompt(state.prompt);
  const survivors = pickSurvivors(state.reveals);
  const result = pickResult(state.reveals);
  const dwellSecondsLeft = useDwellCountdown(state.autoAdvanceMsRemaining, phase, state.paused);

  function nicknameOf(id: string): string {
    return players.find((player) => player.player === id)?.nickname ?? id;
  }

  if (phase === 'complete') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <FinalResults standings={standings} me={me} />
      </section>
    );
  }

  if (phase === 'leaderboard') {
    const revealBlock: ReactNode = result ? (
      <ResultReveal result={result} players={players} dwellSecondsLeft={dwellSecondsLeft} />
    ) : null;
    const waitingNote =
      dwellSecondsLeft === null ? (
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      ) : null;
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        {revealBlock}
        <Leaderboard standings={standings} me={me} autoAdvanceSecondsLeft={dwellSecondsLeft} />
        {waitingNote}
      </section>
    );
  }

  if (prompt && phase === 'guessing') {
    const seekerName = nicknameOf(prompt.seeker);
    const iAmSeeker = me === prompt.seeker;
    const survivorWords = survivors?.survivors ?? [];
    const heading = iAmSeeker
      ? 'Your remaining clues'
      : `${seekerName} is guessing from these clues`;
    const guessHint = iAmSeeker
      ? 'Type your one guess on your phone.'
      : 'Matching clues cancelled out. Only the unique ones are left.';
    const clueList =
      survivorWords.length === 0 ? (
        <p className="text-body text-text-muted">
          Every clue cancelled out - the Seeker has nothing to go on this round.
        </p>
      ) : (
        <ul aria-label="Remaining clues" className="flex flex-wrap gap-2">
          {survivorWords.map((word, index) => (
            <li
              key={`${word}-${index}`}
              className="rounded-md bg-surface-raised px-3 py-2 text-body text-text"
            >
              {word}
            </li>
          ))}
        </ul>
      );
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <LoneLeafPromptCard
          state={state}
          round={prompt.round}
          category={prompt.category}
          heading={heading}
        >
          {clueList}
        </LoneLeafPromptCard>
        <p className="text-body text-text-muted">{guessHint}</p>
      </section>
    );
  }

  if (prompt && phase === 'collecting') {
    const seekerName = nicknameOf(prompt.seeker);
    const iAmSeeker = me === prompt.seeker;
    const heading = iAmSeeker ? 'You are the Seeker' : `${seekerName} is the Seeker`;
    const intro = iAmSeeker
      ? 'You cannot see the word. Everyone else is writing a one-word clue to help you guess it.'
      : 'Write one word to help the Seeker - but matching clues cancel out, so think alike, not too alike.';
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <LoneLeafPromptCard
          state={state}
          round={prompt.round}
          category={prompt.category}
          heading={heading}
        >
          <p className="text-body text-text-muted">{intro}</p>
        </LoneLeafPromptCard>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">The first word is on its way.</p>
    </section>
  );
}
