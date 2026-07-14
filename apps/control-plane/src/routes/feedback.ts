import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FeedbackRateLimitConfig } from '../config';
import type { FeedbackMailer } from '../feedback/mailer';
import { MailerError } from '../feedback/mailer';
import type { RateLimiter } from '../ratelimit/limiter';

/** The most a feedback message can be, so a runaway/hostile body cannot balloon the email. */
const MAX_MESSAGE_LENGTH = 5000;

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

/** Pull the untrusted context object off the body, defaulting to an empty object. */
function readContext(body: unknown): FeedbackContext {
  if (body && typeof body === 'object' && 'context' in body) {
    const raw = (body as Record<string, unknown>).context;
    if (raw && typeof raw === 'object') {
      const ctx = raw as Record<string, unknown>;
      return {
        ...(typeof ctx.code === 'string' ? { code: ctx.code } : {}),
        ...(typeof ctx.game === 'string' ? { game: ctx.game } : {}),
        ...(typeof ctx.phase === 'string' ? { phase: ctx.phase } : {}),
        ...(typeof ctx.isHost === 'boolean' ? { isHost: ctx.isHost } : {}),
        ...(typeof ctx.at === 'string' ? { at: ctx.at } : {}),
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
 * strips `/api`). It validates the message, rate-limits per client IP, and sends via Resend. With no
 * mailer wired (`RESEND_API_KEY` unset) it returns a clear 503 and logs a warning - it never crashes,
 * so the code ships before the secret does.
 */
export function registerFeedbackRoutes(app: FastifyInstance, deps: FeedbackDeps): void {
  const { mailer, limiter, rateLimit } = deps;

  app.post('/feedback', async (request: FastifyRequest, reply: FastifyReply) => {
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

    // Per-IP cap so one source cannot flood the inbox. request.ip is the Caddy-sanitized peer on the
    // edge-fronted path (spec 0038); a best-effort secondary signal for a low-stakes form.
    const limitKey = `feedback:${request.ip}`;
    const verdict = await limiter.check(limitKey, rateLimit.maxPerIp);
    if (verdict.blocked) {
      return tooManyRequests(reply, verdict.retryAfterSeconds);
    }

    // The wire-the-secret-later state: no key, no send. Return a clear, non-500 "not configured" so
    // the host sees a real message and the caller can distinguish it from an actual failure.
    if (!mailer) {
      request.log.warn(
        '[feedback] RESEND_API_KEY is unset - feedback email is not configured; dropping submission',
      );
      return reply.code(503).send({ ok: false, error: 'Feedback email is not configured yet.' });
    }

    const context = readContext(request.body);
    const receivedAt = new Date().toISOString();
    const gameLabel = context.game ? ` (${context.game})` : '';
    const email = {
      subject: `Branch Out feedback${gameLabel}`,
      text: composeBody(message, context, receivedAt),
    };

    try {
      await mailer.send(email);
    } catch (error) {
      // Count the attempt only on a real send path, and map a downstream failure to a 502 (the
      // upstream mail service failed) rather than a bare 500 - the request itself was well-formed.
      request.log.error({ err: error }, '[feedback] send failed');
      if (error instanceof MailerError) {
        return reply.code(502).send({ ok: false, error: 'Could not send feedback right now.' });
      }
      throw error;
    }

    await limiter.record(limitKey, rateLimit.windowSeconds);
    return reply.code(200).send({ ok: true });
  });
}
