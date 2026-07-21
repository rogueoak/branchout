import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Sketchy (spec 0063): the insider-only, draw-and-guess party game. It exercises
// what the unit tests cannot - the real browser -> control-plane -> game-engine -> browser loop for
// three players at a 360px phone viewport: an insider host picks the gated game and starts it, every
// player DRAWS their secret seed on the canvas (a few pointer moves) and submits it, then for each
// featured sketch the other players write a decoy and everyone guesses the true seed, until the game
// reaches a scored end. It also proves the gate: the game lives ONLY on the insider surface.
//
// Pairing (live-verified, mirrors the fixed Zinger spec): the host plays INTERACTIVE (a screen + a
// controller on one device) and the two guests play REMOTE (controller-only). The guests join on a
// mobile user agent, whose device default is `remote` (spec 0050), so no manual mode switch is needed.
//
// Guests are SIGNED-IN insiders, not anonymous. The insider surface is gated (feedback 0029): a
// signed-out visitor to `insider.localhost/join` is bounced to login and can never reach the room.
// So each guest signs up, is granted insider + funded out-of-band, and spans its session to the
// insider host - exactly the host's own path - before joining. (An earlier version joined anonymously
// and hung: the guest never reached the room, so it never reached final-results.)

const PHONE = { width: 360, height: 780 };

const PIXEL_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** Sign up a fresh insider account in `ctx`, grant it insider + credits, span its session to the
 * insider host, then join the insider-hosted room by code. The context uses a mobile UA, so the guest
 * defaults to REMOTE. Returns the joined room page. */
async function joinInsiderAsGuest(
  ctx: BrowserContext,
  code: string,
  nickname: string,
): Promise<Page> {
  const setup = await ctx.newPage();
  const account = await signUp(setup);
  await setup.close();
  grantInsider(account.gamerTag);
  grantCredits(account.gamerTag);
  await spanSessionToInsider(ctx);

  const page = await ctx.newPage();
  await page.goto(`${INSIDER_URL}/join?code=${code}`);
  await page.getByLabel('Your name').fill(nickname);
  await page.getByRole('button', { name: /join room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
  return page;
}

/** Draw a few strokes on the sketch canvas with pointer moves, then submit. Also asserts the twig
 * toolbar shows exactly the player's THREE claimed palette colors (spec 0063), not a global set. */
async function drawAndSubmit(page: Page): Promise<void> {
  const twigs = page.getByRole('group', { name: /twig color/i }).getByRole('button');
  await expect(twigs).toHaveCount(3);
  const canvas = page.getByLabel(/draw your seed on the bark/i);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('draw canvas has no bounding box');
  // One diagonal stroke via pointer down -> move -> up (mouse emulates a pointer at 360px).
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: /submit sketch/i }).click();
  await expect(page.getByText(/sketch submitted/i)).toBeVisible({ timeout: 15_000 });
}

test('three insiders play a full Sketchy round: draw, decoy, guess, and score', async ({
  browser,
}) => {
  // The draw + per-sketch guess cycle streams several rounds, so allow a generous budget.
  test.setTimeout(240_000);

  // Host defaults to interactive; the two guests use a mobile UA so they default to remote.
  const hostCtx = await browser.newContext({ viewport: PHONE });
  const p2Ctx = await browser.newContext({ viewport: PHONE, userAgent: PIXEL_UA });
  const p3Ctx = await browser.newContext({ viewport: PHONE, userAgent: PIXEL_UA });
  const host = await hostCtx.newPage();

  try {
    // A fresh account, granted insider out-of-band and funded (a multi-round game reserves credits).
    const account = await signUp(host);
    await spanSessionToInsider(hostCtx);
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

    // Two more insiders join as REMOTE guests - three total (Sketchy's minimum).
    const player2 = await joinInsiderAsGuest(p2Ctx, code, 'Player Two');
    const player3 = await joinInsiderAsGuest(p3Ctx, code, 'Player Three');
    const players = [host, player2, player3];

    // Per-player palettes (spec 0063): the lobby shows a palette picker, and every player was auto-
    // assigned a distinct reserved palette on join. Confirm the host sees the picker with its own
    // palette marked "Yours", then claim a specific free palette and confirm it sticks.
    await expect(host.getByRole('group', { name: /choose your palette/i })).toBeVisible();
    await expect(host.getByRole('button', { name: /palette - yours/i })).toBeVisible();
    // Switch to the first still-free palette and confirm the claim sticks (server reserves it). Using
    // "the first free one" avoids picking a palette a player was already auto-assigned (flaky).
    const freePalette = host.getByRole('button', { name: /palette - free/i }).first();
    const freeName = (await freePalette.getAttribute('aria-label'))?.split(' palette')[0] ?? '';
    await freePalette.click();
    await expect(
      host.getByRole('button', { name: new RegExp(`^${freeName} palette - yours$`, 'i') }),
    ).toBeVisible();
    // Exactly one palette is "yours" at a time (the claim moved, not duplicated).
    await expect(host.getByRole('button', { name: /palette - yours/i })).toHaveCount(1);
    // A guest sees the host's claim as reserved on the next member poll (cross-device reservation).
    await expect(
      player2.getByRole('button', { name: new RegExp(`${freeName} palette - taken`, 'i') }),
    ).toBeVisible({ timeout: 10_000 });

    // One cycle keeps the run short: rounds now default to a "Standard" preset, so pick Custom to
    // reveal the number field and set a single round.
    await host.getByRole('radio', { name: /set your own number of rounds/i }).click();
    await host.locator('#sketchy-rounds').fill('1');

    // Auto-advance now defaults ON. This test drives a deterministic, HOST-advanced run (it gates the
    // between-round "Next" on the leaderboard copy, and the finale is host-advanced), so turn
    // auto-advance off in the lobby's Advanced settings first. The auto-advance-on behavior is covered
    // by the engine/web unit tests; here we keep the classic host-advanced flow the loop is tuned for.
    await host.getByRole('button', { name: /advanced settings/i }).click();
    const autoAdvance = host.locator('#sketchy-auto-advance');
    await expect(autoAdvance).toHaveAttribute('aria-checked', 'true');
    await autoAdvance.click();
    await expect(autoAdvance).toHaveAttribute('aria-checked', 'false');

    await host.getByRole('button', { name: /start game/i }).click();

    // ----- Draw round -----
    // Gate on ALL THREE controllers showing the draw canvas BEFORE anyone submits. The engine
    // early-closes the draw window once every CONNECTED player has submitted (allSubmitted); a guest
    // whose game socket is still connecting when the others submit would be locked out of the draw
    // round (the window closes without its sketch, and the sketch rounds run one short). Waiting for
    // every canvas first guarantees all three are connected before the first submit - the same
    // connect-race gate that mattered for Zinger.
    for (const page of players) {
      await expect(page.getByLabel(/draw your seed on the bark/i)).toBeVisible({ timeout: 30_000 });
    }
    for (const page of players) {
      await drawAndSubmit(page);
    }

    // The draw round has no guess: play proceeds through the gallery leaderboard, then the sketch
    // rounds run (one per player). Auto-advance defaults on (spec 0068), so each leaderboard would
    // hop on its own after the dwell; the host's "Next" press below just accelerates that so the
    // sweep stays well inside budget. Drive the whole game to the final results, handling each decoy +
    // guess stage as it appears on the host (interactive) and the two remotes.
    await expect(async () => {
      // ADVANCE ONLY on a between-round leaderboard. The host's "Next" button (an `advance` control)
      // is present in EVERY non-complete phase, so clicking it whenever it is visible would force-skip
      // an open decoy/guess collection (advancing past it with no submissions) and stall the game. The
      // host's viewer shows "Waiting for the host to start the next round." ONLY on the leaderboard, so
      // gate the advance on that copy - a reliable "between rounds" signal - then press Next.
      const onLeaderboard = await host
        .getByText(/waiting for the host to start the next round/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (onLeaderboard) {
        await host
          .getByRole('button', { name: /^next$/i })
          .click()
          .catch(() => {});
      }

      // Decoy stage: any player showing the decoy input writes one. Scope the submit to that player's
      // own controller so a stray button elsewhere is never mistaken for it.
      for (const page of players) {
        const decoy = page.getByPlaceholder(/convincing fake seed/i);
        if (await decoy.isVisible().catch(() => false)) {
          await decoy.fill(`decoy ${Math.floor(Math.random() * 100000)}`).catch(() => {});
          await page
            .getByRole('region', { name: /your controller/i })
            .getByRole('button', { name: /^(submit|resend)$/i })
            .click()
            .catch(() => {});
        }
      }

      // Guess stage: any player asked "Which one is the true seed?" whose controller shows vote
      // buttons picks the first option. Scope to the controller so a viewer's option list (which has
      // no buttons) is never clicked.
      for (const page of players) {
        const controller = page.getByRole('region', { name: /your controller/i });
        const guessing = await controller
          .getByText(/which one is the true seed/i)
          .isVisible()
          .catch(() => false);
        if (!guessing) continue;
        const button = controller.getByRole('button').first();
        if (await button.isVisible().catch(() => false)) {
          await button.click().catch(() => {});
        }
      }

      // We are done when the final results render on the host. Keep this poll short so a still-open
      // decoy/guess stage is re-driven quickly on the next iteration instead of burning seconds
      // waiting for results that cannot appear yet - this is what keeps the whole sweep well inside
      // budget on a slow CI runner.
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 750 });
    }).toPass({ timeout: 180_000, intervals: [250] });

    // Both REMOTE guests also reach the final results - the "remote guest completes" proof.
    await expect(player2.getByTestId('final-results')).toBeVisible();
    await expect(player3.getByTestId('final-results')).toBeVisible();
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
