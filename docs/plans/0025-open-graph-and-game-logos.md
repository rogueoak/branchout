# Plan 0025 - Open Graph share cards and per-game logos

Source: `docs/specs/0025-open-graph-and-game-logos.md`.

Core move: add two on-theme game marks and drive three surfaces of OG cards (home wordmark,
per-game "Join my game" share, generic fallback) off pre-rendered rasters. The only runtime
decision is *which* static card a `/join?code=` link points at - resolved server-side via a new
public room-preview endpoint (crawlers are not room members, so `getRoom` cannot be used).

Build in a worktree; test before commit; open a PR for persona review.

## Step 1 - Game marks (`assets/game-trivia.svg`, `assets/game-liarliar.svg`)

- Author both at 512x512 to the family rules in `packages/brand/BRAND.md`: radial-glow dark tile
  (`bo-bg` #221836 -> #0d0a15), two-pass spark strokes (`#FBBF24 -> #EC4899 -> #7C3AED`),
  party-color leaf-node cores with halos + white highlights, and the single gold root `#d2a463`
  at the base. Reuse the `branchout-icon.svg` structure as the skeleton so they read as siblings.
- **Trivia:** bend the branch graph into a question mark - a curved stem of nodes arcing over,
  the gold root as the dot at the bottom.
- **Liar Liar:** a domino/masquerade mask formed by two node-cluster "eyes" bridged by branch
  strokes, one leaf-node offset/dimmed as the "lie"; gold root centered below as the chin anchor.
- Verify each renders and holds down to ~64px (game-card size).

## Step 2 - Brand exports (`packages/brand/src`)

- Add `src/trivia.ts` and `src/liarliar.ts` mirroring `icon.ts` (raw SVG string import), and
  re-export `triviaSvg`, `liarLiarSvg` from `src/brand.ts`.
- Confirm `svg.d.ts` / tsup config already inline `?raw`-style SVG imports (icon.ts pattern);
  match it exactly so the build picks them up with no config change.

## Step 3 - Raster generation (`packages/brand/scripts/generate-rasters.mjs`)

- Keep the favicon loop. Replace the single centered-icon OG with:
  - **Home card** (`og-1200x630.png`): render `branchout-logo.svg` (wordmark + tagline) scaled to
    ~880px wide, centered on the `#0d0a15` canvas. This is the "logo and tagline" home card.
  - **Share cards** - a small helper `buildShareCard(gameSvg, outName)` that composites, on the
    `#0d0a15` canvas: (a) the game mark ~520px, offset right/centered as the backdrop art;
    (b) the "Join my game" headline rendered as an SVG text buffer, bottom-left; (c) the
    `branchout-favicon.svg` mark ~96px in the top-left safe area. Emit `share-trivia.png`
    (trivia mark), `share-liarliar.png` (liar-liar mark), and `share-join.png` (the
    `branchout-icon.svg` as generic art).
  - Render the "Join my game" text via a tiny inline SVG string (system font stack, #e6edf3) ->
    `sharp` buffer, so no font files are needed (matches how the logo SVG sets type).
- Copy all four new rasters into `apps/web/public/` alongside the existing favicon/og copies.
- Update `packages/brand/BRAND.md`: document the game-mark rules (Step 1) and list the new
  generated files under "Generated files (do not commit)".

## Step 4 - Brand tests (`packages/brand/src/__tests__/rasters.test.ts`)

- Extend the existing raster test: after running/importing the generator, assert each new file
  (`og-1200x630.png`, `share-trivia.png`, `share-liarliar.png`, `share-join.png`) exists and is a
  1200x630 PNG (probe with `sharp(...).metadata()`).
- Extend `brand.test.ts` to assert `triviaSvg` / `liarLiarSvg` are non-empty SVG strings that
  contain the gold-root color `#d2a463` (the gold-root rule holds for game marks too).

## Step 5 - Public room preview (`apps/control-plane`)

- Add `GET /rooms/:code/preview` (route beside the existing room routes). No auth/membership
  guard. Load the room by code; 404 `{ error, code: 'ROOM_NOT_FOUND' }` if absent. Return only
  `{ code, selectedGame, status }` - explicitly no members, sessionId, config, or hostAccountId.
- Service method `previewRoom(code)` in `rooms/service.ts` returning that minimal shape, so the
  route stays a thin transport (mirrors `getRoom` but skips the membership check and redacts to
  the three public fields).
- Tests (`apps/control-plane` route/service tests): known code returns the three fields and
  nothing else; unknown code 404s; assert the response body has no `members`/`sessionId`/`config`.

## Step 6 - Web preview client (`apps/web/lib/room-api.ts`)

- Add `RoomPreview { code; selectedGame: string | null; status: string }` and
  `getRoomPreview(code): Promise<RoomPreview>` using the same `request` helper but **without**
  `credentials` mattering (public). Keep it resilient: callers handle throw as "no game".

## Step 7 - Share-card selection helper (`apps/web/lib/share-card.ts`, new)

- Pure map `shareCardFor(game: string | null): { image: string; alt: string }`:
  `'trivia' -> /share-trivia.png`, `'liarliar' -> /share-liarliar.png`, else
  `/share-join.png`. ASCII alt text ("Join my Branch Out trivia game", generic fallback).
- Keep the game-id constants aligned with `TRIVIA_GAME_ID = 'trivia'` (RoomClient) and use
  `'liarliar'` for the new mark. Unit-testable pure function.

## Step 8 - Join page metadata (`apps/web/app/join/page.tsx`)

- Add `export async function generateMetadata({ searchParams })`: read `code`, call
  `getRoomPreview(code)` in a try/catch; on success pick `shareCardFor(preview.selectedGame)`, on
  any failure (no code, bad code, network) use `shareCardFor(null)`. Return `Metadata` with
  `title: 'Join my game'`, matching `openGraph` (title, description "Tap to join.", the chosen
  image at 1200x630) and `twitter: { card: 'summary_large_image', title, images }`.
- Leave the existing default export (JoinForm) untouched.

## Step 9 - Root metadata (`apps/web/app/layout.tsx`)

- Add `twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] }` to the
  root metadata so the home card renders large. The `openGraph.images` already points at
  `/og.png`, which Step 3 upgrades to the wordmark card - no path change needed.

## Step 10 - Web tests

- Unit: `share-card.test.ts` (trivia/liarliar/null/unknown -> correct image + ASCII alt).
- Unit: `join/generateMetadata` test - mock `getRoomPreview`; assert trivia room -> trivia card,
  thrown preview -> fallback card, and `twitter.card === 'summary_large_image'`.
- E2E (Playwright, per the repo non-negotiable): create a room, select Trivia, hit
  `/join?code=CODE`, and assert the served HTML has `og:image` ending `share-trivia.png` and
  `og:title` "Join my game"; then a bad code -> `share-join.png`. Follow the existing e2e harness
  patterns (see `apps/web` Playwright setup and the trivia integration e2e).

## Step 11 - Verify, reflect, PR

- `pnpm --filter @branchout/brand build` then eyeball all four rasters (SendUserFile) before
  wiring - the visual is the deliverable.
- Full gate: build packages first, then lint + typecheck + unit + e2e across touched packages;
  `prettier --check` (CI runs a format check turbo can miss - see memory).
- Reflect: update `docs/overview/features.md` (share cards + game logos) and
  `docs/overview/architecture.md` (public preview endpoint, OG surfaces); note any brand-raster
  learnings in `docs/overview/learnings.md`.
- Open PR; address `docs/spectra/personas/` review comments; merge on approval (squash; resolve
  threads - see memory).

## Risks / watch-outs

- **Crawler auth:** the whole reason for Step 5 - do not let `generateMetadata` fall back to
  `getRoom`; a crawler is never a member and would always 401.
- **Game not yet selected:** `selectedGame` is null through the lobby (host picks after create),
  so the fallback card is the common early-share case, not an edge case - make it good.
- **SVG text in rasters:** no font files in the pipeline; keep type in the system stack inside the
  SVG (as `branchout-logo.svg` does) so sharp renders it without embedding fonts.
- **Public endpoint scope creep:** preview must never grow member/session fields; assert absence
  in tests so a future change cannot leak them.
