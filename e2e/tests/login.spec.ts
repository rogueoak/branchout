import { expect, test } from '@playwright/test';
import { signUp } from '../lib/helpers';

/**
 * Log in with email OR username (spec 0072). A player signs up (email + gamer tag), then logs in
 * through the real /login UI with each identifier form. The single "Email or username" field must
 * accept a bare gamer tag (no email format) just as it accepts the email.
 */
test('logs in through /login by username and by email (spec 0072)', async ({ page, context }) => {
  const account = await signUp(page);

  // Log in with the USERNAME (gamer tag), not the email. Drop the session first so this is a real
  // sign-in, not the session the signup already set.
  await context.clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(account.gamerTag);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  // And again with the EMAIL - the same field, the same account.
  await context.clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
