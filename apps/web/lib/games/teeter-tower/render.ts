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

/** World headroom above the target line for the spinning aim piece + breathing room at the top. */
const AIM_HEADROOM = 130;
/** World y just below the platform - the bottom edge of the view. */
const VIEW_BOTTOM = GROUND_TOP + PLATFORM_H + 24;

/** The world->screen mapping for a level: `screenX = worldX*scale + originX`, same for y. */
export interface LevelView {
  scale: number;
  originX: number;
  originY: number;
  /** World y at the top edge of the view (a bit above the target line). */
  top: number;
  /** World y at the bottom edge of the view (just below the platform). */
  bottom: number;
}

/**
 * Fit the CURRENT LEVEL's full height - from just below the platform up to above the target line -
 * into the canvas, centered horizontally, at a uniform scale (pieces keep their aspect). The whole
 * level fits, so the tower fills the vertical space with no camera pan; a taller canvas simply scales
 * the level up. The tower is centered, so the platform's edges may fall outside the canvas width - the
 * action is always in the middle.
 */
export function levelView(cssW: number, cssH: number, target: number): LevelView {
  const top = GROUND_TOP - target - AIM_HEADROOM;
  const bottom = VIEW_BOTTOM;
  const scale = cssH > 0 ? cssH / (bottom - top) : 1;
  return { scale, originX: cssW / 2 - CENTER_X * scale, originY: -top * scale, top, bottom };
}

/** Apply a {@link LevelView} to the canvas context (accounting for device pixel ratio). */
export function applyLevelTransform(
  ctx: CanvasRenderingContext2D,
  v: LevelView,
  dpr: number,
): void {
  ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.originX * dpr, v.originY * dpr);
}

/** The leftmost world x currently visible under a {@link LevelView} (for placing edge labels). */
export function visibleLeftX(v: LevelView): number {
  return -v.originX / v.scale;
}

/**
 * Paint the sky gradient behind everything, in SCREEN space so it always fills the whole canvas
 * regardless of the level fit. Resets to the device-pixel transform, then restores nothing (the caller
 * sets the world transform next).
 */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  chrome: ChromeColors,
  cssW: number,
  cssH: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, cssH);
  g.addColorStop(0, chrome.skyTop);
  g.addColorStop(1, chrome.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cssW, cssH);
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
  labelX = 10,
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
    ctx.fillText(`${i * 25} pts`, labelX, y - 4);
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
  ctx.fillText('TARGET - 100 pts', labelX, ty - 8);
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
  labelX = VIEW_W - 170,
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
  ctx.fillText('drop above this line', labelX, requiredLine + 18);
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

/** Stroke a rounded-rectangle path (helper for the screen-space HUD pill). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Draw the compact level/height/score HUD as a screen-space pill in the top-left. Resets to the screen
 * transform (undoing any world transform) so it stays pinned regardless of the camera. `text` holds 1-2
 * short lines (e.g. `['Lv 1 - Warm-up', '258/600 px   50 pts']`).
 */
export function drawHudOverlay(
  ctx: CanvasRenderingContext2D,
  chrome: ChromeColors,
  dpr: number,
  text: string[],
): void {
  const lines = text.filter((t) => t.length > 0);
  if (lines.length === 0) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "12px 'Trebuchet MS', system-ui, sans-serif";
  ctx.textBaseline = 'middle';
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);
  const padX = 10;
  const padY = 7;
  const lineH = 16;
  const x = 8;
  const y = 8;
  const w = maxW + padX * 2;
  const h = lines.length * lineH + padY * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.fillStyle = chrome.text;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, x + padX, y + padY + lineH * i + lineH / 2);
  }
  ctx.restore();
}

/**
 * Draw the turn/aim hint as centered screen-space text near the top-center, with a text-shadow so it
 * reads over the sky. Resets to the screen transform. `cssW`/`cssH` are the canvas CSS pixel size.
 */
export function drawHintOverlay(
  ctx: CanvasRenderingContext2D,
  chrome: ChromeColors,
  dpr: number,
  cssW: number,
  cssH: number,
  text: string,
): void {
  if (!text) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "600 13px 'Trebuchet MS', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = chrome.text;
  // Pinned bottom-center so it never crowds the top HUD pill or the spinning aim piece.
  ctx.fillText(text, cssW / 2, cssH - 20, cssW - 24);
  ctx.restore();
}
