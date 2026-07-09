import { expect, test } from '@playwright/test';

// Mobile-first is the product's first non-negotiable (CLAUDE.md). This lane runs at a phone
// viewport (Pixel 7, ~390px) and guards that the primary entry surfaces render and fit - no
// horizontal overflow, key affordances visible - in a real small-viewport browser.

async function expectNoHorizontalOverflow(scrollWidth: number, clientWidth: number) {
  // Allow a 1px rounding slack; anything more means content pushes past the viewport.
  expect(scrollWidth, 'page should not scroll horizontally on a phone').toBeLessThanOrEqual(
    clientWidth + 1,
  );
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

test('join-by-code page renders and fits on a phone', async ({ page }) => {
  await page.goto('/join?code=ABC12');
  await expect(page.getByRole('button', { name: /join room/i })).toBeVisible();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await expectNoHorizontalOverflow(scrollWidth, clientWidth);
});
