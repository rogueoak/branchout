'use client';

// The Teeter Tower single interactive surface (spec 0044). Teeter is a LIVE game: the engine steps a
// continuously-running world and streams a `TeeterSim` on the `sim` frame (~25x/sec). This ONE canvas
// is the whole game - it renders the streamed live tower and, when it is the local player's turn,
// lets them aim + drop the next piece directly on the canvas. It runs no physics; the server is
// authoritative.
//
// Rendering: a single rAF loop draws every animation frame. It INTERPOLATES between the last two
// received sim snapshots by wall-clock time, so the ~25 fps stream looks smooth (the tower visibly
// sways / settles / topples as the stream changes). A vertical camera pans up to follow the tower top.
//
// Aim flow (feedback 0023), only when `me === sim.activePlayer` and `sim.next` exists. The CANVAS only
// ever MOVES the piece (tap/drag sets the drop position); a top-right on-canvas button drives the phase:
//   1. 'spinning': the piece spins locally (spinSeed via rAF) AND sits at the pointer - tap/drag the
//      canvas to reposition it repeatedly. The top-right button reads "Stop spin".
//   2. Tapping "Stop spin" LOCKS the current on-screen angle and switches to 'placing'. The piece keeps
//      following the pointer (x and y), clamped so its bottom stays ABOVE the required line and its x
//      within the platform range; it ghosts + turns red when the drop would be below the line.
//   3. The top-right button now reads "Drop"; tapping it submits onMove(round, JSON.stringify({ angle,
//      dropX, dropY })). No re-aim - we wait for the stream to land it and present the next piece.
// Mobile-first (CLAUDE.md rule #1): the surface fills the viewport height and the canvas fits WIDTH
// (a taller canvas shows more of the tower, no letterbox), reads well at ~360px wide, uses big tap
// targets and pointer capture + touch-action:none so a drag never scrolls the page, and disables text
// selection / the iOS callout so aiming by drag never pops copy/paste. The level/height/score HUD and
// the turn/aim hint are drawn ON the canvas (screen-space overlays) rather than as DOM rows.

import { useEffect, useRef, useState } from 'react';
import type { GameViewProps } from '../registry';
import { asTeeterSim, type Body, type Piece, type TeeterSim } from './protocol';
import {
  CENTER_X,
  GROUND_TOP,
  applyLevelTransform,
  clampDropX,
  drawBody,
  drawHintOverlay,
  drawHudOverlay,
  drawPlatform,
  drawRequiredLine,
  drawSky,
  drawTargetBands,
  drawTower,
  levelView,
  resolveChrome,
  rotatedYSpan,
  visibleLeftX,
} from './render';

const LEVEL_NAMES = ['Warm-up', 'Reach for the sky', 'The Pendulum'];

/**
 * The local aim phase for the active player (feedback 0023): the piece is spinning (the canvas moves
 * it while it spins) or its angle is locked and it is being placed. The button (now ABOVE the canvas,
 * feedback 0025) transitions between them ("Stop spin" -> 'placing') and finally drops ("Drop"). A
 * tap/drag on the canvas moves the piece; a double-tap (double-click) is a shortcut for the button.
 */
type AimPhase = 'spinning' | 'placing';

/**
 * Double-tap shortcut tuning (feedback 0025). A "tap" is a quick press that barely moves; two taps
 * within `DOUBLE_TAP_MS` fire the aim button. A drag (moves past `TAP_MAX_MOVE_PX`) or a long press
 * (over `TAP_MAX_MS`) is not a tap and breaks the sequence, so aiming never trips the shortcut.
 */
const DOUBLE_TAP_MS = 320;
const TAP_MAX_MS = 250;
const TAP_MAX_MOVE_PX = 12;

/** The default world-y a fresh piece starts at (high + centered, so it reads clearly above the tower). */
const DEFAULT_AIM_Y = GROUND_TOP - 300;

/** Interpolate one transform between two snapshots at fraction `f` (0..1). */
function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** The shortest-arc angle interpolation (so a wrap across +/-PI does not spin the long way). */
function lerpAngle(a: number, b: number, f: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

/**
 * Interpolate the tower bodies between the previous and current sim by fraction `f`. Bodies matched
 * by id lerp their transform; a body only in the newer snapshot (a piece that just landed) or only in
 * the older one snaps to whichever exists.
 */
function interpolateBodies(prev: Body[], cur: Body[], f: number): Body[] {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  return cur.map((c) => {
    const p = prevById.get(c.id);
    if (!p) return c;
    return {
      ...c,
      x: lerp(p.x, c.x, f),
      y: lerp(p.y, c.y, f),
      angle: lerpAngle(p.angle, c.angle, f),
    };
  });
}

function nicknameOf(state: GameViewProps['state'], id: string): string {
  return state.players.find((player) => player.player === id)?.nickname ?? id;
}

/**
 * Translate an engine rejection reason into player-clear copy. The engine's raw reasons read like
 * internal verdicts ("not your turn", "drop above the required line", ...); rendered verbatim they can
 * confuse. This maps the known reasons to friendly, self-contained lines and falls back to a generic
 * nudge for anything unexpected.
 */
function rejectionMessage(reason: string): string {
  const map: Record<string, string> = {
    'not your turn': 'Hold tight - it is not your turn yet.',
    'drop above the required line': 'Drop it higher, above the marked line.',
    'piece overlaps the tower': 'That spot is blocked - nudge it over and try again.',
    'malformed move': 'That did not send cleanly - aim and drop again.',
    'game over': 'The tower is finished - nothing left to drop.',
    'tower is full': 'The tower is packed full - no room for another piece.',
  };
  return map[reason] ?? 'That drop did not land - aim and drop again.';
}

export function TeeterViewer({ state, me, onMove }: GameViewProps) {
  const sim = asTeeterSim(state.sim);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The active player's local aim state. `angle` is the locked drop angle; `pointer` is the latest
  // world-space pointer position the piece follows in BOTH phases. A spinning piece has no locked angle
  // yet (the top-right "Stop spin" button locks it). The default sits high + centered so the fresh
  // piece reads clearly above the tower before the player moves it.
  const [aim, setAim] = useState<AimPhase>('spinning');
  const [angle, setAngle] = useState(0);
  const [pointer, setPointer] = useState<{ x: number; y: number }>({
    x: CENTER_X,
    y: DEFAULT_AIM_Y,
  });
  // The `sim.next` id we last aimed at, so a new piece (new id) resets the aim UI to spinning.
  const [aimedPieceId, setAimedPieceId] = useState<number | null>(null);
  // True from the moment we submit a drop until the stream presents a new piece id - so we stop
  // spinning/aiming while the drop is in flight and the piece is landing.
  const [dropped, setDropped] = useState(false);
  // Whether this device is touch-first (`pointer: coarse`), so the onboarding hint says "Double tap"
  // vs "Click". Resolved on mount (SSR has no matchMedia); defaults to the mouse copy.
  const [isCoarse, setIsCoarse] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      setIsCoarse(window.matchMedia('(pointer: coarse)').matches);
    }
  }, []);

  const me_ = me ?? '';
  const isActive = sim != null && !sim.over && sim.next != null && sim.activePlayer === me_;
  const nextId = sim?.next?.id ?? null;

  // A new aim piece (or losing the turn) resets the local aim UI.
  useEffect(() => {
    if (nextId !== aimedPieceId) {
      setAimedPieceId(nextId);
      setAim('spinning');
      setAngle(0);
      setDropped(false);
      setPointer({ x: CENTER_X, y: DEFAULT_AIM_Y });
    }
  }, [nextId, aimedPieceId]);

  // Refs the draw loop reads without re-subscribing rAF each render. The loop stays stable for the
  // component's life; refs carry the changing sim, aim, and pointer into it.
  const simRef = useRef<TeeterSim | null>(sim);
  const prevSimRef = useRef<TeeterSim | null>(null);
  const simArrivedRef = useRef<number>(0);
  const prevArrivedRef = useRef<number>(0);

  const aimRef = useRef(aim);
  aimRef.current = aim;
  const angleRef = useRef(angle);
  angleRef.current = angle;
  // True only while a press-drag is in progress (pointer down on the board). The piece follows the
  // pointer during a drag, NOT on a bare hover: on a mouse, moving the cursor up to tap the top-right
  // Stop-spin/Drop button would otherwise re-aim the piece to the button's corner right before the
  // drop lands. Touch has no hover so this never bit mobile, but it breaks the desktop/responsive path.
  const draggingRef = useRef(false);
  // Double-tap tracking (feedback 0025): the current press's start (time + screen pos) and the time of
  // the last completed tap, so releaseCapture can tell a tap from a drag and pair two taps.
  const pressStartRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastTapRef = useRef(0);
  const pointerRef = useRef(pointer);
  pointerRef.current = pointer;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const droppedRef = useRef(dropped);
  droppedRef.current = dropped;
  // The turn/aim hint text the draw loop paints as a screen-space overlay (computed below from state).
  const hintRef = useRef('');
  // The live spin angle the draw loop advances, so the angle "Stop spin" locks is exactly the one on
  // screen. Read by both the draw loop and the stop-spin handler.
  const spinAngleRef = useRef(0);

  // Fold each new sim snapshot into the interpolation buffer: keep the previous snapshot + its arrival
  // time so the draw loop can lerp between them by wall-clock. A brand-new object identity (the reducer
  // replaces `sim` each frame) marks a fresh arrival.
  useEffect(() => {
    if (!sim) return;
    if (simRef.current !== sim) {
      prevSimRef.current = simRef.current;
      prevArrivedRef.current = simArrivedRef.current;
      simRef.current = sim;
      simArrivedRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
  }, [sim]);

  // Clamp the aim piece's centroid at a given angle so its rotated bottom stays above the required line
  // and its x stays in the platform range. Returns the drawable transform + whether the drop is legal.
  // Used in BOTH phases (the spinning piece and the placing ghost both follow the pointer): pass the
  // live spin angle while spinning, the locked angle while placing.
  function placedTransform(
    piece: Piece,
    live: TeeterSim,
    angleAt: number,
  ): { x: number; y: number; legal: boolean; rawBottom: number } {
    const span = rotatedYSpan(piece, angleAt);
    const x = clampDropX(pointerRef.current.x, live.platform.width);
    // The piece bottom (centroid y + rotated max) must be strictly above requiredLine (smaller y).
    const rawBottom = pointerRef.current.y + span.max;
    const legal = rawBottom < live.requiredLine;
    // Clamp the drawn y so the ghost never sinks below the line (a small margin keeps it readable).
    const maxCentroidY = live.requiredLine - span.max - 1;
    const y = Math.min(pointerRef.current.y, maxCentroidY);
    return { x, y, legal, rawBottom };
  }

  // The single draw loop: interpolate + draw the live tower every frame, follow the tower top with the
  // camera, and (when active) overlay the spinning / placing aim piece.
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
          // Interpolate the tower between the previous and current snapshot by wall-clock time. The
          // stream is ~25 fps (40ms/frame); ease toward the newest over that window for smooth sway.
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const prev = prevSimRef.current;
          const span = simArrivedRef.current - prevArrivedRef.current;
          const f =
            prev && span > 0 ? Math.max(0, Math.min(1, (now - simArrivedRef.current) / span)) : 1;
          const bodies = prev ? interpolateBodies(prev.bodies, live.bodies, f) : live.bodies;

          // Fit a FIXED reference height into the canvas (feedback 0023), centered horizontally at a
          // uniform scale, so the tower fills the vertical space with no camera pan AND lowering a
          // level's target does not zoom the view - the target line just moves within an unchanging fit.
          const view = levelView(rect.width, rect.height);
          const labelX = visibleLeftX(view) + 12;

          const chrome = resolveChrome(canvas);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawSky(ctx, chrome, rect.width, rect.height, dpr);
          applyLevelTransform(ctx, view, dpr);
          drawTargetBands(ctx, chrome, live.target, labelX);
          drawPlatform(ctx, chrome, live.platform.width, live.platform.walls);
          drawTower(ctx, bodies);

          // The aim overlay for the active player who has not yet dropped. In BOTH phases the piece
          // FOLLOWS THE POINTER (feedback 0023) - the canvas moves it; the top-right button changes the
          // phase. Spinning advances the live angle; placing uses the locked angle. Both clamp above the
          // required line + within the platform range so the piece always previews a droppable pose.
          if (isActiveRef.current && !droppedRef.current && live.next) {
            const piece = live.next;
            // Draw the min-drop line + forbidden zone in BOTH phases, so the "drop above this line" rule
            // is visible from the first frame - not only once the spin is stopped.
            drawRequiredLine(ctx, chrome, live.requiredLine, labelX);
            const spinning = aimRef.current === 'spinning';
            if (spinning) spinAngleRef.current += piece.spinSeed;
            const drawAngle = spinning ? spinAngleRef.current : angleRef.current;
            const t = placedTransform(piece, live, drawAngle);
            const skin =
              spinning || t.legal ? piece.skin : { fill: '#c23b52', stroke: chrome.dropLine };
            // A drop guide line from the piece down to the platform, so the landing spot reads clearly.
            ctx.save();
            ctx.strokeStyle = chrome.dropLine;
            ctx.setLineDash([8, 8]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(t.x, t.y);
            ctx.lineTo(t.x, GROUND_TOP);
            ctx.stroke();
            ctx.restore();
            drawBody(
              ctx,
              piece.verts,
              piece.eyes,
              skin,
              t.x,
              t.y,
              drawAngle,
              { x: 0, y: 0 },
              spinning ? 0.9 : 0.85,
            );
          }

          // Screen-space overlays (reset transform inside each helper): the compact round/score HUD pill
          // top-left, and the turn/aim hint centered near the top. These replace the old DOM badge rows
          // so the canvas keeps all the vertical space (feedback 0022 #6). Points only, no px readout,
          // and "Round" not "Level" (feedback 0025).
          const lvl = live.level;
          const hud = [
            `Round ${lvl + 1} - ${LEVEL_NAMES[lvl] ?? `Round ${lvl + 1}`}`,
            `${live.score} pts`,
          ];
          drawHudOverlay(ctx, chrome, dpr, hud);
          drawHintOverlay(ctx, chrome, dpr, rect.width, rect.height, hintRef.current);
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Map a pointer event to world coordinates. Mirrors the level-fit draw transform exactly: inverse of
  // `applyLevelTransform` for the current target, so a tap lands where it looks. `worldX = (screenX -
  // originX)/scale`, `worldY = (screenY - originY)/scale`.
  function pointerToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return pointerRef.current;
    const rect = canvas.getBoundingClientRect();
    // A zero-sized rect (not laid out yet, e.g. jsdom) has no meaningful mapping; keep the last pointer.
    if (!(rect.width > 0 && rect.height > 0)) return pointerRef.current;
    const view = levelView(rect.width, rect.height);
    return {
      x: (clientX - rect.left - view.originX) / view.scale,
      y: (clientY - rect.top - view.originY) / view.scale,
    };
  }

  // The CANVAS MOVES the piece (a tap/drag sets the drop position in both phases) and a DOUBLE-TAP is a
  // shortcut for the aim button above it (feedback 0025). It never single-tap-drops - so a stray tap
  // only repositions, while a deliberate double-tap stops the spin / drops.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!isActive || dropped) return;
    // Capture the pointer so a finger that drifts off a small (~360px) board mid-drag keeps tracking
    // (guarded: jsdom / older engines may not implement pointer capture).
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    pressStartRef.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    setPointer(pointerToWorld(e.clientX, e.clientY));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    // Only track a real press-drag, never a bare hover: a mouse moving to the button must not re-aim the
    // piece (touch has no hover, so this only affects the desktop/responsive path).
    if (!isActive || dropped || !draggingRef.current) return;
    setPointer(pointerToWorld(e.clientX, e.clientY));
  }

  function releaseCapture(e: React.PointerEvent<HTMLDivElement>): void {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    // Double-tap detection: a quick press that barely moved is a tap; two taps close in time fire the
    // aim button. A drag or long press breaks the pairing so aiming never trips the shortcut.
    const start = pressStartRef.current;
    pressStartRef.current = null;
    if (!isActive || dropped || !start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    const isTap = e.timeStamp - start.t <= TAP_MAX_MS && moved <= TAP_MAX_MOVE_PX;
    if (!isTap) {
      lastTapRef.current = 0;
      return;
    }
    if (e.timeStamp - lastTapRef.current <= DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      handleAimButton();
    } else {
      lastTapRef.current = e.timeStamp;
    }
  }

  // The top-right button: 'spinning' -> STOP the spin (lock the current on-screen angle, switch to
  // 'placing'); 'placing' -> DROP (submit the previewed pose). The server clamps + re-checks.
  function handleAimButton(): void {
    if (!isActive || dropped) return;
    if (aim === 'spinning') {
      // Lock the exact angle on screen this frame, then let the pointer keep moving the piece.
      setAngle(spinAngleRef.current);
      setAim('placing');
      return;
    }
    drop();
  }

  function drop(): void {
    const live = simRef.current;
    if (!live || !live.next || !isActive || aim !== 'placing') return;
    const t = placedTransform(live.next, live, angleRef.current);
    // Refuse an illegal (below-the-line) drop here too - the button is disabled for it, but the
    // double-tap shortcut (feedback 0025) reaches drop() directly, and the server would reject it anyway.
    if (!t.legal) return;
    // Submit the piece's current transform. The server clamps + re-checks; we send our previewed pose.
    onMove?.(state.round, JSON.stringify({ angle: angleRef.current, dropX: t.x, dropY: t.y }));
    setDropped(true);
  }

  // Whether the currently placed pose is above the required line (a legal drop preview). The server is
  // authoritative; this only disables/annotates the Drop button + colors the ghost.
  const dropLegal =
    isActive && sim != null && sim.next != null && aim === 'placing'
      ? placedTransform(sim.next, sim, angle).legal
      : false;

  const level = sim?.level ?? 0;
  const score = sim?.score ?? 0;

  // Game over: a final summary with the score.
  if (sim?.over) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4 text-center">
          <h2 className="text-h3 text-text">Tower complete</h2>
          <p className="text-body-sm text-text-muted">
            You stacked your way to {score} pts. Nice climbing.
          </p>
          <p className="text-body-sm text-text-muted">
            The host can play again or head back to the lobby.
          </p>
        </div>
        <TowerCanvas canvasRef={canvasRef} />
      </section>
    );
  }

  const watchingName = sim && !isActive ? nicknameOf(state, sim.activePlayer) : null;

  // The SHORT turn/aim hint the draw loop paints as an on-canvas overlay (kept terse so it never
  // squishes at ~360px). The full copy lives in the screen-reader status below. It describes the new
  // flow: the canvas moves the piece; the top-right button stops the spin, then drops (feedback 0023).
  const hint = isActive
    ? dropped
      ? 'Dropping...'
      : aim === 'spinning'
        ? 'Move the piece, then Stop spin'
        : 'Move it into place, then Drop'
    : watchingName
      ? `Watching ${watchingName}`
      : '';
  hintRef.current = hint;

  // The live game state as text, for the visually-hidden aria-live region below. The HUD + hint are
  // painted on the canvas (feedback 0022 #6), so this restores the round/score/turn info to the DOM for
  // screen readers - and gives an automated test a stable signal (the canvas pixels are opaque to both).
  // Points only, "Round" not "Level" (feedback 0025). `polite` so it announces without interrupting.
  const roundName = LEVEL_NAMES[level] ?? `round ${level + 1}`;
  const srStatus = [
    `Round ${level + 1}, ${roundName}.`,
    `${score} points.`,
    isActive
      ? dropped
        ? 'Dropping the piece.'
        : aim === 'spinning'
          ? 'Your turn: move the piece on the board, then Stop spin to lock the angle.'
          : dropLegal
            ? 'Your turn: move it into place, then Drop. The drop is final, no re-aim.'
            : 'Your turn: the piece is below the line - move it higher before you can drop.'
      : watchingName
        ? `Watching ${watchingName} build the tower.`
        : '',
  ].join(' ');

  // The start-of-game gesture hint (feedback 0025): a centered onboarding overlay shown only while the
  // very first piece is still being aimed (nothing has landed yet), with copy for touch vs. mouse.
  const showStartHint =
    isActive && !dropped && sim != null && sim.level === 0 && sim.score === 0 && sim.height === 0;
  const startHintText = isCoarse
    ? 'Double tap to stop spin and drop'
    : 'Click to stop spin and drop';

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-3">
      {/* The round/score + turn state as text for screen readers (the on-canvas HUD/hint are invisible
          to assistive tech and to automated tests). Visually hidden; announced politely. */}
      <p className="sr-only" role="status" aria-live="polite">
        {srStatus}
      </p>
      {/* The aim control bar ABOVE the canvas (feedback 0025), so the button never sits on the on-canvas
          hint. 'spinning' -> "Stop spin" (lock the angle); 'placing' -> "Drop" (submit); disabled below
          the required line. A double-tap on the board is the same action. min-h keeps the row from
          collapsing (no layout jump) when it is not the local turn. */}
      <div className="flex min-h-11 items-center justify-end">
        {isActive && !dropped ? (
          <button
            type="button"
            aria-label={
              aim === 'spinning'
                ? 'Stop the spin and lock the angle'
                : dropLegal
                  ? 'Drop the piece'
                  : 'The piece is below the line - move it higher before dropping'
            }
            disabled={aim === 'placing' && !dropLegal}
            onClick={handleAimButton}
            className="min-h-11 min-w-24 rounded-lg bg-accent px-4 py-2 text-body-sm font-semibold text-black shadow-md disabled:opacity-50"
          >
            {aim === 'spinning' ? 'Stop spin' : dropLegal ? 'Drop' : 'Too low'}
          </button>
        ) : null}
      </div>
      {/* The single game surface: the live tower, plus the aim overlay when it is the local turn. The
          round/score HUD and the turn/aim hint are drawn ON the canvas (feedback 0022 #6). touch-action
          :none + pointer capture keep a drag over the board from scrolling the page and keep tracking
          when a finger drifts off a small (~360px) board mid-drag; user-select/callout off stop iOS
          copy/paste while dragging to aim (mobile-first). `relative` anchors the overlays. */}
      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-bg"
        style={{
          height: 'min(74svh, calc(100svh - 244px))',
          minHeight: '300px',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releaseCapture}
        onPointerCancel={releaseCapture}
      >
        <canvas
          ref={canvasRef}
          aria-label={isActive ? 'Aim and drop the piece' : 'Teeter Tower board'}
          role="img"
          className="block h-full w-full"
        />
        {showStartHint ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <p className="max-w-[15rem] rounded-lg bg-black/70 px-4 py-3 text-center text-body-sm font-semibold text-white shadow-md">
              {startHintText}
            </p>
          </div>
        ) : null}
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

/** The bare canvas element, shared by the over/summary and main views so one draw loop keeps running. */
function TowerCanvas({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-border bg-bg"
      style={{
        height: 'min(78svh, calc(100svh - 190px))',
        minHeight: '320px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="Teeter Tower board"
        role="img"
        className="block h-full w-full"
      />
    </div>
  );
}
