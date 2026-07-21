# 0040 - Sketchy palette validation: empty allow-set soft-lock + trust-boundary id validation

## Symptom

In the first cut of per-player Sketchy palettes (spec 0063), the engine validated a player's strokes
against their claimed palette by building an allowed-color `Set` from the palette id snapshotted at
`configure`. For a player whose snapshotted id was unknown (or unresolvable), `paletteColors(id)`
returned `[]`, so `allowed` became an EMPTY set - and `parseSketch` then dropped EVERY stroke. The
player's draw submission was always rejected as "draw something first": a soft-lock out of the round,
the exact opposite of the intended "no palette -> permissive fallback" behavior. The engineer persona
caught it as a blocker in review. It was reachable because the handoff ingress (`requirePlayers`)
accepted any string `paletteId` without checking it was a real palette.

## Root cause

Two compounding gaps:
1. The validator conflated "no restriction" with "restrict to nothing". `undefined` allowed meant "use
   the lenient all-palette union", but an empty `Set` meant "allow no colors at all". An unresolved id
   fell into the second, hard-locking bucket instead of the first, lenient one.
2. A per-player identifier crossed a trust boundary (control-plane -> engine handoff) validated only as
   `typeof === 'string'`, so a stale/garbage id entered the engine and drove the empty-set path.

## Fix

- Resolve the colors first and collapse an empty result to `undefined` so an unknown/empty palette
  falls back to the lenient union, never an empty allow-set (`sketchy.ts` `collectMove`).
- Validate `paletteId` with `isPaletteId` at the handoff ingress (`reporting.ts` `requirePlayers`), so a
  bad id degrades to the documented no-palette path before it reaches the engine.

## Learning

Two rules, both general (rolled into `overview/learnings.md`):
- When a per-item restriction is derived from a lookup that can miss, distinguish "no restriction" from
  "restrict to the empty set" - an unresolved key must fall back to the PERMISSIVE default, never the
  empty one that silently blocks the actor. An empty allow-list is a lock, not an absence of a lock.
- Validate an identifier at the trust boundary it crosses (ingress), not only where it is consumed.
  Degrading a bad id to a safe default at ingress keeps every downstream consumer on the intended path.
