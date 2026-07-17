import { expect, test } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Reversi (spec 0054): the insider-only, two-player, LIVE-model board game. It
// exercises what the unit tests cannot - the real browser -> control-plane -> game-engine (board in
// scratch, streamed) -> browser loop: two insiders join one room on the insider surface, start the
// game, and then play a real ALTERNATING sequence of moves. Violet places, the engine flips + streams
// so Amber's device sees the new board and takes the turn; Amber replies, the turn comes back to
// Violet; and so on for several moves - proving the second player's move streams back and the disc
// counts + turn state update on BOTH devices, not just the opening. It also proves the surface gate
// (the game lives ONLY on the insider surface) and runs at a 360px phone viewport (CLAUDE.md rule 1).
// It is written to run in CI; if docker cannot run in the sandbox it is still authored here and noted
// as not-run.

test('two insiders play an alternating Reversi sequence on the live board', async ({ browser }) => {
  // The move streams back from the engine's live sim, so this needs more than the default budget.
  test.setTimeout(150_000);

  // Two fresh accounts, both granted insider and spanned to the insider host (the game lives there),
  // both at a 360px phone viewport. Fund them so the live game can reserve its budget to start.
  const hostCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const playerCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const host = await hostCtx.newPage();
  const player = await playerCtx.newPage();

  try {
    const hostAccount = await signUp(host);
    await spanSessionToInsider(hostCtx);
    grantInsider(hostAccount.gamerTag);
    grantCredits(hostAccount.gamerTag);

    const playerAccount = await signUp(player);
    await spanSessionToInsider(playerCtx);
    grantInsider(playerAccount.gamerTag);
    grantCredits(playerAccount.gamerTag);

    // Host creates a room on the insider surface and picks the insider-only game.
    await host.goto(`${INSIDER_URL}/rooms`);
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    // The whole flow stays on the insider host - it never bounced to the apex.
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick reversi/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // The second insider joins the same room on the insider surface.
    await player.goto(`${INSIDER_URL}/join?code=${code}`);
    await player.getByLabel('Your name').fill('Amber Player');
    await player.getByRole('button', { name: /join room/i }).click();
    await player.waitForURL(new RegExp(`/rooms/${code}$`));

    // Start the two-player game.
    await host.getByRole('button', { name: /start game/i }).click();

    // The board appears for both. The scoreboard + turn state are DOM rows (the canvas is opaque to
    // tests), so assert on those: 2 discs each at the opening, and Violet (seat 0 = host) to move.
    await expect(host.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    const hostViewer = host.getByRole('region', { name: /game viewer/i });
    await expect(hostViewer.getByText(/Violet 2/)).toBeVisible({ timeout: 30_000 });
    await expect(hostViewer.getByText(/Amber 2/)).toBeVisible();
    // The host holds seat 0 (Violet) and moves first.
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });
    // The joiner is waiting for Violet.
    const playerViewer = player.getByRole('region', { name: /game viewer/i });
    await expect(playerViewer.getByRole('status')).toContainText(/waiting/i, { timeout: 30_000 });

    // Tap cell {row,col} at the center of its square on the given player's board. The square board is
    // centered in the canvas with an 8px margin, 8x8 - the same geometry the renderer uses - so a tap
    // by proportion lands on the intended cell (the engine re-validates regardless).
    async function tapCell(page: typeof host, row: number, col: number): Promise<void> {
      const board = page.locator('canvas').first();
      const box = await board.boundingBox();
      if (!box) throw new Error('board has no bounding box');
      const margin = 8;
      const side = Math.min(box.width, box.height) - margin * 2;
      const cell = side / 8;
      const originX = box.x + (box.width - side) / 2;
      const originY = box.y + (box.height - side) / 2;
      await page.mouse.click(originX + col * cell + cell / 2, originY + row * cell + cell / 2);
    }

    // A real alternating play-through. Each move's cell + resulting disc counts were computed against
    // the rules from the standard opening (each side plays the top-left-most legal square in turn):
    //   1. Violet (2,3) -> V4 A1, turn to Amber
    //   2. Amber  (2,2) -> V3 A3, turn to Violet
    //   3. Violet (2,1) -> V5 A2, turn to Amber
    //   4. Amber  (1,1) -> V4 A4, turn to Violet
    // After each move we assert the streamed counts AND that the turn flipped to the other device, so
    // both players' moves and both players' views are proven over the live loop.

    // Move 1 - Violet places; Amber's device takes the turn.
    await tapCell(host, 2, 3);
    await expect(hostViewer.getByText(/Violet 4/)).toBeVisible({ timeout: 30_000 });
    await expect(hostViewer.getByText(/Amber 1/)).toBeVisible();
    await expect(playerViewer.getByText(/Violet 4/)).toBeVisible({ timeout: 30_000 });
    await expect(playerViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });
    await expect(hostViewer.getByRole('status')).toContainText(/waiting/i);

    // Move 2 - Amber replies; the turn comes back to Violet (the joiner's move streams to the host).
    await tapCell(player, 2, 2);
    await expect(playerViewer.getByText(/Violet 3/)).toBeVisible({ timeout: 30_000 });
    await expect(playerViewer.getByText(/Amber 3/)).toBeVisible();
    await expect(hostViewer.getByText(/Amber 3/)).toBeVisible({ timeout: 30_000 });
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // Move 3 - Violet again.
    await tapCell(host, 2, 1);
    await expect(hostViewer.getByText(/Violet 5/)).toBeVisible({ timeout: 30_000 });
    await expect(hostViewer.getByText(/Amber 2/)).toBeVisible();
    await expect(playerViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // Move 4 - Amber again; the turn returns to Violet.
    await tapCell(player, 1, 1);
    await expect(playerViewer.getByText(/Violet 4/)).toBeVisible({ timeout: 30_000 });
    await expect(playerViewer.getByText(/Amber 4/)).toBeVisible();
    await expect(hostViewer.getByText(/Amber 4/)).toBeVisible({ timeout: 30_000 });
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // No rejection was shown across the whole exchange (every tap was a legal move for the mover).
    await expect(hostViewer.getByRole('alert')).toHaveCount(0);
    await expect(playerViewer.getByRole('alert')).toHaveCount(0);
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});

test('a non-insider never sees Reversi in the game picker', async ({ page }) => {
  // A normal account (no insider grant) walks the apex create flow; the insider-only game is filtered.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  // The public games are offered, but the insider-only game is not.
  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick reversi/i })).toHaveCount(0);
});

test('an INSIDER never sees Reversi in the APEX picker (surface, not entitlement)', async ({
  page,
}) => {
  // Visibility follows the surface, not the entitlement: an insider on the main site must not see the
  // insider-only game. It exists only on the insider surface.
  const account = await signUp(page);
  grantInsider(account.gamerTag);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick reversi/i })).toHaveCount(0);
});
