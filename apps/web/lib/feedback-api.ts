// The web client for the host feedback endpoint (spec 0048). One POST to /v1/feedback, same fetch
// base and /v1 prefix as room-api. The message is required; the context is auto-captured by the
// dialog. Keep this tiny and dependency-free so it is trivial to unit-test with a mocked fetch.

import { V1_PREFIX } from '@branchout/protocol';

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

/**
 * The auto-captured context the dialog attaches. No PII beyond what the recipient needs to act, and
 * never a session token: the room code, the game id, the current phase, and that the sender is the
 * host. `at` is stamped at submit time.
 */
export interface FeedbackContext {
  code?: string;
  game?: string;
  phase?: string;
  isHost?: boolean;
  at?: string;
}

/**
 * Send host feedback. Resolves on a 2xx `{ ok: true }`; throws an `Error` carrying the server's
 * message otherwise (including the 503 "not configured" state), so the dialog can show it verbatim.
 */
export async function sendFeedback(message: string, context: FeedbackContext): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}/feedback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, context }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || body.ok !== true) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Could not send feedback.');
  }
}
