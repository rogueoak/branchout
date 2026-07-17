'use client';

// The Chess single interactive surface (spec 0056). Chess is a LIVE-model board game with PERFECT
// information: the engine streams the whole position on the `sim` frame and this ONE canvas is the whole
// game - it renders the streamed board and, on the local player's turn, lets them tap to move. It runs
// no rules; the server validates + applies every move.
//
// Interaction is the standard two-tap board move: tap one of YOUR pieces to select it (its legal
// destinations light up), then tap a highlighted square to move. Tapping the piece again, or an empty
// non-legal square, clears the selection. A pawn reaching the last rank raises a small promotion picker
// (Queen / Rook / Bishop / Knight). A "Resign" button concedes. This reuses the shared board geometry
// (layout + hit-test) so it matches Reversi/Checkers; only the piece drawing (Unicode glyphs) and the
// two-tap move flow are Chess's own.
//
// Mobile-first (CLAUDE.md rule #1): the surface fills the stage height, the board fits WIDTH as a
// square, reads at ~360px, uses whole-cell tap targets, touch-action:none so a tap never scrolls, and
// disables text selection / the iOS callout. The turn/check/result state is a DOM status row (a
// screen-reader mirror and a stable test signal), not canvas text.

import { useEffect, useRef, useState } from 'react';
import type { GameViewProps } from '../registry';
import {
  asChessSim,
  type ChessMove,
  type ChessSim,
  type PromotionType,
  type Square,
} from './protocol';
import {
  cellAt,
  cellBox,
  decodePiece,
  glyphFor,
  layoutBoard,
  resolveBoardChrome,
  type BoardChrome,
  type BoardLayout,
} from './board-render';

/** The color name shown to players for each side. */
const SIDE_LABEL: Record<'white' | 'black', string> = { white: 'Violet', black: 'Amber' };

function nicknameOf(state: GameViewProps['state'], id: string): string {
  return state.players.find((player) => player.player === id)?.nickname ?? id;
}

/** Map an engine rejection reason to player-clear copy. */
function rejectionMessage(reason: string): string {
  const map: Record<string, string> = {
    'not your turn': 'Hold tight - it is not your turn yet.',
    'illegal move': 'That is not a legal move - pick a highlighted square.',
    'malformed move': 'That did not send cleanly - try the move again.',
    'game over': 'The game is finished - no more moves.',
  };
  return map[reason] ?? 'That move did not land - pick a highlighted square.';
}

function sameSquare(a: Square, b: Square): boolean {
  return a.row === b.row && a.col === b.col;
}

/** The game-over line: draw (with reason) or a win (by checkmate or resignation). */
function resultLineFor(sim: ChessSim | null): string {
  if (!sim?.over) return '';
  if (sim.outcome === 'draw') {
    let why = 'a draw';
    if (sim.endReason === 'stalemate') why = 'stalemate';
    else if (sim.endReason === 'insufficient') why = 'insufficient material';
    return `Game over - draw (${why}).`;
  }
  if (sim.outcome === 'white' || sim.outcome === 'black') {
    const how = sim.endReason === 'resign' ? 'by resignation' : 'by checkmate';
    return `Game over - ${SIDE_LABEL[sim.outcome]} wins ${how}.`;
  }
  return 'Game over.';
}

/** The turn line while the game is live, phrased from `me`'s vantage. */
function liveTurnLineFor(
  sim: ChessSim | null,
  isActive: boolean,
  toMove: 'white' | 'black' | null,
  activeName: string | null,
): string {
  const side = toMove ? SIDE_LABEL[toMove] : '';
  if (isActive) {
    const check = sim?.check ? ' - you are in check' : '';
    return `Your turn (${side})${check} - tap a piece, then a highlighted square.`;
  }
  if (activeName) {
    const check = sim?.check ? ' - in check' : '';
    return `Waiting for ${activeName} (${side})${check}.`;
  }
  return 'Waiting for the next move.';
}

/** The legal destinations for a selected from-square (deduped across promotion variants). */
function destinationsFor(sim: ChessSim, from: Square): Square[] {
  const seen = new Set<string>();
  const out: Square[] = [];
  for (const m of sim.legal) {
    if (sameSquare(m.from, from) && !seen.has(`${m.to.row},${m.to.col}`)) {
      seen.add(`${m.to.row},${m.to.col}`);
      out.push(m.to);
    }
  }
  return out;
}

/** True when moving from->to is a promotion (the sim lists a promotion variant for it). */
function isPromotion(sim: ChessSim, from: Square, to: Square): boolean {
  return sim.legal.some(
    (m) => sameSquare(m.from, from) && sameSquare(m.to, to) && m.promotion != null,
  );
}

/** Draw one piece glyph centered in a cell, tinted to its army color with a contrasting outline. */
function drawPiece(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; size: number },
  fill: string,
  outline: string,
  glyph: string,
): void {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  ctx.font = `${Math.floor(box.size * 0.72)}px "Segoe UI Symbol", "Apple Color Emoji", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1.5, box.size * 0.04);
  ctx.strokeStyle = outline;
  ctx.strokeText(glyph, cx, cy);
  ctx.fillStyle = fill;
  ctx.fillText(glyph, cx, cy);
}

/** Draw the whole board: wood squares, the selection + hints + check wash, and the pieces. */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  sim: ChessSim,
  layout: BoardLayout,
  chrome: BoardChrome,
  selected: Square | null,
  dests: Square[],
): void {
  const destSet = new Set(dests.map((d) => `${d.row},${d.col}`));
  // Locate the king in check to wash its square (only the side to move is ever in check).
  let checkSquare: string | null = null;
  if (sim.check && sim.toMove) {
    const kingColor = sim.toMove === 'white' ? 'w' : 'b';
    for (let i = 0; i < sim.cells.length; i += 1) {
      if (sim.cells[i] === `${kingColor}K`) {
        checkSquare = `${Math.floor(i / sim.size)},${i % sim.size}`;
        break;
      }
    }
  }

  for (let row = 0; row < sim.size; row += 1) {
    for (let col = 0; col < sim.size; col += 1) {
      const box = cellBox(layout, row, col);
      ctx.fillStyle = (row + col) % 2 === 0 ? chrome.light : chrome.dark;
      ctx.fillRect(box.x, box.y, box.size, box.size);
      const key = `${row},${col}`;
      if (checkSquare === key) {
        ctx.fillStyle = chrome.danger;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(box.x, box.y, box.size, box.size);
        ctx.globalAlpha = 1;
      }
      if (selected && selected.row === row && selected.col === col) {
        ctx.fillStyle = chrome.select;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(box.x, box.y, box.size, box.size);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = chrome.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, box.size, box.size);

      const piece = decodePiece(sim.cells[row * sim.size + col] ?? 'empty');
      if (piece) {
        const fill = piece.color === 'w' ? chrome.violet : chrome.amber;
        const outline = piece.color === 'w' ? chrome.violetRim : chrome.amberRim;
        drawPiece(ctx, box, fill, outline, glyphFor(piece.type));
      }
      // A legal-destination dot (drawn on top so it shows over an empty square or a capturable piece).
      if (destSet.has(key)) {
        const cx = box.x + box.size / 2;
        const cy = box.y + box.size / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, box.size * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = chrome.hint;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}

export function ChessViewer({ state, me, onMove }: GameViewProps) {
  const sim = asChessSim(state.sim);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const me_ = me ?? '';
  const isActive = sim != null && !sim.over && sim.activePlayer === me_;

  // The selected from-square (first tap) and a pending promotion (from/to awaiting a piece choice).
  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: Square; to: Square } | null>(null);

  // Refs the draw loop + tap handler read without re-subscribing each render.
  const simRef = useRef<ChessSim | null>(sim);
  simRef.current = sim;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const selectedRef = useRef<Square | null>(selected);
  selectedRef.current = selected;

  // Clear the selection whenever it stops being our turn or the board resets under us.
  useEffect(() => {
    if (!isActive) {
      setSelected(null);
      setPendingPromo(null);
    }
  }, [isActive]);

  const dests = sim && selected ? destinationsFor(sim, selected) : [];
  const destsRef = useRef<Square[]>(dests);
  destsRef.current = dests;

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
        const c = canvas.getContext('2d');
        if (c) {
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          c.clearRect(0, 0, rect.width, rect.height);
          const layout = layoutBoard(rect.width, rect.height, live.size);
          const chrome = resolveBoardChrome(canvas);
          drawBoard(c, live, layout, chrome, selectedRef.current, destsRef.current);
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  function submit(from: Square, to: Square, promotion?: PromotionType): void {
    const move: ChessMove = promotion ? { from, to, promotion } : { from, to };
    onMove?.(state.round, JSON.stringify(move));
    setSelected(null);
    setPendingPromo(null);
  }

  // Two-tap move: first tap a friendly piece to select; second tap a legal destination to move.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const live = simRef.current;
    const canvas = canvasRef.current;
    if (!live || !canvas || !isActiveRef.current || pendingPromo) return;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const layout = layoutBoard(rect.width, rect.height, live.size);
    const hit = cellAt(layout, e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;

    const current = selectedRef.current;
    if (current) {
      // Tapping the same square deselects; tapping a legal destination moves.
      if (sameSquare(current, hit)) {
        setSelected(null);
        return;
      }
      const legalDest = destinationsFor(live, current).some((d) => sameSquare(d, hit));
      if (legalDest) {
        if (isPromotion(live, current, hit)) {
          setPendingPromo({ from: current, to: hit });
        } else {
          submit(current, hit);
        }
        return;
      }
    }
    // Otherwise (re)select if the tapped square holds one of the mover's pieces that HAS a legal move.
    const hasMove = live.legal.some((m) => sameSquare(m.from, hit));
    setSelected(hasMove ? hit : null);
  }

  // The DOM status the turn/check/result state renders into (also the screen-reader / test signal).
  const toMove = sim?.toMove ?? null;
  const activeName = sim && sim.activePlayer ? nicknameOf(state, sim.activePlayer) : null;

  const turnLine = sim?.over
    ? resultLineFor(sim)
    : liveTurnLineFor(sim, isActive, toMove, activeName);

  const violetTone = toMove === 'white' && !sim?.over ? 'text-primary' : 'text-text';
  const amberTone = toMove === 'black' && !sim?.over ? 'text-accent-strong' : 'text-text';
  const boardLabel = isActive ? 'Tap a piece, then a highlighted square, to move' : 'Chess board';

  let promoPicker = null;
  if (pendingPromo) {
    promoPicker = (
      <div
        role="dialog"
        aria-label="Choose promotion"
        className="absolute inset-x-0 bottom-2 mx-2 flex items-center justify-center gap-2 rounded-lg bg-surface-raised px-3 py-2"
      >
        <span className="text-body-sm text-text-muted">Promote to</span>
        {(['Q', 'R', 'B', 'N'] as PromotionType[]).map((p) => (
          <button
            key={p}
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-body-sm font-semibold text-white"
            onClick={() => submit(pendingPromo.from, pendingPromo.to, p)}
          >
            {PROMO_LABEL[p]}
          </button>
        ))}
      </div>
    );
  }

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

  let resignButton = null;
  if (isActive) {
    resignButton = (
      <button
        type="button"
        className="mx-auto rounded-md border border-border px-4 py-1.5 text-body-sm text-text-muted"
        onClick={() => onMove?.(state.round, JSON.stringify({ resign: true }))}
      >
        Resign
      </button>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex h-full min-h-0 flex-col gap-2">
      {/* The two armies + the side to move. Big + legible at 360px. */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2">
        <span className={`flex items-center gap-2 text-body-sm font-semibold ${violetTone}`}>
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full bg-primary ring-1 ring-primary-active"
          />
          Violet
        </span>
        <span className={`flex items-center gap-2 text-body-sm font-semibold ${amberTone}`}>
          Amber
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full bg-accent ring-1 ring-accent-strong"
          />
        </span>
      </div>

      <p className="text-center text-body-sm text-text-muted" role="status" aria-live="polite">
        {turnLine}
      </p>

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

        {/* Promotion picker: raised when a pawn move reaches the last rank; pick the piece to promote. */}
        {promoPicker}

        {rejectedBanner}
      </div>

      {/* Resign concedes the game to the other side. Only offered on the local player's turn. */}
      {resignButton}
    </section>
  );
}

/** Player-facing labels for the promotion choices. */
const PROMO_LABEL: Record<PromotionType, string> = {
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};
