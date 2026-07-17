import { expect, test } from '@playwright/test';
import { joinRoom, signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Lone Leaf (spec 0057): the insider-only, COOPERATIVE single-clue word game. It
// drives the real browser -> control-plane -> game-engine loop through a full one-round game with THREE
// players (the minimum) in three browser contexts: an insider host creates + picks the gated game on
// the insider surface; two others join by code; the two NON-Seekers each write a one-word leaf; the
// Seeker guesses the seed; the whole grove shares the co-op result (final standings on every screen).
//
// The critical secrecy guarantee is asserted directly: the SEEKER's device never shows the seed word,
// while a NON-Seeker's device does - proving the seed rides the per-player private channel (spec 0052)
// and never the broadcast prompt/viewer.

test('an insider grove plays a full one-round Lone Leaf game, seed hidden from the Seeker', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const hostCtx = await browser.newContext();
  const p2Ctx = await browser.newContext();
  const p3Ctx = await browser.newContext();
  const host = await hostCtx.newPage();
  const p2 = await p2Ctx.newPage();
  const p3 = await p3Ctx.newPage();

  try {
    // A fresh insider host, funded so a multi-round start is affordable, on the insider surface where
    // the gated game lives.
    const account = await signUp(host);
    await spanSessionToInsider(host.context());
    grantInsider(account.gamerTag);
    grantCredits(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    // Create a room and pick Lone Leaf (the shared createRoom helper hardcodes Trivia).
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    // The whole flow stays on the insider host - it never bounced to the apex.
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick lone leaf/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // Two more players join by code (anonymous sessions minted on the apex join flow).
    await joinRoom(p2, code, 'Player Two');
    await joinRoom(p3, code, 'Player Three');

    // One round, then start. Round 1 Seeker is the first seat (the host).
    await host.locator('#lone-leaf-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // Collecting: the Seeker (host) never sees the seed and has no leaf input; the two non-Seekers do.
    await expect(host.getByText(/You are the Seeker/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(host.locator('#leaf-input')).toHaveCount(0);
    await expect(p2.locator('#leaf-input')).toBeVisible({ timeout: 30_000 });
    await expect(p3.locator('#leaf-input')).toBeVisible({ timeout: 30_000 });

    // The seed shows on a non-Seeker's controller. Read it so we can (a) prove the Seeker never sees it
    // and (b) let the Seeker guess it for a banked, co-op point.
    const seedNode = p2
      .getByRole('region', { name: /your controller/i })
      .locator('.text-secondary');
    await expect(seedNode).toBeVisible();
    const seed = ((await seedNode.textContent()) ?? '').trim();
    expect(seed.length).toBeGreaterThan(0);
    // SECRECY: the seed word appears nowhere on the Seeker's whole page.
    await expect(host.getByText(seed, { exact: false })).toHaveCount(0);

    // The two non-Seekers write DISTINCT one-word leaves (matching leaves would wilt).
    await p2.locator('#leaf-input').fill('current');
    await p2.getByRole('button', { name: /^submit$/i }).click();
    await p3.locator('#leaf-input').fill('bank');
    await p3.getByRole('button', { name: /^submit$/i }).click();
    await expect(p2.getByText(/Leaf sent/i)).toBeVisible();

    // Guessing: the Seeker types the seed (learned out of band here to force a banked co-op point).
    await expect(host.getByLabel(/your one guess/i)).toBeVisible({ timeout: 30_000 });
    await host.getByLabel(/your one guess/i).fill(seed);
    await host.getByRole('button', { name: /^guess$/i }).click();
    await expect(host.getByText(/Guess locked in/i)).toBeVisible();

    // Drive the (last) round to completion; auto-advance may also do it, so click Next when offered.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    // Co-op: the whole grove shares the result - every device lands on the final standings.
    await expect(p2.getByTestId('final-results')).toBeVisible();
    await expect(p3.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  }
});

// Mobile-first guard (CLAUDE.md rule 1): the Lone Leaf controller renders and fits a 360px phone for a
// non-Seeker (the seed + leaf input) without horizontal overflow.
test('the Lone Leaf controller fits a 360px phone', async ({ browser }) => {
  test.setTimeout(180_000);
  const hostCtx = await browser.newContext();
  const p2Ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const p3Ctx = await browser.newContext();
  const host = await hostCtx.newPage();
  const p2 = await p2Ctx.newPage();
  const p3 = await p3Ctx.newPage();

  try {
    const account = await signUp(host);
    await spanSessionToInsider(host.context());
    grantInsider(account.gamerTag);
    grantCredits(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick lone leaf/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    await joinRoom(p2, code, 'Player Two');
    await joinRoom(p3, code, 'Player Three');

    await host.locator('#lone-leaf-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // p2 is a non-Seeker: their controller shows the seed + leaf input. Assert no horizontal overflow.
    await expect(p2.locator('#leaf-input')).toBeVisible({ timeout: 30_000 });
    const { scrollWidth, clientWidth } = await p2.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      'the Lone Leaf controller should not scroll horizontally on a phone',
    ).toBeLessThanOrEqual(clientWidth + 1);
  } finally {
    await hostCtx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  }
});
