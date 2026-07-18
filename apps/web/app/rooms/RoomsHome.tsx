'use client';

// The rooms home: one primary action - create a room (host) - plus a quieter path to join a room
// by code. Hosting needs an account, so a signed-out visitor is pointed to sign in rather than
// shown a button that will fail.

import { Button, Input, buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { trackRoomCreated } from '../../lib/analytics';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';
import { defaultMode } from '../../lib/default-mode';
import { getGameUi, isPublicGame } from '../../lib/games/registry';
import { recallDeviceMode, rememberMembership } from '../../lib/membership';
import { RoomApiError, createRoom, fetchIdentity, selectGame, setMode } from '../../lib/room-api';
import type { Viewer } from '../../lib/session';
import { APEX_SURFACE, type Surface } from '../../lib/surface';

// If the deep-link auto-create stalls (flaky network), do not strand the host on the setup screen
// forever - after this long, drop back to the create landing with a retry-able message (review #138).
const SETUP_TIMEOUT_MS = 8000;

interface RoomsHomeProps {
  /** The `?game=<slug>` deep link from a feature-page "Start a game" CTA (spec 0030): create a room
   * pre-selected to this game and skip the pick step. Ignored if it is not a known game id. */
  initialGame?: string;
  /** The signed-in identity for the shared top nav (spec 0029), read server-side to avoid a flash. */
  viewer: Viewer;
  /** The surface this page is served on (feedback 0029): gates the insider-only deep link and crosses
   * the shared chrome's links back to the apex when on the insider subdomain. Defaults to apex. */
  surface?: Surface;
}

export function RoomsHome({ initialGame, viewer, surface = APEX_SURFACE }: RoomsHomeProps) {
  const router = useRouter();
  const [isAccount, setIsAccount] = useState<boolean | null>(null);
  const [hostName, setHostName] = useState('Host');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // One-shot guard (spec 0029): the deep-link auto-create must fire exactly once per arrival, so a
  // React re-render or StrictMode double-invoke never creates a second room.
  const autoStarted = useRef(false);

  // Resolve the deep-link game once, respecting the insider surface gate (spec 0043 / feedback 0029):
  // an insider-only game is only pre-selected on the insider surface. On the apex an insider slug is
  // dropped (the host falls back to the picker), so an insider game never starts on the main site -
  // even for an insider. Stable across renders so the auto-create effect fires once.
  const preselected = useMemo(() => {
    const candidate = initialGame ? getGameUi(initialGame) : undefined;
    return candidate && (isPublicGame(candidate) || surface.insider) ? candidate : undefined;
  }, [initialGame, surface.insider]);

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

  // The create + select sequence. `useReplace` swaps the created-room URL in for the current one
  // (the `?game=` deep link) so a back/refresh cannot re-trigger the create; the manual button path
  // pushes so the landing stays in history.
  async function runCreate(useReplace: boolean) {
    setCreating(true);
    setError(null);
    try {
      const { room, playerId } = await createRoom();
      trackRoomCreated();
      // The host's mode (spec 0050): a fresh room has no interactive member yet, so the default is
      // this device's remembered mode, else `interactive` (be the shared screen). createRoom seeds
      // `interactive` server-side; this refines it, and the host can still change it in the lobby.
      const mode = defaultMode({
        previous: recallDeviceMode(),
        hasInteractive: false,
        rejoining: false,
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      });

      // Deep link (spec 0029): if the "Start a game" CTA named a known game (resolved above with the
      // surface gate), select it now and skip the pick step, landing the host straight in the lobby.
      // Otherwise the host picks a game first.
      let roomToStore = room;
      if (preselected) {
        try {
          roomToStore = await selectGame(room.code, preselected.id, preselected.defaultConfig());
        } catch {
          // If pre-selection fails, fall back to the pick step rather than blocking room creation.
        }
      }
      // A pre-selected game drops straight into the lobby; otherwise the host picks a game first.
      const step = roomToStore.selectedGame ? null : 'pick';

      rememberMembership(room.code, {
        isHost: true,
        mode,
        nickname: hostName,
        player: playerId,
        room: roomToStore,
      });
      if (mode !== 'interactive') {
        try {
          await setMode(room.code, mode);
        } catch {
          // Best-effort: the server default (interactive) stands and the host can still pick in
          // the lobby, so a failed refinement should not block entering the room.
        }
      }
      const dest = step ? `/rooms/${room.code}?step=${step}` : `/rooms/${room.code}`;
      if (useReplace) router.replace(dest);
      else router.push(dest);
    } catch (err) {
      // An error clears `creating` and, since `showSetup` keys off `error`, drops the "Setting up
      // your room..." state so an auto-create failure falls back to the create landing with the
      // message rather than a stuck spinner.
      setError(err instanceof RoomApiError ? err.message : 'Could not create a room. Try again.');
      setCreating(false);
    }
  }

  const onCreate = () => runCreate(false);

  // Auto-create on the deep link (spec 0029): a signed-in host who can host and arrived with a valid
  // `?game=<slug>` skips the "Create a room" tap - create the room, select the game, and replace to
  // the lobby. Waits for the identity to resolve (isAccount === true); a signed-out / cannot-host
  // viewer never auto-creates (they see the landing with "Log in to host"). The ref guard makes it
  // fire once per arrival.
  useEffect(() => {
    if (autoStarted.current) return;
    if (!preselected || isAccount !== true) return;
    autoStarted.current = true;
    void runCreate(true);
    // runCreate is a stable closure over the render's props; it is intentionally omitted from deps so
    // the effect keys only on the auto-create trigger (the resolved game + host identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected, isAccount]);

  // Show a lightweight setup state for an eligible deep-link host instead of flashing the landing,
  // while the identity resolves (isAccount === null) and while the auto-create runs. Gated on the
  // SERVER-KNOWN `viewer.signedIn` (review #138) so a signed-OUT visitor opening a shared
  // `?game=` link never flashes "Setting up your room..." during the async identity window - they
  // go straight to the "Log in to host" landing. An error drops back to the landing (which surfaces
  // the message); a signed-out viewer (isAccount === false) also sees the landing so they can log in.
  const showSetup = Boolean(preselected) && viewer.signedIn && !error && isAccount !== false;

  // Safety timeout (review #138): if the setup (identity + auto-create) stalls, drop the host to the
  // create landing with a retry-able message instead of a spinner that never resolves. Keyed on
  // `showSetup`, so it is armed only while the setup screen is up and is cleared on navigation/unmount.
  useEffect(() => {
    if (!showSetup) return;
    const timer = setTimeout(() => {
      setCreating(false);
      setError('This is taking longer than expected. Try again.');
    }, SETUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [showSetup]);

  // A signed-out deep-linker must resume into the game after auth (review #138): carry the current
  // `?game=` deep link as a validated internal `next` on the login / sign-up links so, once they have
  // an account, they land back here and the auto-create fires. No deep link -> plain auth links. The
  // links stay relative (surface-owned): the insider host serves /login + /signup directly, so this
  // resolves on whichever surface the host is on. `preselected.id` is used (not the raw slug) so an
  // insider game dropped on the apex carries no `next` - matching where the auto-create would land.
  const deepLink = preselected ? `/rooms?game=${encodeURIComponent(preselected.id)}` : null;
  const loginHref = deepLink ? `/login?next=${encodeURIComponent(deepLink)}` : '/login';
  const signupHref = deepLink ? `/signup?next=${encodeURIComponent(deepLink)}` : '/signup';

  function onJoin() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed) router.push(`/join?code=${encodeURIComponent(trimmed)}`);
  }

  if (showSetup) {
    return (
      <div className="flex min-h-screen flex-col bg-bg text-text">
        <TopNav
          viewer={viewer}
          label={surface.insider ? 'Insider' : undefined}
          linkOrigin={surface.linkOrigin || undefined}
          insider={surface.insider}
        />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center sm:px-6">
          <h1 className="text-h2 text-text">Setting up your room...</h1>
          <p className="text-body text-text-muted">Hang tight - we are getting your game ready.</p>
        </main>
        <Footer linkOrigin={surface.linkOrigin || undefined} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <TopNav
        viewer={viewer}
        label={surface.insider ? 'Insider' : undefined}
        linkOrigin={surface.linkOrigin || undefined}
        insider={surface.insider}
      />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-16 sm:px-6">
        <header className="flex flex-col items-center gap-4 text-center">
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
              <a href={loginHref} className={buttonVariants({ variant: 'primary' })}>
                Log in to host
              </a>
              <a href={signupHref} className={buttonVariants({ variant: 'outline' })}>
                Sign up
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
              // Never grab focus on mount (feedback 0031): auto-focusing the join-code field pops the
              // mobile keyboard the instant "Play a game" opens, which is annoying and hides the
              // primary "Create a room" action above it. Host is the primary path; the player taps the
              // code field when they actually want to join. No code focuses it, so this is the explicit
              // guard against any browser/agent that would autofocus the page's first empty text input.
              autoFocus={false}
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
      </main>
      <Footer linkOrigin={surface.linkOrigin || undefined} />
    </div>
  );
}
