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
    // no longer shows). Its "Play now" control is the RELATIVE room-create deep link (feedback 0029),
    // so starting stays on the insider surface instead of bouncing to the apex. The card is no longer
    // the link (spec 0046 shared card): the play link is a text-only control, and the hero/mark art
    // lives in the card body - so assert the art on the card, not on the play link.
    const playLink = page.getByRole('link', { name: /play teeter tower now/i });
    await expect(playLink).toBeVisible();
    expect(await playLink.getAttribute('href')).toBe('/rooms?game=teeter-tower');
    // The card leads with hero art: the games region carries at least one inline SVG (the wide hero
    // plus each game mark), matching the main-site card look.
    const gamesRegion = page.getByRole('region', { name: /branch out games for insiders/i });
    await expect(gamesRegion.getByRole('heading', { name: 'Teeter Tower' })).toBeVisible();
    expect(await gamesRegion.locator('svg').count()).toBeGreaterThan(0);
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
    await page.getByRole('link', { name: /play teeter tower now/i }).click();
    await page.waitForURL(/insider\.localhost.*\/rooms\?game=teeter-tower/);
    // Create the room: the deep link pre-selects the insider game (allowed on this surface) and
    // drops straight into the lobby, still on the insider host.
    await page.getByRole('button', { name: /create a room/i }).click();
    await page.waitForURL(/\/rooms\/[A-Z2-9]{5}$/);
    // The URL never left the insider subdomain - hosting an insider game stays on the insider
    // surface, proving both the relative deep link and the room flow mirrored under /insider.
    expect(new URL(page.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    // The deep link pre-selected the insider game and dropped into the lobby, proving the picker
    // allowed it on this surface (the authenticated create ran same-origin against /api). The lobby's
    // invite affordance carries the "Invite friends" heading.
    await expect(page.getByRole('heading', { name: /invite friends/i })).toBeVisible();
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

  test('the insider surface + its nav fit a 360px phone (mobile-first)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      const page = await context.newPage();
      const account = await signUp(page);
      await spanSessionToInsider(context);
      grantInsider(account.gamerTag);
      await page.goto(INSIDER_URL);
      await expect(page.getByRole('heading', { name: 'Insider' })).toBeVisible();
      // Guard the insider NAV variant at 360px (review #138): it now carries the most items of any
      // surface - the wordmark + INSIDER badge + Games + Join on the left plus the account control on
      // the right - so it is the most likely to collide at the narrow floor. (A signed-out visitor
      // never renders this six-item nav: the gate sends them to the apex login, which carries no
      // TopNav; the signed-in insider here is the reachable worst case.) Assert the Join link and the
      // Insider badge are present, then that nothing overflows the phone viewport.
      const nav = page.getByRole('navigation', { name: /site navigation/i });
      await expect(nav).toBeVisible();
      await expect(nav.getByText('Insider')).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Games', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Join', exact: true })).toHaveAttribute(
        'href',
        '/join',
      );
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

  test('an insider game has a gated feature page on the insider surface; the apex 404s it (spec 0030)', async ({
    page,
  }) => {
    const account = await signUp(page);
    await spanSessionToInsider(page.context());
    grantInsider(account.gamerTag);

    // The insider landing card's "Details" link now resolves (spec 0030): it targets the RELATIVE
    // /games/<slug>, which the insider host rewrites into the gated /insider/games/<slug> page.
    await page.goto(INSIDER_URL);
    const details = page.getByRole('link', { name: /details about teeter tower/i });
    await expect(details).toBeVisible();
    expect(await details.getAttribute('href')).toBe('/games/teeter-tower');
    await details.click();
    await page.waitForURL(/insider\.localhost.*\/games\/teeter-tower/);
    // The hero-first feature page renders behind the gate: title + Rules, and it stays on the host.
    await expect(page.getByRole('heading', { name: 'Teeter Tower', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^rules$/i })).toBeVisible();
    expect(new URL(page.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    // SEO only where public: an insider page is noindex with NO VideoGame structured data.
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);

    // On the apex the same insider slug must 404 - it never exists on the public site.
    const apex = await page.goto(`${BASE_URL}/games/teeter-tower`);
    expect(apex?.status()).toBe(404);
  });

  test('a signed-out visitor cannot reach an insider feature page (sent to the apex login)', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${INSIDER_URL}/games/teeter-tower`);
      // The insider layout gate (via middleware's signed-out shortcut) crosses to the apex login.
      await page.waitForURL(/\/login/);
      expect(new URL(page.url()).host).toBe(`localhost:${WEB_PORT}`);
    } finally {
      await context.close();
    }
  });
});
