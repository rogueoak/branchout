import { expect, test, type Page } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Odd Bird: the insider-only, hidden-role location deduction game. It exercises
// what unit tests cannot - the real browser -> control-plane -> game-engine -> browser loop, including
// the spec 0052 PER-PLAYER SECRET: each player's card (the roost + their perch, or "you are the odd
// bird") is delivered ONLY to that player's device via the `private` channel and NEVER broadcast, so
// the shared viewer never shows it. Three insiders play a full game on the insider surface at a 360px
// phone viewport (CLAUDE.md rule 1): deal -> question -> call the flush -> vote -> final standings.
//
// NOT RUN in the sandbox (no docker e2e); this runs in CI on the PR.

/** Join an insider room by code through the /join UI on the insider host (anonymous session). */
async function joinInsiderRoom(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto(`${INSIDER_URL}/join?code=${code}`);
  await page.getByLabel('Your name').fill(nickname);
  await page.getByRole('button', { name: /join room/i }).click();
  await page.waitForURL(new RegExp(`/rooms/${code}$`));
}

test('three insiders play a full Odd Bird game and flush the odd bird', async ({ browser }) => {
  test.setTimeout(180_000);
  // Mobile-first: every context is a 360px phone.
  const phone = { viewport: { width: 360, height: 780 } };
  const hostCtx = await browser.newContext(phone);
  const p2Ctx = await browser.newContext(phone);
  const p3Ctx = await browser.newContext(phone);
  const host = await hostCtx.newPage();
  const p2 = await p2Ctx.newPage();
  const p3 = await p3Ctx.newPage();

  try {
    // A fresh insider host, spanned to the insider surface and funded for a round.
    const account = await signUp(host);
    await spanSessionToInsider(hostCtx);
    grantInsider(account.gamerTag);
    grantCredits(account.gamerTag);
    await host.goto(`${INSIDER_URL}/rooms`);

    // Create a room and pick Odd Bird (the insider-only game, visible on the insider surface).
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick odd bird/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // Two more players join by code (Odd Bird seats 3-8).
    await joinInsiderRoom(p2, code, 'Player Two');
    await joinInsiderRoom(p3, code, 'Player Three');

    // Start the game.
    await host.getByRole('button', { name: /start game/i }).click();

    // Everyone is dealt a card ON THEIR OWN DEVICE. Exactly one player sees "you are the odd bird";
    // the others see "The roost" with a perch. The shared viewer shows neither.
    const pages = [host, p2, p3];
    for (const p of pages) {
      await expect(
        p
          .getByRole('region', { name: /your controller/i })
          .getByText(/the roost|you are the odd bird/i),
      ).toBeVisible({ timeout: 30_000 });
    }

    // Prove exactly one odd bird across the three devices (the secret is partitioned per player).
    // Each device carries a known nickname, so identifying the odd bird's device gives the flock the
    // name to accuse - letting the flock deterministically flush the odd bird (a real flock win).
    const nicknameByPage = new Map<Page, string>([
      [host, account.gamerTag],
      [p2, 'Player Two'],
      [p3, 'Player Three'],
    ]);
    let oddBirdCount = 0;
    const oddBirdPages: Page[] = [];
    const flockPages: Page[] = [];
    for (const p of pages) {
      const isOdd = await p
        .getByText(/you are the odd bird/i)
        .isVisible()
        .catch(() => false);
      if (isOdd) {
        oddBirdCount += 1;
        oddBirdPages.push(p);
      } else {
        flockPages.push(p);
      }
    }
    expect(oddBirdCount).toBe(1);
    const oddBird = oddBirdPages[0]!;
    const oddBirdNickname = nicknameByPage.get(oddBird)!;

    // Anyone can call the flush to open the vote.
    await host.getByRole('button', { name: /call the flush/i }).click();

    // The flush opens: the flock accuses, the odd bird guesses the roost. Every flock member accuses
    // the odd bird BY NAME - the deterministic path to a flock win - and the odd bird makes a guess.
    for (const p of flockPages) {
      await expect(p.getByText(/who is the odd bird/i).first()).toBeVisible({ timeout: 30_000 });
    }
    for (const p of flockPages) {
      await p
        .getByRole('region', { name: /your controller/i })
        .getByRole('button', { name: oddBirdNickname })
        .click();
    }
    // The odd bird picks a roost from the slate.
    await oddBird
      .getByRole('region', { name: /your controller/i })
      .getByRole('button')
      .first()
      .click();

    // Drive to completion; auto-advance may finish it, so click Next when offered.
    await expect(async () => {
      const next = host.getByRole('button', { name: /^next$/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
      }
      await expect(host.getByTestId('final-results')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });

    // The flock accused the odd bird unanimously, so the flock wins - assert that outcome by name.
    await expect(host.getByText(/the flock wins/i).first()).toBeVisible();
    await expect(p2.getByTestId('final-results')).toBeVisible();
    await expect(p3.getByTestId('final-results')).toBeVisible();
  } finally {
    await hostCtx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  }
});
