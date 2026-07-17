import { expect, test } from '@playwright/test';
import { createRoom, signUpHost } from '../lib/helpers';

// The game library + help sheet e2e (spec 0051), at the 360px phone viewport per non-negotiable 1.
// Two flows: (1) the /games index search narrows the list; (2) inside a live game, the always-present
// help icon opens a rules sheet showing the objective, dismisses, and leaves the game running.
test.use({ viewport: { width: 360, height: 780 } });

test('the /games index search narrows the list', async ({ page }) => {
  await page.goto('/games');
  await expect(page.getByRole('heading', { name: 'Games', level: 1 })).toBeVisible();

  // Both public games are listed before searching.
  await expect(page.getByRole('link', { name: /learn about trivia/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /learn about liar liar/i })).toBeVisible();

  // Typing a query narrows the list to the matching game.
  await page.getByLabel(/search games/i).fill('liar');
  await expect(page.getByRole('link', { name: /learn about liar liar/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /learn about trivia/i })).toHaveCount(0);

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

    // Dismiss via the close button; the game is still live behind it (question still visible).
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(host.getByRole('dialog')).toHaveCount(0);
    await expect(host.getByTestId('question-prompt')).toBeVisible();
  } finally {
    await hostCtx.close();
  }
});
