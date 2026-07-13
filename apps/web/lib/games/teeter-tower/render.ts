// Shared canvas-rendering helpers and world constants for the Teeter Tower renderer (spec 0044).
// The browser runs NO physics - it draws the server-streamed live world-space geometry. These
// constants mirror the engine's world (packages/games/teeter-tower/src/levels.ts) so the client's
// coordinate space matches exactly what the server simulated. Chrome colors read Branch Out theme
// tokens at render time (the canvas needs concrete color strings, so we resolve the CSS custom
// properties); the piece palette stays the engine's bright cosmetics, which arrive per body on the wire.

import type { Body, Eye, Piece, Vec2 } from './protocol';

// World constants (mirror packages/games/teeter-tower/src/levels.ts).
export const VIEW_W = 820;
export const VIEW_H = 620;
/** y of the platform's top surface. */
export const GROUND_TOP = 540;
export const PLATFORM_W = 480;
export const PLATFORM_H = 60;
export const CENTER_X = VIEW_W / 2; // 410
/** The horizontal half-range (from center) a drop position may occupy (mirrors DROP_HALF_RANGE). */
export const DROP_HALF_RANGE = PLATFORM_W / 2 + 90;

/** The chrome colors the renderer paints non-piece scenery with, resolved from theme tokens. */
export interface ChromeColors {
  skyTop: string;
  skyBottom: string;
  platformFill: string;
  platformStroke: string;
  target: string;
  band: string;
  bandText: string;
  dropLine: string;
  text: string;
}

/**
 * Resolve the theme tokens into concrete color strings for the canvas. Reads the CSS custom
 * properties off the given element's computed style (they cascade from :root / .dark), falling back
 * to sane on-brand values when a token is unset (e.g. during SSR/first paint before styles apply).
 */
export function resolveChrome(el: Element | null): ChromeColors {
  const read = (name: string, fallback: string): string => {
    if (!el || typeof window === 'undefined') return fallback;
    const value = getComputedStyle(el).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    // A cool dusk gradient built from the theme surface tones so the canvas sits in the app's palette.
    skyTop: read('--color-bg', '#1b2233'),
    skyBottom: read('--color-surface', '#2c3550'),
    platformFill: read('--color-surface-raised', '#3a2f2a'),
    platformStroke: read('--color-border-strong', '#221a16'),
    target: read('--color-accent', '#ffd166'),
    band: 'rgba(255,255,255,0.16)',
    bandText: 'rgba(255,255,255,0.5)',
    dropLine: read('--color-danger', '#ff5c7a'),
    text: read('--color-text', '#f4f4f5'),
  };
}

/**
 * Set up the canvas transform so drawing happens in world coordinates, scaled to the element size and
 * panned by the vertical camera (`cameraY`). The camera shifts the visible world window up as the
 * tower grows (a smaller/negative `cameraY` reveals higher world-y-negative space), like the prototype.
 */
export function withWorldTransform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  cameraY = 0,
): void {
  // Map the VIEW_W x VIEW_H world onto the device-pixel canvas, letterboxed to preserve aspect.
  const scale = Math.min(width / VIEW_W, height / VIEW_H);
  const offsetX = (width - VIEW_W * scale) / 2;
  const offsetY = (height - VIEW_H * scale) / 2;
  // cameraY is a world-space vertical pan: subtract it so a negative cameraY moves the world down on
  // screen (revealing the upward-growing tower).
  ctx.setTransform(
    scale * dpr,
    0,
    0,
    scale * dpr,
    offsetX * dpr,
    (offsetY - cameraY * scale) * dpr,
  );
}

/** Paint the sky gradient behind everything. Drawn in screen space so it fills regardless of camera. */
export function drawSky(ctx: CanvasRenderingContext2D, chrome: ChromeColors, cameraY = 0): void {
  const g = ctx.createLinearGradient(0, cameraY, 0, cameraY + VIEW_H);
  g.addColorStop(0, chrome.skyTop);
  g.addColorStop(1, chrome.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, cameraY, VIEW_W, VIEW_H);
}

/** Paint the static platform the tower stacks on. */
export function drawPlatform(ctx: CanvasRenderingContext2D, chrome: ChromeColors): void {
  ctx.fillStyle = chrome.platformFill;
  ctx.strokeStyle = chrome.platformStroke;
  ctx.lineWidth = 2;
  const x = CENTER_X - PLATFORM_W / 2;
  ctx.fillRect(x, GROUND_TOP, PLATFORM_W, PLATFORM_H);
  ctx.strokeRect(x, GROUND_TOP, PLATFORM_W, PLATFORM_H);
}

/** Paint the dashed score bands (25/50/75%) and the target line (100 pts), ported from the prototype. */
export function drawTargetBands(
  ctx: CanvasRenderingContext2D,
  chrome: ChromeColors,
  target: number,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = "11px 'Trebuchet MS', system-ui, sans-serif";
  for (let i = 1; i <= 3; i++) {
    const y = GROUND_TOP - (target * i) / 4;
    ctx.strokeStyle = chrome.band;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIEW_W, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = chrome.bandText;
    ctx.fillText(`${i * 25} pts`, 10, y - 4);
  }

  const ty = GROUND_TOP - target;
  ctx.setLineDash([12, 8]);
  ctx.strokeStyle = chrome.target;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, ty);
  ctx.lineTo(VIEW_W, ty);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = chrome.target;
  ctx.font = "bold 14px 'Trebuchet MS', system-ui, sans-serif";
  ctx.fillText('TARGET - 100 pts', 10, ty - 8);
  ctx.restore();
}

/**
 * Draw the dashed minimum-drop line (the required-drop line, a world-y) plus a soft forbidden-zone
 * gradient below it, ported from the prototype. The active player must drop with the piece's bottom
 * ABOVE this line (`bottom.y < requiredLine`).
 */
export function drawRequiredLine(
  ctx: CanvasRenderingContext2D,
  chrome: ChromeColors,
  requiredLine: number,
): void {
  ctx.save();
  const grad = ctx.createLinearGradient(0, requiredLine, 0, requiredLine + 140);
  grad.addColorStop(0, 'rgba(239,71,111,0.30)');
  grad.addColorStop(1, 'rgba(239,71,111,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, requiredLine, VIEW_W, 140);
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = chrome.dropLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, requiredLine);
  ctx.lineTo(VIEW_W, requiredLine);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = chrome.dropLine;
  ctx.font = "bold 13px 'Trebuchet MS', system-ui, sans-serif";
  ctx.fillText('drop above this line', VIEW_W - 170, requiredLine + 18);
  ctx.restore();
}

/**
 * Draw one body's polygon loops at a world transform, filling with its skin and drawing its googly
 * eyes. `verts` are LOCAL loops; the caller supplies world `x`/`y`/`angle`. `vel` biases the pupils
 * so they track "downward" (toward gravity, nudged by motion) like the prototype's drawEyes. An
 * optional `override` fill/stroke tints the piece (the aim ghost turns red when the drop is illegal).
 */
export function drawBody(
  ctx: CanvasRenderingContext2D,
  verts: Vec2[][],
  eyes: Eye[],
  skin: { fill: string; stroke: string },
  x: number,
  y: number,
  angle: number,
  vel: Vec2 = { x: 0, y: 0 },
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = skin.fill;
  ctx.strokeStyle = skin.stroke;
  ctx.lineWidth = 2;
  for (const loop of verts) {
    if (loop.length === 0) continue;
    ctx.beginPath();
    const first = loop[0]!;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < loop.length; i++) {
      const p = loop[i]!;
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // Eyes are drawn in world space (unrotated pupils) so they read as googly and track gravity.
  ctx.save();
  ctx.globalAlpha = alpha;
  drawEyes(ctx, eyes, x, y, angle, vel);
  ctx.restore();
}

/** Draw the googly eyes for a body whose centroid is at world `(px, py)` rotated by `angle`. */
export function drawEyes(
  ctx: CanvasRenderingContext2D,
  eyes: Eye[],
  px: number,
  py: number,
  angle: number,
  vel: Vec2,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const e of eyes) {
    const wx = px + e.x * cos - e.y * sin;
    const wy = py + e.x * sin + e.y * cos;

    // Pupil looks "down" (toward gravity), nudged by the body's motion.
    let dx = vel.x * 0.25;
    let dy = 1 + vel.y * 0.25;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const off = e.r * 0.42;

    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(wx, wy, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = '#1a1a1a';
    ctx.arc(wx + dx * off, wy + dy * off, e.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draw the whole live tower (each body world-space), with still (velocity-free) eyes. */
export function drawTower(ctx: CanvasRenderingContext2D, tower: Body[]): void {
  for (const b of tower) {
    drawBody(ctx, b.verts, b.eyes, b.skin, b.x, b.y, b.angle);
  }
}

/** Clamp a drop x to the legal horizontal range around center (mirrors the engine's clampDropX). */
export function clampDropX(x: number): number {
  return Math.max(CENTER_X - DROP_HALF_RANGE, Math.min(CENTER_X + DROP_HALF_RANGE, x));
}

/**
 * The world-space vertical extent of a piece's LOCAL geometry once rotated by `angle` (min/max of the
 * rotated y of every vertex, relative to the centroid). The piece's world bottom at centroid-y `cy`
 * is `cy + halfSpan.max`; used to clamp `dropY` so the bottom stays above the required line.
 */
export function rotatedYSpan(piece: Piece, angle: number): { min: number; max: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let min = Infinity;
  let max = -Infinity;
  for (const loop of piece.verts) {
    for (const p of loop) {
      const ry = p.x * sin + p.y * cos;
      min = Math.min(min, ry);
      max = Math.max(max, ry);
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 };
  return { min, max };
}
