import { expect, test } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { BASE_URL, INSIDER_URL, SESSION_COOKIE, WEB_PORT, grantInsider } from '../lib/stack';

// End-to-end proof of the insider surface (spec 0035). The surface lives on the `insider`
// subdomain, served by the same `web` process via host-aware middleware; `*.localhost` resolves to
// 127.0.0.1, so `insider.localhost` reaches the same web app. The risk this guards is
// authorization, so it exercises the gate from every side: insider in, non-insider out (403),
// anonymous out (apex login), and no apex path leak. The session-spanning stand-in for prod's
// parent-domain cookie lives in `spanSessionToInsider` (helpers).

test.describe('insider surface (spec 0035)', () => {
  test('a non-insider is forbidden; the same account sees the surface once granted', async ({
    page,
  }) => {
    // A normal signed-up account, its session then spanned to the insider host.
    const account = await signUp(page);
    await spanSessionToInsider(page.context());

    // Signed in but not an insider -> a real 403 rendered by the forbidden boundary.
    const denied = await page.goto(INSIDER_URL);
    expect(denied?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: /insider only/i })).toBeVisible();

    // Grant the role out-of-band (the documented manual DB update), then the same session is let in.
    grantInsider(account.gamerTag);
    await page.goto(INSIDER_URL);
    await expect(page.getByRole('heading', { name: 'Insider' })).toBeVisible();
    // Teeter Tower (spec 0043) is now a live insider game, so the surface lists it (the empty state
    // no longer shows). The card carries the game's mark and deep-links RELATIVELY (feedback 0029),
    // so starting stays on the insider surface instead of bouncing to the apex.
    const card = page.getByRole('link', { name: /start a room to test teeter tower/i });
    await expect(card).toBeVisible();
    expect(await card.getAttribute('href')).toBe('/rooms?game=teeter-tower');
    expect(await card.locator('svg').count()).toBeGreaterThan(0);
  });

  test('starting an insider game from its card stays on the insider host (feedback 0029)', async ({
    page,
  }) => {
    const account = await signUp(page);
    await spanSessionToInsider(page.context());
    grantInsider(account.gamerTag);

    await page.goto(INSIDER_URL);
    // Tap the Teeter Tower card: the room-create deep link keeps the player on the insider host (the
    // rooms home, now hosted under the gated /insider tree). It never bounced to the apex.
    await page.getByRole('link', { name: /start a room to test teeter tower/i }).click();
    await page.waitForURL(/insider\.localhost.*\/rooms\?game=teeter-tower/);
    // Create the room: the deep link pre-selects the insider game (allowed on this surface) and
    // skips straight to the invite step, still on the insider host.
    await page.getByRole('button', { name: /create a room/i }).click();
    await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=invite/);
    // The URL never left the insider subdomain - hosting an insider game stays on the insider
    // surface, proving both the relative deep link and the room flow mirrored under /insider.
    expect(new URL(page.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    // The deep link pre-selected the insider game and skipped to invite, proving the picker allowed
    // it on this surface (the authenticated create ran same-origin against /api).
    await expect(page.getByRole('heading', { name: /invite your friends/i })).toBeVisible();
  });

  test('the mirrored insider room routes are gated to insiders (feedback 0029)', async ({
    page,
  }) => {
    // A signed-up NON-insider whose session is spanned to the insider host. `/rooms` is public on the
    // apex, but on the insider host it rewrites into the gated /insider tree - so the layout must 403
    // it: the room flow mirrored under /insider must not leak to a non-insider on the insider surface.
    await signUp(page);
    await spanSessionToInsider(page.context());
    const denied = await page.goto(`${INSIDER_URL}/rooms`);
    expect(denied?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: /insider only/i })).toBeVisible();
  });

  test('a signed-out visitor is sent to the apex login (never the gated host)', async ({
    browser,
  }) => {
    // A fresh context carries no session cookie.
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(INSIDER_URL);
      // Middleware crosses back to the apex login rather than looping through the insider tree,
      // carrying an origin-validated return target so login can send the visitor back.
      await page.waitForURL(/\/login/);
      const url = new URL(page.url());
      expect(url.host).toBe(`localhost:${WEB_PORT}`);
      expect(url.searchParams.get('next')).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test('a stale/invalid session cookie is rejected by the authoritative layout gate', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      // A cookie that clears middleware's cheap presence check but is not a real session - the
      // layout's getViewer() must still reject it and send the visitor to login (defence in depth).
      await context.addCookies([
        {
          name: SESSION_COOKIE,
          value: 'not-a-real-session-id',
          domain: 'insider.localhost',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ]);
      const page = await context.newPage();
      await page.goto(INSIDER_URL);
      await page.waitForURL(/\/login/);
      expect(new URL(page.url()).host).toBe(`localhost:${WEB_PORT}`);
    } finally {
      await context.close();
    }
  });

  test('the apex cannot reach the insider tree by typing its path', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/insider`);
    expect(res?.status()).toBe(404);
  });

  test('the account page links insiders to the surface and hides it from everyone else (spec 0039)', async ({
    page,
  }) => {
    const account = await signUp(page);

    // A normal signed-up account: the account page shows no insider entry point at all - the surface
    // is never advertised to accounts that cannot enter it.
    await page.goto(`${BASE_URL}/account`);
    await expect(page.getByRole('heading', { name: account.gamerTag })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Insider game previews' })).toHaveCount(0);

    // Grant the role out-of-band, reload: the button appears and targets the insider host. The href
    // is built from the baked apex origin, so it points at `insider.` + the apex (asserted by the
    // hostname prefix, robust to whether the build baked branchout.games or localhost).
    grantInsider(account.gamerTag);
    await page.goto(`${BASE_URL}/account`);
    const link = page.getByRole('link', { name: 'Insider game previews' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href, 'insider button should have a target').toBeTruthy();
    expect(new URL(href!).hostname.startsWith('insider.')).toBe(true);
  });

  test('the insider button on /account fits a 360px phone (mobile-first)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      const page = await context.newPage();
      const account = await signUp(page);
      grantInsider(account.gamerTag);
      await page.goto(`${BASE_URL}/account`);
      // The button renders for the (now) insider account, and the page does not overflow the phone.
      await expect(page.getByRole('link', { name: 'Insider game previews' })).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // 1px rounding slack; more means the button/section pushes past the phone viewport.
      expect(
        scrollWidth,
        'the account page with the insider button should not scroll horizontally on a phone',
      ).toBeLessThanOrEqual(clientWidth + 1);
    } finally {
      await context.close();
    }
  });

  test('the insider surface fits a 360px phone (mobile-first)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      const page = await context.newPage();
      const account = await signUp(page);
      await spanSessionToInsider(context);
      grantInsider(account.gamerTag);
      await page.goto(INSIDER_URL);
      await expect(page.getByRole('heading', { name: 'Insider' })).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // 1px rounding slack; more means content pushes past the phone viewport.
      expect(
        scrollWidth,
        'insider surface should not scroll horizontally on a phone',
      ).toBeLessThanOrEqual(clientWidth + 1);
    } finally {
      await context.close();
    }
  });
});
