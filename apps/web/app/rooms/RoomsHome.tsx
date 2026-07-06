'use client';

// The rooms home: one primary action - create a room (host) - plus a quieter path to join a room
// by code. Hosting needs an account, so a signed-out visitor is pointed to sign in rather than
// shown a button that will fail.

import { Button, Input, buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '../../components/Logo';
import { rememberMembership } from '../../lib/membership';
import { RoomApiError, createRoom, fetchIdentity } from '../../lib/room-api';

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
      const room = await createRoom();
      rememberMembership(room.code, { role: 'host', nickname: hostName, room });
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
          <Logo className="h-10" />
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
            <Button type="button" variant="primary" onClick={onCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create a room'}
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
