'use client';

// The Sketchy freehand drawing surface (spec 0063): the interactive canvas the local player draws
// their secret seed on during a draw round. It captures pointer moves into the compact stroke format
// (points on the fixed 0..CANVAS_SIZE logical canvas) and hands the finished sketch up via `onChange`.
// Mobile-first (CLAUDE.md rule 1): it is a square that fills its box and reads at ~360px, uses
// pointer events + pointer capture so a finger that drifts off the small board keeps drawing,
// `touch-action: none` so a drag never scrolls the page, and disables text selection / the iOS
// callout so drawing never pops copy/paste. The canvas sits behind a symmetric horizontal gutter with
// overscroll-x contained, so a finger starting at the screen edge can't trigger the browser's
// back/forward swipe mid-stroke. A small color palette and an Undo + Clear control sit above it.
//
// Undo and Clear are LIMITED and their allowance is PER GAME, not per round: the parent (Remote) owns
// the remaining counts and keeps them across rounds (the per-round reset clears the sketch, not the
// counters). This component only reflects the counts, disables an exhausted control, gates Clear
// behind a confirm dialog (it wipes the drawing and spends the single clear), and reports each spend
// so the parent decrements. The parent owns submission; this only builds the sketch.

import { Button } from '@rogueoak/canopy';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@rogueoak/canopy/branches';
import { PLAYER_PALETTES } from '@branchout/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS_SIZE, type Sketch, type Stroke } from './strokes';
import { drawSketch } from './SketchReplay';

/** A safe on-palette default twig when a palette somehow arrives empty (never in normal play - the
 * Remote always passes a non-empty palette). Uses a real palette color, never an off-palette hex. */
const DEFAULT_TWIG = PLAYER_PALETTES[0]!.colors[0];

/** Undos a player gets for the WHOLE game (not per round). */
export const UNDO_ALLOWANCE = 3;
/** Clears a player gets for the WHOLE game (not per round). */
export const CLEAR_ALLOWANCE = 1;

export function DrawCanvas({
  sketch,
  onChange,
  palette,
  disabled = false,
  undosRemaining,
  clearsRemaining,
  onUndo,
  onClear,
}: {
  sketch: Sketch;
  onChange: (next: Sketch) => void;
  /**
   * The player's OWN claimed palette (spec 0063): the exact set of colors this player may draw with,
   * delivered from the engine per-player. The toolbar shows one swatch per color and nothing else, so
   * a player can only ever draw in their three colors. The first color is the default twig.
   */
  palette: readonly string[];
  disabled?: boolean;
  /** Undos still available this GAME. When 0 the Undo control is disabled. */
  undosRemaining: number;
  /** Clears still available this GAME. When 0 the Clear control is disabled. */
  clearsRemaining: number;
  /** Reports a spent undo so the parent decrements the per-game allowance. */
  onUndo: () => void;
  /** Reports a spent clear so the parent decrements the per-game allowance. */
  onClear: () => void;
}) {
  const [clearOpen, setClearOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState<string>(palette[0] ?? DEFAULT_TWIG);
  // Keep the selected twig on-palette: if the palette changes (a late-arriving claim) and the current
  // color is no longer offered, fall back to the first color.
  useEffect(() => {
    if (!palette.includes(color)) setColor(palette[0] ?? DEFAULT_TWIG);
  }, [palette, color]);
  // The stroke being drawn right now (null between strokes). Kept in a ref so the pointer handlers
  // read the latest without re-subscribing.
  const drawingRef = useRef<Stroke | null>(null);
  const sketchRef = useRef<Sketch>(sketch);
  sketchRef.current = sketch;

  // Redraw whenever the sketch changes (an undo/clear or a committed stroke) or the box resizes.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(1, Math.round(rect.width));
    const px = Math.max(1, Math.round(size * dpr));
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    // getContext can throw in a non-browser test env (jsdom has no canvas backend); ignore it.
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Draw the committed sketch plus the in-progress stroke, so the current line shows live.
    const live: Sketch = {
      strokes: drawingRef.current
        ? [...sketchRef.current.strokes, drawingRef.current]
        : sketchRef.current.strokes,
    };
    drawSketch(ctx, live, size);
  }, []);

  useEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => redraw()) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [redraw, sketch]);

  /** Map a pointer event to a logical [0, CANVAS_SIZE] coordinate, clamped to the canvas. */
  function toLogical(clientX: number, clientY: number): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return [0, 0];
    const clamp = (v: number) => Math.max(0, Math.min(CANVAS_SIZE, Math.round(v)));
    return [
      clamp(((clientX - rect.left) / rect.width) * CANVAS_SIZE),
      clamp(((clientY - rect.top) / rect.height) * CANVAS_SIZE),
    ];
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const [x, y] = toLogical(e.clientX, e.clientY);
    drawingRef.current = { color, points: [x, y] };
    redraw();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || !drawingRef.current) return;
    const [x, y] = toLogical(e.clientX, e.clientY);
    const pts = drawingRef.current.points;
    // Skip a repeat of the last point so the stroke stays compact.
    if (pts[pts.length - 2] !== x || pts[pts.length - 1] !== y) {
      pts.push(x, y);
      redraw();
    }
  }

  function endStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke || stroke.points.length < 2) {
      redraw();
      return;
    }
    onChange({ strokes: [...sketchRef.current.strokes, stroke] });
  }

  const hasStrokes = sketch.strokes.length > 0;
  const canUndo = !disabled && undosRemaining > 0 && hasStrokes;
  const canClear = !disabled && clearsRemaining > 0 && hasStrokes;

  function undo() {
    if (!canUndo) return;
    onChange({ strokes: sketch.strokes.slice(0, -1) });
    onUndo();
  }

  function confirmClear() {
    if (!canClear) return;
    onChange({ strokes: [] });
    onClear();
    setClearOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Twig color">
          {palette.map((c) => {
            const selectedBorder = color === c ? 'border-text' : 'border-border';
            return (
              <button
                key={c}
                type="button"
                aria-label={`Draw in ${c}`}
                aria-pressed={color === c}
                disabled={disabled}
                onClick={() => setColor(c)}
                className={`h-11 w-11 rounded-full border-2 ${selectedBorder}`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="min-h-8 rounded-md border border-border px-2 text-body-sm text-text disabled:opacity-40"
          >
            Undo ({undosRemaining} left)
          </button>
          <ResponsiveDialog open={clearOpen} onOpenChange={setClearOpen}>
            <ResponsiveDialogTrigger asChild>
              <button
                type="button"
                disabled={!canClear}
                className="min-h-8 rounded-md border border-border px-2 text-body-sm text-text disabled:opacity-40"
              >
                Clear ({clearsRemaining} left)
              </button>
            </ResponsiveDialogTrigger>
            <ResponsiveDialogContent>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>Clear your whole sketch?</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  This wipes every twig stroke and spends your one clear for the whole game. You
                  cannot get it back.
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogFooter>
                <ResponsiveDialogClose asChild>
                  <Button type="button" variant="ghost">
                    Keep drawing
                  </Button>
                </ResponsiveDialogClose>
                <Button type="button" variant="destructive" onClick={confirmClear}>
                  Clear sketch
                </Button>
              </ResponsiveDialogFooter>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        </div>
      </div>
      {/* The gutter (px on each side) keeps the touch surface off the viewport edge so an edge-start
          swipe is a draw, not a browser back/forward; overscroll-x-contain is defense-in-depth. */}
      <div className="overscroll-x-contain px-3 sm:px-4">
        <canvas
          ref={canvasRef}
          aria-label="Draw your seed on the bark"
          className="aspect-square w-full touch-none select-none rounded-lg border border-border bg-white"
          style={{
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
      </div>
      <p className="text-caption text-text-subtle">
        {UNDO_ALLOWANCE} undos and {CLEAR_ALLOWANCE} clear for the whole game - use them wisely.
      </p>
    </div>
  );
}
