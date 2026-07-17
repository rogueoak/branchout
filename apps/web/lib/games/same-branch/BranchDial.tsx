'use client';

// The branch dial: a horizontal spectrum from one end (root, 0) to the other (tip, 100), with a
// draggable sap-line pointer. Mobile-first and touch-first - the whole track is a pointer target, the
// thumb is a 44px touch handle, and it is fully keyboard-operable (arrow keys, Home/End) as an ARIA
// slider. Reused by the Reader's Viewer (read-only, showing the bud), the guesser's Remote (draggable),
// and the reveal (read-only, showing bud + every guess). Pure over its props: a value in [0, 100] and
// an optional onChange; no engine coupling.

import { useCallback, useRef } from 'react';

export interface DialMarker {
  /** Position on the branch [0, 100]. */
  position: number;
  /** A short label under the marker (a nickname, "bud"). */
  label?: string;
  /** Visual tone of the marker. */
  tone: 'bud' | 'guess' | 'me';
}

export interface BranchDialProps {
  /** The label at the root (0) end. */
  left: string;
  /** The label at the tip (100) end. */
  right: string;
  /** The sap-line value in [0, 100], or null when the player has not set it yet. */
  value: number | null;
  /** Called with a clamped, rounded [0, 100] as the player drags/keys. Omit for a read-only dial. */
  onChange?: (value: number) => void;
  /** Extra read-only markers to paint on the branch (the bud, other guesses at reveal). */
  markers?: DialMarker[];
  /** Accessible name for the slider. */
  ariaLabel: string;
  /** Disable interaction (e.g. after locking in). */
  disabled?: boolean;
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

/** The border+fill classes for a marker dot, keyed by its tone. */
function markerToneClass(tone: DialMarker['tone']): string {
  if (tone === 'bud') return 'border-success bg-success/40';
  if (tone === 'me') return 'border-primary bg-primary/40';
  return 'border-text-subtle bg-text-subtle/30';
}

export function BranchDial({
  left,
  right,
  value,
  onChange,
  markers = [],
  ariaLabel,
  disabled = false,
}: BranchDialProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const interactive = typeof onChange === 'function' && !disabled;
  // The rendered sap-line position: the value, or the middle of the branch before the player moves it.
  const shown = value ?? 50;
  const trackCursor = interactive ? 'cursor-pointer' : '';
  const valueText = value === null ? undefined : `${value} of 100, between ${left} and ${right}`;
  const thumbTone = value === null ? 'bg-text-subtle opacity-60' : 'bg-text';

  let hintLine = `Sap line at ${value}.`;
  if (value === null) {
    hintLine = interactive ? 'Drag the sap line to your guess.' : 'Waiting for the sap line.';
  }

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || !onChange) return;
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = (clientX - rect.left) / rect.width;
      onChange(clamp(ratio * 100));
    },
    [onChange],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setFromClientX(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.buttons === 0) return;
    setFromClientX(event.clientX);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const current = value ?? 50;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - 1;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + 1;
        break;
      case 'PageDown':
        next = current - 10;
        break;
      case 'PageUp':
        next = current + 10;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 100;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange?.(clamp(next));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <span className="max-w-[45%] break-words text-body-sm font-medium text-secondary">
          {left}
        </span>
        <span className="max-w-[45%] break-words text-right text-body-sm font-medium text-primary">
          {right}
        </span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={interactive ? 0 : -1}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className={`relative h-14 w-full touch-none select-none rounded-full bg-surface-raised ${trackCursor}`}
        data-testid="branch-dial"
      >
        {/* The branch line running root -> tip. */}
        <div className="pointer-events-none absolute inset-x-3 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-secondary via-text-subtle to-primary" />

        {/* Read-only markers (the bud, other guesses). */}
        {markers.map((marker, index) => {
          let markerLabel = null;
          if (marker.label) {
            markerLabel = (
              <span className="absolute left-1/2 top-7 -translate-x-1/2 whitespace-nowrap text-caption text-text-subtle">
                {marker.label}
              </span>
            );
          }
          return (
            <div
              key={`${marker.tone}-${index}`}
              className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `calc(${clamp(marker.position)}% )` }}
            >
              <div
                className={`h-6 w-6 rounded-full border-2 ${markerToneClass(marker.tone)}`}
                aria-hidden="true"
              />
              {markerLabel}
            </div>
          );
        })}

        {/* The sap-line thumb. Rendered muted until the player has actually set a value. */}
        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `calc(${shown}% )` }}
        >
          <div
            className={`h-9 w-9 rounded-full border-4 border-surface shadow-md ${thumbTone}`}
            aria-hidden="true"
          />
        </div>
      </div>
      <p className="text-caption text-text-subtle">{hintLine}</p>
    </div>
  );
}
