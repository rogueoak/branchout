'use client';

// Sketchy's viewer: the shared screen everyone watches (spec 0063). It renders the "everyone is
// drawing" cue during a draw round, the gallery of sketches between rounds, the featured sketch +
// shuffled options while everyone guesses, and the round result (the true seed, who wrote each decoy,
// who it fooled, who guessed right) - then the standings and final results. It reads state; it never
// drives the game. The opaque prompt/reveals are decoded at the render boundary. A player's own seed
// is NEVER on the shared screen (it lives only in that player's private payload).

import type { ReactNode } from 'react';
import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { useMoveCountdown } from '../../use-move-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asSketchyPrompt, pickGallery, pickOptions, pickResult } from './protocol';
import { SketchReplay } from './SketchReplay';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

/** The countdown badge shown while a round is timed; null once the timer has stopped. */
function timerBadge(secondsLeft: number | null, warnAt: number): ReactNode {
  if (secondsLeft === null) return null;
  const variant = secondsLeft <= warnAt ? 'warning' : 'neutral';
  return (
    <Badge variant={variant}>
      <span role="timer" aria-label={`${secondsLeft} seconds left`}>
        {secondsLeft}s left
      </span>
    </Badge>
  );
}

/** The "<name>'s sketch" badge, or null when there is no featured player. */
function featuredBadge(featured: string | null | undefined, players: PlayerView[]): ReactNode {
  if (!featured) return null;
  return <Badge variant="neutral">{nicknameOf(players, featured)}&apos;s sketch</Badge>;
}

/** The attribution line under a round-result option (own decoy / another's decoy / the real seed). */
function optionAuthorLabel(
  option: { kind: 'truth' | 'decoy'; author?: string | null },
  me: string | undefined,
  players: PlayerView[],
): ReactNode {
  if (option.kind === 'decoy' && option.author === me) {
    return <strong className="text-secondary">Your decoy</strong>;
  }
  if (option.kind === 'decoy' && option.author) {
    return `Decoy by ${nicknameOf(players, option.author)}`;
  }
  return 'The real seed';
}

export function SketchyViewer({ state, me, sharesDeviceWithRemote = false }: GameViewProps) {
  // In interactive mode the guesser's/featured player's Remote pane already shows the featured sketch,
  // so the shared viewer suppresses its duplicate copy to keep exactly one canvas on screen (spec
  // 0063 canvas-UX). In viewer-only mode the panes are on different devices, so the viewer shows it.
  const hideSketchCanvas = sharesDeviceWithRemote;
  const { phase, standings, players } = state;
  const prompt = asSketchyPrompt(state.prompt);
  const options = pickOptions(state.reveals);
  const result = pickResult(state.reveals);
  const gallery = pickGallery(state.reveals);
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);

  if (phase === 'complete') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <FinalResults standings={standings} me={me} />
      </section>
    );
  }

  if (phase === 'leaderboard') {
    let roundRecap = null;
    if (result) {
      const featuredName = result.featured ? nicknameOf(players, result.featured) : 'a player';
      let resultSketch = null;
      if (result.sketch) {
        resultSketch = (
          <div className="mx-auto w-full max-w-xs">
            <SketchReplay sketch={result.sketch} label={`Sketch by ${featuredName}`} />
          </div>
        );
      }
      const guessersLine =
        result.correctGuessers.length === 0
          ? 'Nobody found the true seed!'
          : `Found the true seed: ${result.correctGuessers
              .map((id) => nicknameOf(players, id))
              .join(', ')}`;
      roundRecap = (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4">
          <Badge variant="primary" className="w-fit">
            Round {result.round} - the true seed
          </Badge>
          {resultSketch}
          <p className="text-h3 text-success">{result.trueSeed}</p>
          <ul aria-label="Round result" className="flex flex-col gap-2">
            {result.options.map((option) => {
              const isTruth = option.kind === 'truth';
              const textTone = isTruth ? 'font-medium text-success' : 'text-text';
              const truthSuffix = isTruth ? ' (the true seed)' : '';
              const fooled =
                option.kind === 'decoy' && option.pickedBy.length > 0
                  ? ` - fooled ${option.pickedBy.map((id) => nicknameOf(players, id)).join(', ')}`
                  : '';
              return (
                <li key={option.id} className="flex flex-col gap-0.5">
                  <span className={`break-words text-body ${textTone}`}>
                    {option.text}
                    {truthSuffix}
                  </span>
                  <span className="text-caption text-text-subtle">
                    {optionAuthorLabel(option, me, players)}
                    {fooled}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-body-sm text-text">{guessersLine}</p>
        </div>
      );
    } else if (gallery) {
      roundRecap = (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4">
          <Badge variant="primary" className="w-fit">
            Round {gallery.round} - the sketches
          </Badge>
          <ul aria-label="The sketches" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.gallery.map((entry) => {
              let entrySketch = null;
              if (entry.sketch) {
                entrySketch = (
                  <SketchReplay
                    sketch={entry.sketch}
                    label={`Sketch by ${nicknameOf(players, entry.player)}`}
                  />
                );
              }
              return (
                <li key={entry.player} className="flex flex-col gap-1">
                  {entrySketch}
                  <span className="text-caption text-text-subtle">
                    {nicknameOf(players, entry.player)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        {roundRecap}
        <Leaderboard standings={standings} me={me} />
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      </section>
    );
  }

  if (phase === 'guessing' && options) {
    // In interactive mode the guesser's Remote pane already shows this sketch; suppress the viewer's
    // copy so exactly one canvas is on screen (spec 0063 canvas-UX). Viewer-only mode still shows it.
    let sketchToGuess = null;
    if (options.sketch && !hideSketchCanvas) {
      sketchToGuess = (
        <div className="mx-auto w-full max-w-sm">
          <SketchReplay sketch={options.sketch} label="The sketch to guess" />
        </div>
      );
    }
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {options.round}</Badge>
          {featuredBadge(options.featured, players)}
          {timerBadge(secondsLeft, 10)}
        </div>
        {sketchToGuess}
        <p className="text-body text-text-muted">
          Which one is the true seed? Pick the real prompt on your phone.
        </p>
        <ol aria-label="Seeds to guess" className="flex flex-col gap-2">
          {options.options.map((option, index) => (
            <li
              key={option.id}
              className="flex items-baseline gap-3 rounded-md bg-surface-raised px-3 py-2"
            >
              <span className="tabular-nums text-text-subtle">{index + 1}</span>
              <span className="break-words text-body text-text">{option.text}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (phase === 'collecting' && prompt?.stage === 'sketch') {
    // Decoy stage: the non-featured writers see this sketch on their Remote and the featured player
    // sees it on theirs, so in interactive mode suppress the viewer's duplicate (single canvas, spec
    // 0063 canvas-UX). Viewer-only mode has no Remote pane, so it still shows the featured sketch.
    let featuredSketch = null;
    if (prompt.sketch && !hideSketchCanvas) {
      featuredSketch = (
        <div className="mx-auto w-full max-w-sm">
          <SketchReplay sketch={prompt.sketch} label="The featured sketch" />
        </div>
      );
    }
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          {featuredBadge(prompt.featured, players)}
          {timerBadge(secondsLeft, 10)}
        </div>
        {featuredSketch}
        <p className="text-body text-text-muted">
          Everyone is writing a fake seed for this sketch. Fool your friends!
        </p>
      </section>
    );
  }

  if (phase === 'collecting' && prompt?.stage === 'draw') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          {timerBadge(secondsLeft, 15)}
        </div>
        <h2 className="text-h2 text-text">Everyone is drawing their secret seed</h2>
        <p className="text-body text-text-muted">
          Each player has a different prompt only they can see. Draw it on your phone!
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">The first seeds are on their way.</p>
    </section>
  );
}
