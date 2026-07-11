'use client';

// The pre-game lobby: the invite affordance, who is here, each player's mode toggle, and - for the
// host - the selected game's detail card, a Change game button, the config panel, and Start. Game
// SELECTION happens in the create flow's pick step and the change-game flow (spec 0029), not here;
// the lobby shows what is chosen and lets the host swap it. An observer sees the roster and their
// watching state only. Presentational and controlled; the parent owns the data and the actions. The
// config is opaque (the chosen game's blob), so the lobby is game-agnostic: it resolves the game's
// UI module by id (spec 0023) and renders that module's config panel.

import { Badge, Button } from '@rogueoak/canopy';
import { DEFAULT_GAME_UI, getGameUi } from '../../lib/games/registry';
import type { RoomMember, RoomView, Mode, Role } from '../../lib/room-api';
import { GameCard } from './GameCard';
import { ShareLink } from './ShareLink';

interface LobbyProps {
  room: RoomView;
  members: RoomMember[];
  role: Role;
  mode?: Mode;
  isHost: boolean;
  me?: string;
  /** The game id the host has selected (drives the detail card + config panel). */
  game: string;
  /** Open the change-game flow (the card picker); selection happens there, not in the lobby. */
  onChangeGame: () => void;
  /** The opaque config for the selected game. */
  config: unknown;
  onConfigChange: (next: unknown) => void;
  onStart: () => void;
  starting: boolean;
  startError: string | null;
  onModeChange: (mode: Mode) => void;
  onKick: (sessionId: string) => void;
}

/** A viewer is an observer or an interactive player - the "at least one viewer" start rule (0006). */
function hasViewer(members: RoomMember[]): boolean {
  return members.some(
    (member) =>
      member.role === 'observer' || (member.role === 'player' && member.mode === 'interactive'),
  );
}

function memberLabel(member: RoomMember): string {
  if (member.isHost) return `Host - ${member.mode === 'remote' ? 'Remote' : 'Interactive'}`;
  if (member.role === 'observer') return 'Observer';
  return member.mode === 'remote' ? 'Remote' : 'Interactive';
}

export function Lobby({
  room,
  members,
  role,
  mode,
  isHost,
  me,
  game,
  onChangeGame,
  config,
  onConfigChange,
  onStart,
  starting,
  startError,
  onModeChange,
  onKick,
}: LobbyProps) {
  // Resolve the selected game's UI module. `game` is always a registered id (the picker only sets
  // ids from GAME_UI_LIST); fall back to the first registered game for an unexpected value.
  const activeModule = getGameUi(game) ?? DEFAULT_GAME_UI;
  const ConfigPanel = activeModule.ConfigPanel;
  const validation = activeModule.validateConfig(config);
  const viewerPresent = hasViewer(members);

  // One plain reason a start is blocked, in priority order. When no viewer is present, the copy is
  // host-aware: a remote host that is the only viewer-capable device can fix it itself.
  const noViewerReason =
    mode === 'remote'
      ? "You're the only viewer-capable device here. Switch yourself to Interactive above to start."
      : 'Waiting for a viewer to join - an observer or an interactive player.';
  const blockedReason = !viewerPresent
    ? noViewerReason
    : !validation.ok
      ? (validation.error ?? 'Fix the game settings to start.')
      : startError;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header aria-label="Invite friends" className="flex flex-col gap-2">
        <h2 className="text-h4 text-text">Invite friends</h2>
        <p className="text-body-sm text-text-muted">
          Share the room code or link - anyone can join, no account needed:
        </p>
        <ShareLink code={room.code} href={room.shareLink} />
      </header>

      <section aria-label="Players" className="flex flex-col gap-3">
        <h2 className="text-h4 text-text">Who is here</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li
              key={member.sessionId ?? member.nickname}
              className="flex items-center justify-between rounded-md bg-surface-raised px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block size-2 rounded-full ${
                    member.connected ? 'bg-success' : 'bg-disabled'
                  }`}
                />
                <span className="text-body text-text">{member.nickname}</span>
                <Badge variant="neutral">{memberLabel(member)}</Badge>
              </span>
              {isHost && !member.isHost && member.sessionId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onKick(member.sessionId as string)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {role === 'player' ? (
        <section aria-label="Your mode" className="flex flex-col gap-2">
          <h2 className="text-h4 text-text">Your setup</h2>
          <p className="text-body-sm text-text-muted">
            Interactive shows the game and your controller on one screen. Remote is the controller
            only.
          </p>
          <div className="flex gap-2" role="group" aria-label="Choose your mode">
            <Button
              type="button"
              variant={mode === 'interactive' ? 'primary' : 'outline'}
              aria-pressed={mode === 'interactive'}
              onClick={() => onModeChange('interactive')}
            >
              Interactive
            </Button>
            <Button
              type="button"
              variant={mode === 'remote' ? 'primary' : 'outline'}
              aria-pressed={mode === 'remote'}
              onClick={() => onModeChange('remote')}
            >
              Remote
            </Button>
          </div>
        </section>
      ) : null}

      {role === 'observer' ? (
        <p className="text-body text-text-muted">You are watching this game.</p>
      ) : null}

      {isHost ? (
        <section aria-label="Game setup" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-h3 text-text">Your game</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onChangeGame}
              disabled={starting}
            >
              Change game
            </Button>
          </div>
          <GameCard game={activeModule} />

          <ConfigPanel value={config} onChange={onConfigChange} disabled={starting} />

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={onStart}
              disabled={!viewerPresent || !validation.ok || starting}
            >
              {starting ? 'Starting...' : 'Start game'}
            </Button>
            {blockedReason ? (
              <p role="status" className="text-body-sm text-text-muted">
                {blockedReason}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-body-sm text-text-muted" role="status">
          Waiting for the host to start the game.
        </p>
      )}

      {me ? <span className="sr-only">Joined as {me}</span> : null}
    </div>
  );
}
