'use client';

// The Checkers single interactive surface (spec 0055, animated in spec 0071). Checkers is a LIVE-model
// board game with PERFECT information: the engine streams the whole board on the `sim` frame and this
// ONE canvas is the whole game - it renders the streamed board and, when it is the local player's turn,
// lets the player TAP a piece to select it, then tap a highlighted destination to move (or jump). It
// runs no rules; the server validates + applies every move.
//
// It reuses the family board harness: the layout math + tap hit-test are the game-agnostic geometry in
// ../board/geometry.ts (the SAME module Reversi uses), so only the piece drawing (two-tone men +
// crowned kings) and the move payload ({from, path}) are Checkers's own.
//
// Interaction: unlike Reversi's single tap, a checkers move needs a source + a destination, so this is
// a two-tap select-then-move. Tap one of your movable pieces to select it (its legal destinations
// highlight); tap a destination to submit that move (the full jump path is looked up from the streamed
// legal list, so a multi-jump is submitted whole). Tap the piece again, or an empty non-target, to
// clear the selection. Mandatory capture is server-enforced and reflected in the legal list, so only
// capturing pieces highlight when a capture exists.
//
// Motion (spec 0071, mirroring Reversi): the authoritative board deltas between two sims drive a canvas
// animation - a moved piece SLIDES from its source to its landing square, captured (jumped) pieces FADE
// out, and a crowned man grows its King ring. The whole thing honors prefers-reduced-motion (instant,
// no animation). A brief turn-start popup ("Your turn" / "you must jump") pops on the board.
//
// Mobile-first (CLAUDE.md rule #1): the board fits WIDTH as a square, reads at ~360px, uses whole-cell
// tap targets, touch-action:none so a tap never scrolls, and disables text selection / the iOS
// callout. The scoreboard + turn state are DOM rows (a screen-reader status mirror) so assistive tech
// and automated tests can read them.

import { useEffect, useRef, useState } from 'react';
import type { GameViewProps } from '../registry';
import {
  asCheckersSim,
  sameCoord,
  type CheckersMove,
  type CheckersSim,
  type Coord,
  type WireCell,
} from './protocol';
import {
  cellAt,
  cellBox,
  layoutBoard,
  resolveBoardChrome,
  type BoardChrome,
  type BoardLayout,
} from './board-render';
import {
  diffMove,
  hasMandatoryCapture,
  jumpPath,
  turnPopupMessage,
  type MoveAnim,
} from './turn-notice';

/** How long a moved piece takes to slide from its source to its landing square. */
const MOVE_MS = 320;
/** How long a fresh crown ring takes to grow in, after the slide lands. */
const CROWN_MS = 220;
/** How long the turn-start popup stays up before it fades out. */
const POPUP_MS = 1800;

/** An in-flight move animation: the classified delta plus the rAF-clock timestamp it started at. */
interface RunningMove extends MoveAnim {
  start: number;
}

/** The total duration of a move animation (the slide, plus the crown grow-in when it crowns). */
function animTotalMs(anim: MoveAnim): number {
  return MOVE_MS + (anim.crowned ? CROWN_MS : 0);
}

/** Cubic ease-in-out for the slide, so the piece accelerates off its square and settles onto the next. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The color name shown to players for each side. */
const SIDE_LABEL: Record<'violet' | 'amber', string> = { violet: 'Violet', amber: 'Amber' };

/**
 * Whether to paint the legal-move hints this frame: only for the active player (the hints are their
 * affordance, not the opponent's), and only when the host left the "see available moves" setting on.
 * Pure and exported so the gating is unit-tested without driving the canvas draw loop.
 */
export function hintsVisibleFor(sim: CheckersSim | null, isActive: boolean): boolean {
  return isActive && sim != null && sim.showAvailableMoves;
}

function nicknameOf(state: GameViewProps['state'], id: string): string {
  return state.players.find((player) => player.player === id)?.nickname ?? id;
}

/**
 * Map an engine rejection reason to player-clear copy. `showHints` drops any reference to a highlight
 * when the host turned the legal-move hints off (nothing is highlighted to point the player at).
 */
function rejectionMessage(reason: string, showHints: boolean): string {
  const fallback = showHints
    ? 'That move did not land - tap a piece, then a highlighted square.'
    : 'That move did not land - tap a piece, then a square to move.';
  const map: Record<string, string> = {
    'not your turn': 'Hold tight - it is not your turn yet.',
    'illegal move': 'That move is not allowed - if a jump is available you must take it.',
    'malformed move': showHints
      ? 'That did not send cleanly - tap a piece, then a highlighted square.'
      : 'That did not send cleanly - tap a piece, then a square to move.',
    'game over': 'The game is finished - no more moves.',
  };
  return map[reason] ?? fallback;
}

/** The turn/outcome status line, phrased from `me`'s vantage. */
function turnLineFor(
  sim: CheckersSim | null,
  isActive: boolean,
  toMove: 'violet' | 'amber' | null,
  activeName: string | null,
): string {
  if (sim?.over) {
    if (sim.outcome) return `Game over - ${SIDE_LABEL[sim.outcome]} wins.`;
    return 'Game over.';
  }
  const side = toMove ? SIDE_LABEL[toMove] : '';
  if (isActive) {
    // With hints off there is nothing highlighted, so the prompt must not tell the player to tap a
    // "highlighted" square that is not shown.
    const showHints = sim?.showAvailableMoves !== false;
    return showHints
      ? `Your turn (${side}) - tap a piece, then a highlighted square.`
      : `Your turn (${side}) - tap a piece, then a square to move.`;
  }
  if (activeName) return `Waiting for ${activeName} (${side}).`;
  return 'Waiting for the next move.';
}

/** The color/rank of a wire cell, or null for an empty square. */
function pieceOf(cell: WireCell): { color: 'violet' | 'amber'; king: boolean } | null {
  if (cell === 'empty') return null;
  const king = cell.endsWith('-king');
  const color = (king ? cell.slice(0, -'-king'.length) : cell) as 'violet' | 'amber';
  return { color, king };
}

/**
 * Draw one checker piece centered at (cx, cy); a king gets a gold crown ring. `crownScale` grows the
 * ring from 0 to full so a fresh crowning reads as the crown appearing; `alpha` fades a captured piece
 * out. A plain draw passes crownScale 1 and alpha 1.
 */
function drawPieceAt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fill: string,
  rim: string,
  king: boolean,
  crown: string,
  crownScale = 1,
  alpha = 1,
): void {
  const r = size * 0.36;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.strokeStyle = rim;
  ctx.stroke();
  if (king && crownScale > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55 * crownScale, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.strokeStyle = crown;
    ctx.stroke();
  }
  ctx.restore();
}

/** The set of legal destination squares for the currently selected source (as `row,col` keys). */
function destinationsFor(sim: CheckersSim, from: Coord | null): Set<string> {
  const out = new Set<string>();
  if (!from) return out;
  for (const move of sim.legal) {
    if (sameCoord(move.from, from)) {
      const last = move.path[move.path.length - 1];
      if (last) out.add(`${last.row},${last.col}`);
    }
  }
  return out;
}

/** The set of squares that HAVE a legal move (movable sources) for the side to move. */
function movableSources(sim: CheckersSim): Set<string> {
  const out = new Set<string>();
  for (const move of sim.legal) out.add(`${move.from.row},${move.from.col}`);
  return out;
}

/** The fill/rim for a piece color, from the resolved board chrome. */
function paintFor(color: 'violet' | 'amber', chrome: BoardChrome): { fill: string; rim: string } {
  return color === 'violet'
    ? { fill: chrome.violet, rim: chrome.violetRim }
    : { fill: chrome.amber, rim: chrome.amberRim };
}

/**
 * Draw the whole board: wood-grain squares, pieces, the active player's selection + hints, and any
 * in-flight move animation (the sliding piece, fading captures, and a growing crown). The animation is
 * driven entirely by `anim` (the classified board delta) + `now`; with no anim (or once it finishes) the
 * board renders straight from the streamed sim.
 */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  sim: CheckersSim,
  layout: BoardLayout,
  chrome: BoardChrome,
  selected: Coord | null,
  showHints: boolean,
  anim: RunningMove | null,
  now: number,
): void {
  const sources = showHints ? movableSources(sim) : new Set<string>();
  const targets = showHints ? destinationsFor(sim, selected) : new Set<string>();
  const hintColor = sim.toMove === 'amber' ? chrome.amber : chrome.violet;

  const elapsed = anim ? now - anim.start : 0;
  const animActive = anim != null && elapsed < animTotalMs(anim);

  for (let row = 0; row < sim.size; row += 1) {
    for (let col = 0; col < sim.size; col += 1) {
      const box = cellBox(layout, row, col);
      // Alternating wood tints for a checkerboard grain (dark squares are the playable ones).
      ctx.fillStyle = (row + col) % 2 === 0 ? chrome.light : chrome.dark;
      ctx.fillRect(box.x, box.y, box.size, box.size);
      ctx.strokeStyle = chrome.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, box.size, box.size);

      const key = `${row},${col}`;
      const index = row * sim.size + col;
      const isSelected = selected != null && selected.row === row && selected.col === col;

      // A destination hint: a filled dot on a square the selected piece can move/jump to.
      if (targets.has(key)) {
        const cx = box.x + box.size / 2;
        const cy = box.y + box.size / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, box.size * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = hintColor;
        ctx.globalAlpha = 0.75;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // While a move is animating, the landing square's piece is drawn by the slider below (it is still
      // in flight), so skip painting the final piece there this frame.
      if (animActive && index === anim!.to) continue;

      const cell: WireCell = sim.cells[index] ?? 'empty';
      const piece = pieceOf(cell);
      if (piece) {
        const cx = box.x + box.size / 2;
        const cy = box.y + box.size / 2;
        const { fill, rim } = paintFor(piece.color, chrome);
        drawPieceAt(ctx, cx, cy, box.size, fill, rim, piece.king, chrome.crown);
        // Ring a selected source, or a movable source (a subtle affordance) on the active turn.
        if (isSelected || (showHints && sources.has(key))) {
          ctx.beginPath();
          ctx.arc(cx, cy, box.size * 0.44, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(2, box.size * (isSelected ? 0.08 : 0.04));
          ctx.strokeStyle = isSelected ? chrome.crown : chrome.highlight;
          ctx.globalAlpha = isSelected ? 1 : 0.6;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  if (!animActive || !anim) return;

  // Route the slide ALONG THE JUMP PATH: the ordered board indices the piece hops through (source,
  // each intermediate landing, the final square) and the captures ordered to match each hop. A plain
  // step / single jump is the straight [from, to] line; a multi-jump traces each diagonal hop so the
  // piece visibly bounds over each captured piece.
  const { points, captures } = jumpPath(anim, sim.size);
  const centerOf = (index: number): { x: number; y: number } => {
    const box = cellBox(layout, Math.floor(index / sim.size), index % sim.size);
    return { x: box.x + box.size / 2, y: box.y + box.size / 2 };
  };
  const cellSize = cellBox(layout, 0, 0).size;
  const segCount = Math.max(points.length - 1, 1);
  // Progress measured in hop-units: 0 at the source, `segCount` at the final square.
  const progress = Math.min(elapsed / MOVE_MS, 1) * segCount;

  // Fade each captured piece out as the mover crosses its hop: capture k fades over segment k, so it is
  // whole until the mover leaves its square and gone by the time it lands past it - the fade is TIMED
  // to the pass, not started for every piece at t=0.
  for (let k = 0; k < captures.length; k += 1) {
    const alpha = 1 - Math.min(Math.max(progress - k, 0), 1);
    if (alpha <= 0) continue;
    const captured = captures[k]!;
    const c = centerOf(captured.index);
    const { fill, rim } = paintFor(captured.color, chrome);
    drawPieceAt(ctx, c.x, c.y, cellSize, fill, rim, captured.king, chrome.crown, 1, alpha);
  }

  // The sliding piece walks the polyline: pick the current hop segment and ease across it (a slight
  // settle at each landing reads as a bound). A piece that was already a King wears its crown the whole
  // way; a freshly crowned man grows the ring only after the WHOLE slide lands (crownScale 0 -> 1 over
  // CROWN_MS), so the crowning reads as a distinct beat.
  const seg = Math.min(Math.floor(progress), segCount - 1);
  const localT = easeInOut(progress - seg);
  const a = centerOf(points[seg]!);
  const b = centerOf(points[seg + 1]!);
  const cx = a.x + (b.x - a.x) * localT;
  const cy = a.y + (b.y - a.y) * localT;
  const landed = elapsed >= MOVE_MS;
  const kingNow = anim.king && (!anim.crowned || landed);
  const crownScale = anim.crowned ? (landed ? Math.min((elapsed - MOVE_MS) / CROWN_MS, 1) : 0) : 1;
  const { fill, rim } = paintFor(anim.color, chrome);
  drawPieceAt(ctx, cx, cy, cellSize, fill, rim, kingNow, chrome.crown, crownScale);
}

export function CheckersViewer({ state, me, onMove }: GameViewProps) {
  const sim = asCheckersSim(state.sim);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState<Coord | null>(null);

  // Refs the draw loop reads without re-subscribing each render.
  const simRef = useRef<CheckersSim | null>(sim);
  simRef.current = sim;
  const me_ = me ?? '';
  const isActive = sim != null && !sim.over && sim.activePlayer === me_;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const selectedRef = useRef<Coord | null>(selected);
  selectedRef.current = selected;

  // The single in-flight move animation, read every frame by the draw loop and populated when a new
  // board arrives (below). Null under prefers-reduced-motion, so pieces simply snap into place.
  const animRef = useRef<RunningMove | null>(null);
  // The previous board, to diff against the next snapshot for the slide/capture/crown.
  const prevCellsRef = useRef<WireCell[] | null>(null);

  // Honor prefers-reduced-motion: no slide, no capture fade, no crown grow, no popup fade - the state
  // still updates, it just lands instantly. Resolved on mount (SSR has no matchMedia) and kept live.
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

  // Clear a stale selection when the turn moves away from me or the game ends (so a leftover ring does
  // not linger on the other player's move).
  useEffect(() => {
    if (!isActive && selected) setSelected(null);
  }, [isActive, selected]);

  // React to a NEW board snapshot: classify the move (so the draw loop animates the slide/capture/crown)
  // and pop the turn-start notice. Keyed on the board contents so it fires exactly once per move, driven
  // by the authoritative sim rather than a guess. Score/label re-renders that leave the board unchanged
  // do not retrigger it. `over` boards still animate their final move but never pop a "your turn" notice.
  const boardKey = sim ? sim.cells.join(',') : '';
  useEffect(() => {
    if (!sim) return;
    const prev = prevCellsRef.current;
    if (prev && !reducedMotionRef.current) {
      const move = diffMove(prev, sim.cells);
      animRef.current = move ? { ...move, start: performance.now() } : null;
    }
    prevCellsRef.current = sim.cells;

    if (!sim.over) {
      const message = turnPopupMessage({ isActive, mustCapture: hasMandatoryCapture(sim) });
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

  // The single draw loop: redraw the board every frame so an in-flight move animates. A rAF loop keeps
  // the canvas crisp across DPR / resize without a manual resize observer.
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
          // Drop a finished animation so the map stays bounded and the board settles to the sim.
          const anim = animRef.current;
          if (anim && now - anim.start >= animTotalMs(anim)) animRef.current = null;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, rect.width, rect.height);
          const layout = layoutBoard(rect.width, rect.height, live.size);
          const chrome = resolveBoardChrome(canvas);
          drawBoard(
            ctx,
            live,
            layout,
            chrome,
            selectedRef.current,
            hintsVisibleFor(live, isActiveRef.current),
            animRef.current,
            now,
          );
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Select-then-move: the first tap on a movable own piece selects it; a second tap on a highlighted
  // destination submits the full move (the whole jump path is read from the streamed legal list). A tap
  // elsewhere clears or reselects. The server re-validates + applies; an illegal tap is ignored
  // client-side (no hint) and, if it somehow reaches the engine, rejected to this device only.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const live = simRef.current;
    const canvas = canvasRef.current;
    if (!live || !canvas || !isActiveRef.current) return;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const layout = layoutBoard(rect.width, rect.height, live.size);
    const hit = cellAt(layout, e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;

    const current = selectedRef.current;
    // With a piece selected, a tap on one of its legal destinations submits that move.
    if (current) {
      const move = live.legal.find(
        (m) =>
          sameCoord(m.from, current) &&
          m.path.length > 0 &&
          sameCoord(m.path[m.path.length - 1] as Coord, hit),
      );
      if (move) {
        onMove?.(
          state.round,
          JSON.stringify({ from: move.from, path: move.path } satisfies CheckersMove),
        );
        setSelected(null);
        return;
      }
      // Tapping the selected piece again clears it.
      if (sameCoord(current, hit)) {
        setSelected(null);
        return;
      }
    }

    // Otherwise, select the tapped square if it is one of my movable pieces.
    const isMovableSource = live.legal.some((m) => sameCoord(m.from, hit));
    setSelected(isMovableSource ? hit : null);
  }

  // The DOM status the scoreboard + turn state render into (also the screen-reader / test signal).
  const violet = sim?.violet ?? 12;
  const amber = sim?.amber ?? 12;
  const toMove = sim?.toMove ?? null;
  const activeName = sim && sim.activePlayer ? nicknameOf(state, sim.activePlayer) : null;

  // A side's tally is emphasized when it is that side's turn (mid-game) OR, once over, when that side
  // WON - so at game over the winner still pops.
  const highlightViolet = sim?.over ? sim.outcome === 'violet' : toMove === 'violet';
  const highlightAmber = sim?.over ? sim.outcome === 'amber' : toMove === 'amber';

  const turnLine = turnLineFor(sim, isActive, toMove, activeName);
  const violetTone = highlightViolet ? 'text-primary' : 'text-text';
  const amberTone = highlightAmber ? 'text-accent-strong' : 'text-text';
  // The legal-move hints are only shown when the host left them on; the interactive copy (this label,
  // the turn line, and the reject message) drops the word "highlighted" when they are off so it never
  // points a player - or a screen reader - at a highlight that is not on the board.
  const showHints = sim?.showAvailableMoves !== false;
  let boardLabel = 'Checkers board';
  if (isActive) {
    boardLabel = showHints
      ? 'Tap a piece, then a highlighted square to move'
      : 'Tap a piece, then a square to move';
  }

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
  // the BOTTOM edge so it never covers the pieces the active player is about to tap.
  let popupNotice = null;
  if (popup) {
    const fade = reducedMotion ? '' : 'animate-board-turn-notice';
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
      {/* Scoreboard: the two piece counts, the side to move called out. Big + legible at 360px. */}
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

      {/* The turn state as text (screen readers + tests read this; the canvas is opaque to both). */}
      <p className="text-center text-body-sm text-text-muted" role="status" aria-live="polite">
        {turnLine}
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
