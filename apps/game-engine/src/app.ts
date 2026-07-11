import { ProtocolError, V1_PREFIX, parseStartHandoff } from '@branchout/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { GameEngine, NoSessionError, type HostAction } from './engine';
import { UnknownGameError } from './registry';

/** Injected liveness probe so the app is testable without a real Redis. */
export interface HealthChecks {
  checkRedis(): Promise<boolean>;
}

const HOST_ACTIONS: readonly HostAction[] = ['pause', 'advance', 'restart', 'exit'];

function isHostAction(value: unknown): value is HostAction {
  return typeof value === 'string' && (HOST_ACTIONS as readonly string[]).includes(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build the game-engine HTTP app. An unversioned `/health` reports Redis reachability; the
 * `/v1/sessions` routes (spec 0033) are the control-plane -> engine channel: the start handoff
 * (idempotent) and host controls. Health stays at the root because it is an operational probe, not
 * a product API.
 */
export function createApp(checks: HealthChecks, engine: GameEngine): FastifyInstance {
  const app = Fastify();

  app.get('/health', async (_request, reply) => {
    const redis = await checks.checkRedis();
    return reply.code(redis ? 200 : 503).send({
      status: redis ? 'ok' : 'degraded',
      redis: redis ? 'ok' : 'unreachable',
    });
  });

  // NOTE: the /sessions routes carry ambient authority - any caller that reaches this port can
  // start, control, or inspect a session. There is no auth yet (the control-plane authenticates
  // this server-to-server channel in a later spec), so the engine port must stay network-isolated
  // to the control-plane until then. See the matching Origin note in @branchout/protocol's ws.ts.
  //
  // Mounted under `/v1` so every functional API is versioned (spec 0033); the player WebSocket is
  // versioned separately at the connect URL (the ws server accepts any path - see socket.ts).
  app.register(
    (v1, _opts, done) => {
      // Start handoff (control-plane -> engine). Idempotent on room + game: re-posting a running
      // session returns `running` rather than restarting it.
      v1.post('/sessions', async (request, reply) => {
        let handoff;
        try {
          handoff = parseStartHandoff(request.body);
        } catch (error) {
          return reply.code(400).send({ error: messageOf(error) });
        }
        try {
          const response = await engine.start(handoff);
          return reply.code(200).send(response);
        } catch (error) {
          // Unknown game id or a game rejecting its opaque config are both client errors, not faults.
          if (error instanceof UnknownGameError || error instanceof ProtocolError) {
            return reply.code(400).send({ error: error.message });
          }
          return reply.code(400).send({ error: messageOf(error) });
        }
      });

      // Inspect a session (useful for the host UI and debugging). Returns the protocol `state`
      // projection only - never the module scratch or opaque config, which can hold in-flight secrets.
      v1.get<{ Params: { room: string; game: string } }>(
        '/sessions/:room/:game',
        async (request, reply) => {
          const { room, game } = request.params;
          const snapshot = await engine.getSnapshot(room, game);
          if (!snapshot) return reply.code(404).send({ error: 'no such session' });
          return reply.code(200).send(snapshot);
        },
      );

      // Host controls (control-plane -> engine): pause, advance, restart, exit.
      v1.post<{ Params: { room: string; game: string }; Body: { action?: unknown } }>(
        '/sessions/:room/:game/control',
        async (request, reply) => {
          const { room, game } = request.params;
          const action = request.body?.action;
          if (!isHostAction(action)) {
            return reply
              .code(400)
              .send({ error: `action must be one of ${HOST_ACTIONS.join(', ')}` });
          }
          try {
            await engine.control(room, game, action);
            return reply.code(200).send({ ok: true, action });
          } catch (error) {
            if (error instanceof NoSessionError) {
              return reply.code(404).send({ error: error.message });
            }
            throw error;
          }
        },
      );

      done();
    },
    { prefix: V1_PREFIX },
  );

  return app;
}
