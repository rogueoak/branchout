import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, V1_PREFIX, type StartHandoffRequest } from '@branchout/protocol';
import { EngineError, HttpEngineClient } from './engine-client';

const request: StartHandoffRequest = {
  v: PROTOCOL_VERSION,
  room: 'r1',
  game: 'trivia',
  players: [{ player: 'p1', nickname: 'Ada', isHost: true }],
  config: {},
};

describe('HttpEngineClient error mapping', () => {
  it('maps an unreachable engine (fetch rejects) to a 502 EngineError, not a raw throw', async () => {
    // A rejected fetch (ECONNREFUSED when the engine is down or the URL is wrong) would otherwise
    // escape the room route as an unlogged 500. It must surface as a mapped 502.
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = new HttpEngineClient('http://engine:4001', undefined, fetchImpl);

    const error = await client.start(request).catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).status).toBe(502);
  });

  it('maps a non-ok engine response to an EngineError carrying that status', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const client = new HttpEngineClient('http://engine:4001', undefined, fetchImpl);

    const error = await client.start(request).catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).status).toBe(503);
  });

  it('sends the internal token header to the versioned /v1/sessions handoff', async () => {
    let seen: Headers | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seen = new Headers(init.headers);
      return new Response(
        JSON.stringify({ v: PROTOCOL_VERSION, room: 'r1', game: 'trivia', status: 'started' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const client = new HttpEngineClient('http://engine:4001', 'secret-token', fetchImpl);

    await client.start(request);
    expect(seen?.get('x-internal-token')).toBe('secret-token');
    // The handoff targets the engine's versioned route (spec 0033).
    expect(seenUrl).toBe('http://engine:4001/v1/sessions');
  });

  it('proxies a host control to the versioned /v1/sessions/:room/:game/control route', async () => {
    // control() also moved under /v1 (spec 0033); without this, dropping the prefix would 404 every
    // host control (pause/advance/restart/exit) while the suite stayed green.
    let seen: Headers | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seen = new Headers(init.headers);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const client = new HttpEngineClient('http://engine:4001', 'secret-token', fetchImpl);

    await client.control('r1', 'trivia', 'advance');
    expect(seen?.get('x-internal-token')).toBe('secret-token');
    expect(seenUrl).toBe(`http://engine:4001${V1_PREFIX}/sessions/r1/trivia/control`);
  });
});
