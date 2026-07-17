'use client';

// The Sketchy freehand drawing surface (spec 0063): the interactive canvas the local player draws
// their secret seed on during a draw round. It captures pointer moves into the compact stroke format
// (points on the fixed 0..CANVAS_SIZE logical canvas) and hands the finished sketch up via `onChange`.
// Mobile-first (CLAUDE.md rule 1): it is a square that fills its box and reads at ~360px, uses
// pointer events + pointer capture so a finger that drifts off the small board keeps drawing,
// `touch-action: none` so a drag never scrolls the page, and disables text selection / the iOS
// callout so drawing never pops copy/paste. A small color palette and an Undo + Clear control sit
// above it. The parent owns submission; this only builds the sketch.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS_SIZE, STROKE_COLORS, type Sketch, type Stroke } from './strokes';
import { drawSketch } from './SketchReplay';

export function DrawCanvas({
  sketch,
  onChange,
  disabled = false,
}: {
  sketch: Sketch;
  onChange: (next: Sketch) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState<string>(STROKE_COLORS[0]);
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

  function undo() {
    if (disabled || sketch.strokes.length === 0) return;
    onChange({ strokes: sketch.strokes.slice(0, -1) });
  }

  function clear() {
    if (disabled || sketch.strokes.length === 0) return;
    onChange({ strokes: [] });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Twig color">
          {STROKE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Draw in ${c}`}
              aria-pressed={color === c}
              disabled={disabled}
              onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-full border-2 ${
                color === c ? 'border-text' : 'border-border'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={disabled || sketch.strokes.length === 0}
            className="min-h-8 rounded-md border border-border px-2 text-body-sm text-text disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={disabled || sketch.strokes.length === 0}
            className="min-h-8 rounded-md border border-border px-2 text-body-sm text-text disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>
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
  );
}
