import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionCookieConfig } from '../config';
import type { ControlAction } from '../rooms/engine-client';
import { EngineError } from '../rooms/engine-client';
import type { Mode } from '../rooms/membership';
import { RoomError, type RoomService } from '../rooms/service';
import type { Session } from '../sessions/session';
import type { SessionStore } from '../sessions/store';

export interface RoomRoutesDeps {
  rooms: RoomService;
  sessions: SessionStore;
  cookie: SessionCookieConfig;
}

/** Read a string field from an unknown JSON body without trusting its type. */
function asString(body: unknown, key: string): string {
  if (body && typeof body === 'object' && key in body) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

/** Map a RoomError code to an HTTP status. Authorization and affordability are distinct codes. */
function statusFor(code: RoomError['code']): number {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'kicked':
      return 403;
    case 'insufficient_credits':
      return 402;
    case 'no_game':
    case 'no_viewer':
    case 'invalid':
      return 409;
    case 'engine':
      return 502;
  }
}

/**
 * Room and orchestration endpoints (browser-facing, cookie-authenticated). A host creates and
 * steers a room; players and observers join by code. The engine's report intake is a separate,
 * server-to-server surface (routes/engine.ts).
 */
export function registerRoomRoutes(app: FastifyInstance, deps: RoomRoutesDeps): void {
  const { rooms, sessions, cookie } = deps;

  const currentSession = async (request: FastifyRequest): Promise<Session | null> => {
    const id = request.cookies[cookie.name];
    return id ? sessions.read(id) : null;
  };

  /** Run a handler that needs a session, translating RoomError + EngineError to HTTP responses. */
  const withSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    handler: (session: Session) => Promise<unknown>,
  ): Promise<unknown> => {
    const session = await currentSession(request);
    if (!session) {
      return reply.code(401).send({ error: 'Sign in or join a room first.' });
    }
    try {
      return await handler(session);
    } catch (error) {
      if (error instanceof RoomError) {
        return reply.code(statusFor(error.code)).send({ error: error.message, code: error.code });
      }
      if (error instanceof EngineError) {
        return reply.code(502).send({ error: 'The game engine could not be reached.' });
      }
      throw error;
    }
  };

  // Create a room. Host only (an account session).
  app.post('/rooms', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { room, playerId } = await rooms.createRoom(session);
      // Echo the host's public playerId so it has its engine identity without waiting on
      // `/members` (a host reloading mid-game would otherwise be bounced to rejoin).
      return reply.code(201).send({ room, playerId });
    }),
  );

  // Join a room by code as a player or observer, with a per-game nickname.
  app.post('/rooms/:code/join', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const roleRaw = asString(request.body, 'role');
      const role = roleRaw === 'observer' ? 'observer' : 'player';
      const modeRaw = asString(request.body, 'mode');
      const { room, playerId } = await rooms.join(code, session, {
        role,
        nickname: asString(request.body, 'nickname'),
        mode:
          modeRaw === 'remote' ? 'remote' : modeRaw === 'interactive' ? 'interactive' : undefined,
      });
      // Return the caller's public playerId so a non-host device can `join` the engine with it.
      // `sessionId` (the httpOnly cookie value) is never echoed to JS.
      return reply.code(200).send({ room, playerId });
    }),
  );

  // A player switches interactive/remote mode.
  app.patch('/rooms/:code/mode', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const mode = asString(request.body, 'mode') as Mode;
      await rooms.setMode(code, session, mode);
      return reply.code(200).send({ ok: true });
    }),
  );

  // Host selects a game and its opaque config.
  app.post('/rooms/:code/select', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const room = await rooms.selectGame(code, session, asString(body, 'game'), body.config);
      return reply.code(200).send({ room });
    }),
  );

  // Host starts the game (runs the viewer + affordability gates before any engine call).
  app.post('/rooms/:code/start', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const rounds = typeof body.rounds === 'number' ? body.rounds : 1;
      const room = await rooms.start(code, session, rounds);
      return reply.code(200).send({ room });
    }),
  );

  // Host control: pause / advance / restart / exit (exit returns the room to lobby).
  app.post('/rooms/:code/control', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const action = asString(request.body, 'action') as ControlAction;
      if (action !== 'pause' && action !== 'advance' && action !== 'restart' && action !== 'exit') {
        return reply.code(400).send({ error: 'action must be pause, advance, restart, or exit.' });
      }
      const room = await rooms.control(code, session, action);
      return reply.code(200).send({ room });
    }),
  );

  // Host kicks a member by their session id.
  app.post('/rooms/:code/kick', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      await rooms.kick(code, session, asString(request.body, 'sessionId'));
      return reply.code(200).send({ ok: true });
    }),
  );

  // Members list: caller must be a member; only the host sees session ids.
  app.get('/rooms/:code/members', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const members = await rooms.members(code, session);
      return reply.code(200).send({ members });
    }),
  );
}
