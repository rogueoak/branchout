import { afterEach, describe, expect, it, vi } from 'vitest';
import { V1_PREFIX } from '@branchout/protocol';

// ENGINE_WS_URL is computed at module load from NEXT_PUBLIC_ENGINE_WS_URL, so each case resets the
// module registry and re-imports after setting the env. Guards the `/v1` versioning (spec 0033) of
// the realtime channel: without this, reverting the suffix leaves the whole suite green.
describe('ENGINE_WS_URL', () => {
  const original = process.env.NEXT_PUBLIC_ENGINE_WS_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_ENGINE_WS_URL;
    else process.env.NEXT_PUBLIC_ENGINE_WS_URL = original;
    vi.resetModules();
  });

  it('versions the default connect URL under /v1', async () => {
    delete process.env.NEXT_PUBLIC_ENGINE_WS_URL;
    vi.resetModules();
    const { ENGINE_WS_URL } = await import('./engine');
    expect(ENGINE_WS_URL.endsWith(V1_PREFIX)).toBe(true);
    expect(ENGINE_WS_URL).toBe('ws://localhost:4001/v1');
  });

  it('appends /v1 to a configured base without doubling the slash', async () => {
    process.env.NEXT_PUBLIC_ENGINE_WS_URL = 'wss://branchout.games/ws/';
    vi.resetModules();
    const { ENGINE_WS_URL } = await import('./engine');
    expect(ENGINE_WS_URL).toBe(`wss://branchout.games/ws${V1_PREFIX}`);
  });
});
