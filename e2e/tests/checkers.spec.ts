import { expect, test } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Checkers (spec 0055): the insider-only, two-player, LIVE-model board game. It
// exercises what the unit tests cannot - the real browser -> control-plane -> game-engine (board in
// scratch, streamed) -> browser loop: two insiders join one room on the insider surface, start the
// game, and then play a real ALTERNATING sequence of moves that includes a CAPTURE. Violet advances,
// the engine streams so Amber's device sees the new board and moves; Amber replies; then Violet JUMPS
// an amber piece - proving the second player's move streams back AND that a capture changes the piece
// counts on BOTH devices, not just the opening. Because a checkers move is select-then-move, each move
// is two taps (the source piece, then the destination). It also proves the surface gate (the game lives
// ONLY on the insider surface) and runs at a 360px phone viewport (CLAUDE.md rule 1). It is written to
// run in CI; if docker cannot run in the sandbox it is still authored here and noted as not-run.

test('two insiders play an alternating Checkers sequence with a capture on the live board', async ({
  browser,
}) => {
  // The moves stream back from the engine's live sim, so this needs more than the default budget.
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
    await host.getByRole('button', { name: /pick checkers/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // The second insider joins the same room on the insider surface.
    await player.goto(`${INSIDER_URL}/join?code=${code}`);
    await player.getByLabel('Your name').fill('Amber Player');
    await player.getByRole('button', { name: /join room/i }).click();
    await player.waitForURL(new RegExp(`/rooms/${code}$`));

    // Start the two-player game.
    await host.getByRole('button', { name: /start game/i }).click();

    // The board appears for both. The scoreboard + turn state are DOM rows (the canvas is opaque to
    // tests), so assert on those: 12 pieces each at the opening, and Violet (seat 0 = host) to move.
    await expect(host.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    const hostViewer = host.getByRole('region', { name: /game viewer/i });
    await expect(hostViewer.getByText(/Violet 12/)).toBeVisible({ timeout: 30_000 });
    await expect(hostViewer.getByText(/Amber 12/)).toBeVisible();
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

    // A checkers move is SELECT-THEN-MOVE: tap the source piece, then tap the destination square.
    async function move(
      page: typeof host,
      from: [number, number],
      to: [number, number],
    ): Promise<void> {
      await tapCell(page, from[0], from[1]);
      await tapCell(page, to[0], to[1]);
    }

    // A real alternating play-through (rows 0=top Amber home, 7=bottom Violet home), verified against
    // the rules from the standard opening:
    //   1. Violet (5,2) -> (4,3): advances; counts stay 12/12, turn to Amber.
    //   2. Amber  (2,5) -> (3,4): advances toward it; counts stay 12/12, turn to Violet.
    //   3. Violet (4,3) -> (2,5): JUMPS the amber at (3,4) (mandatory capture); Amber drops to 11,
    //      turn to Amber.
    // After each move we assert the streamed counts AND that the turn flipped to the other device, so
    // both players' moves and both players' views are proven over the live loop.

    // Move 1 - Violet advances; Amber's device takes the turn.
    await move(host, [5, 2], [4, 3]);
    await expect(playerViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });
    await expect(hostViewer.getByRole('status')).toContainText(/waiting/i);
    // Counts are unchanged (a plain step).
    await expect(playerViewer.getByText(/Violet 12/)).toBeVisible({ timeout: 30_000 });
    await expect(playerViewer.getByText(/Amber 12/)).toBeVisible();

    // Move 2 - Amber replies; the turn comes back to Violet (the joiner's move streams to the host).
    await move(player, [2, 5], [3, 4]);
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // Move 3 - Violet is FORCED to capture (mandatory jump): (4,3) jumps (3,4) landing (2,5). Amber
    // drops from 12 to 11 on BOTH devices, proving the capture streamed back.
    await move(host, [4, 3], [2, 5]);
    await expect(hostViewer.getByText(/Amber 11/)).toBeVisible({ timeout: 30_000 });
    await expect(playerViewer.getByText(/Amber 11/)).toBeVisible({ timeout: 30_000 });
    await expect(hostViewer.getByText(/Violet 12/)).toBeVisible();
    // The turn returns to Amber after Violet's capture.
    await expect(playerViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // No rejection was shown across the whole exchange (every tap sequence was a legal move).
    await expect(hostViewer.getByRole('alert')).toHaveCount(0);
    await expect(playerViewer.getByRole('alert')).toHaveCount(0);
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});

test('a non-insider never sees Checkers in the game picker', async ({ page }) => {
  // A normal account (no insider grant) walks the apex create flow; the insider-only game is filtered.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  // The public games are offered, but the insider-only game is not.
  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick checkers/i })).toHaveCount(0);
});

test('an INSIDER never sees Checkers in the APEX picker (surface, not entitlement)', async ({
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
  await expect(page.getByRole('button', { name: /pick checkers/i })).toHaveCount(0);
});
