// The engine's player-facing WebSocket URL. The engine serves http + ws on one port (spec 0007,
// default 4001); the browser connects straight to it. Overridable per environment.
//
// The connect URL carries the `/v1` API version (spec 0033) so the realtime channel is versioned
// like the REST APIs. The engine ws server accepts any path (room/game/player come from the `join`
// frame, not the URL), and Caddy routes `/ws/*` to the engine, so appending `/v1` needs no server
// or proxy change: dev `ws://localhost:4001/v1`, prod `wss://branchout.games/ws/v1`.
import { V1_PREFIX } from '@branchout/protocol';

const ENGINE_WS_BASE = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? 'ws://localhost:4001';

export const ENGINE_WS_URL = `${ENGINE_WS_BASE.replace(/\/+$/, '')}${V1_PREFIX}`;
