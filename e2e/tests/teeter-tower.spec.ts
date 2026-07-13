import { expect, test } from '@playwright/test';
import { signUp } from '../lib/helpers';
import { grantInsider } from '../lib/stack';

// End-to-end proof of Teeter Tower (spec 0044): the insider-only, LIVE server-authoritative physics
// game. It exercises what the unit tests cannot - the real browser -> control-plane -> game-engine
// (headless Matter.js, continuously stepped + streamed) -> browser loop: an insider picks the gated
// game, starts a solo room, and plays a drop directly on the single canvas (tap to lock the angle,
// tap to drop); the engine drops the piece into the live world and streams it back, so the height and
// score climb. It also proves the gate: a non-insider never sees the game in the picker.

test('an insider starts a solo Teeter Tower room and drops a piece on the live board', async ({
  page,
}) => {
  // The drop streams back from the engine's live sim, so this needs more than the default budget.
  test.setTimeout(120_000);

  // A fresh account, granted the insider role out-of-band (the documented mechanism), then reloaded
  // so the picker reads the new role from /auth/me.
  const account = await signUp(page);
  grantInsider(account.gamerTag);
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

  // The single interactive board appears. The level/height/score + turn state are painted ON the
  // canvas (feedback 0022), so assert the DOM signals that remain: the aria-live status region (the
  // visually-hidden mirror of the HUD/turn), which is also what a screen reader reads.
  const board = page.locator('canvas').first();
  await expect(board).toBeVisible({ timeout: 30_000 });
  const status = page.getByText(/of 600 pixels/i); // the live status region, level-1 target 600
  await expect(status).toContainText(/tower 0 of 600 pixels/i, { timeout: 30_000 });
  await expect(status).toContainText(/tap the board to lock/i);

  // Aim + drop directly on the canvas. The first tap locks the spinning angle (the status flips to the
  // "move to aim, then tap to drop" prompt). Then MOVE the pointer to a spot above the min-drop line
  // and tap to drop there - the move both aims and arms the drop past the double-tap guard. No re-aim.
  await board.click();
  await expect(status).toContainText(/move to aim, then tap to drop/i);
  const box = await board.boundingBox();
  if (!box) throw new Error('board has no bounding box');
  // Upper-third, centered: comfortably above the 25%-from-platform line, and a real move from center.
  await board.click({ position: { x: box.width / 2, y: box.height * 0.32 } });

  // The engine dropped the piece into the live world and streamed it back: the tower now has non-zero
  // height and a fresh piece is offered. This proves the full live-authoritative loop, not a freeze.
  await expect(page.getByText(/tower [1-9]\d* of 600 pixels/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/tap the board to lock/i)).toBeVisible({ timeout: 30_000 });
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
