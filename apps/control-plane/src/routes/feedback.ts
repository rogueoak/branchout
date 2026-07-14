import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FeedbackRateLimitConfig, SessionCookieConfig } from '../config';
import type { FeedbackMailer } from '../feedback/mailer';
import { MailerError } from '../feedback/mailer';
import type { RateLimiter } from '../ratelimit/limiter';
import { RoomError, type RoomService } from '../rooms/service';
import type { Session } from '../sessions/session';
import type { SessionStore } from '../sessions/store';

/** The most a feedback message can be, so a runaway/hostile body cannot balloon the email. */
const MAX_MESSAGE_LENGTH = 5000;

/** Cap each untrusted context string so a hostile caller cannot balloon the email through them. */
const MAX_CONTEXT_FIELD_LENGTH = 200;

/**
 * Auto-captured context the web dialog attaches to a feedback note (spec 0048). Every field is
 * optional and untrusted - it comes from the browser - so the route treats it as best-effort
 * annotation, never as anything it authorizes on. No PII and no session token: just enough for the
 * recipient to act (which room, which game, where in the game, that the sender was the host).
 */
export interface FeedbackContext {
  /** The room join code. */
  code?: string;
  /** The selected game id (the engine/registry plugin id). */
  game?: string;
  /** The current game phase/status. */
  phase?: string;
  /** Whether the sender is the host (the button is host-only, so this is normally true). */
  isHost?: boolean;
  /** ISO timestamp the browser stamped when the host submitted. */
  at?: string;
}

export interface FeedbackDeps {
  /**
   * Sends the composed email. `undefined` when `RESEND_API_KEY` is unset - the "wire the secret
   * later" state: the route replies "not configured" (503) and logs a warning instead of crashing.
   */
  mailer?: FeedbackMailer;
  /** Rate limiter backing the per-IP cap (reuses the spec 0036 limiter). */
  limiter: RateLimiter;
  /** Per-IP feedback thresholds. */
  rateLimit: FeedbackRateLimitConfig;
  /** Session store + cookie config to authenticate the caller (the same reads the room routes use). */
  sessions: SessionStore;
  cookie: SessionCookieConfig;
  /** Rooms service, to verify the caller is actually the host of the room in the context. */
  rooms: RoomService;
}

/** Read a string field from an unknown JSON value without trusting its type. */
function asString(source: unknown, key: string): string {
  if (source && typeof source === 'object' && key in source) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

/** A capped copy of an untrusted context string, or undefined when it is not a string. */
function cappedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_CONTEXT_FIELD_LENGTH) : undefined;
}

/** Pull the untrusted context object off the body, capping each string field. */
function readContext(body: unknown): FeedbackContext {
  if (body && typeof body === 'object' && 'context' in body) {
    const raw = (body as Record<string, unknown>).context;
    if (raw && typeof raw === 'object') {
      const ctx = raw as Record<string, unknown>;
      const code = cappedString(ctx.code);
      const game = cappedString(ctx.game);
      const phase = cappedString(ctx.phase);
      const at = cappedString(ctx.at);
      return {
        ...(code !== undefined ? { code } : {}),
        ...(game !== undefined ? { game } : {}),
        ...(phase !== undefined ? { phase } : {}),
        ...(typeof ctx.isHost === 'boolean' ? { isHost: ctx.isHost } : {}),
        ...(at !== undefined ? { at } : {}),
      };
    }
  }
  return {};
}

/** Compose the plain-text email body: the message, then the context the recipient needs to act. */
function composeBody(message: string, context: FeedbackContext, receivedAt: string): string {
  const lines = [
    message.trim(),
    '',
    '--- context ---',
    `room code: ${context.code ?? '(none)'}`,
    `game: ${context.game ?? '(none)'}`,
    `phase: ${context.phase ?? '(none)'}`,
    `host: ${context.isHost === true ? 'yes' : context.isHost === false ? 'no' : '(unknown)'}`,
    `submitted at: ${context.at ?? receivedAt}`,
  ];
  return lines.join('\n');
}

/** A uniform 429, mirroring the auth routes (no wording that leaks anything). */
function tooManyRequests(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header('Retry-After', String(retryAfterSeconds))
    .send({ ok: false, error: 'Too many feedback submissions. Please try again later.' });
}

/**
 * Register the host feedback endpoint (spec 0048). `POST /feedback` (prod `/api/v1/feedback` - Caddy
 * strips `/api`). Browser-facing and cookie-authenticated like the room routes: an unauthenticated
 * caller gets a 401 so an anonymous internet caller cannot make the service spend money on Resend or
 * spam the inbox (the per-IP cap is only trustworthy behind Caddy, spec 0038). When the context names
 * a room, the caller is verified to be that room's host (403 otherwise), so `isHost` is server-checked
 * rather than trusted from the body. It then validates the message, rate-limits per IP, and sends via
 * Resend. With no mailer wired (`RESEND_API_KEY` unset) it returns a clear 503 and logs a warning - it
 * never crashes, so the code ships before the secret does.
 */
export function registerFeedbackRoutes(app: FastifyInstance, deps: FeedbackDeps): void {
  const { mailer, limiter, rateLimit, sessions, cookie, rooms } = deps;

  const currentSession = async (request: FastifyRequest): Promise<Session | null> => {
    const id = request.cookies[cookie.name];
    return id ? sessions.read(id) : null;
  };

  app.post('/feedback', async (request: FastifyRequest, reply: FastifyReply) => {
    // Require a valid session. The host is always signed in, and the web client sends the session
    // cookie (credentials: 'include'), so this rejects only an anonymous/forged caller.
    const session = await currentSession(request);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'Sign in to send feedback.' });
    }

    const message = asString(request.body, 'message').trim();
    if (message.length === 0) {
      return reply.code(400).send({ ok: false, error: 'A feedback message is required.' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return reply.code(400).send({
        ok: false,
        error: `Feedback is limited to ${MAX_MESSAGE_LENGTH} characters.`,
      });
    }

    const context = readContext(request.body);

    // When the note names a room, verify the caller is actually that room's host - so `isHost` in the
    // email is server-verified, not trusted from the request body. `resume` re-seats a durable host
    // and throws for a true non-member (404); a member who is not the host is a 403.
    if (context.code) {
      try {
        const { membership } = await rooms.resume(context.code, session);
        if (!membership.isHost) {
          return reply.code(403).send({ ok: false, error: 'Only the host can send feedback.' });
        }
      } catch (error) {
        if (error instanceof RoomError) {
          // A non-member (or unknown room) has no business sending host feedback for it.
          return reply.code(403).send({ ok: false, error: 'Only the host can send feedback.' });
        }
        throw error;
      }
    }

    // Per-IP cap so one authenticated source cannot flood the inbox. request.ip is the Caddy-sanitized
    // peer on the edge-fronted path (spec 0038); a best-effort secondary signal for a low-stakes form.
    // Checked (and recorded below) for EVERY processed request so the 503/502 paths are capped too.
    const limitKey = `feedback:${request.ip}`;
    const verdict = await limiter.check(limitKey, rateLimit.maxPerIp);
    if (verdict.blocked) {
      return tooManyRequests(reply, verdict.retryAfterSeconds);
    }
    // Record the attempt regardless of send outcome, so a not-configured (503) or failing (502) path
    // cannot be hammered without limit.
    await limiter.record(limitKey, rateLimit.windowSeconds);

    // The wire-the-secret-later state: no key, no send. Return a clear, non-500 "not configured" so
    // the host sees a real message and the caller can distinguish it from an actual failure.
    if (!mailer) {
      request.log.warn(
        '[feedback] RESEND_API_KEY is unset - feedback email is not configured; dropping submission',
      );
      return reply.code(503).send({ ok: false, error: 'Feedback email is not configured yet.' });
    }

    const receivedAt = new Date().toISOString();
    const gameLabel = context.game ? ` (${context.game})` : '';
    const email = {
      subject: `Branch Out feedback${gameLabel}`,
      text: composeBody(message, context, receivedAt),
    };

    try {
      await mailer.send(email);
    } catch (error) {
      // Map a downstream failure to a 502 (the upstream mail service failed) rather than a bare 500 -
      // the request itself was well-formed.
      request.log.error({ err: error }, '[feedback] send failed');
      if (error instanceof MailerError) {
        return reply.code(502).send({ ok: false, error: 'Could not send feedback right now.' });
      }
      throw error;
    }

    return reply.code(200).send({ ok: true });
  });
}
