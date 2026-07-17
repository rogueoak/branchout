'use client';

// React glue over the framework-agnostic GameClient. Given connection options it opens the socket,
// subscribes the component to state, and hands back the three player actions; passing `null` (the
// game is not running yet) keeps the hook inert. The client is rebuilt only when an identity field
// changes, so a re-render does not churn the socket.

import { useEffect, useRef, useState } from 'react';
import { GameClient, type GameClientOptions } from './game-client';
import { initialGameState, type GameState } from './game-state';

export interface GameActions {
  submitMove: (round: number, move: string) => void;
  /** The generic vote action every game UI module uses (Trivia dispute/ballot, Liar Liar guess). */
  submitVote: (round: number, target: string, agree: boolean) => void;
}

export interface UseGameClientResult extends GameActions {
  state: GameState;
}

export function useGameClient(options: GameClientOptions | null): UseGameClientResult {
  const [state, setState] = useState<GameState>(initialGameState);
  const clientRef = useRef<GameClient | null>(null);

  const identity = options
    ? `${options.url}|${options.room}|${options.game}|${options.player}|${options.nickname}`
    : null;

  useEffect(() => {
    if (!options) {
      clientRef.current = null;
      setState(initialGameState());
      return;
    }
    const client = new GameClient(options);
    clientRef.current = client;
    setState(client.getState());
    const unsubscribe = client.subscribe(setState);
    client.connect();
    return () => {
      unsubscribe();
      client.close();
      clientRef.current = null;
    };
    // Rebuild only when the identity string changes, not on every options object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // Push a refreshed engine-join token (spec 0064) into the live client WITHOUT rebuilding the
  // socket - the token is short-lived, so a long game refreshes it out-of-band, and a rebuild would
  // needlessly drop a healthy connection. The new token takes effect on the next (re)join. This runs
  // after the mount effect above so a token change on an existing client is applied in place.
  useEffect(() => {
    clientRef.current?.updateToken(options?.token);
  }, [options?.token]);

  return {
    state,
    submitMove: (round, move) => clientRef.current?.submitMove(round, move),
    submitVote: (round, target, agree) => clientRef.current?.submitVote(round, target, agree),
  };
}
