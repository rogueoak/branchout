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
 * Host creates a room from the rooms home and walks the create flow (spec 0029, spec 0050): create
 * -> pick a game (Trivia) -> into the lobby (the standalone invite step was removed). Returns the
 * 5-char join code (read from the URL). Exercises the create flow in a real browser on every host.
 */
export async function createRoom(page: Page): Promise<string> {
  await page.getByRole('button', { name: /create a room/i }).click();
  // The create flow lands on the pick step first.
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
  const code = page.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
  if (!code) throw new Error(`could not read room code from ${page.url()}`);
  // Pick a game (its detail card): a first pick now drops straight into the lobby.
  await page.getByRole('button', { name: /pick trivia/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));
  return code;
}

/**
 * Set a Custom Trivial Matters mix in the host lobby (spec 0074). Duration is chosen by preset
 * (Fast/Standard/Long/Marathon) or Custom; the specs that need an exact composition pick Custom,
 * which reveals the three per-type count inputs, and fill them. Scoped to the "Game duration"
 * radiogroup so it never collides with the difficulty selector's own Custom option.
 */
export async function setTriviaCustom(
  page: Page,
  counts: { multipleChoice: number; trueFalse: number; open: number },
): Promise<void> {
  await page
    .getByRole('radiogroup', { name: 'Game duration' })
    .getByRole('radio', { name: /custom/i })
    .click();
  await page.locator('#trivia-custom-mc').fill(String(counts.multipleChoice));
  await page.locator('#trivia-custom-tf').fill(String(counts.trueFalse));
  await page.locator('#trivia-custom-open').fill(String(counts.open));
}

/**
 * Answer whatever question type the current round is showing on a player's controller (spec 0074),
 * returning which type it was so a test can assert coverage. Open -> free text + Submit;
 * true-false -> tap True; multiple-choice -> tap the first option. The round-close is all-submitted,
 * so both players calling this closes the round without waiting on the per-type timer.
 */
export async function answerCurrentQuestion(
  page: Page,
  openText = 'branch out',
): Promise<'open' | 'true-false' | 'multiple-choice'> {
  // Scope to `:visible` elements: a just-finished round leaves its (now hidden) answer group in the
  // DOM, so an unscoped locator can resolve to that stale node and miss the live control.
  const openInput = page.locator('#answer-input:visible');
  const choices = page.locator('[role="group"][aria-label="Choose your answer"]:visible');
  await expect(openInput.or(choices).first()).toBeVisible({ timeout: 30_000 });

  if (await openInput.isVisible().catch(() => false)) {
    await openInput.fill(openText);
    await page.getByRole('button', { name: /^submit$/i }).click();
    return 'open';
  }
  // A true-false round's answer group is exactly a True and a False button; a multiple-choice round's
  // group is the option-text buttons. Distinguish by the presence of a literal False button (option
  // texts are answers, never the word "False"), which is layout- and copy-independent.
  const falseButton = choices.getByRole('button', { name: /^false$/i });
  if ((await falseButton.count()) > 0) {
    await choices.getByRole('button', { name: /^true$/i }).click();
    return 'true-false';
  }
  await choices.getByRole('button').first().click();
  return 'multiple-choice';
}

/** A second player joins a room by code through the /join UI (anonymous session is minted). */
export async function joinRoom(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto(`/join?code=${code}`);
  // The name field always arrives pre-filled (spec 0066): a remembered name, a gamer tag, or a
  // generated adjective+noun. A fresh anonymous joiner here gets the generated default, so the field
  // is non-empty before the test overwrites it with its own nickname.
  await expect(page.getByLabel('Your name')).not.toHaveValue('');
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
