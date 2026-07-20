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

import { useEffect, useRef, useState } from 'react';
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
import { detectFlips, turnPopupMessage } from './turn-notice';

/** How long a captured disc takes to flip to its new color (matches the --duration-slow token). */
const FLIP_MS = 320;
/** How long the turn-start popup stays up before it fades out. */
const POPUP_MS = 1800;

/** An in-flight flip: the disc's NEW color and when the flip started (a rAF-clock timestamp). */
interface FlipAnim {
  to: Exclude<Cell, 'empty'>;
  start: number;
}

/** The disc color a flip animates AWAY from - the opposite of its new color. */
function fromColor(to: Exclude<Cell, 'empty'>): Exclude<Cell, 'empty'> {
  return to === 'violet' ? 'amber' : 'violet';
}

/** The color name shown to players for each side. */
const SIDE_LABEL: Record<'violet' | 'amber', string> = { violet: 'Violet', amber: 'Amber' };

/**
 * Whether to paint the legal-move hint dots this frame: only for the active player (hints are their
 * affordance, not the opponent's), and only when the host left the "see available moves" setting on.
 * Pure and exported so the gating is unit-tested without driving the canvas draw loop.
 */
export function hintsVisibleFor(sim: ReversiSim | null, isActive: boolean): boolean {
  return isActive && sim != null && sim.showAvailableMoves;
}

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
  if (isActive) {
    // With hints off there is nothing highlighted, so the prompt must not tell the player to tap a
    // "highlighted" square that is not shown.
    const showHints = sim?.showAvailableMoves !== false;
    return showHints
      ? `Your turn (${side}) - tap a highlighted square.`
      : `Your turn (${side}) - tap an empty square to place.`;
  }
  if (activeName) return `Waiting for ${activeName} (${side}).`;
  return 'Waiting for the next move.';
}

/**
 * Map an engine rejection reason to player-clear copy. `showHints` drops any reference to a highlight
 * when the host turned the legal-move hints off (nothing is highlighted to point the player at).
 */
function rejectionMessage(reason: string, showHints: boolean): string {
  const illegal = showHints
    ? 'That square does not flip anything - pick a highlighted one.'
    : 'That square does not flip anything - pick an empty square that captures.';
  const fallback = showHints
    ? 'That move did not land - tap a highlighted square.'
    : 'That move did not land - tap an empty square to place.';
  const map: Record<string, string> = {
    'not your turn': 'Hold tight - it is not your turn yet.',
    'illegal move': illegal,
    'malformed move': 'That did not send cleanly - tap a square again.',
    'game over': 'The game is finished - no more moves.',
  };
  return map[reason] ?? fallback;
}

/**
 * Draw one disc filling a cell box, with a subtle rim, in the given color. `scaleX` squashes the disc
 * horizontally (1 = full circle, 0 = edge-on) so the flip animation can spin it about its vertical axis
 * like a coin turning over - a rotateY flip drawn on the canvas.
 */
function drawDisc(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; size: number },
  fill: string,
  rim: string,
  scaleX = 1,
): void {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const r = box.size * 0.38;
  ctx.save();
  // Scale about the disc center so it thins toward a vertical line and back, never drifting.
  ctx.translate(cx, cy);
  ctx.scale(Math.max(scaleX, 0.02), 1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, box.size * 0.05);
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.restore();
}

/**
 * The disc paint for a cell, applying an in-flight flip. A flip runs the disc from its OLD color at full
 * width, thinning to edge-on at the mid-point, then widening in its NEW color - so a capture reads as
 * the disc turning over. Past the flip's duration (or with no flip) it draws the disc solid.
 */
function discPaint(
  cell: Exclude<Cell, 'empty'>,
  chrome: BoardChrome,
  flip: FlipAnim | undefined,
  now: number,
): { fill: string; rim: string; scaleX: number } {
  const solid = (c: Exclude<Cell, 'empty'>): { fill: string; rim: string; scaleX: number } => ({
    fill: c === 'violet' ? chrome.violet : chrome.amber,
    rim: c === 'violet' ? chrome.violetRim : chrome.amberRim,
    scaleX: 1,
  });
  if (!flip) return solid(cell);
  const t = (now - flip.start) / FLIP_MS;
  if (t >= 1 || t < 0) return solid(cell);
  // Width tracks |cos(pi*t)|: full at t=0, edge-on at t=0.5, full again at t=1. The color swaps at the
  // half-way point, when the disc is edge-on, so the change is hidden inside the turn.
  const scaleX = Math.abs(Math.cos(Math.PI * t));
  const shown = t < 0.5 ? fromColor(flip.to) : flip.to;
  return { ...solid(shown), scaleX };
}

/** Draw the whole board: wood-grain squares, grid lines, discs, and the active player's legal hints. */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  sim: ReversiSim,
  layout: BoardLayout,
  chrome: BoardChrome,
  showHints: boolean,
  flips: Map<number, FlipAnim>,
  now: number,
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

      const index = row * sim.size + col;
      const cell: Cell = sim.cells[index] ?? 'empty';
      if (cell !== 'empty') {
        const paint = discPaint(cell, chrome, flips.get(index), now);
        drawDisc(ctx, box, paint.fill, paint.rim, paint.scaleX);
      } else if (legal.has(`${row},${col}`)) {
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

  // In-flight disc flips, keyed by board index, read every frame by the draw loop and populated when a
  // new board arrives (below). Empty under prefers-reduced-motion, so discs simply swap color at once.
  const flipsRef = useRef<Map<number, FlipAnim>>(new Map());
  // The previous board, to diff against the next snapshot for flipped discs + turn transitions.
  const prevCellsRef = useRef<Cell[] | null>(null);

  // Honor prefers-reduced-motion: no disc-flip animation, no popup fade - the state still updates, it
  // just lands instantly. Resolved on mount (SSR has no matchMedia) and kept live if the setting flips.
  const [reducedMotion, setReducedMotion] = useState(false);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // The brief turn-start popup and its dismiss timer.
  const [popup, setPopup] = useState<string | null>(null);
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React to a NEW board snapshot: register the disc flips (so the draw loop animates them) and pop the
  // turn-start notice. Keyed on the board contents so it fires exactly once per move / pass, driven by
  // the authoritative sim rather than a guess. Score/label re-renders that leave the board unchanged do
  // not retrigger it. `over` boards still animate their final flips but never pop a "your turn" notice.
  const boardKey = sim ? sim.cells.join(',') : '';
  useEffect(() => {
    if (!sim) return;
    const prev = prevCellsRef.current;
    if (prev && !reducedMotionRef.current) {
      const now = performance.now();
      for (const index of detectFlips(prev, sim.cells)) {
        const to = sim.cells[index];
        if (to === 'violet' || to === 'amber') flipsRef.current.set(index, { to, start: now });
      }
    }
    prevCellsRef.current = sim.cells;

    if (!sim.over) {
      const otherName = nicknameOf(
        state,
        state.players.find((player) => player.player !== sim.activePlayer)?.player ?? '',
      );
      const message = turnPopupMessage({ isActive, passed: sim.passed, otherName });
      if (message) {
        if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
        setPopup(message);
        popupTimerRef.current = setTimeout(() => setPopup(null), POPUP_MS);
      }
    }
    // boardKey is the stable signal for "the board changed"; the rest is read fresh at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  useEffect(() => () => clearTimeout(popupTimerRef.current ?? undefined), []);

  // The single draw loop: redraw the board every frame so in-flight flips animate. A rAF loop keeps the
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
          const now = performance.now();
          // Drop flips that have finished so the map stays bounded.
          for (const [index, flip] of flipsRef.current) {
            if (now - flip.start >= FLIP_MS) flipsRef.current.delete(index);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, rect.width, rect.height);
          const layout = layoutBoard(rect.width, rect.height, live.size);
          const chrome = resolveBoardChrome(canvas);
          drawBoard(
            ctx,
            live,
            layout,
            chrome,
            hintsVisibleFor(live, isActiveRef.current),
            flipsRef.current,
            now,
          );
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
  // The legal-move hints are only shown when the host left them on; the interactive copy (this label,
  // the turn line, and the illegal-move message) drops the word "highlighted" when they are off so it
  // never points a player - or a screen reader - at a highlight that is not on the board.
  const showHints = sim?.showAvailableMoves !== false;
  let boardLabel = 'Reversi board';
  if (isActive) {
    boardLabel = showHints
      ? 'Tap a highlighted square to place your disc'
      : 'Tap an empty square to place your disc';
  }

  const turnLine = turnLineFor(sim, isActive, toMove, activeName);

  // The forced-pass notice is broadcast to both devices, so phrase it relative to `me`: if I now hold
  // the turn again the OTHER side was skipped (I got an extra turn); otherwise it was MY turn that got
  // skipped. A single fixed vantage would read backwards on the skipped player's phone. The wording is
  // kept in step with the on-board popup ("<other> has no moves" / "you have no moves") so the visible
  // pill and the announced status line describe the same event the same way.
  const otherName =
    sim && sim.activePlayer
      ? nicknameOf(
          state,
          state.players.find((player) => player.player !== sim.activePlayer)?.player ?? '',
        )
      : null;
  let passLine = '';
  if (sim?.passed && !sim.over) {
    passLine = isActive
      ? `${otherName} has no moves - your turn again.`
      : 'You have no moves - your turn was skipped.';
  }
  const statusLine = passLine ? `${turnLine} ${passLine}` : turnLine;

  let rejectedBanner = null;
  if (state.rejected) {
    rejectedBanner = (
      <p
        role="alert"
        className="absolute inset-x-0 top-2 mx-2 rounded-md bg-danger/90 px-3 py-1.5 text-center text-body-sm text-white"
      >
        {rejectionMessage(state.rejected, showHints)}
      </p>
    );
  }

  // The turn-start popup ON the board (a brief, self-dismissing notice). It mirrors the aria-live status
  // line for sighted players, so it is aria-hidden to avoid a double announcement. The fade is a canopy
  // motion token; under reduced motion it appears + clears instantly (no animation class). Anchored to
  // the BOTTOM edge, not dead-center: the opening / early-game legal-move hint dots cluster mid-board,
  // so a centered pill would cover exactly where the active player needs to tap.
  let popupNotice = null;
  if (popup) {
    const fade = reducedMotion ? '' : 'animate-reversi-turn-notice';
    popupNotice = (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
      >
        <span
          className={`rounded-full bg-surface-raised/95 px-4 py-2 text-body-sm font-semibold text-text shadow-lg ring-1 ring-border ${fade}`}
        >
          {popup}
        </span>
      </div>
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
        {popupNotice}
      </div>
    </section>
  );
}
