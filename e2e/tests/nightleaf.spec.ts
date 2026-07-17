import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Nightleaf (spec 0060): the insider-only, cooperative, real-time, SILENT
// ascending-number game. It exercises what the unit tests cannot - the real browser -> control-plane
// -> game-engine (live, per-session sim loop + the spec-0052 private hand channel) -> browser loop -
// with TWO real players on the insider surface. It proves the whole cooperative happy path: both
// players get a SECRET hand delivered only to their own device (spec 0052), play their leaves onto the
// shared trunk in ascending order, and clear the single tier to WIN together. It also proves hand
// SECRECY at the wire: each player's Remote names ONLY their own lowest leaf; neither device ever
// shows the other player's leaf value. The whole flow runs on the insider host, never the apex.

/** Sign up a fresh insider account, span its session to the insider host, and fund it. Returns the page. */
async function insiderPlayer(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const account = await signUp(page);
  await spanSessionToInsider(context);
  grantInsider(account.gamerTag);
  // A live game reserves its full round budget to start; fund the account so the start does not no-op.
  grantCredits(account.gamerTag);
  return page;
}

/** Read a player's own lowest leaf from their Remote's play button ("Play your lowest (N)"). */
async function ownLowest(page: Page): Promise<number> {
  const button = page.getByRole('button', { name: /Play your lowest \(\d+\)/i });
  await expect(button).toBeVisible({ timeout: 30_000 });
  const label = (await button.getAttribute('aria-label')) ?? (await button.textContent()) ?? '';
  const match = label.match(/Play your lowest \((\d+)\)/i);
  if (!match) throw new Error(`could not read the lowest leaf from "${label}"`);
  return Number(match[1]);
}

test('two insiders play a full cooperative Nightleaf game to a shared WIN', async ({ browser }) => {
  test.setTimeout(150_000);
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();

  try {
    const host = await insiderPlayer(hostCtx);
    const player = await insiderPlayer(playerCtx);

    // The host creates a room and picks the insider-only Nightleaf on the insider surface.
    await host.goto(`${INSIDER_URL}/rooms`);
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick nightleaf/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // The second insider joins the same room on the insider surface.
    await player.goto(`${INSIDER_URL}/join?code=${code}`);
    await player.getByLabel('Your name').fill('Player Two');
    await player.getByRole('button', { name: /join room/i }).click();
    await player.waitForURL(new RegExp(`/rooms/${code}$`));

    // Configure the shortest winnable climb: one tier (one leaf each), three buds. Then start.
    await host.locator('#nightleaf-tiers').fill('1');
    await host.locator('#nightleaf-buds').fill('3');
    await host.getByRole('button', { name: /start game/i }).click();

    // Each player's SECRET hand arrives on their own device (spec 0052): their Remote names ONLY their
    // own lowest leaf. Read both, then play in ASCENDING order so there is no misplay.
    const hostLeaf = await ownLowest(host);
    const playerLeaf = await ownLowest(player);
    expect(hostLeaf).not.toBe(playerLeaf); // the deal is distinct across hands

    // SECRECY: neither device shows the OTHER player's leaf value in its own hand list. The play
    // button on each device names only that device's own leaf.
    await expect(
      host.getByRole('button', { name: new RegExp(`Play your lowest \\(${playerLeaf}\\)`) }),
    ).toHaveCount(0);
    await expect(
      player.getByRole('button', { name: new RegExp(`Play your lowest \\(${hostLeaf}\\)`) }),
    ).toHaveCount(0);

    // Play the lower leaf first, then the higher - a clean ascending clear of the tier.
    const first = hostLeaf < playerLeaf ? host : player;
    const second = hostLeaf < playerLeaf ? player : host;
    await first.getByRole('button', { name: /Play your lowest/i }).click();
    // The higher holder's turn: after the first clean play, they play their leaf to empty the grove.
    await second.getByRole('button', { name: /Play your lowest/i }).click();

    // The tier clears and the grove wins together - the cooperative shared standing. Both viewers show
    // the win (the aria-live status mirrors it too).
    await expect(host.getByText(/The grove wins/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(player.getByText(/The grove wins/i).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});

test('two insiders on a 360px phone play Nightleaf (mobile-first, spec 0060)', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const hostCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const playerCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });

  try {
    const host = await insiderPlayer(hostCtx);
    const player = await insiderPlayer(playerCtx);

    await host.goto(`${INSIDER_URL}/rooms`);
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick nightleaf/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    await player.goto(`${INSIDER_URL}/join?code=${code}`);
    await player.getByLabel('Your name').fill('Player Two');
    await player.getByRole('button', { name: /join room/i }).click();
    await player.waitForURL(new RegExp(`/rooms/${code}$`));

    await host.locator('#nightleaf-tiers').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // The controller renders and fits the 360px phone (no horizontal overflow) on both devices.
    await expect(host.getByRole('button', { name: /Play your lowest/i })).toBeVisible({
      timeout: 30_000,
    });
    for (const page of [host, player]) {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        'Nightleaf should not scroll horizontally on a phone',
      ).toBeLessThanOrEqual(clientWidth + 1);
    }
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});

test('a non-insider never sees Nightleaf in the game picker (spec 0043)', async ({ page }) => {
  // A normal account (no insider grant) walks the apex create flow; the insider-only game is filtered.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick nightleaf/i })).toHaveCount(0);
});
