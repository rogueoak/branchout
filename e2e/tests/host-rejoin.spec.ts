import { expect, test } from '@playwright/test';
import { createRoom, signUpHost } from '../lib/helpers';

// Feedback 0021: a host who returns to their room after a stretch of time was bounced to the "Join
// room" screen and lost host, because the browser remembers its seat only in per-tab sessionStorage
// (cleared when the tab closes) and the returning path never asked the server "do I already own this
// room?". The fix re-seats the durable host from the server on load. This proves it end to end: we
// wipe the tab's memory (the real closed-tab condition) and reload, and the host lands back in their
// lobby with host controls - no join prompt.
test('a returning host is re-seated in their room, not sent to the join screen', async ({
  page,
}) => {
  await signUpHost(page);
  const code = await createRoom(page);

  // In the lobby as host: the start control is host-only, so it proves host powers.
  await expect(page.getByRole('button', { name: /start game/i })).toBeVisible();

  // Simulate coming back after a stretch of time: the tab forgot its membership (sessionStorage is
  // cleared when a tab/browser is closed), then the host reopens the room URL.
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto(`/rooms/${code}`);

  // The host is dropped straight back into their lobby - not the "Join room" prompt - and still holds
  // the host-only start control.
  await expect(page.getByRole('button', { name: /start game/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /join room/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /go to join/i })).toHaveCount(0);
});
