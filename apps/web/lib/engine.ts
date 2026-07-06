// The engine's player-facing WebSocket URL. The engine serves http + ws on one port (spec 0007,
// default 4001); the browser connects straight to it. Overridable per environment.
export const ENGINE_WS_URL = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? 'ws://localhost:4001';
