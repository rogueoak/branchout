import { expect, test, type Page } from '@playwright/test';
import {
  answerCurrentQuestion,
  createRoom,
  joinRoom,
  setTriviaCustom,
  signUpHost,
} from '../lib/helpers';

// Spec 0074: Trivial Matters mixes three question types. This proves the multi-type flow end to end
// against the real stack - a host and a second player play a Custom game of one multiple-choice, one
// true-false, and one open-answer question (the plan builder always ends on the open one), answering
// through each type's controller, and reach the final standings. Coverage of the open-answer dispute
// and finale-terminality behaviors lives in trivia-round.spec.ts.

// Mobile-first (rule 1): play the whole flow at a 360px phone viewport so the three answer controls
// (option buttons, True/False, free text) are proven usable on the smallest supported screen.
test.use({ viewport: { width: 360, height: 780 } });

test('a host and a player play one of each question type to the finale', async ({ browser }) => {
  // Three engine-timed rounds (per-type answer windows + auto-advance dwell) need more than the
  // default per-test budget.
  test.setTimeout(150_000);
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const player = await playerCtx.newPage();

  try {
    await signUpHost(host);
    const code = await createRoom(host);
    await joinRoom(player, code, 'Player Two');

    // One of each type: the plan is [multiple-choice, true-false] shuffled, then always open last.
    await setTriviaCustom(host, { multipleChoice: 1, trueFalse: 1, open: 1 });
    await host.getByRole('button', { name: /start game/i }).click();

    // Drive each device with its OWN concurrent loop. Answering the two players sequentially lets the
    // second fall behind across the auto-advancing rounds until the game ends without it; an
    // independent per-page driver keeps both in step, so every round closes on all-submitted and no
    // per-type answer window expires. Each driver answers every DISTINCT question its page shows once
    // (deduped by prompt text) until the finale, and records the type it saw.
    const seen = new Set<string>();
    async function drive(page: Page) {
      const finale = page.getByTestId('final-results');
      const control = page.locator(
        '#answer-input:visible, [role="group"][aria-label="Choose your answer"]:visible',
      );
      let lastQuestion = '';
      for (let tick = 0; tick < 240; tick++) {
        if (await finale.isVisible().catch(() => false)) return;
        if (
          !(await control
            .first()
            .isVisible()
            .catch(() => false))
        ) {
          await page.waitForTimeout(350);
          continue;
        }
        const question = (
          await page
            .getByTestId('question-prompt')
            .innerText()
            .catch(() => '')
        )
          .replace(/\s+/g, ' ')
          .slice(0, 60);
        if (question && question === lastQuestion) {
          await page.waitForTimeout(250);
          continue;
        }
        const type = await answerCurrentQuestion(page).catch(() => null);
        if (type) {
          seen.add(type);
          lastQuestion = question;
        }
      }
    }
    await Promise.all([drive(host), drive(player)]);

    // All three question types were exercised across the game (spec 0074: open is always last).
    expect([...seen].sort()).toEqual(['multiple-choice', 'open', 'true-false']);

    // Reach the finale: with auto-advance on it completes on its own, but click Next if the game is
    // waiting on a host-advanced leaderboard, exactly like the flagship spec.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });

    await expect(host.getByRole('list', { name: /final standings/i })).toBeVisible();
    await expect(player.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});
