'use client';

// The room page: lobby before the game, the interactive/remote stage once it runs. It holds the
// room + roster, drives the host's select/start/controls through the control-plane (spec 0006),
// and opens the engine WebSocket (spec 0007) when the game is running. It is a thin orchestrator -
// the phase rendering lives in the game components, the engine folding in the game client.

import { buttonVariants } from '@rogueoak/canopy';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameStage, type HostControl } from '../../../components/game/GameStage';
import { Lobby } from '../../../components/game/Lobby';
import { ENGINE_WS_URL } from '../../../lib/engine';
import { recallMembership, rememberMembership, type Membership } from '../../../lib/membership';
import {
  RoomApiError,
  controlGame,
  getRoom,
  listMembers,
  selectGame,
  setMode,
  startGame,
  kickMember,
  type Mode,
  type RoomMember,
  type RoomView,
} from '../../../lib/room-api';
import { defaultTriviaConfig, type TriviaHostConfig } from '../../../lib/trivia-config';
import { useGameClient } from '../../../lib/use-game-client';

const TRIVIA_GAME_ID = 'trivia';
const MEMBER_POLL_MS = 3000;

interface RoomClientProps {
  code: string;
}

export function RoomClient({ code }: RoomClientProps) {
  // `undefined` means "still hydrating from session storage"; `null` means "hydrated, not a member
  // of this room". Distinguishing them avoids flashing the join prompt to a valid member on load.
  const [membership, setMembership] = useState<Membership | null | undefined>(undefined);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [config, setConfig] = useState<TriviaHostConfig>(defaultTriviaConfig);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Hydrate what the join step remembered about this player. Without it, this browser is not a
  // known member of the room, so send them to the join screen.
  useEffect(() => {
    const recalled = recallMembership(code);
    setMembership(recalled ?? null);
    setRoom(recalled?.room ?? null);
  }, [code]);

  const isHost = membership?.isHost ?? false;
  const running = room?.status === 'running';

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

  const gameOptions =
    running && me && room?.selectedGame
      ? {
          url: ENGINE_WS_URL,
          room: room.id,
          game: room.selectedGame,
          player: me,
          nickname: membership?.nickname ?? 'Player',
        }
      : null;

  const { state, submitAnswer, submitVote } = useGameClient(gameOptions);

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

  const onStart = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await selectGame(code, TRIVIA_GAME_ID, config);
      const started = await startGame(code, config.rounds);
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
  }, [code, config, persist]);

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

  if (membership === undefined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8 bg-bg text-text">
        <p className="text-body text-text-muted" role="status">
          Loading room {code.toUpperCase()}...
        </p>
      </main>
    );
  }

  if (!membership || !room) {
    return (
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
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {loadError ? (
          <p role="alert" className="mb-4 text-body-sm text-danger">
            {loadError}
          </p>
        ) : null}

        {running ? (
          <div className="flex flex-col gap-6">
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
                game={room?.selectedGame ?? TRIVIA_GAME_ID}
                role={membership.role}
                mode={membership.mode}
                isHost={isHost}
                onAnswer={submitAnswer}
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
        ) : (
          <Lobby
            room={room}
            members={members}
            role={membership.role}
            mode={membership.mode}
            isHost={isHost}
            me={me}
            config={config}
            onConfigChange={setConfig}
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
