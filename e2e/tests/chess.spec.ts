import { expect, test } from '@playwright/test';
import { signUp, spanSessionToInsider } from '../lib/helpers';
import { INSIDER_URL, WEB_PORT, grantCredits, grantInsider } from '../lib/stack';

// End-to-end proof of Chess (spec 0056): the insider-only, two-player, LIVE-model board game. It
// exercises what the unit tests cannot - the real browser -> control-plane -> game-engine (position in
// scratch, streamed) -> browser loop: two insiders join one room on the insider surface, start the
// game, and play a real ALTERNATING sequence to a KNOWN decisive end (Scholar's Mate, a four-move
// checkmate). White (the host) and Black (the joiner) each move in turn via the two-tap board (tap a
// piece, then a highlighted square); the engine validates full legality, applies, and streams the new
// position to both devices so each side takes its turn. The game reaches checkmate and the DOM status
// shows the winner on both phones. It also proves the surface gate (the game lives ONLY on the insider
// surface) and runs at a 360px phone viewport (CLAUDE.md rule 1). It is written to run in CI; if docker
// cannot run in the sandbox it is still authored here and noted as not-run.

test('two insiders play Chess to a checkmate on the live board', async ({ browser }) => {
  // Moves stream back from the engine's live sim, so this needs more than the default budget.
  test.setTimeout(180_000);

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
    expect(new URL(host.url()).host).toBe(`insider.localhost:${WEB_PORT}`);
    const code = host.url().match(/\/rooms\/([A-Z2-9]{5})/)?.[1];
    if (!code) throw new Error(`could not read room code from ${host.url()}`);
    await host.getByRole('button', { name: /pick chess/i }).click();
    await host.waitForURL(new RegExp(`/rooms/${code}(?![?/])`));

    // The second insider joins the same room on the insider surface.
    await player.goto(`${INSIDER_URL}/join?code=${code}`);
    await player.getByLabel('Your name').fill('Amber Player');
    await player.getByRole('button', { name: /join room/i }).click();
    await player.waitForURL(new RegExp(`/rooms/${code}$`));

    // Start the two-player game.
    await host.getByRole('button', { name: /start game/i }).click();

    // The board appears for both. The host holds White (Violet) and moves first.
    await expect(host.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    const hostViewer = host.getByRole('region', { name: /game viewer/i });
    const playerViewer = player.getByRole('region', { name: /game viewer/i });
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });
    await expect(playerViewer.getByRole('status')).toContainText(/waiting/i, { timeout: 30_000 });

    // Tap the center of cell {row,col} on the given player's board. The square board is centered in the
    // canvas with an 8px margin, 8x8 (the same geometry the renderer uses), so a tap by proportion lands
    // on the intended cell (the engine re-validates regardless). Chess uses a two-tap move: select the
    // from-square, then the to-square.
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
    // Algebraic 'e2' -> {row,col} (rank 8 is row 0, file a is col 0). A full move is two taps.
    function sq(alg: string): { row: number; col: number } {
      return { col: alg.charCodeAt(0) - 'a'.charCodeAt(0), row: 8 - Number(alg[1]) };
    }
    async function move(page: typeof host, from: string, to: string): Promise<void> {
      const f = sq(from);
      const t = sq(to);
      await tapCell(page, f.row, f.col);
      await tapCell(page, t.row, t.col);
    }

    // Scholar's Mate: 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 4.Qxf7#. After each move we wait for the turn to
    // pass to the other device, proving both players' moves stream over the live loop.

    // 1. White e2-e4
    await move(host, 'e2', 'e4');
    await expect(playerViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });
    // 1... Black e7-e5
    await move(player, 'e7', 'e5');
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // 2. White Qd1-h5
    await move(host, 'd1', 'h5');
    await expect(playerViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });
    // 2... Black Nb8-c6
    await move(player, 'b8', 'c6');
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // 3. White Bf1-c4
    await move(host, 'f1', 'c4');
    await expect(playerViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });
    // 3... Black Ng8-f6 (the losing move that walks into mate)
    await move(player, 'g8', 'f6');
    await expect(hostViewer.getByRole('status')).toContainText(/your turn/i, { timeout: 30_000 });

    // 4. White Qh5xf7# - checkmate. Both devices show the decisive result.
    await move(host, 'h5', 'f7');
    await expect(hostViewer.getByRole('status')).toContainText(/violet wins by checkmate/i, {
      timeout: 30_000,
    });
    await expect(playerViewer.getByRole('status')).toContainText(/violet wins by checkmate/i, {
      timeout: 30_000,
    });

    // No rejection was shown across the whole exchange (every move was legal for the mover).
    await expect(hostViewer.getByRole('alert')).toHaveCount(0);
    await expect(playerViewer.getByRole('alert')).toHaveCount(0);
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});

test('a non-insider never sees Chess in the game picker', async ({ page }) => {
  await signUp(page);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick chess/i })).toHaveCount(0);
});

test('an INSIDER never sees Chess in the APEX picker (surface, not entitlement)', async ({
  page,
}) => {
  const account = await signUp(page);
  grantInsider(account.gamerTag);
  await page.goto('/rooms');
  await page.getByRole('button', { name: /create a room/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z2-9]{5}\?step=pick/);

  await expect(page.getByRole('button', { name: /pick trivia/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /pick chess/i })).toHaveCount(0);
});
