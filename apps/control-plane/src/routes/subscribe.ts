import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SubscribeConfig } from '../config';
import type { RateLimiter } from '../ratelimit/limiter';
import { type TokenCache, submitSubscription } from '../subscribe/constant-contact';
import { validateSubscribe } from '../subscribe/validate';

/**
 * `POST /v1/subscribe` (spec 0047) - adds a visitor's email to the "Branch Out" list in Constant
 * Contact, without ever exposing the OAuth credentials to the browser. Reachable in prod at
 * `/api/v1/subscribe` (Caddy strips `/api`). All the CTCT logic lives in the pure, unit-tested
 * `../subscribe/*`; this handler bridges the HTTP request to it, reads config, and maps outcomes to
 * status codes. Mirrors rogueoak's route, moved into the control-plane (branchout holds secrets here,
 * not in the Next app).
 */

export interface SubscribeDeps {
  /** CTCT credentials + the per-IP rate-limit knobs (spec 0047). */
  config: SubscribeConfig;
  /** The shared fixed-window limiter (spec 0036), also used by the auth routes. */
  limiter: RateLimiter;
  /** Module-scoped access-token cache, so a 24h CTCT token is minted once and reused across requests. */
  tokenCache: TokenCache;
  /** Injected for tests; defaults to the global fetch in production. */
  fetchImpl?: typeof fetch;
}

// Reject a body larger than this before doing any work. The payload is a single email plus an
// optional name and the honeypot, so this is generous headroom yet bounds a runaway body.
const MAX_BODY_BYTES = 8 * 1024;

/** Read a field from an unknown JSON body without trusting its type. */
function asUnknown(body: unknown, key: string): unknown {
  if (body && typeof body === 'object' && key in body) {
    return (body as Record<string, unknown>)[key];
  }
  return undefined;
}

/** A honeypot field is "filled" when a bot typed anything into the hidden input. */
function isHoneypotFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function tooManyRequests(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header('Retry-After', String(retryAfterSeconds))
    .send({ ok: false, error: 'Too many requests - please try again shortly.' });
}

/** Register the newsletter subscribe endpoint on the app (spec 0047). */
export function registerSubscribeRoutes(app: FastifyInstance, deps: SubscribeDeps): void {
  const { config, limiter, tokenCache } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.post('/subscribe', async (request, reply) => {
    // 1. Bound the body before parsing. Fastify has already parsed JSON, so guard on the serialized
    //    size as a cheap runaway check.
    const rawSize = request.body ? Buffer.byteLength(JSON.stringify(request.body), 'utf8') : 0;
    if (rawSize > MAX_BODY_BYTES) {
      return reply.code(413).send({ ok: false, error: 'Request too large.' });
    }

    const body = request.body;

    // 2. Honeypot: a filled hidden `company` field means a bot. Drop silently, report ok so it learns
    //    nothing. Deliberately BEFORE the rate limiter and any CTCT work.
    if (isHoneypotFilled(asUnknown(body, 'company'))) {
      return reply.code(200).send({ ok: true });
    }

    // 3. Validate + normalize the email (generic message; never echo the input).
    const result = validateSubscribe({
      email: asUnknown(body, 'email'),
      name: asUnknown(body, 'name'),
    });
    if (!result.ok) {
      return reply.code(400).send({ ok: false, error: result.error });
    }

    // 4. Rate limit per client IP (spec 0036 limiter). `request.ip` is the Caddy-sanitized peer on the
    //    edge-fronted path (spec 0038). Count every valid, non-bot attempt that reaches here.
    const limitKey = `subscribe:${request.ip}`;
    const verdict = await limiter.check(limitKey, config.maxPerIp);
    if (verdict.blocked) {
      return tooManyRequests(reply, verdict.retryAfterSeconds);
    }
    await limiter.record(limitKey, config.windowSeconds);

    // 5. Config from server env. Any credential unset -> fail INERT, not 500. This is the "wire secrets
    //    later" behavior: the endpoint ships before the CTCT secrets are provisioned.
    const { ctctClientId, ctctRefreshToken, ctctListId } = config;
    if (!ctctClientId || !ctctRefreshToken || !ctctListId) {
      request.log.warn(
        'subscribe: CTCT_CLIENT_ID / CTCT_REFRESH_TOKEN / CTCT_LIST_ID not fully set; endpoint is inert',
      );
      return reply.code(503).send({ ok: false, error: 'Subscribe is not configured yet.' });
    }

    // 6. Submit to CTCT (refresh-cached token -> sign_up_form). A failure returns a generic message;
    //    the thrown error carries only a status, never the CTCT response body (which can echo PII).
    //    ABUSE NOTE (spec 0047 "Abuse / go-live"): the honeypot + per-IP cap only deter naive bots;
    //    a distributed signup-bomb could still list victims and burn our sender reputation. The
    //    accepted mitigation is CONFIRMED (double) OPT-IN on the "Branch Out" list, which must be
    //    enabled BEFORE the CTCT secrets are provisioned - so an unconfirmed signup never actually
    //    joins. CAPTCHA/proof-of-work + a global rate cap are documented stronger future hardening.
    try {
      await submitSubscription(
        {
          email: result.data.email,
          name: result.data.name,
          clientId: ctctClientId,
          refreshToken: ctctRefreshToken,
          listIds: [ctctListId],
        },
        { cache: tokenCache, fetchImpl },
      );
    } catch (err) {
      request.log.error({ err }, 'subscribe: Constant Contact submission failed');
      return reply
        .code(502)
        .send({ ok: false, error: 'Sorry, subscribing failed. Please try again later.' });
    }

    return reply.code(200).send({ ok: true });
  });
}
