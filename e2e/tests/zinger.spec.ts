import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantInsider } from '../lib/stack';

// End-to-end proof of Zinger (spec 0053): the insider-only funny-answer party game on the round-based
// decision lifecycle. It exercises the real browser -> control-plane -> game-engine -> browser loop for
// the happy path: an insider host on the insider surface picks the gated game, two players join, and a
// full one-round game runs - each writes a zinger, two are pitted head to head in the face-off, the
// non-authors vote, and the standings resolve. It also proves the gate (feedback 0029): the game lives
// ONLY on the insider surface. Runs at 360px (CLAUDE.md rule 1: mobile-first).
//
// Pairing (live-verified): the host plays INTERACTIVE (a screen + a controller on one device) and the
// two guests play REMOTE (controller-only). The guests join on a mobile user agent, whose device
// default is `remote` (spec 0050), so no manual mode switch is needed.
//
// Guests are SIGNED-IN insiders, not anonymous. The insider surface is gated (feedback 0029): a
// signed-out visitor to `insider.localhost/join` is bounced to login and can never reach the room.
// So each guest signs up, is granted insider out-of-band, and spans its session to the insider host -
// exactly the host's own path - before joining. (An earlier version joined anonymously and hung: the
// guest never reached the room, so it never reached final-results.)

const PIXEL_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** Sign up a fresh insider account in `ctx`, span its session to the insider host, then join the
 * insider-hosted room by code. The context uses a mobile UA, so the guest defaults to REMOTE. */
async function joinInsiderAsGuest(
  ctx: BrowserContext,
  code: string,
  nickname: string,
): Promise<Page> {
  const setup = await ctx.newPage();
  const account = await signUp(setup);
  await setup.close();
  grantInsider(account.gamerTag);
  await spanSessionToInsider(ctx);

  const page = await ctx.newPage();
  await page.goto(`${INSIDER_URL}/join?code=${code}`);
  await page.getByLabel('Your name').fill(nickname);
  await page.getByRole('button', { name: /join room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
  return page;
}

test('an insider host and two players play a full one-round Zinger game at 360px', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const phone = { width: 360, height: 780 };
  // Host defaults to interactive; the two guests use a mobile UA so they default to remote.
  const hostCtx = await browser.newContext({ viewport: phone });
  const p2Ctx = await browser.newContext({ viewport: phone, userAgent: PIXEL_UA });
  const p3Ctx = await browser.newContext({ viewport: phone, userAgent: PIXEL_UA });
  const host = await hostCtx.newPage();

  try {
    // A fresh account granted the insider role out-of-band; the session is spanned to the insider
    // host, where the game lives (feedback 0029), so the whole flow runs on `insider.localhost`.
    const account = await signUp(host);
    await spanSessionToInsider(hostCtx);
    grantInsider(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    // Create a room and pick the insider-only game (visible on the insider surface).
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick zinger/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // Two more insiders join as REMOTE guests - three total, enough for a face-off + a voter.
    const player2 = await joinInsiderAsGuest(p2Ctx, code, 'Player Two');
    const player3 = await joinInsiderAsGuest(p3Ctx, code, 'Player Three');

    // One round, then start (the host is interactive - a screen + a player).
    await host.locator('#zinger-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // Collecting: gate on ALL THREE controllers showing the input BEFORE anyone submits. The engine
    // early-closes the answer window once every CONNECTED player has submitted (allSubmitted); a
    // guest whose game socket is still connecting when the others submit would be locked out of the
    // round (the window closes with a 2-zinger face-off and that guest never gets to write one).
    // Waiting for every input first guarantees all three are connected before the first submit.
    const entries = [
      [host, 'The Titanic 2'],
      [player2, 'Wet Bandit'],
      [player3, 'Boaty McFloatface'],
    ] as const;
    for (const [p] of entries) {
      await expect(p.locator('#zinger-input')).toBeVisible({ timeout: 30_000 });
    }
    for (const [p, text] of entries) {
      await p.locator('#zinger-input').fill(text);
      await p.getByRole('button', { name: /^submit$/i }).click();
    }
    await expect(host.getByText(/zinger submitted/i)).toBeVisible();

    // The face-off is live once the viewer switches to it (mirror liar-liar, which gates its guess on
    // the guessing-phase heading before clicking). Waiting here is what keeps the vote loop below from
    // racing the collecting phase: without this gate a retry could fire while a controller still shows
    // its "Resend" submit button, "vote" by clicking that, and leave the real ballot uncast - the
    // round would then only close on the 30s timeout with ZERO votes (a scoreless tie), and the
    // leaderboard's "(winner)" assertion would never come true.
    await expect(host.getByText(/which zinger landed hardest/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // Guessing (the face-off): each eligible voter picks a zinger from their own controller. An author
    // of the face-off is told to sit out (no vote button); a non-author sees the two zingers as vote
    // buttons. Scope the click to the "Which zinger landed hardest?" prompt's own button list so a
    // controller that has slipped to a later phase (or still shows a submit button) is never mistaken
    // for a ballot.
    await expect(async () => {
      let voted = false;
      for (const p of [host, player2, player3]) {
        const controller = p.getByRole('region', { name: /your controller/i });
        // A voter's controller shows this prompt above the two vote buttons; an author's shows only a
        // sit-out message. Require the prompt to be present before treating a button as a vote.
        const isVoter = await controller
          .getByText(/which zinger landed hardest/i)
          .isVisible()
          .catch(() => false);
        if (!isVoter) continue;
        const button = controller.getByRole('button').first();
        if (await button.isVisible().catch(() => false)) {
          await button.click().catch(() => {});
          voted = true;
        }
      }
      // At least one non-author must have a vote button in the face-off.
      expect(voted).toBe(true);
    }).toPass({ timeout: 60_000 });

    // The vote must actually score someone (spec Acceptance 4/5), not merely reach the end. At the
    // leaderboard the viewer renders the face-off result - the winning zinger tagged "(winner)" and a
    // vote tally. Assert that before advancing to the final results, so "it finished" becomes "it
    // scored the right person". The host is interactive (a screen + a player), so its viewer shows the
    // result list. (Race note: the 1-round game may auto-advance past the leaderboard, so accept the
    // final results as a fallback and still prove scoring there.)
    // The round finalizes to the leaderboard (engine.finalizeRound) and dwells there until the host
    // advances, so the viewer's face-off result list is reliably up first. Assert it shows the outcome
    // - the winning zinger tagged "(winner)" and a vote tally - so "it finished" becomes "it scored the
    // right person".
    const resultList = host.getByRole('list', { name: /face-off result/i });
    await expect(resultList).toBeVisible({ timeout: 60_000 });
    await expect(resultList.getByText(/\(winner\)/i)).toBeVisible();
    await expect(resultList.getByText(/\d+ votes?/i).first()).toBeVisible();

    // Drive the (last) round to completion; auto-advance may also do it, so click Next when offered.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    await expect(player2.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  }
});

test('a non-insider never sees Zinger in the game picker', async ({ page }) => {
  // A normal account (no insider grant) walks the apex create flow; the insider-only game is filtered.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick zinger/i })).toHaveCount(0);
});
