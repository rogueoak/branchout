'use client';

// The pre-game lobby (spec 0050): the invite affordance, the selected game, who is here, each
// member's mode (viewer / interactive / remote), and - for the host - the game config + Start.
// Layout order: Invite -> Your game -> Who is here -> Game Setup -> Your mode. Game Setup (host
// config) leads because it is the host's main pre-game task; Your mode is a collapsed accordion
// since a player rarely changes it. Game Setup itself splits standard config (always visible) from
// an "Advanced settings" accordion (collapsed, a frame a later workstream fills). Game SELECTION
// happens in the create flow's pick step and the change-game flow (spec 0029), not here; the lobby
// shows what is chosen and lets the host swap it. Presentational and controlled; the parent owns the
// data and the actions. The config is opaque (the chosen game's blob), so the lobby is game-agnostic:
// it resolves the game's UI module by id (spec 0023) and renders that module's config panel.

import type { ReactNode } from 'react';
import { Badge, Button } from '@rogueoak/canopy';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@rogueoak/canopy/branches';
import { playerLimits } from '@branchout/protocol';
import { getGameCard } from '../../lib/games/catalog';
import { DEFAULT_GAME_UI, getGameUi } from '../../lib/games/registry';
import {
  isDisplayMode,
  isPlayingMode,
  type Mode,
  type RoomMember,
  type RoomView,
} from '../../lib/room-api';
import { GameCard } from './GameCard';
import { OptionSelector, type SelectorOption } from './OptionSelector';
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
  /**
   * Optional advanced game-setup content (spec: WS2 frame). When provided, Game setup shows an
   * "Advanced settings" accordion (collapsed) below the standard config panel; when absent - the
   * case for every game today - the accordion is omitted so there is no empty disclosure. A later
   * workstream (trivia config) passes the game's advanced knobs here.
   */
  advanced?: ReactNode;
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

/** The picker label for a mode, for the collapsed "Your mode" summary. */
function modeLabel(mode: Mode): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? 'Interactive';
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
  advanced,
  onStart,
  starting,
  startError,
  onModeChange,
  onKick,
}: LobbyProps) {
  // Resolve the selected game's UI module. `game` is always a registered id (the picker only sets
  // ids from GAME_UI_LIST); fall back to the first registered game for an unexpected value.
  const activeModule = getGameUi(game) ?? DEFAULT_GAME_UI;
  // The read-only "Your game" card (spec 0065): the same unified card, both affordances off (selection
  // and play happen elsewhere - the change-game picker and Start). Falls back to the default game's
  // card for an unexpected id, mirroring the module fallback above.
  const activeCard = getGameCard(game) ?? getGameCard(DEFAULT_GAME_UI.id);
  const ConfigPanel = activeModule.ConfigPanel;
  const validation = activeModule.validateConfig(config);
  // The advanced-settings content: the selected game's own AdvancedConfigPanel (spec 0068), resolved
  // HERE from the same module the standard panel came from, so one game's setup resolves in one place.
  // An explicit `advanced` prop still overrides it (used by tests). When neither exists, the accordion
  // is omitted so no game shows an empty disclosure.
  const AdvancedConfigPanel = activeModule.AdvancedConfigPanel;
  const advancedContent =
    advanced ??
    (AdvancedConfigPanel ? (
      <AdvancedConfigPanel value={config} onChange={onConfigChange} disabled={starting} />
    ) : null);

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
      ? "No screen yet - switch yourself to Viewer or Interactive below so there's something to watch."
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
        {activeCard ? <GameCard game={activeCard} showPlay={false} showDetails={false} /> : null}
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

      {isHost ? (
        <section aria-label="Game setup" className="flex flex-col gap-4">
          <h2 className="text-h3 text-text">Game Setup</h2>
          {/* Standard config: the always-visible, common options for this game. */}
          <ConfigPanel value={config} onChange={onConfigChange} disabled={starting} />

          {/* Advanced config: a collapsed disclosure for the rarely-touched knobs, kept below the
              standard config so the common path stays front-and-centre. Rendered only when the game
              supplies advanced content (via its AdvancedConfigPanel), so a game without any shows no
              empty disclosure. */}
          {advancedContent ? (
            <Accordion type="single" collapsible>
              <AccordionItem value="advanced">
                <AccordionTrigger>Advanced settings</AccordionTrigger>
                <AccordionContent>{advancedContent}</AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}

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

      {/* Your mode: collapsed by default - a player rarely changes it, so the trigger carries the
          current selection to stay informative while closed. */}
      <section aria-label="Your mode" className="flex flex-col gap-3">
        <Accordion type="single" collapsible>
          <AccordionItem value="your-mode">
            <AccordionTrigger>
              <span className="flex items-center gap-2 text-h4 text-text">
                Your mode
                <Badge variant="neutral">{modeLabel(mode)}</Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {/* The mode picker shares the same radio-style OptionSelector as the Trivia
                  difficulty/rounds pickers (spec 0068), so every one reads the same. */}
              <div className="pt-1">
                <OptionSelector
                  ariaLabel="Choose your mode"
                  value={mode}
                  selectedBadge="Selected"
                  onChange={onModeChange}
                  options={MODE_OPTIONS.map((option): SelectorOption<Mode> => ({
                    value: option.mode,
                    label: option.label,
                    description: option.description,
                    // A playing seat (interactive/remote) is unavailable when the game is already
                    // full and I am not already one of the players - I can still watch as a viewer.
                    disabled: full && isPlayingMode(option.mode) && mode !== option.mode,
                  }))}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        {/* The forced-viewer explanation lives OUTSIDE the accordion: Your mode is collapsed by
            default and Radix unmounts collapsed content, so keeping it here means a player bumped to
            viewer always sees the reason and the live region announces it. */}
        {full && mode === 'viewer' ? (
          <p className="text-body-sm text-text-muted" role="status">
            This game is full at {limits.max} players, so you can join as a viewer to watch.
          </p>
        ) : null}
      </section>

      {me ? <span className="sr-only">Joined as {me}</span> : null}
    </div>
  );
}
