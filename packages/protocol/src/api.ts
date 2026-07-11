// API versioning (spec 0033). Every functional HTTP + WebSocket API is served under a version
// prefix so a breaking change can later run a second version side by side. `/health` is exempt: it
// is an operational liveness probe (compose healthchecks, the Caddy edge, uptime monitors), not a
// product API, so it stays at the root. This is the single source of truth for the prefix - both
// services and the web client import it rather than hard-coding the string.

/** The current API version. All functional APIs live under this version. */
export const API_VERSION = 'v1';

/** The path prefix every functional API lives under, e.g. `/v1/auth/login`, `/v1/sessions`. */
export const V1_PREFIX = `/${API_VERSION}`;

// The engine -> control-plane report intake subpaths (relative to the version prefix). Both ends of
// this server-to-server seam import these so they cannot drift apart: the control-plane registers
// the routes at these subpaths (under its `/v1` mount) and the engine reporter targets
// `V1_PREFIX + subpath`. They evolved independently once (the reporter posted to `/rounds` while the
// intake served `/engine/rounds`, so every report 404'd wherever CONTROL_PLANE_URL was set - feedback
// `0017`); a shared constant makes that class of mismatch impossible by construction.

/** The round-report intake subpath, below the version prefix (full path: `/v1/engine/rounds`). */
export const ENGINE_ROUNDS_SUBPATH = '/engine/rounds';

/** The game-complete intake subpath, below the version prefix (full path: `/v1/engine/games/complete`). */
export const ENGINE_COMPLETE_SUBPATH = '/engine/games/complete';
