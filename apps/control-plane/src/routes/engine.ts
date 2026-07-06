import { timingSafeEqual } from 'node:crypto';
import { ProtocolError, parseGameCompleteReport, parseRoundReport } from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RoomError, type RoomService } from '../rooms/service';

export interface EngineRoutesDeps {
  rooms: RoomService;
  /**
   * Shared secret the engine presents in `x-internal-token` on every report. These endpoints
   * debit credits and award stars, so they must not be callable by a browser or a stranger. When
   * set, a missing or wrong token is rejected 401; left unset only in a trusted local/dev network.
   */
  internalToken?: string;
}

/**
 * The engine -> control-plane report intake (server-to-server, internal REST - spec 0007). The
 * engine calls these when a round finishes and when a game completes; the control-plane bills and
 * scores. Both are idempotent by the report's stable id, so a retry is safe.
 */
export function registerEngineRoutes(app: FastifyInstance, deps: EngineRoutesDeps): void {
  const { rooms, internalToken } = deps;

  /** Guard the internal surface with the shared token when one is configured. */
  const authorized = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!internalToken) {
      // Fail closed in production: an unset token must never silently ship an open money
      // endpoint. Only a trusted local/dev network may run without one, by explicit opt-in.
      if (
        process.env.NODE_ENV === 'production' &&
        process.env.ALLOW_UNAUTHENTICATED_ENGINE !== '1'
      ) {
        reply.code(401).send({ error: 'Unauthorized.' });
        return false;
      }
      return true;
    }
    const header = request.headers['x-internal-token'];
    const presented = Array.isArray(header) ? header[0] : header;
    if (!presented || !safeEqual(presented, internalToken)) {
      reply.code(401).send({ error: 'Unauthorized.' });
      return false;
    }
    return true;
  };

  // Round report: record scoring and debit one credit, idempotent by roundId.
  app.post('/engine/rounds', async (request, reply) => {
    if (!authorized(request, reply)) {
      return reply;
    }
    let status: 'recorded' | 'duplicate';
    try {
      const report = parseRoundReport(request.body);
      status = await rooms.recordRound(report);
    } catch (error) {
      return handleReportError(error, reply);
    }
    return reply.code(200).send({ v: PROTOCOL_VERSION, status });
  });

  // Game-complete report: convert final standings to stars and record, idempotent by gameId.
  app.post('/engine/games/complete', async (request, reply) => {
    if (!authorized(request, reply)) {
      return reply;
    }
    let status: 'recorded' | 'duplicate';
    try {
      const report = parseGameCompleteReport(request.body);
      status = await rooms.recordGameComplete(report);
    } catch (error) {
      return handleReportError(error, reply);
    }
    return reply.code(200).send({ v: PROTOCOL_VERSION, status });
  });
}

/**
 * Constant-time comparison of the bearer secret so response latency does not leak how much of the
 * token matched. A length mismatch is an early, safe reject (timingSafeEqual requires equal-length
 * buffers); the only thing leaked is the token's length, which is not the secret.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A malformed envelope is a 400; an unknown room is a 404; anything else propagates. */
function handleReportError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof ProtocolError) {
    return reply.code(400).send({ error: error.message });
  }
  if (error instanceof RoomError) {
    return reply.code(error.code === 'not_found' ? 404 : 409).send({ error: error.message });
  }
  throw error;
}
