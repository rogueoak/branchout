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

  await page.getByRole('button', { name: 'Choose the berry avatar' }).click();
  await expect(page.getByText('Avatar updated.')).toBeVisible();

  await page.getByLabel('Who can see your full profile').selectOption('private');
  await expect(page.getByText('Privacy updated.')).toBeVisible();

  // Private: gamer tag + stars stay public; nickname and the recent-games section are hidden.
  await page.goto(`/u/${account.gamerTag}`);
  await expect(page.getByText(/This profile is private/)).toBeVisible();
  await expect(page.getByText(`@${account.gamerTag}`)).toBeVisible();
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

test.describe('mobile-first at 360px (CLAUDE.md rule 1)', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('/account and /u fit on a phone with no horizontal overflow', async ({ page }) => {
    const account = await signUp(page);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: account.gamerTag })).toBeVisible();
    await expectFits(page);

    await page.goto(`/u/${account.gamerTag}`);
    await expect(page.getByText(`@${account.gamerTag}`)).toBeVisible();
    await expectFits(page);
  });
});
