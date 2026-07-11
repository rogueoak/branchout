import { describe, expect, it, vi } from 'vitest';
import {
  ENGINE_COMPLETE_SUBPATH,
  ENGINE_ROUNDS_SUBPATH,
  PROTOCOL_VERSION,
  V1_PREFIX,
  type RoundReport,
} from '@branchout/protocol';
import { HttpControlPlaneReporter } from './reporter';

// The expected intake paths are DERIVED from the shared constants both ends use, not re-typed as
// literals. A stale hard-coded path (the feedback-0017 bug) cannot pass this test, because the same
// constant drives the reporter and the control-plane route registration - the seam is pinned to one
// source of truth, not two literals a reader hopes match.
const ROUNDS_URL = `http://cp:4000${V1_PREFIX}${ENGINE_ROUNDS_SUBPATH}`;
const COMPLETE_URL = `http://cp:4000${V1_PREFIX}${ENGINE_COMPLETE_SUBPATH}`;

const roundReport: RoundReport = {
  v: PROTOCOL_VERSION,
  room: 'r1',
  game: 'stub',
  round: 1,
  roundId: 'r1:stub:1:1',
  scores: [{ player: 'p1', points: 100, reason: 'correct answer' }],
  standings: [{ player: 'p1', nickname: 'Ada', score: 100, rank: 1 }],
};

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
}

/** The [url, init] of the first call to a mocked fetch. */
function firstCall(fetchImpl: typeof fetch): [string, RequestInit] {
  const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  return call as [string, RequestInit];
}

describe('HttpControlPlaneReporter', () => {
  it('POSTs a round report as JSON to the control-plane /v1/engine/rounds endpoint', async () => {
    const fetchImpl = okFetch();
    const reporter = new HttpControlPlaneReporter({ baseUrl: 'http://cp:4000', fetch: fetchImpl });

    await reporter.reportRound(roundReport);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = firstCall(fetchImpl);
    // baseUrl is the control-plane ORIGIN; the reporter appends the full versioned intake path
    // (spec 0033), so the version lives in code, not in the CONTROL_PLANE_URL env value.
    expect(url).toBe(ROUNDS_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(roundReport);
  });

  it('POSTs a completion report to /v1/engine/games/complete', async () => {
    const fetchImpl = okFetch();
    const reporter = new HttpControlPlaneReporter({ baseUrl: 'http://cp:4000', fetch: fetchImpl });
    await reporter.reportComplete({
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: 'stub',
      gameId: 'r1:stub:1',
      standings: [],
    });
    const [url] = firstCall(fetchImpl);
    expect(url).toBe(COMPLETE_URL);
  });

  it('strips a trailing slash from the base URL', async () => {
    const fetchImpl = okFetch();
    const reporter = new HttpControlPlaneReporter({ baseUrl: 'http://cp:4000/', fetch: fetchImpl });
    await reporter.reportRound(roundReport);
    const [url] = firstCall(fetchImpl);
    expect(url).toBe(ROUNDS_URL);
  });

  it('throws on a non-2xx response so the engine keeps the report queued', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    const reporter = new HttpControlPlaneReporter({ baseUrl: 'http://cp:4000', fetch: fetchImpl });
    await expect(reporter.reportRound(roundReport)).rejects.toThrow(/500/);
  });
});
