import { expect, test } from '@playwright/test';

// The home hero carousel (spec 0067) leads the landing page with one portrait card per public game,
// the "where game night grows" tagline beneath it. This lane runs at the 360px phone floor (the
// mobile-first non-negotiable) with reduced motion on, so the autoplay plugin is dropped and the
// slides only move when we drive them - deterministic, no auto-advance flake.
test.describe('home hero carousel (spec 0067) at 360px', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('rotates game hero cards, the dots page, and a slide links to its feature page', async ({
    page,
  }) => {
    // Reduced motion drops the autoplay plugin, so the slides only move when we drive them -
    // deterministic, no auto-advance flake. Set it before the first load so the component reads it
    // on mount.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // The carousel leads the hero; the tagline reads as its caption directly below.
    const carousel = page.getByRole('region', { name: 'Featured games' });
    await expect(carousel).toBeVisible();
    await expect(page.getByRole('heading', { name: /where game night grows/i })).toBeVisible();

    // One dot per public game (Trivia, Liar Liar) - the pager reflects the slide count.
    const dots = page.getByRole('button', { name: /^Go to slide/ });
    await expect(dots).toHaveCount(2);

    // Paging to the second slide marks its dot current.
    await page.getByRole('button', { name: 'Go to slide 2' }).click();
    await expect(page.getByRole('button', { name: 'Go to slide 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    // Tapping the (now active) slide goes to that game's feature page.
    await page.getByRole('link', { name: 'Liar Liar - game details' }).click();
    await expect(page).toHaveURL(/\/games\/liar-liar$/);

    // The feature page is the hero-first page for that game (spec 0030).
    await expect(page.getByRole('heading', { name: 'Liar Liar', level: 1 })).toBeVisible();

    // Back on the landing page, the carousel still fits the 360px viewport (no horizontal overflow).
    await page.goto('/');
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      'landing page should not scroll horizontally on a phone',
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
});
