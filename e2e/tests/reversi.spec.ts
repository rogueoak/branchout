import { expect, test } from '@playwright/test';
import { joinRoom, signUp } from '../lib/helpers';
import { grantCredits } from '../lib/stack';

// End-to-end proof of Reversi (spec 0054, promoted to PUBLIC in WS9): the two-player, LIVE-model
// board game, now on the main site. It exercises what the unit tests cannot - the real browser ->
// control-plane -> game-engine (board in scratch, streamed) -> browser loop: two players join one
// room on the PUBLIC surface, start the game, and play a real ALTERNATING sequence of moves. Violet
// places, the engine flips + streams so Amber's device sees the new board and takes the turn; Amber
// replies, the turn comes back to Violet; and so on for several moves - proving the second player's
// move streams back and the disc counts + turn state update on BOTH devices, not just the opening. It
// also proves Reversi is now PUBLIC (it appears in the apex picker for a normal account) and runs at a
// 360px phone viewport (CLAUDE.md rule 1). It is written to run in CI; if docker cannot run in the
// sandbox it is still authored here and noted as not-run.

test('two players play an alternating Reversi sequence on the public live board', async ({
  browser,
}) => {
  // The move streams back from the engine's live sim, so this needs more than the default budget.
  test.setTimeout(150_000);

  // Two fresh accounts, both at a 360px phone viewport. Fund them so the live game can reserve its
  // budget to start (Reversi is a live game; no insider grant is needed now that it is public).
  const hostCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const playerCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const host = await hostCtx.newPage();
  const player = await playerCtx.newPage();

  try {
    const hostAccount = await signUp(host);
    grantCredits(hostAccount.gamerTag);

    const playerAccount = await signUp(player);
    grantCredits(playerAccount.gamerTag);

    // Host creates a room on the PUBLIC surface and picks Reversi (now a public game).
    await host.goto('/rooms');
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick reversi/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // The second player joins the same room by code (anonymous).
    await joinRoom(player, code, 'Amber Player');

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

test('a normal account sees Reversi in the public game picker (WS9)', async ({ page }) => {
  // Reversi graduated from insider to public: a normal account (no insider grant) walking the apex
  // create flow must now be offered Reversi alongside the other public games.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick reversi/i })).toBeVisible();
});

test('Reversi has a public feature page on the /games index (WS9)', async ({ page }) => {
  // The public /games index enumerates PUBLIC_GAME_CATALOG, so Reversi now has a card there that
  // links to its public feature page (which 404'd on the apex while it was insider-only).
  await page.goto('/games');
  await expect(page.getByRole('link', { name: /details about reversi/i })).toBeVisible();
  await page.goto('/games/reversi');
  await expect(page.getByRole('heading', { name: 'Reversi', level: 1 })).toBeVisible();
});
