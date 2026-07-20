import { expect, test } from '@playwright/test';
import { joinRoom, signUp } from '../lib/helpers';
import { grantCredits } from '../lib/stack';

// End-to-end proof of Checkers (spec 0055, promoted to PUBLIC in WS14 / spec 0071): the two-player,
// LIVE-model board game, now on the main site. It exercises what the unit tests cannot - the real
// browser -> control-plane -> game-engine (board in scratch, streamed) -> browser loop: two players
// join one room on the PUBLIC surface, start the game, and then play a real ALTERNATING sequence of
// moves that includes a CAPTURE. Violet advances, the engine streams so Amber's device sees the new
// board and moves; Amber replies; then Violet JUMPS an amber piece - proving the second player's move
// streams back AND that a capture changes the piece counts on BOTH devices, not just the opening.
// Because a checkers move is select-then-move, each move is two taps (the source piece, then the
// destination). It also proves Checkers is now PUBLIC (it appears in the apex picker for a normal
// account) and runs at a 360px phone viewport (CLAUDE.md rule 1). It is written to run in CI; if docker
// cannot run in the sandbox it is still authored here and noted as not-run.

test('two players play an alternating Checkers sequence with a capture on the public live board', async ({
  browser,
}) => {
  // The moves stream back from the engine's live sim, so this needs more than the default budget.
  test.setTimeout(150_000);

  // Two fresh accounts, both at a 360px phone viewport. Fund them so the live game can reserve its
  // budget to start (Checkers is a live game; no insider grant is needed now that it is public).
  const hostCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const playerCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const host = await hostCtx.newPage();
  const player = await playerCtx.newPage();

  try {
    const hostAccount = await signUp(host);
    grantCredits(hostAccount.gamerTag);

    const playerAccount = await signUp(player);
    grantCredits(playerAccount.gamerTag);

    // Host creates a room on the PUBLIC surface and picks Checkers (now a public game).
    await host.goto('/rooms');
    await host.getByRole('button', { name: /create a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick checkers/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // The second player joins the same room by code (anonymous).
    await joinRoom(player, code, 'Amber Player');

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

test('a normal account sees Checkers in the public game picker (WS14)', async ({ page }) => {
  // Checkers graduated from insider to public: a normal account (no insider grant) walking the apex
  // create flow must now be offered Checkers alongside the other public games.
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick checkers/i })).toBeVisible();
});

test('Checkers has a public feature page on the /games index (WS14)', async ({ page }) => {
  // The public /games index enumerates PUBLIC_GAME_CATALOG, so Checkers now has a card there that
  // links to its public feature page (which 404'd on the apex while it was insider-only).
  await page.goto('/games');
  await expect(page.getByRole('link', { name: /details about checkers/i })).toBeVisible();
  await page.goto('/games/checkers');
  await expect(page.getByRole('heading', { name: 'Checkers', level: 1 })).toBeVisible();
});
