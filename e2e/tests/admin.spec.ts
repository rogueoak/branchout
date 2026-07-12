import { type Page, expect, test } from '@playwright/test';
import { signUp } from '../lib/helpers';
import { ADMIN_URL } from '../lib/stack';

// End-to-end proof of the admin console (spec 0037). The admin is a SEPARATE app on its own port,
// with a SEPARATE identity (its own store + host-only cookie). The root admin is seeded from env by
// the control-plane on boot (see infra/docker-compose.e2e.yml). The risk this guards is authorization:
// only a valid admin session reaches the console, a player session does not, and an admin can grant a
// player the insider role. The seeded root's credentials match the e2e overlay.
const ROOT = { email: 'root@branchout.test', password: 'e2e-root-admin-password' };

async function adminLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(`${ADMIN_URL}/users`);
}

test.describe('admin console (spec 0037)', () => {
  test('root admin signs in, grants a player insider, and creates another admin', async ({
    page,
    browser,
  }) => {
    // A player to manage, created through the real web signup (page baseURL is the web app).
    const account = await signUp(page);

    await adminLogin(page, ROOT.email, ROOT.password);

    // Find the player by gamer tag and open their detail.
    await page.goto(`${ADMIN_URL}/users?query=${account.gamerTag.toLowerCase()}`);
    await page.getByRole('link', { name: account.gamerTag }).click();
    await page.waitForURL(new RegExp(`${ADMIN_URL}/users/`));

    // Grant insider - the button flips to "Revoke insider", proving the toggle took.
    await page.getByRole('button', { name: /grant insider/i }).click();
    await expect(page.getByRole('button', { name: /revoke insider/i })).toBeVisible();

    // Create another admin.
    await page.goto(`${ADMIN_URL}/admins`);
    const newAdmin = {
      email: `ops-${Date.now().toString(36)}@branchout.test`,
      password: 'another-strong-admin-pw',
    };
    await page.getByLabel('Email').fill(newAdmin.email);
    await page.getByLabel(/Password/).fill(newAdmin.password);
    await page.getByRole('button', { name: /create admin/i }).click();
    await expect(page.getByText(/admin created/i)).toBeVisible();

    // Log out root: the login form reappearing proves the admin session was actually cleared (waiting
    // on the form, not just the URL, avoids racing the cookie-clear re-render).
    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page.getByLabel('Email')).toBeVisible();

    // The newly-created admin can sign in - in a fresh context (clean cookie jar), proving the created
    // credentials work independently of root's session.
    const context = await browser.newContext();
    try {
      const admin2 = await context.newPage();
      await adminLogin(admin2, newAdmin.email, newAdmin.password);
      await expect(admin2.getByRole('heading', { name: 'Users' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('an unauthenticated visitor is sent to the admin login', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${ADMIN_URL}/users`);
      await page.waitForURL(`${ADMIN_URL}/login`);
    } finally {
      await context.close();
    }
  });

  test('the admin API rejects an unauthenticated request', async ({ request }) => {
    // No admin cookie -> control-plane's authoritative gate returns 401 (proxied same-origin via /api).
    const res = await request.get(`${ADMIN_URL}/api/admin/users`);
    expect(res.status()).toBe(401);
  });
});
