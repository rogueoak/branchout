'use client';

// Same Branch viewer: the shared screen everyone watches. It shows the branch (its two ends) and who
// the Reader is while the grove sets the sap line; the Reader reads the hunch aloud (it is not
// broadcast mid-round). At reveal it paints the bud, the Reader's hunch, and every guess on the branch
// and shows who landed where. The bud is NEVER shown here before the reveal - the viewer only ever
// reads the broadcast prompt/reveal, never the private secret. It reads state; it never drives the game.

import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { useMoveCountdown } from '../../use-move-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { BranchDial, type DialMarker } from './BranchDial';
import { asSameBranchPrompt, pickReveal } from './protocol';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function SameBranchViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const prompt = asSameBranchPrompt(state.prompt);
  const reveal = pickReveal(state.reveals);
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);

  if (phase === 'complete') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <FinalResults standings={standings} me={me} />
      </section>
    );
  }

  if (phase === 'leaderboard') {
    const markers: DialMarker[] = reveal
      ? [
          { position: reveal.bud, label: 'bud', tone: 'bud' as const },
          ...reveal.guesses.map((g) => ({
            position: g.position,
            label: nicknameOf(players, g.player),
            tone: g.player === me ? ('me' as const) : ('guess' as const),
          })),
        ]
      : [];
    let revealCard = null;
    if (reveal) {
      revealCard = (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4">
          <Badge variant="primary" className="w-fit">
            Round {reveal.round} - the bud
          </Badge>
          <p className="text-body-sm text-text-muted">
            {nicknameOf(players, reveal.reader)} read: {reveal.hunch || '(no hunch)'}
          </p>
          <BranchDial
            left={reveal.left}
            right={reveal.right}
            value={reveal.bud}
            markers={markers}
            ariaLabel="Round result on the branch"
          />
          <ul aria-label="Round result" className="flex flex-col gap-1">
            {reveal.guesses.map((g) => {
              const who = g.player === me ? 'You' : nicknameOf(players, g.player);
              const pointWord = g.points === 1 ? 'point' : 'points';
              return (
                <li key={g.player} className="flex items-baseline justify-between gap-3">
                  <span className="text-body text-text">{who}</span>
                  <span className="text-body-sm text-text-subtle">
                    {g.band} - {g.points} {pointWord}
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
        {revealCard}
        <Leaderboard standings={standings} me={me} />
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      </section>
    );
  }

  if (prompt && phase === 'collecting') {
    const isReader = prompt.reader === me;
    let timerBadge = null;
    if (secondsLeft !== null) {
      timerBadge = (
        <Badge variant={secondsLeft <= 15 ? 'warning' : 'neutral'}>
          <span role="timer" aria-label={`${secondsLeft} seconds left`}>
            {secondsLeft}s left
          </span>
        </Badge>
      );
    }
    const readerHint = isReader
      ? 'You are the Reader - only you can see the bud. Give a one-line hunch that fits it.'
      : `${nicknameOf(players, prompt.reader)} sees the hidden bud and will read a hunch. Move the sap line to guess where it is.`;
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          <Badge variant="neutral">Reader: {nicknameOf(players, prompt.reader)}</Badge>
          {timerBadge}
        </div>
        <h2 className="text-h2 text-text">Where does the bud sit on the branch?</h2>
        <BranchDial left={prompt.left} right={prompt.right} value={null} ariaLabel="The branch" />
        <p className="text-body text-text-muted">{readerHint}</p>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">The first branch is on its way.</p>
    </section>
  );
}
