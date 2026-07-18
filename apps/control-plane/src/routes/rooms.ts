import { mintEngineToken } from '@branchout/protocol';
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
  /**
   * Shared HMAC secret for engine-join authentication (spec 0064). When set,
   * `GET /rooms/:code/engine-token` mints a token binding the caller's OWN membership to the engine
   * join. Unset -> that endpoint returns a 503 "not configured" (dev/tests).
   */
  engineAuthSecret?: string;
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

/** Parse a raw mode string to a known {@link Mode}, or `undefined` so the service applies its default. */
function parseMode(raw: string): Mode | undefined {
  return raw === 'viewer' || raw === 'interactive' || raw === 'remote' ? raw : undefined;
}

/** Map a RoomError code to an HTTP status. Authorization and affordability are distinct codes. */
function statusFor(code: RoomError['code']): number {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'not_member':
      return 404;
    case 'kicked':
      return 403;
    case 'insufficient_credits':
      return 402;
    case 'no_game':
    case 'no_viewer':
    case 'too_few_players':
    case 'room_full':
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
  const { rooms, sessions, cookie, engineAuthSecret } = deps;

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
        // The engine failing is a 502 either way (an upstream fault the browser cannot fix), but the
        // CAUSE matters: a transport failure (reached=false) is genuinely "could not be reached",
        // while a reached-but-refused start (reached=true, e.g. a 400 for a missing data bank or a
        // 503 at worker cap) is not - flattening both to one message hid a data/config fault as a
        // network fault. Log the real status + engine message (control-plane logs via console) so an
        // operator can see it in `docker logs`; keep the browser copy generic.
        console.error(
          `[control-plane] engine call failed (status=${error.status}, reached=${error.reached}): ${error.message}`,
        );
        return reply.code(502).send({
          error: error.reached
            ? 'The game engine could not start the game.'
            : 'The game engine could not be reached.',
        });
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

  // Join a room by code with a per-game nickname and mode (viewer / interactive / remote).
  app.post('/rooms/:code/join', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const { room, playerId } = await rooms.join(code, session, {
        nickname: asString(request.body, 'nickname'),
        mode: parseMode(asString(request.body, 'mode')),
      });
      // Return the caller's public playerId so a non-host device can `join` the engine with it.
      // `sessionId` (the httpOnly cookie value) is never echoed to JS.
      return reply.code(200).send({ room, playerId });
    }),
  );

  // A member switches mode (viewer / interactive / remote).
  app.patch('/rooms/:code/mode', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const mode = parseMode(asString(request.body, 'mode'));
      if (!mode) {
        return reply.code(409).send({ error: 'Choose a valid mode.' });
      }
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

  // Public room preview: no session required. Serves link unfurls (Open Graph) so a crawler - which
  // has no cookie and is not a member - can still show the right share card. Returns only status +
  // selected game; never member/session data. 404s an unknown code.
  app.get('/rooms/:code/preview', async (request, reply) => {
    const { code } = request.params as { code: string };
    try {
      const preview = await rooms.preview(code);
      return reply.code(200).send({ preview });
    } catch (error) {
      if (error instanceof RoomError && error.code === 'not_found') {
        return reply.code(404).send({ error: error.message, code: error.code });
      }
      throw error;
    }
  });

  // Room view: caller must be a member. Polled so a non-host device learns when the host starts
  // the game (status -> running) or exits back to the lobby, since it never runs the host handler.
  app.get('/rooms/:code', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const room = await rooms.view(code, session);
      return reply.code(200).send({ room });
    }),
  );

  // Resume: the caller's own seat, so the web client can rebuild its per-tab membership after a
  // closed tab cleared it. Re-seats a durable host whose ephemeral roster row expired (feedback
  // 0021), so a returning host lands back in its room instead of the join screen; a true non-member
  // gets `not_member` (404).
  app.get('/rooms/:code/me', async (request, reply) =>
    withSession(request, reply, async (session) => {
      const { code } = request.params as { code: string };
      const { room, membership } = await rooms.resume(code, session);
      return reply.code(200).send({ room, membership });
    }),
  );

  // Engine join token (spec 0064): mint a short-lived HMAC token that authenticates THIS caller's
  // WebSocket join to the engine. Session-authenticated + resolved over the caller's OWN membership,
  // so a device can only ever get a token for its own playerId - never another player's. The token
  // binds `{room.id, selectedGame, player}`; the engine verifies it before honouring the join, which
  // is what makes the spec-0052 per-player secrecy guarantee actually hold. 401 (no session), 404
  // (not a member), 409 (no game selected yet), 503 (secret not configured - dev/tests).
  app.get('/rooms/:code/engine-token', async (request, reply) =>
    withSession(request, reply, async (session) => {
      if (!engineAuthSecret) {
        return reply.code(503).send({ error: 'Engine authentication is not configured.' });
      }
      const { code } = request.params as { code: string };
      // `resume` resolves the caller to their own membership (and re-seats a returning host), throwing
      // `not_member` (404) for a genuine non-member - so the token is minted only for a real seat.
      const { room, membership } = await rooms.resume(code, session);
      if (!room.selectedGame) {
        // No game is selected, so there is nothing to authenticate a join to yet.
        return reply.code(409).send({ error: 'No game is selected for this room yet.' });
      }
      // Bind to room.id (the engine's room key, which the browser sends as the join `room`), the
      // selected game, and the caller's OWN public playerId (never their sessionId).
      const token = mintEngineToken(
        { room: room.id, game: room.selectedGame, player: membership.player },
        engineAuthSecret,
      );
      return reply.code(200).send({ token });
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
