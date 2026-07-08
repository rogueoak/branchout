'use client';

// The rooms home: one primary action - create a room (host) - plus a quieter path to join a room
// by code. Hosting needs an account, so a signed-out visitor is pointed to sign in rather than
// shown a button that will fail.

import { Button, Input, buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Wordmark } from '../../components/Wordmark';
import { defaultMode } from '../../lib/default-mode';
import { rememberMembership } from '../../lib/membership';
import { RoomApiError, createRoom, fetchIdentity, setMode } from '../../lib/room-api';

export function RoomsHome() {
  const router = useRouter();
  const [isAccount, setIsAccount] = useState<boolean | null>(null);
  const [hostName, setHostName] = useState('Host');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    let active = true;
    void fetchIdentity()
      .then((identity) => {
        if (!active) return;
        setIsAccount(identity.kind === 'account');
        if (identity.displayName) setHostName(identity.displayName);
      })
      .catch(() => active && setIsAccount(false));
    return () => {
      active = false;
    };
  }, []);

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      const { room, playerId } = await createRoom();
      // The host is a full player: remember it as such with the host flag, and set its mode from
      // the device (createRoom seeds `interactive` server-side; this refines it, and the host can
      // still change it in the lobby). Store the host's public playerId (echoed by createRoom) so
      // the host has its engine identity immediately - a host reloading mid-game is not bounced to
      // rejoin while the roster poll is skipped.
      const mode = defaultMode(typeof navigator === 'undefined' ? '' : navigator.userAgent);
      rememberMembership(room.code, {
        role: 'player',
        isHost: true,
        mode,
        nickname: hostName,
        player: playerId,
        room,
      });
      if (mode !== 'interactive') {
        try {
          await setMode(room.code, mode);
        } catch {
          // Best-effort: the server default (interactive) stands and the host can still pick in
          // the lobby, so a failed refinement should not block entering the room.
        }
      }
      router.push(`/rooms/${room.code}`);
    } catch (err) {
      setError(err instanceof RoomApiError ? err.message : 'Could not create a room. Try again.');
      setCreating(false);
    }
  }

  function onJoin() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed) router.push(`/join?code=${encodeURIComponent(trimmed)}`);
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-16 sm:px-6">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark />
          <h1 className="text-display text-text">Play a game</h1>
          <p className="text-body text-text-muted">
            Start a room and share the code, or join a game a friend already started.
          </p>
        </header>

        <section aria-labelledby="host-heading" className="flex flex-col gap-3">
          <h2 id="host-heading" className="text-h3 text-text">
            Host a room
          </h2>
          {isAccount === false ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-sm text-text-muted">Hosting needs an account.</p>
              <a href="/login" className={buttonVariants({ variant: 'primary' })}>
                Log in to host
              </a>
            </div>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={onCreate}
              disabled={creating || isAccount === null}
            >
              {creating ? 'Creating...' : isAccount === null ? 'Loading...' : 'Create a room'}
            </Button>
          )}
          {error ? (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="join-heading" className="flex flex-col gap-3">
          <h2 id="join-heading" className="text-h3 text-text">
            Join a room
          </h2>
          <label htmlFor="join-code" className="text-body-sm font-medium text-text">
            Room code
          </label>
          <div className="flex gap-2">
            <Input
              id="join-code"
              value={code}
              autoComplete="off"
              placeholder="ABC12"
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onJoin();
              }}
            />
            <Button type="button" variant="outline" onClick={onJoin} disabled={!code.trim()}>
              Join
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
