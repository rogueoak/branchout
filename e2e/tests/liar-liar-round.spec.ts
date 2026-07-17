import { expect, test } from '@playwright/test';
import { joinRoom, signUpHost } from '../lib/helpers';

// Post-deploy sanity (live): a host and a second player play a full one-round Liar Liar game in two
// real browser contexts - create -> pick Liar Liar -> join -> start -> write a lie -> guess the
// truth -> final standings. Mirrors the Trivia e2e for the second reference game.

test('a host and a second player play a full one-round Liar Liar game', async ({ browser }) => {
  test.setTimeout(150_000);
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const player = await playerCtx.newPage();

  try {
    await signUpHost(host);

    // Create a room and pick Liar Liar (the shared createRoom helper hardcodes Trivia).
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick liar liar/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    await joinRoom(player, code, 'Player Two');

    // One round, then start (host interactive = viewer; joiner interactive too, so the gate passes).
    await host.locator('#liar-liar-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // Collecting: each writes a DISTINCT lie (a duplicate or the real answer is rejected).
    await expect(host.locator('#lie-input')).toBeVisible({ timeout: 30_000 });
    await expect(player.locator('#lie-input')).toBeVisible({ timeout: 30_000 });
    await host.locator('#lie-input').fill('a lantern made of glass');
    await host.getByRole('button', { name: /^submit$/i }).click();
    await player.locator('#lie-input').fill('a bag of forgotten whispers');
    await player.getByRole('button', { name: /^submit$/i }).click();
    await expect(host.getByText(/lie submitted/i)).toBeVisible();

    // Guessing: each picks an option from their own controller (their own lie is hidden).
    // `exact` - on an interactive screen the phrase appears in both the viewer (with extra text) and
    // the controller; the controller's is exactly "Which one is the truth?".
    await expect(host.getByText('Which one is the truth?', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(player.getByText('Which one is the truth?', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    for (const p of [host, player]) {
      await p
        .getByRole('region', { name: /your controller/i })
        .getByRole('button')
        .first()
        .click();
    }
    await expect(host.getByText(/locked in/i)).toBeVisible();

    // Drive the (last) round to completion; auto-advance may also do it, so click Next when offered.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    await expect(player.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});
