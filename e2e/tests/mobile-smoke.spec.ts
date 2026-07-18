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

test.describe('game feature pages (spec 0030) at 360px', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('the games index and a feature page render, fit, and carry JSON-LD', async ({ page }) => {
    // Index lists the games and links to each feature page. The unified card (spec 0065) exposes a
    // per-game "Details about <name>" link (to the feature page) instead of the old whole-card "Learn
    // about <name>" link; assert a known game's card is present and the index still fits at 360px.
    await page.goto('/games');
    await expect(page.getByRole('heading', { name: 'Games', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /details about trivia/i })).toBeVisible();
    await expectFits(page);

    // Feature page: hero + the how-to and categories sections, all fitting at 360.
    await page.goto('/games/trivia');
    await expect(page.getByRole('heading', { name: 'Trivia', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /how to play/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^categories$/i })).toBeVisible();
    await expectFits(page);

    // JSON-LD structured data is actually rendered and typed as a VideoGame (not just unit-tested).
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld ?? '{}')['@type']).toBe('VideoGame');

    // Anonymous visitor: the "Start a game" CTA routes to signup first, preserving the game (0030
    // review) - a first-timer must not hit the "hosting needs an account" wall with the game lost.
    const start = page.getByRole('link', { name: 'Start a game' }).first();
    await expect(start).toHaveAttribute('href', '/signup?next=%2Frooms%3Fgame%3Dtrivia');
  });

  test('an unknown game slug returns 404 with the friendly not-found page', async ({ page }) => {
    const resp = await page.goto('/games/does-not-exist');
    expect(resp?.status()).toBe(404);
    // The custom 404 renders on-brand copy and a link home (not a bare Next.js default).
    await expect(
      page.getByRole('heading', { name: /whoops, looks like you are lost/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /let.?s go home/i })).toHaveAttribute('href', '/');
    // The longer heading + full-width button must still fit a 360px phone.
    await expectFits(page);
  });

  test('a signed-in visitor gets the direct play CTA (skips signup)', async ({ page }) => {
    await signUp(page);
    await page.goto('/games/trivia');
    const start = page.getByRole('link', { name: 'Start a game' }).first();
    await expect(start).toHaveAttribute('href', '/rooms?game=trivia');
  });
});

test.describe('the shared top nav (spec 0028) at 360px', () => {
  // Pin the exact 360px floor from the mobile-first non-negotiable (overriding the device viewport).
  test.use({ viewport: { width: 360, height: 780 } });

  test('signed-out nav shows Games + Sign up and fits on home and /rooms', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: /site navigation/i });
    for (const path of ['/', '/rooms']) {
      await page.goto(path);
      await expect(nav).toBeVisible();
      // `exact` so "Games" does not also match the wordmark link ("Branch Out Games home").
      await expect(nav.getByRole('link', { name: 'Games', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Sign up', exact: true })).toBeVisible();
      // The Join link (spec 0029) is a one-tap path to the join screen, present for signed-out too.
      await expect(nav.getByRole('link', { name: 'Join', exact: true })).toHaveAttribute(
        'href',
        '/join',
      );
      await expectFits(page);
    }
  });

  test('the Join nav link reaches the join screen in one tap (spec 0029)', async ({ page }) => {
    await page.goto('/rooms');
    const nav = page.getByRole('navigation', { name: /site navigation/i });
    await nav.getByRole('link', { name: 'Join', exact: true }).click();
    await page.waitForURL(/\/join(\?|$)/);
    await expect(page.getByLabel('Your name')).toBeVisible();
    await expectFits(page);
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

  // Lobby invite affordance: the room code link + copy icon + share button fit on a phone.
  await page.getByRole('button', { name: /pick trivia/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}$/);
  await expect(page.getByRole('heading', { name: /invite friends/i })).toBeVisible();
  const code = page.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1] ?? '';
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  await expect(page.getByRole('button', { name: /^share$/i })).toBeVisible();
  await expectFits(page);
});

test('a game deep link auto-creates and lands the host straight in the lobby (spec 0029)', async ({
  page,
}) => {
  // The "Start a game" deep link (`?game=<slug>`) for a signed-in host must SKIP the create step:
  // create the room, select the game, and land in the lobby with NO "Create a room" tap and NO pick
  // step. This is the front-door consolidation the revised spec 0029 requires.
  await signUp(page);
  await page.goto('/rooms?game=trivia');
  // Lands directly in the lobby (no `?step=pick`); the invite affordance proves it is the lobby.
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}$/);
  await expect(page.getByRole('heading', { name: /invite friends/i })).toBeVisible();
  const code = page.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1] ?? '';
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  // No "Create a room" button was ever tapped, and no pick step was shown.
  await expect(page.getByRole('button', { name: /create a room/i })).toHaveCount(0);

  // A refresh must NOT create a second room: the auto-create replaced the `?game=` URL with the
  // room URL, so reloading stays on the same room (idempotent per arrival, spec 0029 acceptance).
  await page.reload();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
  expect(page.url()).toContain(`/rooms/${code}`);
});

test.describe('legal pages (spec 0031) at 360px', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  for (const { path, heading } of [
    { path: '/privacy', heading: /privacy policy/i },
    { path: '/terms', heading: /terms of service/i },
  ]) {
    test(`${path} renders, carries the footer links, and fits on a phone`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      const footer = page.getByRole('contentinfo');
      await expect(footer.getByRole('link', { name: 'Privacy' })).toBeVisible();
      await expect(footer.getByRole('link', { name: 'Terms' })).toBeVisible();
      await expectFits(page);
    });
  }

  test('the home footer link opens the privacy policy', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeVisible();
  });

  // The footer is also added to the rooms/join entry surfaces (spec 0031); prove it is present AND
  // that those pages still fit at 360px with the footer (a footer link row + page body offender).
  for (const path of ['/rooms', '/join?code=ABC12']) {
    test(`${path} carries the footer and fits at 360px`, async ({ page }) => {
      await page.goto(path);
      const footer = page.getByRole('contentinfo');
      await expect(footer.getByRole('link', { name: 'Privacy' })).toBeVisible();
      await expect(footer.getByRole('link', { name: 'Terms' })).toBeVisible();
      await expectFits(page);
    });
  }
});
