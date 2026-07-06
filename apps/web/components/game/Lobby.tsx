'use client';

// The pre-game lobby: the room code and share link, who is here, each player's mode toggle, and -
// for the host - the Trivia config panel and Start. An observer sees the roster and their watching
// state only. Presentational and controlled; the parent owns the data and the actions.

import { Badge, Button } from '@rogueoak/canopy';
import { useState } from 'react';
import type { RoomMember, RoomView, Mode, Role } from '../../lib/room-api';
import type { TriviaHostConfig } from '../../lib/trivia-config';
import { HostConfigPanel } from './HostConfigPanel';

/** The share link with a copy-to-clipboard shortcut, falling back to a plain link. */
function ShareLink({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (no permission or insecure context): the visible link still works.
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <a className="text-primary underline-offset-4 hover:underline" href={href}>
        {href}
      </a>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </span>
  );
}

interface LobbyProps {
  room: RoomView;
  members: RoomMember[];
  role: Role;
  mode?: Mode;
  isHost: boolean;
  me?: string;
  config: TriviaHostConfig;
  onConfigChange: (next: TriviaHostConfig) => void;
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
  if (member.role === 'host') return 'Host';
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
  config,
  onConfigChange,
  onStart,
  starting,
  startError,
  onModeChange,
  onKick,
}: LobbyProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-body-sm text-text-muted">Room code</p>
        <p className="text-display tabular-nums tracking-widest text-text">{room.code}</p>
        <div className="flex flex-col gap-1 text-body-sm text-text-muted">
          <span>Share this link:</span>
          <ShareLink href={room.shareLink} />
        </div>
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
              {isHost && member.role !== 'host' && member.sessionId ? (
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
            Interactive shows the question and your controller on one screen. Remote is the
            controller only.
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
          <h2 className="text-h3 text-text">Set up Trivia</h2>
          <HostConfigPanel
            value={config}
            onChange={onConfigChange}
            onStart={onStart}
            hasViewer={hasViewer(members)}
            starting={starting}
            serverReason={startError}
          />
        </section>
      ) : (
        <p className="text-body-sm text-text-muted" role="status">
          Waiting for the host to start the game.
        </p>
      )}

      {/* me is surfaced so an interactive player row can self-highlight later; unused rows keep the
          prop stable across lobby and game. */}
      {me ? <span className="sr-only">Joined as {me}</span> : null}
    </div>
  );
}
