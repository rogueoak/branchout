import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, signUpHost } from '../lib/helpers';

// The flagship happy-path e2e (spec 0024): a host and a second player play a full one-round Trivia
// game in two real browser contexts against the real stack (control-plane + game-engine + Redis +
// Postgres). This proves the multi-device flow the unit/integration tests cannot: create -> join ->
// start -> answer -> reveal -> final standings.

test('a host and a second player play a full one-round Trivia game', async ({ browser }) => {
  // The round lifecycle is engine-timed (answer auto-close, dispute window, advance), so this flow
  // legitimately needs more than the default per-test budget.
  test.setTimeout(120_000);
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const player = await playerCtx.newPage();

  try {
    // Host signs up and opens a room; the second player joins by code (anonymous).
    await signUpHost(host);
    const code = await createRoom(host);
    await joinRoom(player, code, 'Player Two');

    // Host configures a single round and starts. A solo interactive host is already a viewer, and
    // the joiner is interactive too, so the start gate is satisfied.
    await host.locator('#trivia-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // Both devices transition into the running game and see the first question.
    await expect(host.getByTestId('question-prompt')).toBeVisible();
    await expect(player.getByTestId('question-prompt')).toBeVisible();

    // Both submit an answer through their controller.
    for (const p of [host, player]) {
      await p.locator('#answer-input').fill('branch out');
      await p.getByRole('button', { name: /^submit$/i }).click();
    }
    await expect(host.getByText(/answer submitted/i)).toBeVisible();

    // The round reveals its answer to the shared viewer.
    await expect(host.getByTestId('reveal-answer')).toBeVisible({ timeout: 30_000 });

    // Drive the (last) round to completion from the host controls; auto-advance may also do it, so
    // click Next when it is offered and poll for the final results either way.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });

    // Both players land on the final standings.
    await expect(host.getByRole('list', { name: /final standings/i })).toBeVisible();
    await expect(player.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});
