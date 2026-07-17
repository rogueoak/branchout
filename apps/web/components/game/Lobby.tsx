'use client';

// The pre-game lobby (spec 0050): the invite affordance, the selected game, who is here, each
// member's mode (viewer / interactive / remote), and - for the host - the game config + Start.
// Layout order: Invite -> Your game -> Who is here -> Your mode -> Game Setup. Game SELECTION happens
// in the create flow's pick step and the change-game flow (spec 0029), not here; the lobby shows what
// is chosen and lets the host swap it. Presentational and controlled; the parent owns the data and
// the actions. The config is opaque (the chosen game's blob), so the lobby is game-agnostic: it
// resolves the game's UI module by id (spec 0023) and renders that module's config panel.

import { Badge, Button } from '@rogueoak/canopy';
import { playerLimits } from '@branchout/protocol';
import { DEFAULT_GAME_UI, getGameUi } from '../../lib/games/registry';
import {
  isDisplayMode,
  isPlayingMode,
  type Mode,
  type RoomMember,
  type RoomView,
} from '../../lib/room-api';
import { GameCard } from './GameCard';
import { ShareLink } from './ShareLink';

interface LobbyProps {
  room: RoomView;
  members: RoomMember[];
  /** The caller's own mode (spec 0050). */
  mode: Mode;
  isHost: boolean;
  me?: string;
  /** The game id the host has selected (drives the detail card, config panel, and player limits). */
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

/** The three modes with the copy shown in the picker (spec 0050). */
const MODE_OPTIONS: readonly { mode: Mode; label: string; description: string }[] = [
  {
    mode: 'viewer',
    label: 'Viewer',
    description: 'Just watch - you do not play. Best for a shared screen everyone gathers around.',
  },
  {
    mode: 'interactive',
    label: 'Interactive',
    description:
      'Shows the game on this screen and lets you play - screen and controller together.',
  },
  {
    mode: 'remote',
    label: 'Remote',
    description: 'Play from your own device. Someone else needs a screen to show the game.',
  },
];

function memberLabel(member: RoomMember): string {
  const base =
    member.mode === 'viewer' ? 'Viewer' : member.mode === 'remote' ? 'Remote' : 'Interactive';
  return member.isHost ? `Host - ${base}` : base;
}

export function Lobby({
  room,
  members,
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

  // Player-limit maths (spec 0050). Viewers do not count; only interactive + remote fill the seats.
  const limits = playerLimits(game);
  const playing = members.filter((member) => isPlayingMode(member.mode)).length;
  // Seats taken by OTHERS: exclude my own playing seat so a remote<->interactive swap is never blocked
  // by the cap. When those already fill the game, I cannot take a new playing seat - only watch.
  const playingOthers = playing - (isPlayingMode(mode) ? 1 : 0);
  const full = playingOthers >= limits.max;
  const displayPresent = members.some((member) => isDisplayMode(member.mode));
  const enoughPlayers = playing >= limits.min;
  const canStart = displayPresent && enoughPlayers && validation.ok && !starting;

  // One plain reason a start is blocked, in priority order.
  const blockedReason = !displayPresent
    ? mode === 'remote'
      ? "No screen yet - switch yourself to Viewer or Interactive above so there's something to watch."
      : 'Waiting for a screen - someone in viewer or interactive mode.'
    : !enoughPlayers
      ? `This game needs at least ${limits.min} player${limits.min === 1 ? '' : 's'} (${playing} so far).`
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

      <section aria-label="Your game" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-h4 text-text">Your game</h2>
          {isHost ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onChangeGame}
              disabled={starting}
            >
              Change game
            </Button>
          ) : null}
        </div>
        <GameCard game={activeModule} />
        <p className="text-body-sm text-text-muted">
          {limits.min === limits.max
            ? `${limits.min} player${limits.min === 1 ? '' : 's'}.`
            : `${limits.min}-${limits.max} players.`}{' '}
          Viewers can always join to watch.
        </p>
      </section>

      <section aria-label="Players" className="flex flex-col gap-3">
        <h2 className="text-h4 text-text">
          Who is here{' '}
          <span className="text-body-sm text-text-muted">
            ({playing}/{limits.max} playing)
          </span>
        </h2>
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

      <section aria-label="Your mode" className="flex flex-col gap-3">
        <h2 className="text-h4 text-text">Your mode</h2>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Choose your mode">
          {MODE_OPTIONS.map((option) => {
            const selected = mode === option.mode;
            // A playing seat (interactive/remote) is unavailable when the game is already full and I
            // am not already one of the players - I can still watch as a viewer.
            const disabled = full && isPlayingMode(option.mode) && !selected;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onModeChange(option.mode)}
                className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-surface-raised hover:border-border-strong'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span className="flex items-center gap-2 text-body font-medium text-text">
                  {option.label}
                  {selected ? <Badge variant="primary">Selected</Badge> : null}
                </span>
                <span className="text-body-sm text-text-muted">{option.description}</span>
              </button>
            );
          })}
        </div>
        {full && mode === 'viewer' ? (
          <p className="text-body-sm text-text-muted" role="status">
            This game is full at {limits.max} players, so you can join as a viewer to watch.
          </p>
        ) : null}
      </section>

      {isHost ? (
        <section aria-label="Game setup" className="flex flex-col gap-4">
          <h2 className="text-h3 text-text">Game Setup</h2>
          <ConfigPanel value={config} onChange={onConfigChange} disabled={starting} />

          <div className="flex flex-col gap-2">
            <Button type="button" variant="primary" onClick={onStart} disabled={!canStart}>
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
