// Per-game colour skins (spec 0075). A skin is a small set of brand colours a game declares once in
// its module; the shell (GameStage) maps them onto the semantic `--color-*` custom properties the
// whole UI already reads and applies them to the in-game subtree. Because canopy components and the
// game surfaces render through those semantic roles (never hardcoded hex), re-pointing the roles on
// one wrapper re-skins everything underneath with no per-component edits - the same mechanism the
// `.dark` class uses, scoped to a game instead of the document.
//
// The skin deliberately owns the STRUCTURAL and BRAND roles (grounds, text, borders, primary /
// secondary / accent). It leaves the STATUS roles (success / warning / danger / info) on the global
// palette so a green "correct", an amber "paused", and a red error keep their meaning in every game.

import type { CSSProperties } from 'react';

/** One game's colour identity. Ten inputs; the shell derives the ~two dozen semantic vars from them. */
export interface GameSkin {
  /** App ground behind the game (maps to `--color-bg`). */
  bg: string;
  /** Card / panel surface (`--color-surface`, `--color-muted`). */
  surface: string;
  /** Raised surface, one step up from `surface` (`--color-surface-raised`). */
  surfaceRaised: string;
  /** Primary readable text (`--color-text`). */
  text: string;
  /** Secondary / muted text (`--color-text-muted`, `--color-text-subtle`). */
  textMuted: string;
  /** Hairlines and card borders (`--color-border`). */
  border: string;
  /** The main action / brand colour (`--color-primary`, focus `--color-ring`). */
  primary: string;
  /** Legible ink ON primary/secondary/accent fills (`--color-primary-foreground`). */
  primaryForeground: string;
  /** The secondary brand accent (`--color-secondary`). */
  secondary: string;
  /** A third accent for highlights (`--color-accent`). */
  accent: string;
  /**
   * Extra raw CSS custom-property overrides, merged after the derived roles. The escape hatch for
   * surfaces that read PRIMITIVE tokens rather than semantic roles - notably the canvas board games
   * (Reversi, Checkers), whose renderer reads `--color-honey-*` (squares) and `--color-grape-*` /
   * `--color-sunbeam-*` (the two sides) off the board element's computed style. Setting those here
   * re-colours the board to match the rest of the skin. Prefer the semantic roles above; reach for
   * this only when a surface genuinely reads a primitive.
   */
  vars?: Record<string, string>;
}

/**
 * Expand a skin into the semantic `--color-*` custom properties, ready to spread onto an element's
 * `style`. Returns undefined for an unskinned game so the subtree inherits the global Confetti
 * palette unchanged. The `-hover` / `-active` / `-strong` steps reuse the base colour rather than
 * inventing shades - a game skin is a re-point, not a full generated ramp.
 */
export function skinToVars(skin: GameSkin | undefined): CSSProperties | undefined {
  if (!skin) return undefined;
  const vars: Record<string, string> = {
    '--color-bg': skin.bg,
    '--color-overlay': skin.bg,
    '--color-surface': skin.surface,
    '--color-surface-raised': skin.surfaceRaised,
    '--color-muted': skin.surface,
    '--color-muted-raised': skin.surfaceRaised,
    '--color-text': skin.text,
    '--color-text-muted': skin.textMuted,
    '--color-text-subtle': skin.textMuted,
    '--color-muted-foreground': skin.textMuted,
    '--color-border': skin.border,
    '--color-border-strong': skin.border,
    '--color-ring': skin.primary,
    '--color-primary': skin.primary,
    '--color-primary-hover': skin.primary,
    '--color-primary-active': skin.primary,
    '--color-primary-foreground': skin.primaryForeground,
    '--color-secondary': skin.secondary,
    '--color-secondary-hover': skin.secondary,
    '--color-secondary-active': skin.secondary,
    '--color-secondary-foreground': skin.primaryForeground,
    '--color-accent': skin.accent,
    '--color-accent-strong': skin.accent,
    '--color-accent-hover': skin.accent,
    '--color-accent-foreground': skin.primaryForeground,
    // Raw overrides last, so a game can re-point any var (incl. primitives the board canvas reads).
    ...skin.vars,
  };
  return vars as CSSProperties;
}
