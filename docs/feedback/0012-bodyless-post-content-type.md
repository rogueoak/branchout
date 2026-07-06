# Bodyless POST + application/json 400s at the real server

## Symptom

The deployed app's landing/signup/login worked, but "Create a room" failed with a 400
(`FST_ERR_CTP_EMPTY_JSON_BODY`, "Body cannot be empty when content-type is set to
application/json"). Hosting a game - the core flow - was broken in the browser.

## Root cause

`apps/web/lib/room-api.ts`'s `request` helper set `content-type: application/json` on every
call, including bodyless POSTs. `createRoom()` sends no body, so Fastify saw a JSON content-type
with an empty body and rejected it before the handler ran. The unit tests mocked `fetch` and only
asserted method + credentials, never the content-type against the body, so a passing suite shipped
a broken request. It surfaced only against a real Fastify server at deploy time.

## Fix

Only declare `content-type: application/json` when there is a body. Added tests that pin a
bodyless POST sends no JSON content-type and a bodied POST does.

## Learning

**A mocked transport hides content-type/body contract bugs; assert the wire shape, and prefer a
real-server test at the seam.** A request helper that stamps `content-type: application/json` on a
bodyless request is rejected by a strict server (Fastify) even though a mocked `fetch` accepts it.
Test the actual request shape (headers vs body), and run at least one real-server integration test
per external boundary - the class of "works against a mock, 400s against the server" bug is
invisible to unit tests alone.
