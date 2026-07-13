import { expect, test } from '@playwright/test';
import { signUp } from '../lib/helpers';
import { grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Teeter Tower (spec 0044): the insider-only, LIVE server-authoritative physics
// game. It exercises what the unit tests cannot - the real browser -> control-plane -> game-engine
// (headless Matter.js, continuously stepped + streamed) -> browser loop: an insider picks the gated
// game, starts a solo room, and plays a drop on the single canvas (feedback 0023: move the piece on
// the board, then the top-right button stops the spin and drops); the engine drops the piece into the
// live world and streams it back, so the height and score climb. It also proves the gate: a
// non-insider never sees the game in the picker.

test('an insider starts a solo Teeter Tower room and drops a piece on the live board', async ({
  page,
}) => {
  // The drop streams back from the engine's live sim, so this needs more than the default budget.
  test.setTimeout(120_000);

  // A fresh account, granted the insider role out-of-band (the documented mechanism), then reloaded
  // so the picker reads the new role from /auth/me.
  const account = await signUp(page);
  grantInsider(account.gamerTag);
  // A live game reserves its full round budget to start (Teeter is ~53), well over the free-tier daily
  // grant (10), so fund the account or the start silently no-ops and the board never appears.
  grantCredits(account.gamerTag);
  await page.goto('/rooms');

  // Create a room and pick the insider-only game (visible now that the account is an insider).
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
  const code = page.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
  if (!code) throw new Error(`could not read room code from ${page.url()}`);
  await page.getByRole('button', { name: /pick teeter tower/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}\\?step=invite`));
  await page.getByRole('button', { name: /continue to room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

  // Start the game solo (the host is a viewer + a player, so the start gate is satisfied).
  await page.getByRole('button', { name: /start game/i }).click();

  // The single interactive board appears. The round/score + turn state are painted ON the canvas
  // (feedback 0022), so assert the DOM signals that remain: the aria-live status region (the visually-
  // hidden mirror of the HUD/turn). Points only, "Round" not "Level" (feedback 0025).
  const board = page.locator('canvas').first();
  await expect(board).toBeVisible({ timeout: 30_000 });
  const viewer = page.getByRole('region', { name: /game viewer/i });
  const status = viewer.getByRole('status');
  await expect(status).toContainText(/Round 1, Warm-up/i, { timeout: 30_000 });
  await expect(status).toContainText(/0 points/i);
  await expect(status).not.toContainText(/pixels/i);
  // Par is surfaced (feedback 0026): 0 of 8 pieces used at the start of round 1, not yet over par.
  await expect(status).toContainText(/0 of 8 par pieces used/i);
  await expect(status).toContainText(/move the piece on the board, then Stop spin/i);

  // Aim + drop on the canvas. MOVE the piece to a spot above the min-drop line, then the "Stop spin"
  // button (now above the canvas, feedback 0025) locks the angle and the "Drop" button submits.
  const box = await board.boundingBox();
  if (!box) throw new Error('board has no bounding box');
  // Lower-middle, centered: comfortably above the 25%-from-platform min-drop line, and low enough that
  // the piece settles below the round's target (so it does not clear the round on a single drop).
  await board.click({ position: { x: box.width / 2, y: box.height * 0.58 } });
  await page.getByRole('button', { name: /stop the spin and lock the angle/i }).click();
  await expect(status).toContainText(/move it into place, then Drop/i);
  await page.getByRole('button', { name: /drop the piece/i }).click();

  // The engine accepted the drop and streamed the next piece: the aim resets, so the turn cycles back to
  // the spin prompt (it had switched to the "then Drop" prompt above). With the settle-gate + banded
  // scoring (feedback 0025) a single low drop scores 0 pts, so the live loop is proven by the turn
  // cycling, not a score bump. No rejection surfaced, and still Round 1.
  await expect(status).toContainText(/move the piece on the board, then Stop spin/i, {
    timeout: 30_000,
  });
  await expect(status).toContainText(/Round 1, Warm-up/i);
  await expect(viewer.getByRole('alert')).toHaveCount(0);
});

test('a non-insider never sees Teeter Tower in the game picker', async ({ page }) => {
  // A normal account (no insider grant) walks the create flow; the insider-only game is filtered out.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  // The public games are offered, but the insider-only game is not.
  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick teeter tower/i })).toHaveCount(0);
});
