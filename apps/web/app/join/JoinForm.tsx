'use client';

// Join a room by code (the target of the `/join?code=ABC12` share link, spec 0006, spec 0050). The
// player just picks a nickname; their mode (viewer / interactive / remote) is defaulted from the
// device and chosen in the lobby's "Your mode" picker, so joining stays one tap of friction. If the
// browser has no session yet, it mints an anonymous one for this code before joining, so an invited
// friend needs no account.

import { Button, Input, Label, buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { trackRoomJoined } from '../../lib/analytics';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';
import type { Viewer } from '../../lib/session';
import { APEX_SURFACE, type Surface } from '../../lib/surface';
import { defaultMode } from '../../lib/default-mode';
import {
  recallDeviceMode,
  recallMembership,
  recallPlayerName,
  rememberMembership,
  rememberPlayerName,
} from '../../lib/membership';
import { generateRandomName } from '../../lib/random-name';
import { RoomApiError, joinRoom, startAnonymousSession, type Mode } from '../../lib/room-api';

interface JoinFormProps {
  initialCode: string;
  /** The signed-in identity for the shared top nav (spec 0029), read server-side to avoid a flash. */
  viewer: Viewer;
  /** The surface this page is served on (feedback 0029): crosses the shared chrome's links back to
   * the apex when on the insider subdomain. Defaults to apex. */
  surface?: Surface;
}

export function JoinForm({ initialCode, viewer, surface = APEX_SURFACE }: JoinFormProps) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState('');
  // Start on a stable, SSR-safe default so the server and first client render agree (no hydration
  // mismatch), then refine to the device default once mounted. The joiner does not pick a mode here
  // (that is the lobby's "Your mode" picker); this is only the mode the join call requests, which the
  // server may clamp to `viewer` if the game is already full, and which the player can change later.
  const [mode, setMode] = useState<Mode>('interactive');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Apply the device-aware default after mount, where `navigator`/storage are available (not during
  // SSR). A second join from this device (an extra tab / rejoin) defaults to `viewer`; the roster is
  // unknown pre-join, so the "no interactive member yet" rule is left to the lobby. Runs once.
  useEffect(() => {
    setMode(
      defaultMode({
        previous: recallDeviceMode(),
        hasInteractive: true,
        rejoining: recallMembership(initialCode) !== null,
        userAgent: navigator.userAgent,
      }),
    );
  }, [initialCode]);

  // Seed the name field after mount so localStorage and randomness never run on the server (they
  // would diverge and cause a hydration mismatch). Precedence (spec 0066): the last name this player
  // picked, else a signed-in player's gamer tag, else a friendly random name that is remembered
  // immediately so this browser keeps the same name instead of getting a new one each visit. Runs
  // once; the SSR field stays empty until this fills it.
  useEffect(() => {
    const remembered = recallPlayerName();
    if (remembered) {
      setNickname(remembered);
      return;
    }
    if (viewer.gamerTag) {
      setNickname(viewer.gamerTag);
      return;
    }
    const generated = generateRandomName();
    rememberPlayerName(generated);
    setNickname(generated);
  }, [viewer.gamerTag]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = nickname.trim();
    setError(null);
    setSubmitting(true);
    // Remember the committed name so the next /join (any room) pre-fills it, account or not.
    rememberPlayerName(trimmedName);

    const attempt = () => joinRoom(trimmedCode, { nickname: trimmedName, mode });

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
      trackRoomJoined();
      rememberMembership(trimmedCode, {
        mode,
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
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <TopNav
        viewer={viewer}
        label={surface.insider ? 'Insider' : undefined}
        linkOrigin={surface.linkOrigin || undefined}
        insider={surface.insider}
      />
      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12 sm:px-6"
        noValidate
      >
        <header className="flex flex-col items-center gap-3 text-center">
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
            onBlur={() => rememberPlayerName(nickname)}
            required
          />
        </div>

        <p className="text-body-sm text-text-muted">
          Choose how to play - watch, play on this screen, or use this device as a controller - once
          you are in the room.
        </p>

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
      <Footer linkOrigin={surface.linkOrigin || undefined} />
    </div>
  );
}
