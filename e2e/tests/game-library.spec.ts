import { expect, test } from '@playwright/test';
import { createRoom, signUpHost } from '../lib/helpers';

// The game library + help sheet e2e (spec 0051), at the 360px phone viewport per non-negotiable 1.
// Two flows: (1) the /games index search narrows the list; (2) inside a live game, the always-present
// help icon opens a rules sheet showing the objective, dismisses, and leaves the game running.
test.use({ viewport: { width: 360, height: 780 } });

test('the /games index search narrows the list', async ({ page }) => {
  await page.goto('/games');
  await expect(page.getByRole('heading', { name: 'Games', level: 1 })).toBeVisible();

  // Both public games are listed before searching. The unified card (spec 0065) replaced the old
  // "Learn about <name>" whole-card link with a "Details about <name>" link (plus a "Play <name> now"
  // button) per card, so a game is identified by its Details link here.
  await expect(page.getByRole('link', { name: /details about trivia/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /details about liar liar/i })).toBeVisible();

  // Typing a query narrows the list to the matching game.
  await page.getByLabel(/search games/i).fill('liar');
  await expect(page.getByRole('link', { name: /details about liar liar/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /details about trivia/i })).toHaveCount(0);

  // A query that matches nothing shows the intentional no-match state.
  await page.getByLabel(/search games/i).fill('zzzznotathing');
  await expect(page.getByText(/no games match/i)).toBeVisible();
});

test('in a live game, the help icon opens the rules sheet and the game stays live', async ({
  browser,
}) => {
  // Reaching a running game needs a host + a started room, so this leans on the real stack like the
  // other in-game specs.
  test.setTimeout(120_000);
  const hostCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const host = await hostCtx.newPage();

  try {
    await signUpHost(host);
    await createRoom(host);

    // A solo interactive host is already a viewer, so a single round can start straight away.
    await host.locator('#trivia-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // The game is live: the first question is on screen.
    await expect(host.getByTestId('question-prompt')).toBeVisible();

    // The always-present help control opens the rules sheet showing the objective.
    await host.getByRole('button', { name: /how to play/i }).click();
    const sheet = host.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/score the most points/i)).toBeVisible();

    // The prompt is still on screen WHILE the sheet is open (the round did not end/swap behind it).
    await expect(host.getByTestId('question-prompt')).toBeVisible();

    // Dismiss via the close button, then prove the live game is genuinely UNTOUCHED - not merely that
    // the prompt reappears: the answer input is still enabled and editable and typing an answer still
    // reaches the round (the Submit control accepts it). If opening the sheet had paused the round the
    // input would be disabled; if it had ended the round the input would be gone. (While the sheet is
    // open Radix marks this content inert/aria-hidden, so it is asserted just after close, which still
    // fails if the sheet had mutated game state.)
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(host.getByRole('dialog')).toHaveCount(0);
    await expect(host.getByTestId('question-prompt')).toBeVisible();
    const answer = host.getByLabel('Your answer');
    await expect(answer).toBeEnabled();
    await expect(answer).toBeEditable();
    await answer.fill('water');
    await expect(host.getByRole('button', { name: /submit/i })).toBeEnabled();
  } finally {
    await hostCtx.close();
  }
});
