'use client';

// The in-game layout, keyed by mode - one component, no forked screens (spec 0010's "layout from
// mode", spec 0050). Interactive shows the viewer left and the remote right (stacked on narrow
// screens); a remote player sees the remote only; a viewer sees the game only. The host renders by
// its chosen mode like anyone AND additionally gets the control bar (advance / pause / restart /
// exit).

import { Badge, Button } from '@rogueoak/canopy';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@rogueoak/canopy/branches';
import { useEffect } from 'react';
import type { Mode } from '../../lib/room-api';
import type { ConnectionStatus, GameState } from '../../lib/game-state';
import { isComplete } from '../../lib/game-state';
import { getGameUi } from '../../lib/games/registry';
import { FeedbackDialog } from './FeedbackDialog';

/** Every host control the browser can issue, including `advance` (proxied by the control-plane). */
export type HostControl = 'advance' | 'pause' | 'restart' | 'exit';

interface GameStageProps {
  state: GameState;
  me: string;
  /** The selected game id (matches the engine plugin id); resolves the UI module to render. */
  game: string;
  /** The room join code, attached as feedback context (spec 0048). */
  code: string;
  /** The caller's mode (spec 0050): viewer, interactive, or remote. Drives the layout. */
  mode: Mode;
  isHost: boolean;
  onMove: (round: number, answer: string) => void;
  /** The generic vote action (Trivia dispute/ballot, Liar Liar guess); the game module maps it. */
  onVote: (round: number, target: string, agree: boolean) => void;
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
  game,
  code,
  onControl,
}: {
  state: GameState;
  game: string;
  code: string;
  onControl: (action: HostControl) => void;
}) {
  const done = isComplete(state);
  const feedback = (
    <div className="ml-auto">
      <FeedbackDialog context={{ code, game, phase: state.phase, isHost: true }} />
    </div>
  );

  // At the finale the one action is a clear terminal "Back to lobby" - keep it in plain sight, never
  // tucked inside a disclosure.
  if (done) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button type="button" variant="primary" onClick={() => onControl('exit')}>
          Back to lobby
        </Button>
        {feedback}
      </div>
    );
  }

  // While a question is answerable the player's own "Submit" is the clear primary action, so the
  // advance control is de-emphasized (outline) to avoid two competing primaries for a remote host
  // mid-question.
  const answerable = state.phase === 'collecting';
  // Host controls collapse into an accordion, closed by default so they do not clutter the play
  // screen (spec 0069). The accordion opens by default ONLY when a required host "Next" advance is
  // pending - a round-based game the host drives that is NOT currently auto-advancing. Two signals
  // gate it (WS13):
  //   - `live`: a continuous / turn-based game (Reversi, Checkers, Teeter Tower) advances itself on
  //     each move and has no host "Next" at all, so its controls MUST stay collapsed. Keying only on
  //     `autoAdvance` wrongly opened these, because a live game reports `autoAdvance === false`.
  //   - `autoAdvance === true`: the engine is auto-advancing the leaderboard dwell, so the host need
  //     not tap Next - collapse (auto-advancing Trivia).
  // So a round game with auto-advance off (Trivia with the timer off, and the host-advanced insider
  // games Sketchy / Zinger) keeps the accordion open, so the required Next is always in reach to drive
  // the leaderboard to the finale - exactly as the host bar behaved before this feature. `key`
  // re-applies the default if these fields resolve late.
  const hostAdvancePending = !state.live && state.autoAdvance !== true;
  const openByDefault = hostAdvancePending;
  return (
    <Accordion
      type="single"
      collapsible
      key={openByDefault ? 'open' : 'closed'}
      defaultValue={openByDefault ? 'host-controls' : undefined}
      className="border-t border-border pt-2"
    >
      <AccordionItem value="host-controls">
        <AccordionTrigger>Host controls</AccordionTrigger>
        <AccordionContent>
          {/* The controls stay left; the Feedback affordance sits at the right edge (ml-auto).
              The row still wraps at 360px - Feedback drops onto its own line rather than overflow. */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
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
            {feedback}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function GameStage({
  state,
  me,
  game,
  code,
  mode,
  isHost,
  onMove,
  onVote,
  onControl,
}: GameStageProps) {
  const ui = getGameUi(game);
  // A single-surface game (Teeter Tower) is one interactive canvas: the viewer IS the surface every
  // mode sees, and the player acts on it directly. It has no separate remote pane and no two-column
  // split. Branch on the flag, never on the game id, so adding another single-surface game is free.
  const singleSurface = ui?.singleSurface === true;
  // Layout from mode (spec 0050): interactive shows both panes; remote shows the controller only; a
  // viewer sees the game only. `remote` is the only mode with no game screen of its own.
  const remoteVisible = !singleSurface && (mode === 'remote' || mode === 'interactive');
  const viewerVisible = singleSurface || mode !== 'remote';
  const connectionNote = CONNECTION_LABEL[state.connection];

  // When a new answer round opens, bring the fresh question into view - otherwise the viewport can
  // stay scrolled down on the prior reveal/leaderboard and the player misses the new prompt (fb
  // 0016). Keyed on the round so it fires once per new question, only while collecting. Gated on
  // `remoteVisible`: only a player with a controller below the fold can have the question pushed
  // off-screen; a viewer-only screen (observer/TV) has nothing to scroll past.
  useEffect(() => {
    if (state.phase === 'collecting' && remoteVisible) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [state.round, state.phase, remoteVisible]);

  return (
    // A single-surface game (Teeter) fills the viewport height so the page does not scroll (feedback
    // 0027): the stage is a min-h-0 flex column, the viewer flexes to fill, the host bar sits below.
    // Multi-surface games keep the normal auto-height, scrolling layout.
    <div className={singleSurface ? 'flex min-h-0 flex-1 flex-col gap-2' : 'flex flex-col gap-4'}>
      {/* "How to play" now lives inline with the room code in the room header (spec 0068), reachable
          at any time - including mid-round - without its own toolbar row here. */}
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
          singleSurface
            ? 'flex min-h-0 flex-1'
            : viewerVisible && remoteVisible
              ? 'grid grid-cols-1 gap-6 lg:grid-cols-2'
              : 'grid grid-cols-1 gap-6'
        }
      >
        {viewerVisible && ui ? (
          <div className={singleSurface ? 'order-1 flex min-h-0 flex-1 flex-col' : 'order-1'}>
            {/* onMove is game-agnostic: a single-surface game (Teeter Tower) is one interactive
                canvas, so the shell passes the move action straight to its viewer and the player aims
                + drops on it. Multi-surface game viewers ignore it (their moves come from the remote). */}
            <ui.Viewer state={state} me={me} onMove={onMove} />
          </div>
        ) : null}
        {remoteVisible && ui ? (
          <div className="order-2">
            <ui.Remote
              state={state}
              me={me}
              // A remote-only player has no viewer pane, so the controller must also show the
              // between-round leaderboard and the final results.
              showResults={!viewerVisible}
              isHost={isHost}
              onMove={onMove}
              onVote={onVote}
            />
          </div>
        ) : null}
      </div>

      {isHost ? <HostControls state={state} game={game} code={code} onControl={onControl} /> : null}
    </div>
  );
}
