import { type BrowserContext, expect, test } from '@playwright/test';
import { signUp } from '../lib/helpers';
import { BASE_URL, WEB_PORT, grantInsider } from '../lib/stack';

// End-to-end proof of the insiders surface (spec 0035). The surface lives on the `insiders`
// subdomain, served by the same `web` process via host-aware middleware; `*.localhost` resolves to
// 127.0.0.1, so `insiders.localhost` reaches the same web app. The risk this guards is
// authorization, so it exercises the gate from every side: insider in, non-insider out (403),
// anonymous out (apex login), and no apex path leak.
//
// Cross-subdomain session: in prod one login spans the apex + `insiders.` because the cookie is
// scoped `Domain=.branchout.games`. That Domain-spanning is browser behaviour on a real registrable
// domain and is NOT reproducible on `localhost` (Chromium does not span a `Domain=localhost` cookie
// across `*.localhost`), and the dev/e2e stack has no same-origin proxy to even set it. So the test
// plants the just-created session cookie onto the insiders host directly - a faithful stand-in that
// exercises OUR middleware + layout + role gate. The Domain-setting itself is unit-tested in the
// control-plane config/auth suites.
const SESSION_COOKIE = 'branchout_session';
const INSIDERS_URL = `http://insiders.localhost:${WEB_PORT}`;

/** Copy the signed-in session cookie (set on localhost by signUp) onto the insiders host, standing
 * in for prod's parent-domain cookie so the same session reaches `insiders.localhost`. */
async function spanSessionToInsiders(context: BrowserContext): Promise<void> {
  const session = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
  if (!session) throw new Error('no session cookie after signup - login did not set one');
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: session.value,
      domain: 'insiders.localhost',
      path: '/',
      httpOnly: true,
      secure: false, // e2e serves plain http (COOKIE_SECURE=false)
      sameSite: 'Lax',
    },
  ]);
}

test.describe('insiders surface (spec 0035)', () => {
  test('a non-insider is forbidden; the same account sees the surface once granted', async ({
    page,
  }) => {
    // A normal signed-up account, its session then spanned to the insiders host.
    const account = await signUp(page);
    await spanSessionToInsiders(page.context());

    // Signed in but not an insider -> a real 403 rendered by the forbidden boundary.
    const denied = await page.goto(INSIDERS_URL);
    expect(denied?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: /insiders only/i })).toBeVisible();

    // Grant the role out-of-band (the documented manual DB update), then the same session is let in.
    grantInsider(account.gamerTag);
    await page.goto(INSIDERS_URL);
    await expect(page.getByRole('heading', { name: 'Insiders' })).toBeVisible();
    await expect(page.getByText(/no test games yet/i)).toBeVisible();
  });

  test('a signed-out visitor is sent to the apex login (never the gated host)', async ({
    browser,
  }) => {
    // A fresh context carries no session cookie.
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(INSIDERS_URL);
      // Middleware crosses back to the apex login rather than looping through the insiders tree.
      await page.waitForURL(/\/login/);
      expect(new URL(page.url()).host).toBe(`localhost:${WEB_PORT}`);
    } finally {
      await context.close();
    }
  });

  test('the apex cannot reach the insiders tree by typing its path', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/insiders`);
    expect(res?.status()).toBe(404);
  });

  test('the insiders surface fits a 360px phone (mobile-first)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      const page = await context.newPage();
      const account = await signUp(page);
      await spanSessionToInsiders(context);
      grantInsider(account.gamerTag);
      await page.goto(INSIDERS_URL);
      await expect(page.getByRole('heading', { name: 'Insiders' })).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // 1px rounding slack; more means content pushes past the phone viewport.
      expect(
        scrollWidth,
        'insiders surface should not scroll horizontally on a phone',
      ).toBeLessThanOrEqual(clientWidth + 1);
    } finally {
      await context.close();
    }
  });
});
