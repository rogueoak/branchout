'use client';

// The Teeter Tower viewer (spec 0043): the shared screen everyone watches. It is a PURE RENDERER -
// it runs no physics. It draws the server-provided tower (world-space Body[]), the dashed target
// line + score bands, and googly eyes; when a new reveal arrives it plays back the server's settle
// `track` frame by frame (rAF, mapping Frame.t to real time), then rests on the settled tower. A HUD
// shows level / height / score / round. Mobile-first: the canvas scales by aspect ratio and reads
// well at ~360px wide, with `touch-action: none`.
//
// Continuous play: after the settle animation finishes AND the round is at `leaderboard` (the "tower
// settled, next piece ready" rest state), the host viewer calls `onAdvance()` exactly once so the
// next piece spawns without a manual tap. A `complete` game shows a final summary instead.

import { Badge } from '@rogueoak/canopy';
import { useEffect, useRef, useState } from 'react';
import type { GameViewProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import {
  asTeeterPrompt,
  pickTeeterReveal,
  type Body,
  type Frame,
  type TeeterReveal,
} from './protocol';
import {
  drawPlatform,
  drawSky,
  drawTargetBands,
  drawTower,
  resolveChrome,
  VIEW_H,
  VIEW_W,
  withWorldTransform,
} from './render';

const LEVEL_NAMES = ['Warm-up', 'Reach for the sky', 'The Pendulum'];

/** Interpolate a body's transform between two keyframes at fraction `f` (0..1). */
function lerpTransform(
  a: { x: number; y: number; angle: number },
  b: { x: number; y: number; angle: number },
  f: number,
): { x: number; y: number; angle: number } {
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: a.angle + (b.angle - a.angle) * f,
  };
}

/** Build the world-space bodies to draw at simulated time `t` (ms) from the settle track + skins. */
function bodiesAt(track: Frame[], skins: Map<number, Body>, t: number): Body[] {
  if (track.length === 0) return [];
  // Find the bracketing frames for t.
  let lo = 0;
  for (let i = 0; i < track.length - 1; i++) {
    if (track[i]!.t <= t) lo = i;
    else break;
  }
  const a = track[lo]!;
  const b = track[Math.min(lo + 1, track.length - 1)]!;
  const span = b.t - a.t;
  const f = span > 0 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 0;

  const byIdB = new Map(b.bodies.map((body) => [body.id, body]));
  const out: Body[] = [];
  for (const fa of a.bodies) {
    const skin = skins.get(fa.id);
    if (!skin) continue;
    const fb = byIdB.get(fa.id) ?? fa;
    const tr = lerpTransform(fa, fb, f);
    out.push({ ...skin, x: tr.x, y: tr.y, angle: tr.angle });
  }
  return out;
}

export function TeeterViewer({ state, onAdvance }: GameViewProps) {
  const { phase } = state;
  const prompt = asTeeterPrompt(state.prompt);
  const reveal = pickTeeterReveal(state.reveals);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The reveal currently being animated (null when resting). A new reveal object (by round + track
  // length) starts a fresh playback; playing sets `animating` so the rest render yields to it.
  const [animating, setAnimating] = useState(false);
  const playedRevealKey = useRef<string | null>(null);
  const advancedRound = useRef<number | null>(null);

  // The values the draw loop reads without re-subscribing rAF each render. Refs keep the animation
  // loop stable while state drives when to start/stop it.
  const revealRef = useRef<TeeterReveal | null>(null);
  revealRef.current = reveal;
  const promptTowerRef = useRef<Body[]>(prompt?.tower ?? []);
  promptTowerRef.current = prompt?.tower ?? [];
  const targetRef = useRef<number>(prompt?.target ?? reveal?.target ?? 300);
  targetRef.current = prompt?.target ?? reveal?.target ?? 300;
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const roundRef = useRef(state.round);
  roundRef.current = state.round;

  // Start playback when a new reveal with a non-empty track arrives.
  useEffect(() => {
    if (!reveal) return;
    const key = `${state.round}:${reveal.track.length}:${reveal.score}`;
    if (playedRevealKey.current === key) return;
    playedRevealKey.current = key;
    setAnimating(reveal.track.length > 0);
    // A trackless reveal (host force-close) has nothing to animate: fall straight through to the
    // rest render + the advance check below.
    if (reveal.track.length === 0) maybeAdvance();
  }, [reveal, state.round]);

  // Advance once per round when we are resting at leaderboard (continuous play). Guarded so a
  // re-render or a repeated leaderboard frame never fires it twice.
  function maybeAdvance(): void {
    if (
      phaseRef.current === 'leaderboard' &&
      onAdvanceRef.current &&
      advancedRound.current !== roundRef.current
    ) {
      advancedRound.current = roundRef.current;
      onAdvanceRef.current();
    }
  }

  // If we are resting (not animating) and already at leaderboard, advance. Covers the case where the
  // leaderboard frame lands after the track already finished.
  useEffect(() => {
    if (!animating && phase === 'leaderboard') maybeAdvance();
  }, [animating, phase, state.round]);

  // The draw loop. One rAF loop lives for the component's life; it draws the rest tower every frame
  // and, while animating, advances the settle playback in real time, ending it (and checking the
  // continuous-play advance) when the track's final timestamp is reached.
  useEffect(() => {
    let raf = 0;
    let playStart: number | null = null;

    const render = (now: number): void => {
      const canvas = canvasRef.current;
      if (canvas) {
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
          const chrome = resolveChrome(canvas);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          withWorldTransform(ctx, rect.width, rect.height, dpr);
          drawSky(ctx, chrome);
          drawTargetBands(ctx, chrome, targetRef.current);
          drawPlatform(ctx, chrome);

          const rev = revealRef.current;
          if (animating && rev && rev.track.length > 0) {
            if (playStart === null) playStart = now;
            const elapsed = now - playStart;
            const endT = rev.track[rev.track.length - 1]!.t;
            const skins = new Map(rev.tower.map((b) => [b.id, b]));
            // The track only carries surviving bodies' final skins; also index the opening frame's
            // ids so a body that fell off still animates out (it just is not in the settled tower).
            for (const b of rev.tower) skins.set(b.id, b);
            const bodies = bodiesAt(rev.track, skins, Math.min(elapsed, endT));
            drawTower(ctx, bodies);
            if (elapsed >= endT) {
              playStart = null;
              setAnimating(false);
              maybeAdvance();
            }
          } else {
            // Rest render: the settled tower from the last reveal, or the prompt's tower.
            const resting = rev && !animating ? rev.tower : promptTowerRef.current;
            drawTower(ctx, resting);
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [animating]);

  const level = reveal?.level ?? prompt?.level ?? 0;
  const height = reveal?.height ?? prompt?.height ?? 0;
  const target = targetRef.current;
  const score = reveal?.score ?? state.scores[Object.keys(state.scores)[0] ?? ''] ?? 0;

  if (phase === 'complete') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4 text-center">
          <h2 className="text-h3 text-text">Tower complete</h2>
          <p className="text-body-sm text-text-muted">
            You stacked your way to {height} px. Nice climbing.
          </p>
        </div>
        <FinalResults standings={state.standings} me={undefined} />
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" aria-label="Game status">
        <Badge variant="info">Level {level + 1}</Badge>
        <Badge variant="neutral">{LEVEL_NAMES[level] ?? `Level ${level + 1}`}</Badge>
        <Badge variant="neutral">
          <span aria-label={`Height ${height} of ${target} pixels`}>
            {height} / {target} px
          </span>
        </Badge>
        <Badge variant={score >= 100 ? 'success' : 'neutral'}>
          <span aria-label={`Score ${score}`}>{score} pts</span>
        </Badge>
        <Badge variant="neutral">Piece {state.round}</Badge>
      </div>

      {/* Aspect-ratio box keeps the canvas the world's shape and good at ~360px wide (mobile-first).
          touch-action:none so a drag over the board never scrolls the page. */}
      <div
        className="w-full overflow-hidden rounded-xl border border-border bg-bg"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Teeter Tower board"
          role="img"
          className="block h-full w-full"
        />
      </div>

      {reveal?.cleared ? (
        <p role="status" className="text-body-sm text-success">
          Level cleared - reaching for the next height.
        </p>
      ) : null}
    </section>
  );
}
