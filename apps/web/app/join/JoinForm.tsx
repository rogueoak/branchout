'use client';

// Join a room by code (the target of the `/join?code=ABC12` share link, spec 0006). The player
// picks a nickname, whether they play or observe, and - as a player - interactive or remote. If the
// browser has no session yet, it mints an anonymous one for this code before joining, so an invited
// friend needs no account.

import { Button, Input, Label, buttonVariants, inputVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Logo } from '../../components/Logo';
import { rememberMembership } from '../../lib/membership';
import {
  RoomApiError,
  joinRoom,
  startAnonymousSession,
  type Mode,
  type Role,
} from '../../lib/room-api';

interface JoinFormProps {
  initialCode: string;
}

export function JoinForm({ initialCode }: JoinFormProps) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<Role>('player');
  const [mode, setMode] = useState<Mode>('interactive');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = nickname.trim();
    setError(null);
    setSubmitting(true);

    const attempt = () =>
      joinRoom(trimmedCode, {
        role,
        nickname: trimmedName,
        ...(role === 'player' ? { mode } : {}),
      });

    try {
      let result;
      try {
        result = await attempt();
      } catch (err) {
        // No session yet: mint an anonymous one for this code, then retry the join once.
        if (err instanceof RoomApiError && err.status === 401) {
          await startAnonymousSession(trimmedCode, trimmedName);
          result = await attempt();
        } else {
          throw err;
        }
      }
      const { room, playerId } = result;
      rememberMembership(trimmedCode, {
        role,
        ...(role === 'player' ? { mode } : {}),
        nickname: trimmedName,
        // The public engine identity join returned, so this device can connect to the engine.
        player: playerId,
        room,
      });
      router.push(`/rooms/${room.code}`);
    } catch (err) {
      setError(err instanceof RoomApiError ? err.message : 'Could not join. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <form
        onSubmit={onSubmit}
        className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12 sm:px-6"
        noValidate
      >
        <header className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-9" />
          <h1 className="text-h2 text-text">Join the game</h1>
        </header>

        <div className="flex flex-col gap-2">
          <Label htmlFor="code">Room code</Label>
          <Input
            id="code"
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">Your name</Label>
          <Input
            id="nickname"
            value={nickname}
            autoComplete="nickname"
            placeholder="Pick a name to show others"
            onChange={(event) => setNickname(event.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="role">Join as</Label>
          <select
            id="role"
            className={inputVariants()}
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <option value="player">Player</option>
            <option value="observer">Observer (watch only)</option>
          </select>
        </div>

        {role === 'player' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="mode">Mode</Label>
            <select
              id="mode"
              className={inputVariants()}
              value={mode}
              onChange={(event) => setMode(event.target.value as Mode)}
            >
              <option value="interactive">Interactive (question + controller)</option>
              <option value="remote">Remote (controller only)</option>
            </select>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !code.trim() || !nickname.trim()}
        >
          {submitting ? 'Joining...' : 'Join room'}
        </Button>

        <a href="/rooms" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Back
        </a>
      </form>
    </main>
  );
}
