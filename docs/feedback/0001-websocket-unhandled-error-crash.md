# 0001 - WebSocket server crashes on an unhandled socket error

## Symptom

The game-engine WS adapter (`packages/protocol/src/ws.ts`) wired a `message` and `close`
listener per socket but no `error` listener. A transport error (a client resetting the
connection, ECONNRESET, a write to a half-open socket) is emitted as an `error` event on the
socket; with no listener, Node treats it as an unhandled `error` and crashes the whole
game-engine process. One flaky client could take down every live game. Raised as a major by the
engineer persona on PR #2.

## Root cause

`ws` sockets, like every Node `EventEmitter`, throw if an `error` event has no listener. The
adapter wired only the happy-path events. The server-level `WebSocketServer` had the same gap.

## Fix

Added a per-socket `error` listener that routes to the adapter's `onError` handler (or logs),
plus a server-level `wss.on('error')`. Separated the two failure kinds: a malformed frame is a
client mistake and gets an error frame back; a transport error goes to `onError`. Capped
`maxPayload` at 1 MiB while there (a memory-DoS note from the security persona).

## Learning

Any Node `EventEmitter` needs an `error` listener or one emitted error crashes the process. For
long-lived per-connection resources (sockets, streams), wire the failure events at the same time
as the happy-path events, never as a follow-up. Generalized into `overview/learnings.md`.
