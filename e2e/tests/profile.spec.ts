import { expect, test, type Page } from '@playwright/test';
import { signUp } from '../lib/helpers';

// Spec 0027: an account edit (avatar, nickname, visibility) on /account must reflect on the public
// /u/[gamerTag] profile, and the visibility gate must actually hide detail. The profiles read is
// unauthenticated (no viewer identity), so a private profile is restricted even to its owner's view -
// which is exactly what makes this end-to-end assertion meaningful against the real stack.

async function expectFits(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page should not scroll horizontally on a phone').toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

test('account edits reflect on the public profile, gated by visibility', async ({ page }) => {
  const account = await signUp(page);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: account.gamerTag })).toBeVisible();

  // A distinct nickname so we can prove it is HIDDEN when the profile is private (it defaults to the
  // always-public gamer tag, which would otherwise be indistinguishable).
  await page.getByRole('textbox', { name: 'Nickname' }).fill('NebulaFox');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Nickname saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Choose the frog avatar' }).click();
  await expect(page.getByText('Avatar updated.')).toBeVisible();

  await page.getByLabel('Who can see your full profile').selectOption('private');
  await expect(page.getByText('Privacy updated.')).toBeVisible();

  // Private: gamer tag + stars stay public; nickname and the recent-games section are hidden.
  await page.goto(`/u/${account.gamerTag}`);
  await expect(page.getByText(/This profile is private/)).toBeVisible();
  // `exact` so it matches only the header line, not the document <title> (`Name (@tag) - Branch Out`).
  await expect(page.getByText(`@${account.gamerTag}`, { exact: true })).toBeVisible();
  await expect(page.getByText('NebulaFox')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Recent games' })).toHaveCount(0);

  // Flip back to public: the nickname and the recent-games section now render.
  await page.goto('/account');
  await page.getByLabel('Who can see your full profile').selectOption('public');
  await expect(page.getByText('Privacy updated.')).toBeVisible();
  await page.goto(`/u/${account.gamerTag}`);
  await expect(page.getByRole('heading', { name: 'NebulaFox' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent games' })).toBeVisible();
});

test('a player deletes their own account, and the email + gamer tag are freed for reuse (spec 0040)', async ({
  page,
}) => {
  const account = await signUp(page);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: account.gamerTag })).toBeVisible();

  // Two-step delete: the first tap reveals the confirm, the second deletes.
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('button', { name: 'Yes, delete my account' }).click();

  // Routed home and signed out - the account page now shows the signed-out state.
  await page.waitForURL((url) => url.pathname === '/');
  await page.goto('/account');
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();

  // The same email + gamer tag register a fresh account through the real signup UI (freed for reuse:
  // no duplicate 409). Re-using the helper's exact steps with the ORIGINAL credentials.
  await page.goto('/signup');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByLabel('Gamer tag').fill(account.gamerTag);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByText(/you are in/i)).toBeVisible();
});

test.describe('mobile-first at 360px (CLAUDE.md rule 1)', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('/account and /u fit on a phone with no horizontal overflow', async ({ page }) => {
    const account = await signUp(page);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: account.gamerTag })).toBeVisible();
    await expectFits(page);

    await page.goto(`/u/${account.gamerTag}`);
    // `exact` so it matches only the header line, not the document <title> (`Name (@tag) - Branch Out`).
    await expect(page.getByText(`@${account.gamerTag}`, { exact: true })).toBeVisible();
    await expectFits(page);
  });

  test('the Danger zone delete confirm is usable and fits at 360px (spec 0040)', async ({
    page,
  }) => {
    await signUp(page);
    await page.goto('/account');
    // Reveal the two-step confirm; both buttons render and the page still fits the phone.
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByRole('button', { name: 'Yes, delete my account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expectFits(page);
  });
});
