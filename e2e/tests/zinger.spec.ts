import { expect, test, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantInsider } from '../lib/stack';

// End-to-end proof of Zinger (spec 0053): the insider-only funny-answer party game on the round-based
// decision lifecycle. It exercises the real browser -> control-plane -> game-engine -> browser loop for
// the happy path: an insider host on the insider surface picks the gated game, two players join, and a
// full one-round game runs - each writes a zinger, two are pitted head to head in the face-off, the
// non-authors vote, and the standings resolve. It also proves the gate (feedback 0029): the game lives
// ONLY on the insider surface. Runs at 360px (CLAUDE.md rule 1: mobile-first).

/** Join an insider-hosted room by code on the insider host (the /join flow is public; a room the host
 * created on the insider surface is reached via the insider host's join route). */
async function joinInsiderRoom(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto(`${INSIDER_URL}/join?code=${code}`);
  await page.getByLabel('Your name').fill(nickname);
  await page.getByRole('button', { name: /join room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
}

test('an insider host and two players play a full one-round Zinger game at 360px', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const phone = { width: 360, height: 780 };
  const hostCtx = await browser.newContext({ viewport: phone });
  const p2Ctx = await browser.newContext({ viewport: phone });
  const p3Ctx = await browser.newContext({ viewport: phone });
  const host = await hostCtx.newPage();
  const player2 = await p2Ctx.newPage();
  const player3 = await p3Ctx.newPage();

  try {
    // A fresh account granted the insider role out-of-band; the session is spanned to the insider
    // host, where the game lives (feedback 0029), so the whole flow runs on `insider.localhost`.
    const account = await signUp(host);
    await spanSessionToInsider(hostCtx);
    grantInsider(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    // Create a room and pick the insider-only game (visible on the insider surface).
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick zinger/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // Two more players join (anonymous sessions) - three total, enough for a face-off + a voter.
    await joinInsiderRoom(player2, code, 'Player Two');
    await joinInsiderRoom(player3, code, 'Player Three');

    // One round, then start (the host is interactive - a screen + a player).
    await host.locator('#zinger-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // Collecting: each writes a zinger.
    for (const [p, text] of [
      [host, 'The Titanic 2'],
      [player2, 'Wet Bandit'],
      [player3, 'Boaty McFloatface'],
    ] as const) {
      await expect(p.locator('#zinger-input')).toBeVisible({ timeout: 30_000 });
      await p.locator('#zinger-input').fill(text);
      await p.getByRole('button', { name: /^submit$/i }).click();
    }
    await expect(host.getByText(/zinger submitted/i)).toBeVisible();

    // Guessing (the face-off): each eligible voter picks a zinger from their own controller. An author
    // of the face-off is told to sit out; a non-author sees vote buttons. Click the first available
    // vote button in each controller when present.
    await expect(async () => {
      let voted = false;
      for (const p of [host, player2, player3]) {
        const controller = p.getByRole('region', { name: /your controller/i });
        const button = controller.getByRole('button').first();
        if (await button.isVisible().catch(() => false)) {
          await button.click().catch(() => {});
          voted = true;
        }
      }
      // At least one non-author must have a vote button in the face-off.
      expect(voted).toBe(true);
    }).toPass({ timeout: 60_000 });

    // Drive the (last) round to completion; auto-advance may also do it, so click Next when offered.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    await expect(player2.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  }
});

test('a non-insider never sees Zinger in the game picker', async ({ page }) => {
  // A normal account (no insider grant) walks the apex create flow; the insider-only game is filtered.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick zinger/i })).toHaveCount(0);
});
