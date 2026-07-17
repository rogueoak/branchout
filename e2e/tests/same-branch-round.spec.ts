import { expect, test } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Same Branch (spec 0058): the insider-only spectrum-guessing game. It exercises
// the full browser -> control-plane -> game-engine -> browser loop across two real insider contexts,
// AND the load-bearing secret discipline (spec 0052): the hidden bud is delivered ONLY to the Reader's
// device via the private channel and is never shown on the shared viewer or the guesser's controller.
//
// One round, two players. Round 1's Reader is the first seat (the host). The host sees the bud on
// their controller and reads a hunch; the second player - who never receives the bud - drags the sap
// line on a 360px-wide touch target and locks in a guess; the reveal shows the bud + a scored result.

test('two insiders play a full one-round Same Branch game and only the Reader sees the bud', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  // Mobile-first: both players on a ~360px-wide viewport, so the dial drag must work at phone width.
  const hostCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const playerCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const host = await hostCtx.newPage();
  const player = await playerCtx.newPage();

  try {
    // Two insider accounts (the game is gated to the insider surface). Both sessions are spanned to
    // the insider host and granted the role; the host also needs credits to reserve the rounds.
    const hostAccount = await signUp(host);
    await spanSessionToInsider(hostCtx);
    grantInsider(hostAccount.gamerTag);
    grantCredits(hostAccount.gamerTag);

    const playerAccount = await signUp(player);
    await spanSessionToInsider(playerCtx);
    grantInsider(playerAccount.gamerTag);

    // Host creates a room and picks Same Branch (the insider game), staying on the insider host.
    await host.goto(`${INSIDER_URL}/rooms`);
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    await host.getByRole('button', { name: /pick same branch/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // The second insider joins by code on the insider host.
    await player.goto(`${INSIDER_URL}/join?code=${code}`);
    await player.getByLabel('Your name').fill('Player Two');
    await player.getByRole('button', { name: /join room/i }).click();
    await player.waitForURL(new RegExp(`/rooms/${code}$`));

    // One round, then start.
    await host.locator('#same-branch-rounds').fill('1');
    await host.getByRole('button', { name: /start game/i }).click();

    // Round 1 Reader is the host (first seat). Only the host's controller shows the bud; the second
    // player never receives it.
    await expect(host.getByText(/you are the reader/i)).toBeVisible({ timeout: 30_000 });
    await expect(host.getByText('the bud')).toBeVisible();
    // The guesser's controller has no bud anywhere.
    await expect(player.getByText(/move the sap line/i)).toBeVisible({ timeout: 30_000 });
    await expect(player.getByText('the bud')).toHaveCount(0);

    // The Reader reads a hunch.
    await host.getByLabel(/your hunch/i).fill('somewhere in the warm middle');
    await host.getByRole('button', { name: /^send$/i }).click();
    await expect(host.getByText(/hunch sent/i)).toBeVisible();

    // The guesser drags the sap line on the 360px dial, then locks in. Keyboard-driving the slider is
    // the robust way to set an exact value on a touch target across engines.
    const slider = player.getByRole('slider', { name: /move the sap line/i });
    await slider.focus();
    await player.keyboard.press('ArrowRight'); // moves off the unset state to a real value
    await player.getByRole('button', { name: /lock in my guess/i }).click();
    await expect(player.getByText(/locked in/i)).toBeVisible();

    // Drive the (last) round to completion; auto-advance may also do it, so click Next when offered.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    await expect(player.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});
