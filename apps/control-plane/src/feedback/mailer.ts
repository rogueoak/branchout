import { FEEDBACK_FROM, FEEDBACK_TO } from './addresses';

/**
 * One email to send: the composed subject + plain-text body, plus an optional styled HTML body.
 * `text` is always present as the fallback for clients that drop HTML; `html` is the rich version
 * (spec 0048). From/to are fixed (see addresses).
 */
export interface FeedbackEmail {
  subject: string;
  text: string;
  html?: string;
}

/**
 * The narrow send surface the feedback route needs (spec 0048). An interface, not a concrete
 * Resend client, so the route is testable with an in-memory fake that records the call and the
 * integration test asserts the from/to/body without touching the network - the same store-plus-fake
 * shape the rest of the service uses.
 */
export interface FeedbackMailer {
  send(email: FeedbackEmail): Promise<void>;
}

/** How long to wait on the Resend API before aborting, so a hung service can't hang the request. */
const SEND_TIMEOUT_MS = 10_000;

/** Raised when Resend rejects the send, so the route can map it to a 502 rather than a bare 500. */
export class MailerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerError';
  }
}

/**
 * Send via Resend's REST API with a direct `fetch` - no `resend` npm dependency for one POST. The
 * API key stays server-side (this runs in the control-plane, never the browser). `from`/`to` come
 * from the shared addresses module so they are correct by construction, not re-typed here.
 */
export class ResendMailer implements FeedbackMailer {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = SEND_TIMEOUT_MS,
  ) {}

  async send(email: FeedbackEmail): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: FEEDBACK_FROM,
          to: FEEDBACK_TO,
          subject: email.subject,
          text: email.text,
          // Include the styled HTML when the route composed one; Resend uses it as the rich body and
          // falls back to `text` for clients that strip HTML.
          ...(email.html ? { html: email.html } : {}),
        }),
        // Bound the wait so a hung Resend aborts (and surfaces as a MailerError -> 502) rather than
        // holding the request open indefinitely.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new MailerError(`Resend request failed: ${String(error)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new MailerError(`Resend returned ${res.status}: ${detail}`);
    }
  }
}
