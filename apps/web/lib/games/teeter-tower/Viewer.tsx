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
// Aim -> lock -> drop (only when `me === sim.activePlayer` and `sim.next` exists):
//   1. The next piece spins locally (spinSeed drives the rotation via rAF). Tap/click to LOCK the
//      on-screen angle.
//   2. After locking, the piece FOLLOWS THE POINTER (x and y), clamped so its bottom stays ABOVE the
//      required line and its x within the platform range. It ghosts + turns red (drop blocked) when
//      the pointer would put it below the line (client preview; the server re-checks).
//   3. Tap/click again to DROP: onMove(round, JSON.stringify({ angle, dropX, dropY })). No re-aim -
//      we wait for the stream to show it land and present the next piece (a new `sim.next` id).
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
 * Double-tap guard (spec 0044): lock-angle and drop are the SAME tap in the SAME spot, so a reflexive
 * double-tap would lock AND immediately drop an irreversible piece. After locking we do not arm the
 * drop until either the pointer has MOVED past `DROP_ARM_MOVE_PX` (world px) OR `DROP_ARM_MS` have
 * elapsed - so a fast double-tap cannot lock+drop in one motion, while a deliberate single tap after
 * aiming still drops.
 */
const DROP_ARM_MS = 200;
const DROP_ARM_MOVE_PX = 12;

/** The local aim phase for the active player: the piece is spinning, or locked and being placed. */
type AimPhase = 'spinning' | 'placing';

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
  // world-space pointer position while placing. A spinning piece has no locked angle yet.
  const [aim, setAim] = useState<AimPhase>('spinning');
  const [angle, setAngle] = useState(0);
  const [pointer, setPointer] = useState<{ x: number; y: number }>({
    x: CENTER_X,
    y: GROUND_TOP - 100,
  });
  // The `sim.next` id we last aimed at, so a new piece (new id) resets the aim UI to spinning.
  const [aimedPieceId, setAimedPieceId] = useState<number | null>(null);
  // True from the moment we submit a drop until the stream presents a new piece id - so we stop
  // spinning/aiming while the drop is in flight and the piece is landing.
  const [dropped, setDropped] = useState(false);

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
      setPointer({ x: CENTER_X, y: GROUND_TOP - 100 });
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
  const pointerRef = useRef(pointer);
  pointerRef.current = pointer;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const droppedRef = useRef(dropped);
  droppedRef.current = dropped;
  // The turn/aim hint text the draw loop paints as a screen-space overlay (computed below from state).
  const hintRef = useRef('');
  // The live spin angle the draw loop advances, so the angle a tap locks is exactly the one on screen.
  const spinAngleRef = useRef(0);
  // Double-tap guard state: when the angle was locked (ms) and the pointer position at lock, so the
  // drop only arms after a small move or a short debounce (see DROP_ARM_MS / DROP_ARM_MOVE_PX).
  const lockedAtRef = useRef(0);
  const lockPointerRef = useRef<{ x: number; y: number } | null>(null);

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

  // Clamp the placing piece's centroid so its rotated bottom stays above the required line and its x
  // stays in the platform range. Returns the drawable transform + whether the drop is currently legal.
  function placedTransform(
    piece: Piece,
    live: TeeterSim,
  ): { x: number; y: number; legal: boolean; rawBottom: number } {
    const span = rotatedYSpan(piece, angleRef.current);
    const x = clampDropX(pointerRef.current.x);
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

          // Fit the whole level's height into the canvas (platform -> above the target line), centered
          // horizontally at a uniform scale, so the tower fills the vertical space with no camera pan.
          const view = levelView(rect.width, rect.height, live.target);
          const labelX = visibleLeftX(view) + 12;

          const chrome = resolveChrome(canvas);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawSky(ctx, chrome, rect.width, rect.height, dpr);
          applyLevelTransform(ctx, view, dpr);
          drawTargetBands(ctx, chrome, live.target, labelX);
          drawPlatform(ctx, chrome);
          drawTower(ctx, bodies);

          // The aim overlay for the active player who has not yet dropped.
          if (isActiveRef.current && !droppedRef.current && live.next) {
            const piece = live.next;
            // Draw the min-drop line + forbidden zone in BOTH phases (spinning and placing), so the
            // "drop above this line" rule is visible from the first frame - not only once locked.
            drawRequiredLine(ctx, chrome, live.requiredLine, labelX);
            if (aimRef.current === 'spinning') {
              spinAngleRef.current += piece.spinSeed;
              // Spawn the spinning piece near the TOP of the view (just above the target line), so it
              // always reads clearly ABOVE the tower and the required line no matter how tall the tower
              // is - never the payload's fixed low position (which would hover inside a grown pile).
              drawBody(
                ctx,
                piece.verts,
                piece.eyes,
                piece.skin,
                CENTER_X,
                view.top + 110,
                spinAngleRef.current,
                { x: 0, y: 0 },
                0.9,
              );
            } else {
              const t = placedTransform(piece, live);
              const skin = t.legal ? piece.skin : { fill: '#c23b52', stroke: chrome.dropLine };
              // A drop guide line from the piece down to the platform.
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
                angleRef.current,
                { x: 0, y: 0 },
                0.85,
              );
            }
          }

          // Screen-space overlays (reset transform inside each helper): the compact level/height/score
          // HUD pill top-left, and the turn/aim hint centered near the top. These replace the old DOM
          // badge rows so the canvas keeps all the vertical space (feedback 0022 #6).
          const lvl = live.level;
          const hud = [
            `Lv ${lvl + 1} - ${LEVEL_NAMES[lvl] ?? `Level ${lvl + 1}`}`,
            `${live.height}/${live.target} px   ${live.score} pts`,
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
    const view = levelView(rect.width, rect.height, simRef.current?.target ?? 600);
    return {
      x: (clientX - rect.left - view.originX) / view.scale,
      y: (clientY - rect.top - view.originY) / view.scale,
    };
  }

  // Tap 1 locks the spin; tap 2 drops. Between them the pointer moves the piece.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!isActive || dropped) return;
    // Capture the pointer so a finger that drifts off a small (~360px) board mid-drag keeps tracking
    // (guarded: jsdom / older engines may not implement pointer capture).
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (aim === 'spinning') {
      const at = pointerToWorld(e.clientX, e.clientY);
      setAngle(spinAngleRef.current);
      setPointer(at);
      setAim('placing');
      // Record the lock time + position for the double-tap guard: the drop only arms after a small
      // move OR a short debounce, so a reflexive double-tap cannot lock+drop in one motion. Date.now
      // (a wall clock) is enough here - the guard is a coarse ~200ms debounce, not a render clock.
      lockedAtRef.current = Date.now();
      lockPointerRef.current = at;
    } else {
      drop();
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!isActive || dropped || aim !== 'placing') return;
    setPointer(pointerToWorld(e.clientX, e.clientY));
  }

  function releaseCapture(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
  }

  function drop(): void {
    const live = simRef.current;
    if (!live || !live.next || !isActive || aim !== 'placing') return;
    // Double-tap guard: do not drop until the drop is armed - the pointer has moved past the
    // threshold OR the debounce has elapsed since the lock. A fast lock+tap in the same spot is
    // swallowed here (the piece stays aimable), so the irreversible drop needs a deliberate action.
    const elapsed = Date.now() - lockedAtRef.current;
    const lock = lockPointerRef.current;
    const moved =
      lock != null &&
      Math.hypot(pointerRef.current.x - lock.x, pointerRef.current.y - lock.y) >= DROP_ARM_MOVE_PX;
    if (elapsed < DROP_ARM_MS && !moved) return;
    const t = placedTransform(live.next, live);
    // Submit the piece's current transform. The server clamps + re-checks; we send our previewed pose.
    onMove?.(state.round, JSON.stringify({ angle: angleRef.current, dropX: t.x, dropY: t.y }));
    setDropped(true);
  }

  const level = sim?.level ?? 0;
  const target = sim?.target ?? 600;
  const height = sim?.height ?? 0;
  const score = sim?.score ?? 0;

  // Game over: a final summary with the score.
  if (sim?.over) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4 text-center">
          <h2 className="text-h3 text-text">Tower complete</h2>
          <p className="text-body-sm text-text-muted">
            You stacked your way to {height} px for {score} pts. Nice climbing.
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
  // squishes at ~360px). The full copy lives in the screen-reader status below.
  const hint = isActive
    ? dropped
      ? 'Dropping...'
      : aim === 'spinning'
        ? 'Tap to lock the angle'
        : 'Aim, then tap to drop (final)'
    : watchingName
      ? `Watching ${watchingName}`
      : '';
  hintRef.current = hint;

  // The live game state as text, for the visually-hidden aria-live region below. The HUD + hint are
  // painted on the canvas (feedback 0022 #6), so this restores the level/height/score/turn info to the
  // DOM for screen readers - and gives an automated test a stable signal (the canvas pixels are opaque
  // to both). `polite` so it announces changes without interrupting.
  const levelName = LEVEL_NAMES[level] ?? `level ${level + 1}`;
  const srStatus = [
    `Level ${level + 1}, ${levelName}.`,
    `Tower ${height} of ${target} pixels, ${score} points.`,
    isActive
      ? dropped
        ? 'Dropping the piece.'
        : aim === 'spinning'
          ? 'Your turn: tap the board to lock the angle.'
          : 'Your turn: move to aim, then tap to drop. The drop is final, no re-aim.'
      : watchingName
        ? `Watching ${watchingName} build the tower.`
        : '',
  ].join(' ');

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-4">
      {/* The level/height/score + turn state as text for screen readers (the on-canvas HUD/hint are
          invisible to assistive tech and to automated tests). Visually hidden; announced politely. */}
      <p className="sr-only" role="status" aria-live="polite">
        {srStatus}
      </p>
      {/* The single game surface: the live tower, plus the aim overlay when it is the local turn.
          The level/height/score HUD and the turn/aim hint are drawn ON the canvas (feedback 0022 #6),
          freeing this space so the surface fills the viewport height. touch-action:none + pointer
          capture keep a drag over the board from scrolling the page and keep tracking when a finger
          drifts off a small (~360px) board mid-drag; user-select/callout off stop iOS copy/paste while
          dragging to aim (mobile-first). `relative` anchors the rejection overlay. */}
      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-bg"
        style={{
          height: 'min(78svh, calc(100svh - 190px))',
          minHeight: '320px',
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
        {state.rejected ? (
          <p
            role="alert"
            className="absolute inset-x-0 top-0 m-2 rounded-md bg-danger/90 px-3 py-1.5 text-center text-body-sm text-white"
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
