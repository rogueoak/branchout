import { expect, type BrowserContext, type Page } from '@playwright/test';
import { SESSION_COOKIE } from './stack';

/**
 * Copy the signed-in session cookie (set on `localhost` by {@link signUp}) onto the `insider.`
 * host, standing in for prod's parent-domain (`Domain=.branchout.games`) cookie so the same session
 * reaches `insider.localhost`. Chromium does not span a `Domain=localhost` cookie across
 * `*.localhost`, and the e2e stack has no same-origin proxy to set one, so the test plants it - a
 * faithful stand-in that still exercises OUR middleware + layout + role gate.
 */
export async function spanSessionToInsider(context: BrowserContext): Promise<void> {
  const session = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
  if (!session) throw new Error('no session cookie after signup - login did not set one');
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: session.value,
      domain: 'insider.localhost',
      path: '/',
      httpOnly: true,
      secure: false, // e2e serves plain http (COOKIE_SECURE=false)
      sameSite: 'Lax',
    },
  ]);
}

/** A unique-per-run account so repeated runs (or a kept stack) never hit a duplicate-email 409. */
export function uniqueAccount() {
  const tag = `Host${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  return { email: `${tag.toLowerCase()}@example.com`, password: 'supersecret1', gamerTag: tag };
}

/** A signed-up account, as returned by {@link signUp}. */
export interface Account {
  email: string;
  password: string;
  gamerTag: string;
}

/** Sign up a fresh account through the real /signup UI and return it (session cookie set). */
export async function signUp(page: Page): Promise<Account> {
  const account = uniqueAccount();
  await page.goto('/signup');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByLabel('Gamer tag').fill(account.gamerTag);
  await page.getByRole('button', { name: /create account/i }).click();
  // The done state confirms the session cookie is set.
  await expect(page.getByText(/you are in/i)).toBeVisible();
  return account;
}

/** Sign up a fresh host account through the real /signup UI, then land on the rooms home. */
export async function signUpHost(page: Page): Promise<void> {
  await signUp(page);
  await page.goto('/rooms');
}

/**
 * Host creates a room from the rooms home and walks the create flow (spec 0029): create -> pick a
 * game (Trivia) -> invite -> into the lobby. Returns the 5-char join code (read from the URL). This
 * exercises the stepped create flow in a real browser on every hosting test.
 */
export async function createRoom(page: Page): Promise<string> {
  await page.getByRole('button', { name: /create a room/i }).click();
  // The create flow lands on the pick step first.
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
  const code = page.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
  if (!code) throw new Error(`could not read room code from ${page.url()}`);
  // Pick a game (its detail card), then pass the invite step into the lobby.
  await page.getByRole('button', { name: /pick trivia/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}\\?step=invite`));
  await page.getByRole('button', { name: /continue to room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));
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
