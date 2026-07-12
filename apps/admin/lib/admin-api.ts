import { V1_PREFIX } from '@branchout/protocol';

// Browser-side admin API calls. They hit the SAME-ORIGIN `/api/v1/*` path (proxied to control-plane by
// the Next rewrite in dev / Caddy in prod), so the host-only admin cookie is sent and any Set-Cookie is
// stored on this host. The `/v1` is part of the browser path (control-plane serves under /v1, and both
// the dev rewrite and the prod Caddy `(api)` snippet only STRIP `/api`, they do not add `/v1`) - a
// bare `/api${path}` would 404 in prod. `credentials: 'include'` carries the cookie; responses are
// returned raw for the caller to branch on status.
async function send(path: string, body?: unknown): Promise<Response> {
  // Only declare a JSON content-type when we actually send a body: Fastify rejects an empty body
  // under `content-type: application/json` with a 400, which would break the no-body POSTs
  // (logout, hard-delete). So a bodyless call sends no content-type header at all.
  const hasBody = body !== undefined;
  return fetch(`/api${V1_PREFIX}${path}`, {
    method: 'POST',
    credentials: 'include',
    ...(hasBody
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
}

export const adminLogin = (email: string, password: string) =>
  send('/admin/auth/login', { email, password });
export const adminLogout = () => send('/admin/auth/logout');
export const createAdmin = (email: string, password: string) =>
  send('/admin/admins', { email, password });
export const setInsider = (userId: string, insider: boolean) =>
  send(`/admin/users/${userId}/insider`, { insider });
/** Hard-delete a player - purges the account row (spec 0040). */
export const deleteUser = (userId: string) => send(`/admin/users/${userId}/delete`);

/** Read a `{ error }` message from a failed response, with a safe fallback. */
export async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? 'Something went wrong. Please try again.';
}
