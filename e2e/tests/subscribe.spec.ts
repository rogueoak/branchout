import { expect, test } from '@playwright/test';

// Spec 0047: the newsletter-subscribe flow is multi-surface (a /games banner -> a reveal -> a POST to
// the control-plane's /api/v1/subscribe endpoint), so a real-stack e2e proves the pieces are wired
// together, not just unit-mocked. The e2e stack sets no CTCT secrets, so the endpoint is INERT: this
// drives the banner -> form -> submit and asserts the browser reaches the endpoint and renders its
// clear "not configured yet" result. That is the observable end state until an operator provisions
// the secrets (which then need confirmed opt-in on the list per the spec's Abuse / go-live section).

test('the /games coming-soon banner reveals the subscribe form and posts to the (inert) endpoint', async ({
  page,
}) => {
  await page.goto('/games');

  // The coming-soon banner and its entry button render on the public games page (no sign-in needed).
  await expect(page.getByRole('heading', { name: /more games coming soon/i })).toBeVisible();
  const openButton = page.getByRole('button', { name: /subscribe for updates/i });
  await expect(openButton).toBeVisible();

  // The form is revealed only on click (kept out of the initial paint).
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await openButton.click();

  const email = page.getByLabel('Email');
  await expect(email).toBeVisible();
  await email.fill('e2e-subscriber@example.com');

  // Submit -> the browser posts to /api/v1/subscribe. With no CTCT secrets in the e2e stack the
  // endpoint is inert and returns its "not configured" message, which the form surfaces as an alert.
  await page.getByRole('button', { name: /^subscribe$/i }).click();
  await expect(page.getByRole('alert')).toHaveText(/not configured yet/i);
});

test('the subscribe form fits a phone viewport at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/games');
  await page.getByRole('button', { name: /subscribe for updates/i }).click();
  await expect(page.getByLabel('Email')).toBeVisible();

  // Mobile-first (CLAUDE.md #1): the revealed form must not push the page into horizontal scroll.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page should not scroll horizontally on a phone').toBeLessThanOrEqual(
    clientWidth + 1,
  );
});
