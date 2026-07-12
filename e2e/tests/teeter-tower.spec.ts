import { expect, test } from '@playwright/test';
import { signUp } from '../lib/helpers';
import { grantInsider } from '../lib/stack';

// End-to-end proof of Teeter Tower (spec 0043): the insider-only, server-authoritative physics game.
// It exercises what the unit tests cannot - the real browser -> control-plane -> game-engine (headless
// Matter.js) -> browser loop: an insider picks the gated game, starts a solo room, and plays a full
// drop cycle (spin -> lock angle -> choose drop -> the server simulates the settle -> the next piece
// spawns). It also proves the gate: a non-insider never sees the game in the picker.

test('an insider starts a solo Teeter Tower room and plays a drop', async ({ page }) => {
  // The drop is engine-simulated and the settle streams back before the next round, so this
  // legitimately needs more than the default per-test budget.
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

  // The shared viewer renders the board, and the host's remote offers the aim UI on its turn.
  await expect(page.getByRole('img', { name: /teeter tower board/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /lock the angle/i })).toBeVisible({
    timeout: 30_000,
  });

  // Aim: lock the spinning angle, nudge the drop position, and drop.
  await page.getByRole('button', { name: /lock the angle/i }).click();
  await page.getByLabel('Drop position').fill('410');
  await page.getByRole('button', { name: /^drop$/i }).click();

  // The submission is accepted (not rejected) and the server simulates the settle.
  await expect(page.getByText(/dropped - watch it settle/i)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The engine advances to the next piece: the aim UI returns for a fresh round. This proves the
  // full authoritative loop ran (drop -> reveal/settle -> leaderboard -> next round).
  await expect(page.getByRole('button', { name: /lock the angle/i })).toBeVisible({
    timeout: 45_000,
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
