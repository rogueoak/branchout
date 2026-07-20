'use client';

// A read-only replay of a Sketchy sketch (spec 0063). It draws the serialized strokes onto a canvas,
// scaling the fixed logical coordinates (0..CANVAS_SIZE) to the rendered size. Used by the Viewer
// (the shared screen) and by the Remote to re-show the featured sketch while a player writes a decoy
// or guesses. It never captures input - `role="img"` with a label. Mobile-first: it fills its box and
// keeps a square aspect so a doodle reads at ~360px.
//
// The DISPLAY background is a `background` prop (default white). The captured sketch itself carries NO
// background - `drawSketch` clearRects the canvas to transparent and only ever paints stroke lines, so
// the serialized strokes never bake in a color. That keeps this a pure DISPLAY knob: a later change can
// tint the REMOTE's replay a different color while the draw surface and the shared viewer stay white,
// with no effect on what is captured or scored.

import { useEffect, useRef } from 'react';
import { CANVAS_SIZE, type Sketch } from './strokes';

/** Draw every stroke of a sketch onto a 2D context scaled from the logical canvas to `size` px. */
export function drawSketch(ctx: CanvasRenderingContext2D, sketch: Sketch, size: number): void {
  ctx.clearRect(0, 0, size, size);
  const scale = size / CANVAS_SIZE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.012);
  for (const stroke of sketch.strokes) {
    if (stroke.points.length < 2) continue;
    ctx.strokeStyle = stroke.color;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0]! * scale, stroke.points[1]! * scale);
    for (let i = 2; i < stroke.points.length; i += 2) {
      ctx.lineTo(stroke.points[i]! * scale, stroke.points[i + 1]! * scale);
    }
    // A single-point stroke (a dot) still shows as a tiny round cap.
    if (stroke.points.length === 2) {
      ctx.lineTo(stroke.points[0]! * scale + 0.01, stroke.points[1]! * scale + 0.01);
    }
    ctx.stroke();
  }
}

export function SketchReplay({
  sketch,
  label,
  background = '#ffffff',
  gutter = false,
}: {
  sketch: Sketch;
  label: string;
  /** The DISPLAY background behind the strokes (default white). The captured sketch carries NO
   *  background (see the module note), so this only tints the replay surface - it readies a future
   *  colored remote background without changing the serialized strokes. */
  background?: string;
  /** When true, inset the canvas behind a symmetric horizontal gutter with overscroll-x contained, so
   *  a full-width, interactive-adjacent replay never reaches the viewport edge (where a finger would
   *  trigger the browser's back/forward swipe). Off by default so grid/gallery thumbnails are unaffected. */
  gutter?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
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
      drawSketch(ctx, sketch, size);
    };
    draw();
    // Re-draw on resize so the replay stays crisp as the layout changes.
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [sketch]);

  const canvas = (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="aspect-square w-full rounded-lg border border-border"
      style={{ backgroundColor: background }}
    />
  );
  if (!gutter) return canvas;
  return <div className="overscroll-x-contain px-3 sm:px-4">{canvas}</div>;
}
