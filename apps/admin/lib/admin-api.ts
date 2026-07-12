// Browser-side admin API calls. They hit the SAME-ORIGIN `/api/*` path (proxied to control-plane by
// the Next rewrite / Caddy), so the host-only admin cookie is sent and any Set-Cookie is stored on
// this host. `credentials: 'include'` carries the cookie; responses are returned raw for the caller
// to branch on status.
async function send(path: string, body?: unknown): Promise<Response> {
  return fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export const adminLogin = (email: string, password: string) =>
  send('/admin/auth/login', { email, password });
export const adminLogout = () => send('/admin/auth/logout');
export const createAdmin = (email: string, password: string) =>
  send('/admin/admins', { email, password });
export const setInsider = (userId: string, insider: boolean) =>
  send(`/admin/users/${userId}/insider`, { insider });

/** Read a `{ error }` message from a failed response, with a safe fallback. */
export async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? 'Something went wrong. Please try again.';
}
