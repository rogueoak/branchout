# 0024 - LAN dev + room connect callout

## Problem

Liar Liar is a phone-party game: everyone plays on their own phone against a shared "viewer" screen.
To play (or test) that locally, phones on the same WiFi must reach the dev stack - which today binds
to localhost and points the browser at `localhost` URLs, unreachable from another device. The host
also needs the room screen to make "join on your phone" obvious. This spec adds a one-command LAN dev
recipe and a room-screen connect callout; it does not change any game logic.

## Outcome

- `pnpm dev:lan` (or a documented recipe) runs the whole stack reachable from other devices on the
  LAN: web, control-plane, and engine bound to `0.0.0.0`, and the browser's `NEXT_PUBLIC_*` URLs
  pointed at the host's detected LAN IP so a phone loading `http://<lan-ip>:3000` reaches the API and
  the engine WebSocket.
- The room/lobby screen shows a clear "Others join on the same WiFi" callout: the absolute connect
  URL (already origin-resolved by `ShareLink`) and the room code, presented so a host can read it out
  or others can type it on their phones.

## Scope

In:
- A **`dev:lan` recipe**: a small script that detects the host LAN IP (macOS/Linux), exports
  `NEXT_PUBLIC_ENGINE_WS_URL=ws://<ip>:<engine-port>` and the web's control-plane URL
  (`NEXT_PUBLIC_*`) to `http://<ip>:<cp-port>`, binds each dev server to `0.0.0.0` (web `next dev -H
  0.0.0.0`; control-plane/engine host `0.0.0.0` - the engine already does), and starts the stack.
  Wired as a root `dev:lan` script and documented in the README / `docs/overview` with the exact
  steps (build packages first, per the local-dev note).
- A **room-screen connect callout** (lobby): a labeled, mobile-first block showing the connect URL
  (via the existing `ShareLink`, origin-resolved so it is the LAN URL when loaded over LAN) and the
  room code prominently, with friendly copy ("On the same WiFi? Join at ... with code ABC12"). No new
  runtime dependency.
- Tests for the callout (renders the code + link) and any IP-detection helper (pure function over
  sample `os.networkInterfaces()` shapes).

Out:
- A production hosting change (prod already routes `/api` + `/ws` same-origin behind Caddy - spec
  0011 - so LAN is a dev concern). A QR "scan to join" code (nice follow-up; avoided here to skip a
  new dependency and a bundle/security review). The mode-before-start picker and the room code
  already exist (spec 0006/0010) and are unchanged.

## Approach

- **Origin-resolved URLs mean the web needs almost nothing.** `ShareLink` already resolves the join
  path against `window.location.origin`, so when the page is served from `http://<lan-ip>:3000` the
  connect link is the LAN URL automatically. The callout just surfaces it prominently; the real work
  is the dev recipe pointing the *API/WS* `NEXT_PUBLIC_*` URLs at the LAN IP and binding servers to
  `0.0.0.0`.
- **Detect, don't hardcode, the IP.** A tiny helper picks the first non-internal IPv4 from
  `os.networkInterfaces()` so the recipe works on any network; the script prints the chosen URL so
  the host knows what to open.
- **Dev-only.** The recipe is a developer convenience; production is unchanged (same-origin behind
  the proxy).

## Acceptance

- [ ] `pnpm dev:lan` serves web/control-plane/engine reachable from another device on the LAN, with
      the browser reaching the API + engine WS at the host's LAN IP; the chosen URL is printed.
- [ ] The lobby shows a clear connect callout (absolute LAN URL + room code) usable at ~360px.
- [ ] The IP-detection helper and the callout are tested; `pnpm build && typecheck && test && lint &&
      format:check` green. No new runtime dependency.
