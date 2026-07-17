import { expect, test, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider, joinRoom } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Sketchy (spec 0063): the insider-only, draw-and-guess party game. It exercises
// what the unit tests cannot - the real browser -> control-plane -> game-engine -> browser loop for
// three players at a 360px phone viewport: an insider host picks the gated game and starts it, every
// player DRAWS their secret seed on the canvas (a few pointer moves) and submits it, then for each
// featured sketch the other players write a decoy and everyone guesses the true seed, until the game
// reaches a scored end. It also proves the gate: the game lives ONLY on the insider surface.
//
// The whole flow runs on `insider.localhost`, at 360px wide, in three browser contexts (the host is
// interactive; the other two are remote-only players who also see the between-round results).

const PHONE = { width: 360, height: 780 };

/** Draw a few strokes on the sketch canvas with pointer moves, then submit. */
async function drawAndSubmit(page: Page): Promise<void> {
  const canvas = page.getByLabel(/draw your seed on the bark/i);
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('draw canvas has no bounding box');
  // One diagonal stroke via pointer down -> move -> up (mouse emulates a pointer at 360px).
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: /submit sketch/i }).click();
  await expect(page.getByText(/sketch submitted/i)).toBeVisible({ timeout: 10_000 });
}

test('three insiders play a full Sketchy round: draw, decoy, guess, and score', async ({
  browser,
}) => {
  // The draw + per-sketch guess cycle streams several rounds, so allow a generous budget.
  test.setTimeout(240_000);

  const hostCtx = await browser.newContext({ viewport: PHONE });
  const p2Ctx = await browser.newContext({ viewport: PHONE });
  const p3Ctx = await browser.newContext({ viewport: PHONE });
  const host = await hostCtx.newPage();
  const p2 = await p2Ctx.newPage();
  const p3 = await p3Ctx.newPage();
  const players = [host, p2, p3];

  try {
    // A fresh account, granted insider out-of-band and funded (a multi-round game reserves credits).
    const account = await signUp(host);
    await spanSessionToInsider(host.context());
    grantInsider(account.gamerTag);
    grantCredits(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    // Create a room and pick the insider-only game.
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick sketchy/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // Two more players join (on the insider surface).
    await joinRoom(p2, code, 'Player Two');
    await joinRoom(p3, code, 'Player Three');

    // One cycle keeps the run short.
    await host.locator('#sketchy-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // ----- Draw round: every player draws their secret seed. -----
    for (const page of players) {
      await drawAndSubmit(page);
    }

    // The draw round has no guess; the host advances through the gallery leaderboard, then the
    // sketch rounds run (one per player). Drive the whole game to the final results, handling each
    // decoy + guess stage as it appears on the host (interactive) and the two remotes.
    await expect(async () => {
      // If the host has a Next button (a between-round leaderboard), advance.
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }

      // Decoy stage: any player showing the decoy input writes one.
      for (const page of players) {
        const decoy = page.getByPlaceholder(/convincing fake seed/i);
        if (await decoy.isVisible().catch(() => false)) {
          await decoy.fill(`decoy ${Math.floor(Math.random() * 100000)}`).catch(() => {});
          await page
            .getByRole('region', { name: /your controller/i })
            .getByRole('button', { name: /^submit$/i })
            .click()
            .catch(() => {});
        }
      }

      // Guess stage: any player asked "Which one is the true seed?" picks the first option.
      for (const page of players) {
        const guessing = page.getByText(/which one is the true seed/i);
        if (await guessing.isVisible().catch(() => false)) {
          await page
            .getByRole('region', { name: /your controller/i })
            .getByRole('button')
            .first()
            .click()
            .catch(() => {});
        }
      }

      // We are done when the final results render on the host.
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 180_000 });

    // Both remote players also reach the final results.
    await expect(p2.getByTestId('final-results')).toBeVisible();
    await expect(p3.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  }
});

test('a non-insider never sees Sketchy in the game picker', async ({ page }) => {
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick sketchy/i })).toHaveCount(0);
});
