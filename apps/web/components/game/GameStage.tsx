'use client';

// The in-game layout, keyed by mode and role - one component, no forked screens (spec 0010's
// "layout from mode"). Interactive shows the viewer left and the remote right (stacked on narrow
// screens); a remote player sees the remote only; an observer sees the viewer only. The host is a
// full player, so it renders by its chosen mode like any player AND additionally gets the control
// bar (advance / pause / restart / exit).

import { Badge, Button } from '@rogueoak/canopy';
import { useEffect } from 'react';
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
  // While a question is answerable the player's own "Submit" is the clear primary action, so the
  // advance control is de-emphasized (outline) to avoid two competing primaries for a remote host
  // mid-question. A labelled, bordered bar separates the host controls from the player's remote.
  const answerable = state.phase === 'collecting';
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <p className="text-body-sm font-medium text-text-muted">Host controls</p>
      <div className="flex flex-wrap items-center gap-2">
        {done ? (
          <Button type="button" variant="primary" onClick={() => onControl('exit')}>
            Back to lobby
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant={answerable ? 'outline' : 'primary'}
              onClick={() => onControl('advance')}
            >
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

  // When a new answer round opens, bring the fresh question into view - otherwise the viewport can
  // stay scrolled down on the prior reveal/leaderboard and the player misses the new prompt (fb
  // 0016). Keyed on the round so it fires once per new question, only while collecting.
  useEffect(() => {
    if (state.phase === 'collecting') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [state.round, state.phase]);

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

      {/* One paused banner for every layout (the viewer pane no longer carries its own, so the
          copy is consistent and host-aware). Paused covers both a deliberate host pause and the
          engine auto-pausing while the host is disconnected (spec 0014) - the client cannot tell
          them apart, so the non-host copy ("waiting for the host") reads correctly for either: the
          game is paused, not over, and resumes when the host acts or reconnects. A host sees its
          own resume control below. */}
      {state.paused && !isComplete(state) ? (
        <Badge variant="warning" className="w-fit" role="status">
          {isHost ? 'Game paused - resume when you are ready.' : 'Paused - waiting for the host.'}
        </Badge>
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
              isHost={isHost}
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
