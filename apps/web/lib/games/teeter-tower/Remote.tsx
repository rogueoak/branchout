'use client';

// The Teeter Tower remote (spec 0043): the active player's aim UI. It draws only locally (no
// physics) - the server is authoritative and simulates the real drop. Flow:
//   1. The piece spins (spinSeed drives the rotation via rAF). Tap the board to LOCK the angle.
//   2. Drag left/right (or use the slider) to choose the drop position (dropX), clamped to the
//      platform +/- margin like the engine.
//   3. Tap Drop to submit `{ angle, dropX }` via onMove(round, JSON.stringify(...)).
// A non-active player sees a "watching <name> build" state. An illegal/rejected drop (state.rejected)
// is surfaced inline so the player can re-aim. Mobile-first: big tap targets, touch-action:none.

import type { PlayerView } from '@branchout/protocol';
import { Badge, Button } from '@rogueoak/canopy';
import { useEffect, useRef, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { asTeeterPrompt } from './protocol';
import {
  CENTER_X,
  DROP_HALF_RANGE,
  VIEW_H,
  VIEW_W,
  clampDropX,
  drawBody,
  drawPlatform,
  drawSky,
  drawTargetBands,
  drawTower,
  pieceBounds,
  resolveChrome,
  withWorldTransform,
} from './render';

type AimPhase = 'spinning' | 'placing';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function TeeterRemote({ state, me, onMove }: GameRemoteProps) {
  const { phase, round } = state;
  const prompt = asTeeterPrompt(state.prompt);
  const isActive = prompt != null && prompt.activePlayer === me;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [aim, setAim] = useState<AimPhase>('spinning');
  const [angle, setAngle] = useState(0);
  const [dropX, setDropX] = useState(CENTER_X);
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);

  // A fresh round resets the aim UI (a new piece spins from scratch).
  useEffect(() => {
    setAim('spinning');
    setAngle(0);
    setDropX(CENTER_X);
    setSubmittedRound(null);
  }, [round]);

  // Refs the draw loop reads without re-subscribing each render.
  const aimRef = useRef(aim);
  aimRef.current = aim;
  const angleRef = useRef(angle);
  angleRef.current = angle;
  const dropXRef = useRef(dropX);
  dropXRef.current = dropX;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  // The single source of truth for the piece's live spin, advanced by the draw loop while spinning
  // so the angle a board tap locks is exactly the one on screen.
  const spinAngleRef = useRef(0);

  // The spin/aim draw loop, only while this device is the active player and still aiming.
  useEffect(() => {
    if (!isActive) return;
    let raf = 0;

    const render = (): void => {
      const canvas = canvasRef.current;
      const p = promptRef.current;
      if (canvas && p) {
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
          drawTargetBands(ctx, chrome, p.target);
          drawPlatform(ctx, chrome);
          drawTower(ctx, p.tower);

          // The piece: spinning shows a live rotation; placing locks the chosen angle and follows the
          // drop cursor horizontally near the spawn height.
          if (aimRef.current === 'spinning') {
            spinAngleRef.current += p.piece.spinSeed;
            drawBody(
              ctx,
              p.piece.verts,
              p.piece.eyes,
              p.piece.skin,
              p.piece.x,
              p.piece.y,
              spinAngleRef.current,
            );
          } else {
            const x = dropXRef.current;
            drawBody(
              ctx,
              p.piece.verts,
              p.piece.eyes,
              p.piece.skin,
              x,
              p.piece.y,
              angleRef.current,
            );
            // A drop guide from the piece down to the platform so the aim reads clearly.
            ctx.save();
            ctx.strokeStyle = chrome.dropLine;
            ctx.setLineDash([8, 8]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, p.piece.y);
            ctx.lineTo(x, VIEW_H);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [isActive, round]);

  // Lock the current on-screen spin angle when the player taps the board (spinning -> placing).
  function handleBoardTap(): void {
    if (aim !== 'spinning' || !prompt) return;
    setAngle(spinAngleRef.current);
    setAim('placing');
  }

  // Map a pointer x on the canvas to a world dropX (clamped to the legal range).
  function pointerToDropX(clientX: number): number {
    const canvas = canvasRef.current;
    if (!canvas) return dropX;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
    const offsetX = (rect.width - VIEW_W * scale) / 2;
    const worldX = (clientX - rect.left - offsetX) / scale;
    return clampDropX(worldX);
  }

  function handlePointerMove(clientX: number): void {
    if (aim !== 'placing') return;
    setDropX(pointerToDropX(clientX));
  }

  function drop(): void {
    if (!prompt || aim !== 'placing') return;
    onMove(round, JSON.stringify({ angle, dropX: clampDropX(dropX) }));
    setSubmittedRound(round);
  }

  const submitted = submittedRound === round;

  // Non-active player: a plain "watching" state (they build nothing this turn).
  if (!isActive) {
    if (phase === 'complete') {
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          <p className="text-body-sm text-text-muted">The tower is finished - see the viewer.</p>
        </section>
      );
    }
    const builderName = prompt ? nicknameOf(state.players, prompt.activePlayer) : 'the builder';
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <p className="text-body text-text">Watching {builderName} build the tower.</p>
        <p className="text-body-sm text-text-muted">Your turn comes around as pieces drop.</p>
      </section>
    );
  }

  // Active player, but the round is not collecting (settling / between pieces): a brief rest note.
  if (phase !== 'collecting') {
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <p className="text-body-sm text-text-muted">
          {phase === 'complete' ? 'The tower is finished.' : 'The tower is settling...'}
        </p>
      </section>
    );
  }

  const bounds = prompt ? pieceBounds(prompt.piece) : null;

  return (
    <section aria-label="Your controller" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">Your turn</Badge>
        <Badge variant="neutral">
          {aim === 'spinning' ? 'Tap to lock the angle' : 'Drag to aim, then drop'}
        </Badge>
      </div>

      {state.rejected ? (
        <p role="alert" className="text-body-sm text-danger">
          {state.rejected} - re-aim and drop again.
        </p>
      ) : null}

      {/* The aim board. Tapping locks the spin; dragging on it (while placing) moves the drop. */}
      <div
        className="w-full overflow-hidden rounded-xl border border-border bg-bg"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, touchAction: 'none' }}
        onPointerDown={(e) => {
          if (aim === 'spinning') handleBoardTap();
          else handlePointerMove(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) handlePointerMove(e.clientX);
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Aim the piece"
          role="img"
          className="block h-full w-full"
        />
      </div>

      {aim === 'spinning' ? (
        <Button type="button" variant="primary" onClick={handleBoardTap} className="w-full">
          Lock the angle
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <label htmlFor="teeter-dropx" className="text-body-sm font-medium text-text">
            Drop position
          </label>
          <input
            id="teeter-dropx"
            type="range"
            min={CENTER_X - DROP_HALF_RANGE}
            max={CENTER_X + DROP_HALF_RANGE}
            step={1}
            value={dropX}
            aria-label="Drop position"
            onChange={(e) => setDropX(clampDropX(Number(e.target.value)))}
            className="h-8 w-full"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAim('spinning');
                setAngle(0);
              }}
            >
              Re-spin
            </Button>
            <Button type="button" variant="primary" onClick={drop} className="flex-1">
              Drop
            </Button>
          </div>
        </div>
      )}

      {submitted && !state.rejected ? (
        <p role="status" className="text-body-sm text-success">
          Dropped - watch it settle on the board.
        </p>
      ) : bounds == null ? (
        <p className="text-body-sm text-text-muted">Waiting for a piece...</p>
      ) : null}
    </section>
  );
}
