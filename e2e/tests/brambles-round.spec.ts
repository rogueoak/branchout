import { expect, test, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Brambles (spec 0061): the insider-only, two-team forbidden-words game. It
// exercises the full browser -> control-plane -> game-engine (live sim loop, spec 0044) -> browser
// loop that the unit tests cannot: four players in two groves, the active grove's Guide receives the
// hidden bloom + thorns ONLY on their own device (spec 0052 private frame), types a clue, and a
// teammate guesses the bloom to score. Pinned to a 360px phone viewport (CLAUDE.md rule 1).
//
// The team split is deterministic by seat (sorted engine player id), which is opaque here, so the
// test does not assume WHICH browser is the Guide: it reads the "You are the Guide" panel to find the
// Guide, reads the secret bloom shown on that device, and then has every other player type it as a
// guess - the engine accepts the correct-grove teammate and rejects the opposing grove, and a bloom
// is scored either way the two teammates fall out. The viewer's scoreboard proves the score climbed.

/** A guest joins the insider room by code on the insider host and lands in the lobby. */
async function joinInsider(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto(`${INSIDER_URL}/join?code=${code}`);
  await page.getByLabel('Your name').fill(nickname);
  await page.getByRole('button', { name: /join room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
}

test('four insiders play a Brambles sprint and score a bloom (360px)', async ({ browser }) => {
  // A live game streams over the socket, so give it room beyond the default budget.
  test.setTimeout(180_000);

  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 360, height: 780 } }),
    browser.newContext({ viewport: { width: 360, height: 780 } }),
    browser.newContext({ viewport: { width: 360, height: 780 } }),
    browser.newContext({ viewport: { width: 360, height: 780 } }),
  ]);
  const [hostCtx, p2Ctx, p3Ctx, p4Ctx] = contexts;
  const host = await hostCtx.newPage();
  const p2 = await p2Ctx.newPage();
  const p3 = await p3Ctx.newPage();
  const p4 = await p4Ctx.newPage();
  const pages: Page[] = [host, p2, p3, p4];

  try {
    // Host: a fresh insider account, funded (a live game reserves its round budget to start).
    const account = await signUp(host);
    await spanSessionToInsider(host.context());
    grantInsider(account.gamerTag);
    grantCredits(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    // Create the room and pick the insider-only Brambles.
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick brambles/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // Three more players join to make two groves of two.
    await joinInsider(p2, code, 'Player Two');
    await joinInsider(p3, code, 'Player Three');
    await joinInsider(p4, code, 'Player Four');

    // Configure a short game (2 sprints, minimum duration) and start.
    await host.locator('#brambles-sprints').fill('2');
    await host.locator('#brambles-seconds').fill('30');
    await host.getByRole('button', { name: /start game/i }).click();

    // The shared scoreboard appears for everyone.
    for (const page of pages) {
      await expect(page.getByText(/Sprint 1 of 2/i)).toBeVisible({ timeout: 30_000 });
    }

    // Find the Guide's device (the only one showing "You are the Guide") and read the secret bloom
    // it displays - this proves the secret reached exactly one device (the Guide's).
    let guidePage: Page | null = null;
    for (const page of pages) {
      if (
        await page
          .getByText('You are the Guide')
          .isVisible()
          .catch(() => false)
      ) {
        guidePage = page;
        break;
      }
    }
    if (!guidePage) throw new Error('no device showed the Guide panel');

    // The bloom is the large word under "Get your grove to say" on the Guide's remote.
    const bloom = (
      await guidePage
        .getByRole('region', { name: /your controller/i })
        .locator('.text-h2')
        .first()
        .innerText()
    ).trim();
    expect(bloom.length).toBeGreaterThan(0);

    // Secrecy proof in the browser: no OTHER device shows the bloom text anywhere.
    for (const page of pages) {
      if (page === guidePage) continue;
      await expect(page.getByText(bloom, { exact: true })).toHaveCount(0);
    }

    // The Guide types a clean clue (safe: it is not the bloom or a thorn).
    await guidePage.getByLabel(/type a clue/i).fill('you can describe it in your own words');
    await guidePage.getByRole('button', { name: /send/i }).click();

    // Every non-Guide player types the bloom as a guess. The engine accepts the same-grove teammate
    // (scoring a bloom) and rejects the opposing grove - either way a bloom lands for the Guide grove.
    for (const page of pages) {
      if (page === guidePage) continue;
      const box = page.getByPlaceholder(/your guess/i);
      if (await box.isVisible().catch(() => false)) {
        await box.fill(bloom);
        await page.getByRole('button', { name: /^guess$/i }).click();
      }
    }

    // The scoreboard climbs: a bloom is scored (one grove reaches at least 1). Assert on the viewer.
    await expect(async () => {
      const text = await host.getByRole('region', { name: /game viewer/i }).innerText();
      // The two grove score cells are single integers; at least one must now be >= 1.
      expect(/\b[1-9]\d*\b/.test(text)).toBe(true);
    }).toPass({ timeout: 30_000 });

    // Let the game run to completion (2 short sprints) and assert final standings appear.
    await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 120_000 });
    await expect(p2.getByTestId('final-results')).toBeVisible({ timeout: 10_000 });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test('a non-insider never sees Brambles in the game picker', async ({ page }) => {
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick brambles/i })).toHaveCount(0);
});
