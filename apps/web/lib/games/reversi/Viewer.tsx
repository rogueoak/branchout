'use client';

// The Reversi single interactive surface (spec 0054). Reversi is a LIVE-model board game with PERFECT
// information: the engine streams the whole board on the `sim` frame and this ONE canvas is the whole
// game - it renders the streamed board and, when it is the local player's turn, lets them TAP an empty
// legal square to place a disc. It runs no rules; the server validates + applies every move.
//
// This is the reusable single-surface BOARD renderer the family follows: the layout math + tap
// hit-test live in the game-agnostic board-render.ts, so Checkers/Chess reuse the exact grid + tap
// plumbing and only swap the piece drawing (here: two-tone discs) and the move payload.
//
// Mobile-first (CLAUDE.md rule #1): the surface fills the stage height, the board fits WIDTH as a
// square, reads well at ~360px, uses big tap targets (a whole cell), touch-action:none so a tap never
// scrolls, and disables text selection / the iOS callout. The scoreboard + turn state are DOM rows (a
// screen-reader status mirror) rather than canvas text, so assistive tech and automated tests can read
// them.

import { useEffect, useRef } from 'react';
import type { GameViewProps } from '../registry';
import { asReversiSim, type Cell, type ReversiSim } from './protocol';
import {
  cellAt,
  cellBox,
  layoutBoard,
  resolveBoardChrome,
  type BoardChrome,
  type BoardLayout,
} from './board-render';

/** The color name shown to players for each side. */
const SIDE_LABEL: Record<'violet' | 'amber', string> = { violet: 'Violet', amber: 'Amber' };

function nicknameOf(state: GameViewProps['state'], id: string): string {
  return state.players.find((player) => player.player === id)?.nickname ?? id;
}

/** The turn/outcome status line, phrased from `me`'s vantage. */
function turnLineFor(
  sim: ReversiSim | null,
  isActive: boolean,
  toMove: 'violet' | 'amber' | null,
  activeName: string | null,
): string {
  if (sim?.over) {
    if (sim.outcome === 'draw') return 'Game over - a draw.';
    if (sim.outcome) return `Game over - ${SIDE_LABEL[sim.outcome]} wins.`;
    return 'Game over.';
  }
  const side = toMove ? SIDE_LABEL[toMove] : '';
  if (isActive) return `Your turn (${side}) - tap a highlighted square.`;
  if (activeName) return `Waiting for ${activeName} (${side}).`;
  return 'Waiting for the next move.';
}

/** Map an engine rejection reason to player-clear copy. */
function rejectionMessage(reason: string): string {
  const map: Record<string, string> = {
    'not your turn': 'Hold tight - it is not your turn yet.',
    'illegal move': 'That square does not flip anything - pick a highlighted one.',
    'malformed move': 'That did not send cleanly - tap a square again.',
    'game over': 'The game is finished - no more moves.',
  };
  return map[reason] ?? 'That move did not land - tap a highlighted square.';
}

/** Draw one disc filling a cell box, with a subtle rim, in the given color. */
function drawDisc(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; size: number },
  fill: string,
  rim: string,
): void {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const r = box.size * 0.38;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, box.size * 0.05);
  ctx.strokeStyle = rim;
  ctx.stroke();
}

/** Draw the whole board: wood-grain squares, grid lines, discs, and the active player's legal hints. */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  sim: ReversiSim,
  layout: BoardLayout,
  chrome: BoardChrome,
  showHints: boolean,
): void {
  const legal = new Set(showHints ? sim.legal.map((m) => `${m.row},${m.col}`) : []);
  // Tint the legal-move hint to the side to move, so a violet turn shows violet hints and an amber
  // turn amber - the affordance always matches whose turn it is, never a fixed third color.
  const hintColor = sim.toMove === 'amber' ? chrome.amber : chrome.violet;
  for (let row = 0; row < sim.size; row += 1) {
    for (let col = 0; col < sim.size; col += 1) {
      const box = cellBox(layout, row, col);
      // Alternating wood tints for a checkerboard grain.
      ctx.fillStyle = (row + col) % 2 === 0 ? chrome.light : chrome.dark;
      ctx.fillRect(box.x, box.y, box.size, box.size);
      ctx.strokeStyle = chrome.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, box.size, box.size);

      const cell: Cell = sim.cells[row * sim.size + col] ?? 'empty';
      if (cell === 'violet') drawDisc(ctx, box, chrome.violet, chrome.violetRim);
      else if (cell === 'amber') drawDisc(ctx, box, chrome.amber, chrome.amberRim);
      else if (legal.has(`${row},${col}`)) {
        // A hollow hint dot on a legal empty square for the side to move.
        const cx = box.x + box.size / 2;
        const cy = box.y + box.size / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, box.size * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = hintColor;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}

export function ReversiViewer({ state, me, onMove }: GameViewProps) {
  const sim = asReversiSim(state.sim);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Refs the draw loop reads without re-subscribing each render.
  const simRef = useRef<ReversiSim | null>(sim);
  simRef.current = sim;
  const me_ = me ?? '';
  const isActive = sim != null && !sim.over && sim.activePlayer === me_;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // The single draw loop: redraw the board whenever the sim (or size) changes. A rAF loop keeps the
  // canvas crisp across DPR / resize without a manual resize observer.
  useEffect(() => {
    let raf = 0;
    const render = (): void => {
      const canvas = canvasRef.current;
      const live = simRef.current;
      if (canvas && live) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, rect.width, rect.height);
          const layout = layoutBoard(rect.width, rect.height, live.size);
          const chrome = resolveBoardChrome(canvas);
          drawBoard(ctx, live, layout, chrome, isActiveRef.current);
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Tap-to-place: hit-test the tap to a cell and submit it if it is a legal square for the local
  // player. The server re-validates + applies; an illegal tap is ignored client-side (no legal hint)
  // and, if it somehow reaches the engine, rejected to this device only.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const live = simRef.current;
    const canvas = canvasRef.current;
    if (!live || !canvas || !isActiveRef.current) return;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const layout = layoutBoard(rect.width, rect.height, live.size);
    const hit = cellAt(layout, e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    const legal = live.legal.some((m) => m.row === hit.row && m.col === hit.col);
    if (!legal) return;
    onMove?.(state.round, JSON.stringify({ row: hit.row, col: hit.col }));
  }

  // The DOM status the scoreboard + turn state render into (also the screen-reader / test signal).
  const violet = sim?.violet ?? 2;
  const amber = sim?.amber ?? 2;
  const toMove = sim?.toMove ?? null;
  const activeName = sim && sim.activePlayer ? nicknameOf(state, sim.activePlayer) : null;

  // A side's tally is emphasized when it is that side's turn (mid-game) OR, once the game is over, when
  // that side WON - so at game over the winner's count still pops (it is the number a player looks to
  // first). A draw highlights neither.
  const highlightViolet = sim?.over ? sim.outcome === 'violet' : toMove === 'violet';
  const highlightAmber = sim?.over ? sim.outcome === 'amber' : toMove === 'amber';
  const violetTone = highlightViolet ? 'text-primary' : 'text-text';
  const amberTone = highlightAmber ? 'text-accent-strong' : 'text-text';
  const boardLabel = isActive ? 'Tap a highlighted square to place your disc' : 'Reversi board';

  const turnLine = turnLineFor(sim, isActive, toMove, activeName);

  // The forced-pass notice is broadcast to both devices, so phrase it relative to `me`: if I now hold
  // the turn again the OTHER side was skipped (I got an extra turn); otherwise it was MY turn that got
  // skipped. A single fixed vantage would read backwards on the skipped player's phone.
  let passLine = '';
  if (sim?.passed && !sim.over) {
    passLine = isActive
      ? 'The other side had no legal move - your turn again.'
      : 'You had no legal move - your turn was skipped.';
  }
  const statusLine = passLine ? `${turnLine} ${passLine}` : turnLine;

  let rejectedBanner = null;
  if (state.rejected) {
    rejectedBanner = (
      <p
        role="alert"
        className="absolute inset-x-0 top-2 mx-2 rounded-md bg-danger/90 px-3 py-1.5 text-center text-body-sm text-white"
      >
        {rejectionMessage(state.rejected)}
      </p>
    );
  }

  return (
    // Fill the single-surface stage height so the whole board fits the viewport without page scroll.
    <section aria-label="Game viewer" className="flex h-full min-h-0 flex-col gap-2">
      {/* Scoreboard: the two disc counts, the side to move called out. Big + legible at 360px. */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2">
        <span className={`flex items-center gap-2 text-body-sm font-semibold ${violetTone}`}>
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full bg-primary ring-1 ring-primary-active"
          />
          Violet {violet}
        </span>
        <span className={`flex items-center gap-2 text-body-sm font-semibold ${amberTone}`}>
          Amber {amber}
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full bg-accent ring-1 ring-accent-strong"
          />
        </span>
      </div>

      {/* The turn + pass state as text (screen readers + tests read this; the canvas is opaque to both). */}
      <p className="text-center text-body-sm text-text-muted" role="status" aria-live="polite">
        {statusLine}
      </p>

      {/* The single game surface: the board. touch-action:none + no user-select keep a tap from
          scrolling / popping the iOS callout (mobile-first). `relative` anchors the reject alert. */}
      <div
        className="relative w-full flex-1 overflow-hidden rounded-xl border border-border bg-bg"
        style={{
          minHeight: '240px',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
        onPointerDown={handlePointerDown}
      >
        <canvas
          ref={canvasRef}
          aria-label={boardLabel}
          role="img"
          className="block h-full w-full"
        />
        {rejectedBanner}
      </div>
    </section>
  );
}
