import { beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate generateMetadata's game-to-card resolution: mock the public preview fetch.
const hoisted = vi.hoisted(() => ({ getRoomPreview: vi.fn() }));

vi.mock('../../lib/room-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/room-api')>();
  return { ...actual, getRoomPreview: (code: string) => hoisted.getRoomPreview(code) };
});

import { generateMetadata } from './page';

function params(code?: string) {
  return { searchParams: Promise.resolve(code ? { code } : {}) };
}

describe('join generateMetadata (Open Graph share card)', () => {
  beforeEach(() => hoisted.getRoomPreview.mockReset());

  it('points at the trivia card for a room playing trivia', async () => {
    hoisted.getRoomPreview.mockResolvedValueOnce({
      code: 'ABC12',
      status: 'lobby',
      selectedGame: 'trivia',
    });
    const meta = await generateMetadata(params('ABC12'));
    expect(meta.title).toBe('Join my game');
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: '/share-trivia.png', width: 1200, height: 630 }),
    ]);
    expect(meta.twitter?.card).toBe('summary_large_image');
    expect(meta.twitter?.images).toEqual(['/share-trivia.png']);
  });

  it('falls back to the generic card when a room has no game yet', async () => {
    hoisted.getRoomPreview.mockResolvedValueOnce({
      code: 'ABC12',
      status: 'lobby',
      selectedGame: null,
    });
    const meta = await generateMetadata(params('ABC12'));
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: '/share-join.png' })]);
  });

  it('falls back to the generic card when the preview fetch throws (bad/expired code)', async () => {
    hoisted.getRoomPreview.mockRejectedValueOnce(new Error('not found'));
    const meta = await generateMetadata(params('ZZZZZ'));
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: '/share-join.png' })]);
  });

  it('does not even fetch when there is no code, and still unfurls', async () => {
    const meta = await generateMetadata(params());
    expect(hoisted.getRoomPreview).not.toHaveBeenCalled();
    expect(meta.twitter?.images).toEqual(['/share-join.png']);
  });
});
