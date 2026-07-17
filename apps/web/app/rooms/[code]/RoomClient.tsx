'use client';

// The room page: lobby before the game, the interactive/remote stage once it runs. It holds the
// room + roster, drives the host's select/start/controls through the control-plane (spec 0006),
// and opens the engine WebSocket (spec 0007) when the game is running. It is a thin orchestrator -
// the phase rendering lives in the game components, the engine folding in the game client.

import { Button, buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackGameCompleted, trackGamePicked, trackGameStarted } from '../../../lib/analytics';
import { GameStage, type HostControl } from '../../../components/game/GameStage';
import { GamePicker } from '../../../components/game/GamePicker';
import { Lobby } from '../../../components/game/Lobby';
import { TopNav } from '../../../components/TopNav';
import type { Viewer } from '../../../lib/session';
import { APEX_SURFACE, type Surface } from '../../../lib/surface';
import { ENGINE_WS_URL } from '../../../lib/engine';
import {
  recallMembership,
  rememberDeviceMode,
  rememberMembership,
  type Membership,
} from '../../../lib/membership';
import {
  RoomApiError,
  controlGame,
  fetchEngineToken,
  getRoom,
  listMembers,
  resumeRoom,
  selectGame,
  setMode,
  startGame,
  kickMember,
  type Mode,
  type RoomMember,
  type RoomView,
} from '../../../lib/room-api';
import { getGameUi } from '../../../lib/games/registry';
import { useGameClient } from '../../../lib/use-game-client';

const DEFAULT_GAME_ID = 'trivia';
const MEMBER_POLL_MS = 3000;

// The host's create-flow setup step (spec 0029, spec 0050): `pick` is the first game choice; `null`
// is the lobby. A first pick now drops straight into the lobby - the old standalone `invite` step was
// removed (the share link already lives in the lobby, so it was just friction). The in-room "Change
// game" swap is deliberately NOT a step here - it is transient local state (see `changing`), so
// reloading or sharing a room URL never re-enters the picker. Non-hosts never enter a step.
type SetupStep = 'pick' | null;

function normalizeStep(raw: string | undefined): SetupStep {
  return raw === 'pick' ? raw : null;
}

interface RoomClientProps {
  code: string;
  /** The `?step=` query the create flow set (server-passed from the page), seeding the setup step. */
  initialStep?: string;
  /** The signed-in identity for the shared top nav (spec 0029); shown in the lobby/setup, hidden in
   * a running game. Server-passed so the nav renders without an auth flash. */
  viewer: Viewer;
  /** The surface this room is served on (feedback 0029): decides which games the picker offers
   * (insider-only games only on the insider surface) and crosses the shared nav's links back to the
   * apex when on the insider subdomain. Defaults to the apex surface when unset. */
  surface?: Surface;
}

export function RoomClient({
  code,
  initialStep,
  viewer,
  // Defaults to the apex surface (public games, relative chrome) when unset - the safe default,
  // matching the codebase's "assume non-insider unless told otherwise" stance. The page always
  // passes the host-derived surface, so this default only ever stands in for a bare render (tests).
  surface = APEX_SURFACE,
}: RoomClientProps) {
  const router = useRouter();
  // `undefined` means "still hydrating from session storage"; `null` means "hydrated, not a member
  // of this room". Distinguishing them avoids flashing the join prompt to a valid member on load.
  const [membership, setMembership] = useState<Membership | null | undefined>(undefined);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [game, setGame] = useState<string>(DEFAULT_GAME_ID);
  const [config, setConfig] = useState<unknown>(
    () => getGameUi(DEFAULT_GAME_ID)?.defaultConfig() ?? {},
  );
  const [starting, setStarting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<SetupStep>(() => normalizeStep(initialStep));
  // The in-room "Change game" picker is transient local state, not a `?step=` (so a reload/share of
  // the room URL never re-opens it). Distinct from the create-flow `step` above.
  const [changing, setChanging] = useState(false);

  // If the room already has a selected game (a reload, or the create flow's deep link that selected
  // it first), seed the local game + config from it so the config panel and selected-game card show
  // the right game.
  const seedGameFrom = useCallback((view: RoomView | null | undefined) => {
    const module = view?.selectedGame ? getGameUi(view.selectedGame) : undefined;
    if (module) {
      setGame(module.id);
      setConfig(module.defaultConfig());
    }
  }, []);

  // Hydrate what the join step remembered about this player (per-tab sessionStorage). If the tab
  // forgot it - a closed/reopened tab clears sessionStorage - ask the server who we are before
  // giving up: a host still owns the room durably (and any member whose session cookie survived is
  // still seated), so `resumeRoom` drops them back in without a re-join. Only a true non-member
  // (`not_member`) or no session falls through to the join screen (feedback 0021).
  useEffect(() => {
    const recalled = recallMembership(code);
    if (recalled) {
      setMembership(recalled);
      setRoom(recalled.room);
      seedGameFrom(recalled.room);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const { room: resumedRoom, membership: seat } = await resumeRoom(code);
        if (!active) return;
        const restored: Membership = {
          isHost: seat.isHost,
          mode: seat.mode,
          nickname: seat.nickname,
          player: seat.player,
          room: resumedRoom,
        };
        rememberMembership(code, restored);
        setMembership(restored);
        setRoom(resumedRoom);
        seedGameFrom(resumedRoom);
      } catch {
        // No live seat (not a member, or no session) - show the join prompt.
        if (active) setMembership(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [code, seedGameFrom]);

  const isHost = membership?.isHost ?? false;
  const running = room?.status === 'running';
  // A single-surface game (Teeter) locks the running view to the viewport so the page does not scroll
  // (feedback 0027) - a scrolling page under a drag-to-aim canvas breaks immersion. Multi-surface games
  // keep the normal scrolling page.
  const fitViewport = running && getGameUi(room?.selectedGame ?? game)?.singleSurface === true;
  // Only the host runs the setup wizard, and never while the game is running.
  const activeStep: SetupStep = isHost && !running ? step : null;
  // The picker shows for the create-flow `pick` step or the in-room change-game (local) flow.
  const showPicker = isHost && !running && (activeStep === 'pick' || changing);

  const goToStep = useCallback(
    (next: SetupStep) => {
      setStep(next);
      router.replace(next ? `/rooms/${code}?step=${next}` : `/rooms/${code}`, { scroll: false });
    },
    [code, router],
  );

  // Clear a stale `?step=` left in a shared/reloaded URL when the viewer is not a host or the game is
  // running - so the address bar matches the lobby/game they actually see (no ghost create-flow step).
  useEffect(() => {
    if (membership && step !== null && (!isHost || running)) goToStep(null);
  }, [membership, isHost, running, step, goToStep]);

  // The host reads its own public playerId from the members list (its own host row); a non-host
  // relies on the playerId join returned and stored in membership. This is the identity the engine
  // roster and `join` key on (spec 0012), never the httpOnly session id.
  const me = useMemo(() => {
    if (isHost) {
      return members.find((member) => member.isHost)?.playerId ?? membership?.player;
    }
    return membership?.player;
  }, [isHost, members, membership]);

  // Poll the room status the whole time a member is on this page - a non-host never runs the
  // host's start/exit handler, so this poll is its only way to observe the host starting the game
  // (lobby -> running: enter the game and open the engine socket) or exiting it (running -> lobby:
  // return to the lobby). Also poll the roster, but only in the lobby: during the game it arrives
  // on the engine `state` frame, so there is nothing to poll for. Deliberately NOT gated on
  // `running`, so both transitions are caught.
  useEffect(() => {
    if (!membership) return;
    let active = true;
    const load = async () => {
      try {
        const nextRoom = await getRoom(code);
        if (!active) return;
        setRoom(nextRoom);
        // Persist the fresh status to storage (no React state churn) so a reload lands in the
        // right view rather than the stale status the join step remembered.
        rememberMembership(code, { ...membership, room: nextRoom });
        if (nextRoom.status !== 'running') {
          const nextMembers = await listMembers(code);
          if (active) setMembers(nextMembers);
        }
      } catch (error) {
        if (active && error instanceof RoomApiError) setLoadError(error.message);
      }
    };
    void load();
    const timer = setInterval(load, MEMBER_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [code, membership]);

  // The engine-join auth token (spec 0064). We fetch it once the game is running and this device has
  // a resolved identity, and REFRESH it periodically so a mid-game reconnect always joins with a
  // still-valid token (the token is deliberately short-lived). The engine requires it, so the game
  // socket is only opened once we hold one - gating on it below avoids a doomed join that the engine
  // would just reject. A fetch failure leaves it null (the game stays in "connecting"); the interval
  // retries.
  const [engineToken, setEngineToken] = useState<string | null>(null);
  useEffect(() => {
    if (!running || !me || !room?.selectedGame) {
      setEngineToken(null);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const token = await fetchEngineToken(code);
        if (active) setEngineToken(token);
      } catch {
        // Leave the last-good (or null) token; the interval retries. A persistent failure keeps the
        // game in a connecting state rather than joining unauthenticated (which the engine rejects).
      }
    };
    void refresh();
    // 90s < the 120s token TTL, so a reconnect after a drop still has a live token to join with.
    const timer = setInterval(refresh, 90_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [code, running, me, room?.selectedGame]);

  const gameOptions =
    running && me && room?.selectedGame && engineToken
      ? {
          url: ENGINE_WS_URL,
          room: room.id,
          game: room.selectedGame,
          player: me,
          nickname: membership?.nickname ?? 'Player',
          token: engineToken,
        }
      : null;

  const { state, submitMove, submitVote } = useGameClient(gameOptions);

  // Analytics (spec 0032): "game completed" should be ONE event per finished game. Fire only on a real
  // transition INTO `complete` from a prior non-complete phase (a ref tracks the previous phase) - so a
  // reload/late-join that lands directly on `complete` does not fire - AND only for the host, so we get
  // one event per game rather than one per connected client (players + spectators).
  const prevPhaseRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (isHost && prev !== undefined && prev !== 'complete' && state.phase === 'complete') {
      trackGameCompleted(room?.selectedGame ?? game);
    }
  }, [state.phase, isHost, room?.selectedGame, game]);

  const persist = useCallback(
    (nextRoom: RoomView, patch?: Partial<Membership>) => {
      setRoom(nextRoom);
      setMembership((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch, room: nextRoom };
        rememberMembership(code, next);
        return next;
      });
    },
    [code],
  );

  const onModeChange = useCallback(
    async (mode: Mode) => {
      try {
        await setMode(code, mode);
        // Remember this device's choice so the next room defaults to it (spec 0050).
        rememberDeviceMode(mode);
        setMembership((prev) => {
          if (!prev) return prev;
          const next = { ...prev, mode };
          rememberMembership(code, next);
          return next;
        });
      } catch (error) {
        if (error instanceof RoomApiError) setLoadError(error.message);
      }
    },
    [code],
  );

  // Pick a game in the setup wizard: set it locally, select it on the room (so the share-card
  // preview and roster resolve it), then drop into the lobby (the share link lives there now).
  // Stays on the picker if the selection call fails.
  const onPickGame = useCallback(
    async (next: string) => {
      const module = getGameUi(next);
      const nextConfig = module?.defaultConfig() ?? {};
      setGame(next);
      setConfig(nextConfig);
      setPicking(true);
      setLoadError(null);
      try {
        const nextRoom = await selectGame(code, next, nextConfig);
        trackGamePicked(next);
        persist(nextRoom);
      } catch (error) {
        if (error instanceof RoomApiError) setLoadError(error.message);
        return;
      } finally {
        setPicking(false);
      }
      // Both a first pick and a change-game swap land in the lobby (the invite step was removed).
      if (changing) setChanging(false);
      else goToStep(null);
    },
    [code, changing, persist, goToStep],
  );

  const onChangeGame = useCallback(() => setChanging(true), []);

  const onStart = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await selectGame(code, game, config);
      // The game module reads the round count from its own config shape - the shell stays
      // game-agnostic and the control-plane debits per round.
      const rounds = getGameUi(game)?.roundsOf(config) ?? 10;
      const started = await startGame(code, rounds);
      trackGameStarted(game, rounds);
      persist(started);
    } catch (error) {
      if (error instanceof RoomApiError) {
        setStartError(error.message);
      } else {
        setStartError('Could not start the game. Try again.');
      }
    } finally {
      setStarting(false);
    }
  }, [code, game, config, persist]);

  const onControl = useCallback(
    async (action: HostControl) => {
      try {
        const next = await controlGame(code, action);
        if (action === 'exit') persist(next);
      } catch (error) {
        // While running, the Lobby (and its startError) is not on screen, so route control
        // failures to loadError, which renders above both the lobby and the game stage.
        if (error instanceof RoomApiError) setLoadError(error.message);
      }
    },
    [code, persist],
  );

  const onKick = useCallback(
    async (sessionId: string) => {
      try {
        await kickMember(code, sessionId);
        setMembers((prev) => prev.filter((member) => member.sessionId !== sessionId));
      } catch (error) {
        if (error instanceof RoomApiError) setLoadError(error.message);
      }
    },
    [code],
  );

  // One nav for every non-in-game surface (feedback 0029): carries the surface marker + apex
  // link-origin so it is consistent across the loading, join-prompt, and lobby/setup branches.
  const nav = (
    <TopNav
      viewer={viewer}
      label={surface.insider ? 'Insider' : undefined}
      linkOrigin={surface.linkOrigin || undefined}
      insider={surface.insider}
    />
  );

  // These pre-lobby states are not the running game, so they carry the shared nav too - only the
  // running game omits it. Keeps "every non-in-game surface has the nav" a rule, not a per-branch call.
  if (membership === undefined) {
    return (
      <>
        {nav}
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8 bg-bg text-text">
          <p className="text-body text-text-muted" role="status">
            Loading room {code.toUpperCase()}...
          </p>
        </main>
      </>
    );
  }

  if (!membership || !room) {
    return (
      <>
        {nav}
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8 bg-bg text-text">
          <h1 className="text-h2">Join room {code.toUpperCase()}</h1>
          <p className="text-body text-text-muted">
            You are not in this room yet. Join with the code to play.
          </p>
          <a
            href={`/join?code=${encodeURIComponent(code)}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Go to join
          </a>
        </main>
      </>
    );
  }

  return (
    <main
      className={
        fitViewport
          ? 'flex h-[100svh] flex-col overflow-hidden bg-bg text-text'
          : 'min-h-screen bg-bg text-text'
      }
    >
      {/* The shared top nav (spec 0029) shows in the lobby and setup wizard, but NOT once the game is
          running - the in-game stage keeps its own compact room-code/leave header, chrome-free. */}
      {!running ? nav : null}
      <div
        className={
          fitViewport
            ? 'mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 py-3 sm:px-6'
            : 'mx-auto max-w-5xl px-4 py-8 sm:px-6'
        }
      >
        {loadError ? (
          <p role="alert" className="mb-4 text-body-sm text-danger">
            {loadError}
          </p>
        ) : null}

        {running ? (
          <div
            className={fitViewport ? 'flex min-h-0 flex-1 flex-col gap-3' : 'flex flex-col gap-6'}
          >
            <header className="flex items-center justify-between">
              <p className="text-body-sm text-text-muted">
                Room <span className="tabular-nums tracking-widest">{room.code}</span>
              </p>
              {!isHost ? (
                <a
                  href="/rooms"
                  className="text-body-sm text-text-muted underline-offset-4 hover:underline"
                >
                  Leave
                </a>
              ) : null}
            </header>
            {me ? (
              <GameStage
                state={state}
                me={me}
                game={room?.selectedGame ?? game}
                code={code}
                mode={membership.mode}
                isHost={isHost}
                onMove={submitMove}
                onVote={submitVote}
                onControl={onControl}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-body text-text-muted">
                  The game is running but this device could not confirm its player identity, so it
                  cannot connect. Rejoin from the code to reconnect.
                </p>
                <a
                  href={`/join?code=${encodeURIComponent(code)}`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Rejoin
                </a>
              </div>
            )}
          </div>
        ) : showPicker ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="flex flex-col gap-2">
              <h1 className="text-h2 text-text">{changing ? 'Change game' : 'Pick a game'}</h1>
              <p className="text-body text-text-muted">
                {changing
                  ? 'Swap to a different game - your friends stay in the room.'
                  : 'Choose what to play. You can change it later.'}
              </p>
            </header>
            <GamePicker
              selected={game}
              onSelect={onPickGame}
              disabled={picking}
              insider={surface.insider}
            />
            {changing ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setChanging(false)}
                disabled={picking}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        ) : (
          <Lobby
            room={room}
            members={members}
            mode={membership.mode}
            isHost={isHost}
            me={me}
            game={game}
            onChangeGame={onChangeGame}
            config={config}
            onConfigChange={(next) => setConfig(next)}
            onStart={onStart}
            starting={starting}
            startError={startError}
            onModeChange={onModeChange}
            onKick={onKick}
          />
        )}
      </div>
    </main>
  );
}
