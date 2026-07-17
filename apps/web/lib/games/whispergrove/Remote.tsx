'use client';

// Whispergrove's remote: the private controller each player acts on (spec 0062). It branches on the
// live `sim` (Whispergrove is a LIVE game, so the engine phase stays `collecting`; the turn/phase
// come from the sim) and on the player's seat:
//   - The WHISPERER sees the secret key (read from `state.private`, the spec 0052 targeted frame that
//     ONLY the two Whisperers receive) as colored rings on the grove, and composes a one-word whisper
//     plus a count when it is their grove's turn.
//   - A SEEKER taps a leaf on the grove when it is their grove's turn to guess.
// It sends `move` frames (a whisper or a tap) and reflects the phase the engine/sim reports; it never
// tallies or times. The opaque `sim`/`private` are decoded here at the render boundary (spec 0023).

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { asWhispergroveSim, asWhispererSecret, seatOf } from './protocol';
import { Grove, teamName } from './Grove';

export function WhispergroveRemote({ state, me, showResults = false, onMove }: GameRemoteProps) {
  const { round } = state;
  const sim = asWhispergroveSim(state.sim);
  const secret = asWhispererSecret(state.private);

  const [word, setWord] = useState('');
  const [count, setCount] = useState('1');

  // Clear the whisper draft when a fresh whisper phase begins (turn changes / a whisper was accepted).
  const phaseKey = sim ? `${sim.turn}:${sim.phase}` : '';
  useEffect(() => {
    setWord('');
    setCount('1');
  }, [phaseKey]);

  if (!sim) {
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <p className="text-body text-text-muted">Joining the grove...</p>
      </section>
    );
  }

  const seat = seatOf(sim, me);
  const over = sim.phase === 'over';

  // A spectator/host with no seat just watches (and, when remote-only, sees the results).
  if (!seat) {
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <p className="text-body-sm text-text-muted">You are watching the grove.</p>
        {over && showResults ? <FinalResults standings={state.standings} me={me} /> : null}
      </section>
    );
  }

  const myTurn = seat.team === sim.turn && !over;
  const isWhisperer = seat.role === 'whisperer';
  // The Whisperer's key comes over the private channel; align it with the grove's leaf order.
  const keyView = isWhisperer && secret ? secret.key : null;

  function submitWhisper() {
    const trimmed = word.trim();
    const n = Number.parseInt(count, 10);
    if (!trimmed || !Number.isFinite(n)) return;
    onMove(round, JSON.stringify({ kind: 'whisper', word: trimmed, count: n }));
    setWord('');
  }

  function tap(index: number) {
    onMove(round, JSON.stringify({ kind: 'tap', index }));
  }

  const canTap = myTurn && sim.phase === 'guessing' && !isWhisperer && sim.guessesLeft > 0;

  // The turn/phase status block, phrased from this player's grove + seat. Built by role/phase so the
  // render tree stays flat (no deep nested ternary in JSX).
  let turnStatus;
  if (!myTurn) {
    const waiting =
      sim.phase === 'whispering' ? ' is whispering. Hold tight.' : ' is guessing. Hold tight.';
    turnStatus = (
      <p className="text-body-sm text-text-muted">
        {teamName(sim.turn)}
        {waiting}
      </p>
    );
  } else if (isWhisperer && sim.phase === 'whispering') {
    const whisperHint = state.rejected ? (
      <Badge variant="danger" className="w-fit" role="alert">
        {state.rejected}
      </Badge>
    ) : (
      <p className="text-body-sm text-text-subtle">
        The whisper cannot be a word on the grove. Your seekers get one bonus tap.
      </p>
    );
    turnStatus = (
      <div className="flex flex-col gap-2">
        <p className="text-body-sm font-medium text-text">Your turn - give one word and a count.</p>
        <div className="flex gap-2">
          <Input
            id="whisper-word"
            value={word}
            autoComplete="off"
            aria-label="Whisper word"
            placeholder="One word"
            onChange={(event) => setWord(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitWhisper();
            }}
          />
          <Input
            id="whisper-count"
            value={count}
            inputMode="numeric"
            aria-label="Whisper count"
            className="w-16"
            onChange={(event) => setCount(event.target.value.replace(/[^0-9]/g, ''))}
          />
          <Button type="button" variant="primary" onClick={submitWhisper} disabled={!word.trim()}>
            Whisper
          </Button>
        </div>
        {whisperHint}
      </div>
    );
  } else if (isWhisperer) {
    turnStatus = (
      <p className="text-body-sm text-text-muted">
        Your seekers are tapping - you cannot help now.
      </p>
    );
  } else if (sim.phase === 'guessing') {
    const tapWord = sim.guessesLeft === 1 ? 'tap' : 'taps';
    turnStatus = (
      <p className="text-body-sm font-medium text-text">
        Your turn - tap a leaf. {sim.guessesLeft} {tapWord} left.
      </p>
    );
  } else {
    turnStatus = (
      <p className="text-body-sm text-text-muted">Wait for your Whisperer&apos;s whisper.</p>
    );
  }

  const tapReject =
    state.rejected && canTap ? (
      <Badge variant="danger" className="w-fit" role="alert">
        {state.rejected}
      </Badge>
    ) : null;

  let whispererHint = null;
  if (isWhisperer) {
    whispererHint = (
      <p className="text-body-sm text-text-subtle">
        The rings show your secret key: violet, amber, sapling (grey), and the red Deadwood. Do not
        say a word that lands your grove on a sapling, the enemy, or the Deadwood.
      </p>
    );
  }

  const seatBadgeVariant = seat.team === 'violet' ? 'primary' : 'info';
  const seatRoleLabel = isWhisperer ? 'Whisperer' : 'Seeker';

  let body;
  if (over) {
    const winVariant = sim.winner === seat.team ? 'success' : 'danger';
    const winText = sim.winner === seat.team ? 'Your grove wins!' : `${teamName(sim.winner!)} wins`;
    const finalResults = showResults ? <FinalResults standings={state.standings} me={me} /> : null;
    body = (
      <>
        <Badge variant={winVariant} className="w-fit" role="status">
          {winText}
        </Badge>
        {finalResults}
      </>
    );
  } else {
    body = (
      <>
        {/* Turn / phase status, phrased from this player's grove. */}
        {turnStatus}
        {tapReject}
        {/* The grove: the Whisperer sees the secret key rings; a seeker taps when allowed. */}
        <Grove leaves={sim.leaves} keyView={keyView} onTap={tap} canTap={canTap} />
        {whispererHint}
      </>
    );
  }

  return (
    <section aria-label="Your controller" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge variant={seatBadgeVariant} className="w-fit">
          {teamName(seat.team)}
        </Badge>
        <Badge variant="neutral" className="w-fit">
          {seatRoleLabel}
        </Badge>
      </div>
      {body}
    </section>
  );
}
