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

  // The single interactive board appears. The level/height/score + turn state are painted ON the
  // canvas (feedback 0022), so assert the DOM signals that remain: the aria-live status region (the
  // visually-hidden mirror of the HUD/turn), which is also what a screen reader reads.
  const board = page.locator('canvas').first();
  await expect(board).toBeVisible({ timeout: 30_000 });
  const status = page.getByText(/of 450 pixels/i); // the live status region, level-1 target 450
  await expect(status).toContainText(/tower 0 of 450 pixels/i, { timeout: 30_000 });
  await expect(status).toContainText(/move the piece on the board, then Stop spin/i);

  // Aim + drop on the canvas (feedback 0023). MOVE the piece to a spot above the min-drop line, then
  // the top-right "Stop spin" button locks the angle (status flips to the "then Drop" prompt) and the
  // "Drop" button submits. The canvas only moves the piece; the button drives stop-spin -> drop.
  const box = await board.boundingBox();
  if (!box) throw new Error('board has no bounding box');
  // Lower-middle, centered: comfortably above the 25%-from-platform min-drop line, yet low enough that a
  // single piece does NOT reach the level's full target (so the tower gains height but stays on level 1).
  await board.click({ position: { x: box.width / 2, y: box.height * 0.58 } });
  await page.getByRole('button', { name: /stop the spin and lock the angle/i }).click();
  await expect(status).toContainText(/move it into place, then Drop/i);
  await page.getByRole('button', { name: /drop the piece/i }).click();

  // The engine dropped the piece into the live world and streamed it back: the tower now has non-zero
  // height and a fresh piece is offered. This proves the full live-authoritative loop, not a freeze.
  await expect(page.getByText(/tower [1-9]\d* of 450 pixels/i)).toBeVisible({ timeout: 30_000 });
  // Explicitly still on level 1: a single drop should gain height, NOT clear the level. If a future
  // fit/target/platform tweak pushed the drop position above target, this fails loudly rather than the
  // "of 450 pixels" assertion silently passing on a level-2 board.
  await expect(page.getByText(/Level 1, Warm-up/i)).toBeVisible();
  // No rejection surfaced. Scope to the game viewer: the page carries an always-present empty top-level
  // aria-live alert region, so the assertion targets the viewer's own rejection <p role="alert"> only.
  await expect(page.getByRole('region', { name: /game viewer/i }).getByRole('alert')).toHaveCount(
    0,
  );
  await expect(page.getByText(/move the piece on the board, then Stop spin/i)).toBeVisible({
    timeout: 30_000,
  });
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
