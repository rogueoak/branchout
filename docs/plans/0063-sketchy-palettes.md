# 0063 - Sketchy per-player palettes (build plan)

Source: spec `docs/specs/0063-sketchy.md` (Per-player palettes section). Modifies the existing
Sketchy game so every player draws with their own reserved 3-color palette, enforced server-side.

## Chosen seam

Per-player `paletteId` on the control-plane `RoomMember` (mirrors `mode`): stored in Redis,
broadcast free on the existing 3s lobby member poll, reserved server-authoritatively in a new
`setPalette`, and threaded to the engine on the start handoff so Sketchy validates each player's
strokes against only their claimed colors. Palette DEFINITIONS live once in `@branchout/protocol`
(like `PLAYER_LIMITS`), consumed by web, engine, and control-plane - no engine/web mirror.
Rejected: the game-config blob (host-owned, not per-player, not broadcast).

## Steps

1. `@branchout/protocol`: `palettes.ts` - 24 presets (id/name/3 colors), `paletteColors`,
   `isPaletteId`, `pickAvailablePalette`, `ALL_PALETTE_COLORS`. Export from index. Unit test.
2. Thread the id to the engine: `SessionPlayer.paletteId` (game-sdk), `HandoffPlayer.paletteId`
   (protocol, additive, parsed on ingress), map at `engine.ts`.
3. Engine Sketchy: parameterize `strokes.ts` `parseSketch(raw, allowed)`; snapshot `player ->
   paletteId` into scratch at `configure`; validate against the player's colors in `collectMove`;
   deliver each player's colors in the private draw payload. Unit tests.
4. Control-plane: `RoomMember.paletteId`; assign a random free palette on create/join; `setPalette`
   with reservation (`palette_taken`) + route `PATCH /rooms/:code/palette`; carry `paletteId` in
   `toHandoffPlayers`. Unit tests.
5. Web: `room-api` (`RoomMember.paletteId`, `setPalette`); `usesPalettes` module flag (Sketchy on);
   `PalettePicker` + Lobby section (claimed disabled/named, random default, switch); `RoomClient`
   claim wiring (optimistic + race re-sync); decode the palette in `protocol.ts`; pass it into
   `DrawCanvas` (toolbar shows the 3 colors); strokes mirror validates the union. Component tests.
6. e2e: assert the lobby picker, a reservation, and the 3-color toolbar.

## Verification

- Unit: protocol palettes; engine per-player validation + reservation/distinctness; control-plane
  reservation + default + race; web PalettePicker/Lobby/DrawCanvas/protocol.
- typecheck + lint + prettier + web build.
- Drive the real app (3-player e2e over the docker stack): screenshots in
  `docs/verify/sketchy-palettes/`.
