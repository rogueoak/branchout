import { expect, test, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Whispergrove (spec 0062): the insider-only, two-team, LIVE word-grid game. It
// exercises what the unit tests cannot - the real browser -> control-plane -> game-engine loop across
// FOUR players in two groves, and the spec 0052 secret channel end to end: only the two Whisperers'
// devices ever receive the key, so only they see the colored key rings on the grove. The flow: an
// insider host creates + picks the gated game, three more players join, the host starts, then the two
// groves alternate a real whisper + taps until a grove wins - asserting a real scored end (a winner
// banner + final standings), never an injected terminal state.
//
// It also proves the gate + the surface: the whole flow runs on the insider host, and a seeker device
// never renders the secret key (the key rings appear only on a Whisperer's controller).

/** Join an in-progress insider room by code on the insider host, minting an anonymous session. */
async function joinInsiderRoom(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto(`${INSIDER_URL}/join?code=${code}`);
  await page.getByLabel('Your name').fill(nickname);
  await page.getByRole('button', { name: /join room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
}

test('four insiders play a full two-team Whispergrove match to a winner', async ({ browser }) => {
  // Four real browser contexts (two groves of two), plus the live stream - well over the default budget.
  test.setTimeout(180_000);

  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 360, height: 780 } }),
    browser.newContext({ viewport: { width: 360, height: 780 } }),
    browser.newContext({ viewport: { width: 360, height: 780 } }),
    browser.newContext({ viewport: { width: 360, height: 780 } }),
  ]);
  const [hostCtx, p1Ctx, p2Ctx, p3Ctx] = contexts;
  const host = await hostCtx.newPage(); // seat 0 -> Violet Whisperer
  const p1 = await p1Ctx.newPage(); // seat 1 -> Amber Whisperer
  const p2 = await p2Ctx.newPage(); // seat 2 -> Violet seeker
  const p3 = await p3Ctx.newPage(); // seat 3 -> Amber seeker

  try {
    // A fresh insider host, funded (a live game reserves its round budget to start).
    const account = await signUp(host);
    await spanSessionToInsider(hostCtx);
    grantInsider(account.gamerTag);
    grantCredits(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    // Create a room and pick the insider-only Whispergrove.
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick whispergrove/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // Three more players join on the insider host, filling two groves of two.
    await joinInsiderRoom(p1, code, 'Amber Whisperer');
    await joinInsiderRoom(p2, code, 'Violet Seeker');
    await joinInsiderRoom(p3, code, 'Amber Seeker');

    // Start the match.
    await host.getByRole('button', { name: /start game/i }).click();

    // The grove appears for everyone; the host (Violet Whisperer) and p1 (Amber Whisperer) see their
    // role badge. Secrecy: only a Whisperer's controller renders the secret key hint text.
    for (const p of [host, p1, p2, p3]) {
      await expect(p.getByRole('grid', { name: /the grove/i }).first()).toBeVisible({
        timeout: 30_000,
      });
    }
    await expect(host.getByText(/the rings show your secret key/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(p1.getByText(/the rings show your secret key/i)).toBeVisible();
    // A SEEKER never receives the key, so the key-hint text never appears on their device.
    await expect(p2.getByText(/the rings show your secret key/i)).toHaveCount(0);
    await expect(p3.getByText(/the rings show your secret key/i)).toHaveCount(0);

    // Drive the match to a winner. The Violet Whisperer (host) knows the key via the rings; a simple,
    // deterministic strategy that always ends the game: each grove's Whisperer whispers, then the
    // grove taps. To reach a definite scored end quickly and reliably in the browser loop, the active
    // grove's seeker taps leaves until a turn passes or the game ends; both groves keep taking turns
    // until a winner banner shows on every device. The engine is authoritative for the outcome; the
    // test only proves a real play-through reaches a scored end (a winner + final standings).
    const groves: { whisperer: Page; seeker: Page }[] = [
      { whisperer: host, seeker: p2 },
      { whisperer: p1, seeker: p3 },
    ];

    // Termination invariant: every accepted tap reveals one of the 25 leaves and never un-reveals one,
    // so the hidden-leaf count is strictly monotonic down. A grove clears (all its leaves revealed) or
    // wakes the Deadwood within a bounded number of taps, so this retry loop cannot livelock - it drives
    // real progress toward `over` on each pass. The end reason (a clear or a Deadwood loss) is left to
    // the engine; the test only asserts a real scored end is reached.
    await expect(async () => {
      // If a winner banner is up anywhere, we are done.
      const done = await host
        .getByText(/wins/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (done) return;

      for (const { whisperer, seeker } of groves) {
        // Whisper when this grove is prompted to.
        const wordInput = whisperer.getByLabel('Whisper word');
        if (await wordInput.isVisible().catch(() => false)) {
          await wordInput.fill('canopy').catch(() => {});
          await whisperer
            .getByLabel('Whisper count')
            .fill('9')
            .catch(() => {});
          await whisperer
            .getByRole('button', { name: /^whisper$/i })
            .click()
            .catch(() => {});
        }
        // Tap every available leaf on the seeker's controller (one at a time; the turn may pass).
        const controller = seeker.getByRole('region', { name: /your controller/i });
        const tap = controller.getByRole('button', { name: /^tap /i });
        if (
          await tap
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          await tap
            .first()
            .click()
            .catch(() => {});
        }
      }

      // Force a re-check: the winner banner must be visible for this assertion to pass.
      await expect(host.getByText(/wins/i).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 120_000 });

    // A real scored end: the final results are shown to the players (team result -> shared standings).
    await expect(host.getByText(/wins/i).first()).toBeVisible();
    await expect(p1.getByText(/wins/i).first()).toBeVisible();
    await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 10_000 });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
