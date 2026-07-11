import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Integration for the web half of the share-card flow: the REAL server-side getRoomPreview fetch
// (lib/room-preview) + generateMetadata card selection, run against a real HTTP server that returns
// the control-plane's exact `/rooms/:code/preview` response shape (nothing mocked). Paired with the
// control-plane's own route test - which proves the live endpoint emits this shape - the two cover
// the full path from a share link to the unfurled OG tags. The browser-level check lives in the
// Playwright suite (spec 0021).

let server: Server;
let generateMetadata: typeof import('./page').generateMetadata;

// A stand-in control-plane: mirrors the real route's bodies for a known code, a game-less room,
// and an unknown code (404).
beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = req.url ?? '';
    // The preview fetch is versioned under /v1 (spec 0033); the real control-plane serves it there.
    if (url === '/v1/rooms/TRIVI/preview') {
      res.end(
        JSON.stringify({ preview: { code: 'TRIVI', status: 'lobby', selectedGame: 'trivia' } }),
      );
    } else if (url === '/v1/rooms/EMPTY/preview') {
      res.end(JSON.stringify({ preview: { code: 'EMPTY', status: 'lobby', selectedGame: null } }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'No room with that code.', code: 'not_found' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  // room-preview reads the server-side CONTROL_PLANE_URL at module load (not the browser
  // NEXT_PUBLIC_ one), so set it before importing the page.
  process.env.CONTROL_PLANE_URL = `http://127.0.0.1:${port}`;
  ({ generateMetadata } = await import('./page'));
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function params(code?: string) {
  return { searchParams: Promise.resolve(code ? { code } : {}) };
}

describe('join generateMetadata over a real preview fetch', () => {
  it('unfurls the trivia card for a live trivia room', async () => {
    const meta = await generateMetadata(params('TRIVI'));
    expect(meta.title).toBe('Join my game');
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: '/share-trivia.png', width: 1200, height: 630 }),
    ]);
    expect(meta.twitter?.card).toBe('summary_large_image');
  });

  it('unfurls the generic card for a room with no game selected', async () => {
    const meta = await generateMetadata(params('EMPTY'));
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: '/share-join.png' })]);
  });

  it('unfurls the generic card when the code is unknown (real 404)', async () => {
    const meta = await generateMetadata(params('ZZZZZ'));
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: '/share-join.png' })]);
  });
});
