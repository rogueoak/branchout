'use client';

// The in-game layout, keyed by mode and role - one component, no forked screens (spec 0010's
// "layout from mode"). Interactive shows the viewer left and the remote right (stacked on narrow
// screens); a remote player sees the remote only; an observer sees the viewer only. The host is a
// full player, so it renders by its chosen mode like any player AND additionally gets the control
// bar (advance / pause / restart / exit).

import { Badge, Button } from '@rogueoak/canopy';
import type { Role, Mode } from '../../lib/room-api';
import type { ConnectionStatus, GameState } from '../../lib/game-state';
import { isComplete } from '../../lib/game-state';
import { RemotePane } from './RemotePane';
import { ViewerPane } from './ViewerPane';

/** Every host control the browser can issue, including `advance` (proxied by the control-plane). */
export type HostControl = 'advance' | 'pause' | 'restart' | 'exit';

interface GameStageProps {
  state: GameState;
  me: string;
  role: Role;
  /** The player's chosen mode (the host is a player, so it has one too); absent for observers. */
  mode?: Mode;
  isHost: boolean;
  onAnswer: (round: number, answer: string) => void;
  onDispute: (round: number) => void;
  onBallot: (round: number, target: string, agree: boolean) => void;
  onControl: (action: HostControl) => void;
}

const CONNECTION_LABEL: Record<ConnectionStatus, string | null> = {
  connecting: 'Connecting to the game...',
  live: null,
  reconnecting: 'Reconnecting...',
  closed: 'Disconnected.',
};

function HostControls({
  state,
  onControl,
}: {
  state: GameState;
  onControl: (action: HostControl) => void;
}) {
  const done = isComplete(state);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {done ? (
        <Button type="button" variant="primary" onClick={() => onControl('exit')}>
          Back to lobby
        </Button>
      ) : (
        <>
          <Button type="button" variant="primary" onClick={() => onControl('advance')}>
            Next
          </Button>
          <Button type="button" variant="outline" onClick={() => onControl('pause')}>
            {state.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button type="button" variant="outline" onClick={() => onControl('restart')}>
            Restart
          </Button>
          <Button type="button" variant="ghost" onClick={() => onControl('exit')}>
            Exit
          </Button>
        </>
      )}
    </div>
  );
}

export function GameStage({
  state,
  me,
  role,
  mode,
  isHost,
  onAnswer,
  onDispute,
  onBallot,
  onControl,
}: GameStageProps) {
  const isInteractivePlayer = role === 'player' && mode === 'interactive';
  const remoteVisible = role === 'player' && (mode === 'remote' || mode === 'interactive');
  const viewerVisible = role !== 'player' || isInteractivePlayer;
  const connectionNote = CONNECTION_LABEL[state.connection];

  return (
    <div className="flex flex-col gap-4">
      {connectionNote ? (
        <Badge variant="warning" className="w-fit" role="status">
          {connectionNote}
        </Badge>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-body-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div
        className={
          viewerVisible && remoteVisible
            ? 'grid grid-cols-1 gap-6 lg:grid-cols-2'
            : 'grid grid-cols-1 gap-6'
        }
      >
        {viewerVisible ? (
          <div className="order-1">
            <ViewerPane state={state} me={me} />
          </div>
        ) : null}
        {remoteVisible ? (
          <div className="order-2">
            <RemotePane
              state={state}
              me={me}
              // A remote-only player has no viewer pane, so the controller must also show the
              // between-round leaderboard and the final results.
              showResults={!viewerVisible}
              onAnswer={onAnswer}
              onDispute={onDispute}
              onBallot={onBallot}
            />
          </div>
        ) : null}
      </div>

      {isHost ? <HostControls state={state} onControl={onControl} /> : null}
    </div>
  );
}
