import { expect, type Page } from '@playwright/test';

/** A unique-per-run account so repeated runs (or a kept stack) never hit a duplicate-email 409. */
export function uniqueAccount() {
  const tag = `Host${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  return { email: `${tag.toLowerCase()}@example.com`, password: 'supersecret1', gamerTag: tag };
}

/** Sign up a fresh host account through the real /signup UI, then land on the rooms home. */
export async function signUpHost(page: Page): Promise<void> {
  const account = uniqueAccount();
  await page.goto('/signup');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByLabel('Gamer tag').fill(account.gamerTag);
  await page.getByRole('button', { name: /create account/i }).click();
  // The done state confirms the session cookie is set; then head to the rooms home.
  await expect(page.getByText(/you are in/i)).toBeVisible();
  await page.goto('/rooms');
}

/** Host creates a room from the rooms home; returns the 5-char join code (read from the URL). */
export async function createRoom(page: Page): Promise<string> {
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}$/);
  const code = page.url().match(/\/rooms\/([A-Z2-9]{5})$/)?.[1];
  if (!code) throw new Error(`could not read room code from ${page.url()}`);
  return code;
}

/** A second player joins a room by code through the /join UI (anonymous session is minted). */
export async function joinRoom(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto(`/join?code=${code}`);
  await page.getByLabel('Your name').fill(nickname);
  await page.getByRole('button', { name: /join room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
}

/** Read an Open Graph / meta value from the current document by property or name. */
export async function metaContent(page: Page, key: string): Promise<string | null> {
  const byProperty = page.locator(`meta[property="${key}"]`);
  if (await byProperty.count()) return byProperty.first().getAttribute('content');
  return page.locator(`meta[name="${key}"]`).first().getAttribute('content');
}
