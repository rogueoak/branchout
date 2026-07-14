import { FEEDBACK_FROM, FEEDBACK_TO } from './addresses';

/** One email to send: the composed subject + plain-text body. From/to are fixed (see addresses). */
export interface FeedbackEmail {
  subject: string;
  text: string;
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
        }),
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
