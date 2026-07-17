'use client';

// The Checkers single interactive surface (spec 0055). Checkers is a LIVE-model board game with
// PERFECT information: the engine streams the whole board on the `sim` frame and this ONE canvas is the
// whole game - it renders the streamed board and, when it is the local player's turn, lets the player
// TAP a piece to select it, then tap a highlighted destination to move (or jump). It runs no rules;
// the server validates + applies every move.
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

/** The color name shown to players for each side. */
const SIDE_LABEL: Record<'violet' | 'amber', string> = { violet: 'Violet', amber: 'Amber' };

function nicknameOf(state: GameViewProps['state'], id: string): string {
  return state.players.find((player) => player.player === id)?.nickname ?? id;
}

/** Map an engine rejection reason to player-clear copy. */
function rejectionMessage(reason: string): string {
  const map: Record<string, string> = {
    'not your turn': 'Hold tight - it is not your turn yet.',
    'illegal move': 'That move is not allowed - if a jump is available you must take it.',
    'malformed move': 'That did not send cleanly - tap a piece, then a highlighted square.',
    'game over': 'The game is finished - no more moves.',
  };
  return map[reason] ?? 'That move did not land - tap a piece, then a highlighted square.';
}

/** The color/rank of a wire cell, or null for an empty square. */
function pieceOf(cell: WireCell): { color: 'violet' | 'amber'; king: boolean } | null {
  if (cell === 'empty') return null;
  const king = cell.endsWith('-king');
  const color = (king ? cell.slice(0, -'-king'.length) : cell) as 'violet' | 'amber';
  return { color, king };
}

/** Draw one checker piece filling a cell box; a king gets a gold crown ring. */
function drawPiece(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; size: number },
  fill: string,
  rim: string,
  king: boolean,
  crown: string,
): void {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const r = box.size * 0.36;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, box.size * 0.06);
  ctx.strokeStyle = rim;
  ctx.stroke();
  if (king) {
    // A crowned king wears an inner gold ring (the family gold-root tone) so its rank is unmistakable.
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, box.size * 0.05);
    ctx.strokeStyle = crown;
    ctx.stroke();
  }
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

/** Draw the whole board: wood-grain squares, pieces, and the active player's selection + hints. */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  sim: CheckersSim,
  layout: BoardLayout,
  chrome: BoardChrome,
  selected: Coord | null,
  showHints: boolean,
): void {
  const sources = showHints ? movableSources(sim) : new Set<string>();
  const targets = showHints ? destinationsFor(sim, selected) : new Set<string>();
  const hintColor = sim.toMove === 'amber' ? chrome.amber : chrome.violet;
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

      const cell: WireCell = sim.cells[row * sim.size + col] ?? 'empty';
      const piece = pieceOf(cell);
      if (piece) {
        const fill = piece.color === 'violet' ? chrome.violet : chrome.amber;
        const rim = piece.color === 'violet' ? chrome.violetRim : chrome.amberRim;
        drawPiece(ctx, box, fill, rim, piece.king, chrome.crown);
        // Ring a selected source, or a movable source (a subtle affordance) on the active turn.
        if (isSelected || (showHints && sources.has(key))) {
          const cx = box.x + box.size / 2;
          const cy = box.y + box.size / 2;
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

  // Clear a stale selection when the turn moves away from me or the game ends (so a leftover ring does
  // not linger on the other player's move).
  useEffect(() => {
    if (!isActive && selected) setSelected(null);
  }, [isActive, selected]);

  // The single draw loop: redraw the board whenever the sim (or selection) changes. A rAF loop keeps
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
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, rect.width, rect.height);
          const layout = layoutBoard(rect.width, rect.height, live.size);
          const chrome = resolveBoardChrome(canvas);
          drawBoard(ctx, live, layout, chrome, selectedRef.current, isActiveRef.current);
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

  const turnLine = sim?.over
    ? sim?.outcome
      ? `Game over - ${SIDE_LABEL[sim.outcome]} wins.`
      : 'Game over.'
    : isActive
      ? `Your turn (${toMove ? SIDE_LABEL[toMove] : ''}) - tap a piece, then a highlighted square.`
      : activeName
        ? `Waiting for ${activeName} (${toMove ? SIDE_LABEL[toMove] : ''}).`
        : 'Waiting for the next move.';

  return (
    // Fill the single-surface stage height so the whole board fits the viewport without page scroll.
    <section aria-label="Game viewer" className="flex h-full min-h-0 flex-col gap-2">
      {/* Scoreboard: the two piece counts, the side to move called out. Big + legible at 360px. */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2">
        <span
          className={`flex items-center gap-2 text-body-sm font-semibold ${
            highlightViolet ? 'text-primary' : 'text-text'
          }`}
        >
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full bg-primary ring-1 ring-primary-active"
          />
          Violet {violet}
        </span>
        <span
          className={`flex items-center gap-2 text-body-sm font-semibold ${
            highlightAmber ? 'text-accent-strong' : 'text-text'
          }`}
        >
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
          aria-label={
            isActive ? 'Tap a piece, then a highlighted square to move' : 'Checkers board'
          }
          role="img"
          className="block h-full w-full"
        />
        {state.rejected ? (
          <p
            role="alert"
            className="absolute inset-x-0 top-2 mx-2 rounded-md bg-danger/90 px-3 py-1.5 text-center text-body-sm text-white"
          >
            {rejectionMessage(state.rejected)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
