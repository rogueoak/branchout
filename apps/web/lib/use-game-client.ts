'use client';

// React glue over the framework-agnostic GameClient. Given connection options it opens the socket,
// subscribes the component to state, and hands back the three player actions; passing `null` (the
// game is not running yet) keeps the hook inert. The client is rebuilt only when an identity field
// changes, so a re-render does not churn the socket.

import { useEffect, useRef, useState } from 'react';
import { GameClient, type GameClientOptions } from './game-client';
import { initialGameState, type GameState } from './game-state';

export interface GameActions {
  submitAnswer: (round: number, answer: string) => void;
  raiseDispute: (round: number) => void;
  castBallot: (round: number, target: string, agree: boolean) => void;
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

  return {
    state,
    submitAnswer: (round, answer) => clientRef.current?.submitAnswer(round, answer),
    raiseDispute: (round) => clientRef.current?.raiseDispute(round),
    castBallot: (round, target, agree) => clientRef.current?.castBallot(round, target, agree),
  };
}
