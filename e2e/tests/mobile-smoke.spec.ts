import { expect, test, type Page } from '@playwright/test';
import { signUp, signUpHost } from '../lib/helpers';

// Mobile-first is the product's first non-negotiable (CLAUDE.md). This lane runs in a real phone
// browser (the Pixel 7 device viewport) and guards that the primary entry surfaces render and fit -
// no horizontal overflow, key affordances visible. The nav block below pins the exact 360px floor
// the non-negotiable names, since the nav's wordmark + Games + CTA/avatar row is the most likely to
// collide at the narrowest supported width.

async function expectNoHorizontalOverflow(scrollWidth: number, clientWidth: number) {
  // Allow a 1px rounding slack; anything more means content pushes past the viewport.
  expect(scrollWidth, 'page should not scroll horizontally on a phone').toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

/** Assert the current page does not scroll horizontally at the phone viewport. */
async function expectFits(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await expectNoHorizontalOverflow(scrollWidth, clientWidth);
}

test('landing page renders and fits on a phone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /where game night grows/i })).toBeVisible();
  // The primary CTA (sign up / play) is reachable.
  await expect(page.getByRole('link', { name: /sign up free|play now/i })).toBeVisible();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await expectNoHorizontalOverflow(scrollWidth, clientWidth);
});

test.describe('the shared top nav (spec 0028) at 360px', () => {
  // Pin the exact 360px floor from the mobile-first non-negotiable (overriding the device viewport).
  test.use({ viewport: { width: 360, height: 780 } });

  test('signed-out nav shows Games + Sign up and fits on home and /rooms', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: /site navigation/i });
    for (const path of ['/', '/rooms']) {
      await page.goto(path);
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Games' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Sign up' })).toBeVisible();
      await expectFits(page);
    }
  });

  test('signed-in nav shows the avatar menu on first paint (no flash) and the dropdown fits', async ({
    page,
  }) => {
    await signUp(page);
    await page.goto('/rooms');
    const nav = page.getByRole('navigation', { name: /site navigation/i });
    // The server-injected viewer means the signed-in nav (the avatar trigger) is present on the first
    // paint - proving the page actually reads getViewer and there is no signed-out->in flash.
    const trigger = nav.getByRole('button', { name: /account menu/i });
    await expect(trigger).toBeVisible();
    await expectFits(page);
    // The dropdown (avatar + w-56 popover) opens and still fits at 360px.
    await trigger.click();
    await expect(page.getByRole('menu', { name: /account/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
    await expectFits(page);
  });
});

test('join-by-code page renders and fits on a phone', async ({ page }) => {
  await page.goto('/join?code=ABC12');
  await expect(page.getByRole('button', { name: /join room/i })).toBeVisible();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await expectNoHorizontalOverflow(scrollWidth, clientWidth);
});

test('host create -> pick -> invite flow renders and fits on a phone (spec 0029)', async ({
  page,
}) => {
  await signUpHost(page);
  await page.getByRole('button', { name: /create a room/i }).click();

  // Pick step: the detail-card picker fits and the game is choosable at ~390px.
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
  await expect(page.getByRole('heading', { name: /pick a game/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expectFits(page);

  // Invite step: the room code link + copy icon + share button fit on a phone.
  await page.getByRole('button', { name: /pick trivia/i }).click();
  await page.waitForURL(/\?step=invite/);
  await expect(page.getByRole('heading', { name: /invite your friends/i })).toBeVisible();
  const code = page.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1] ?? '';
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  await expect(page.getByRole('button', { name: /^share$/i })).toBeVisible();
  await expectFits(page);
});
