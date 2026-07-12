import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminLogout, deleteUser, setInsider } from './admin-api';

// Regression guard (spec 0040): a bodyless POST must NOT declare `content-type: application/json`.
// Fastify rejects an empty body under that content-type with a 400, which silently broke the
// hard-delete (and latently the logout) call. Body-carrying calls must still send the JSON header.
function okResponse() {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

describe('admin-api send()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deleteUser POSTs the delete endpoint with NO body and NO json content-type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await deleteUser('user-1');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/v1/admin/users/user-1/delete');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(init!.body).toBeUndefined();
    const headers = (init!.headers ?? {}) as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
  });

  it('adminLogout POSTs with no body and no json content-type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await adminLogout();
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init!.body).toBeUndefined();
    expect(((init!.headers ?? {}) as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('setInsider (a body-carrying call) still sends the JSON content-type and body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await setInsider('user-1', true);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/v1/admin/users/user-1/insider');
    expect(((init!.headers ?? {}) as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(JSON.parse(init!.body as string)).toEqual({ insider: true });
  });
});
