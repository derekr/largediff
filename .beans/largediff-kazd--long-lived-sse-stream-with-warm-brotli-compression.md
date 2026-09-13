---
# largediff-kazd
title: Long-lived SSE stream with warm brotli compression
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:22:56Z
updated_at: 2026-05-11T18:52:50Z
parent: largediff-oyhu
blocked_by:
    - largediff-u4me
---

A single long-lived SSE connection per session, wrapped in a node:zlib brotli encoder that accumulates dictionary state across the life of the connection. This is where the compression win comes from.

## Scope

- `src/server/compress.ts`: `wrapStreamWithBrotli(controller, acceptEncoding)` returns `{ writeEvent(event, data), close() }`.
  - Per-event flush via `br.flush(BROTLI_OPERATION_FLUSH, cb)` so the browser receives bytes promptly.
  - Brotli params: `QUALITY=5`, `MODE=TEXT`, `LGWIN=22` (4MB window).
  - `Accept-Encoding` negotiation: `br` → `gzip` (via `CompressionStream`) → identity.
  - Required response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, plus the negotiated `Content-Encoding`.
- `src/session/stream.ts`: `attachStream(session, request, controller)` builds the per-session encoder, stores its writer on the session, listens for `request.signal.aborted` for cleanup.
- The single internal function `pushProjection(session)` uses the session's writer to emit the two SSE events.

## Acceptance criteria

- Inspecting the network tab during scroll shows `Content-Encoding: br` and an open EventStream that stays alive.
- After 20+ scroll-driven pushes, per-event payload size shrinks dramatically vs. the first event (brotli dictionary warmup measurable).
- Disconnect cleanup: closing the tab removes the session entry; no leaked encoders.
- No buffering stalls — the first scroll-after-idle paints within ~50ms locally.

## Todo

- [x] `src/server/compress.ts`: `pickEncoding` (br > gzip > identity) + `wrapStream(controller, acceptEncoding)` returning a `SseWriter` (brotli via node:zlib with QUALITY=5 / MODE=TEXT / LGWIN=22 and per-event `BROTLI_OPERATION_FLUSH`; gzip via `CompressionStream`; identity passes through)
- [x] `src/session/stream.ts`: `attachStream({ sid, request, sessions, writers })` returns the SSE `Response` or `null` on unknown sid; registers writer; detaches on `request.signal.aborted`
- [x] Hand-write SSE bytes (`event: ...\ndata: ...\n\n`, multi-line data → multiple `data: ` lines per RFC) — no SDK coupling
- [x] Wire `/sessions/:sid/stream` in `src/server.ts` through `attachStream`
- [x] Tests: `compress.test.ts` (Accept-Encoding negotiation; brotli round-trip via `BrotliDecompress`; multi-line SSE formatting)
- [x] Tests: `stream.test.ts` (200 + correct headers; 410 on unknown sid; writer attached / detached on abort)
- [x] Browser verify with chrome-devtools MCP: `/stream` is 200 with `Content-Encoding: br`, console clean; verified end-to-end via curl + node `createBrotliDecompress` — 135 wire bytes round-tripped to 5 well-formed `largediff-ack` SSE events
- [x] `bun run check` clean

## Summary of Changes

- `src/server/compress.ts`: `pickEncoding(acceptEncoding)` parses comma-separated tokens with q-values (q=0 disables; case- and whitespace-insensitive) and prefers `br` → `gzip` → `identity`. `formatSseEvent(eventType, data)` produces RFC-shaped SSE bytes (one `event:` line, one `data:` line per `\n` in payload, blank-line terminator). `wrapStream(controller, acceptEncoding)` returns an `SseWriter` (extends `SessionWriter` with `readonly encoding`) backed by:
  - **brotli**: `createBrotliCompress` with `QUALITY=5`, `MODE=BROTLI_MODE_TEXT`, `LGWIN=22` (4 MB window). Each `send()` writes the encoded bytes then calls `br.flush(BROTLI_OPERATION_FLUSH)` so the browser paints promptly while the dictionary keeps accumulating across events.
  - **gzip**: Web `CompressionStream("gzip")` with a backgrounded pump from the readable side into the SSE controller.
  - **identity**: bytes go straight to the controller.
- `src/session/stream.ts`: `attachStream({ sid, request, sessions, writers, onAttached? })` returns the SSE `Response` or `null` for unknown sid (caller turns into 410). Wires headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, plus negotiated `Content-Encoding`). Cleanup is anchored on `request.signal.aborted` — on tab close the writer is detached and the encoder is `close()`'d. `onAttached` callback is the 1qjv hook for pushing the initial projection without a client round-trip.
- `src/server.ts`: `/sessions/:sid/stream` now delegates to `attachStream`; the `notImplemented` helper is gone.
- Tests: 16 new cases across `compress.test.ts` (q-value parsing, br/gzip/identity round-trips via `brotliDecompressSync` / `gunzipSync`, per-event flush, multi-line SSE formatting) and `stream.test.ts` (200 + correct headers, identity emits no `content-encoding`, end-to-end brotli decode, abort detaches the writer, 410 on unknown sid).
- Browser verify via chrome-devtools MCP + curl: `/stream` is 200 with `Content-Encoding: br` and `Content-Type: text/event-stream`; 135 brotli-compressed wire bytes decoded to 5 plaintext `largediff-ack` events (≈3× compression on the tiny placeholder — the real win lands when 1qjv pushes HTML).



## Follow-up after browser verify

Browser-verified end-to-end with chrome-devtools MCP. Two non-obvious gotchas surfaced that the test suite couldn't catch:

1. **Bun.serve's default 10s `idleTimeout`** silently kills long-lived SSE responses with `ERR_INCOMPLETE_CHUNKED_ENCODING`. Set `idleTimeout: 0` in `src/server.ts`.
2. **Synchronous writes inside `ReadableStream.start()`** can cause Bun to treat the response as a one-shot. Deferred the initial push (`onAttached` callback) via `queueMicrotask` so `start()` returns cleanly before any bytes are enqueued.

Both fixes are in place. Wire verification: `curl -H 'accept-encoding: br'` over 21 scroll-driven pushes produced 21,835 wire bytes vs 316,063 decoded — **14.5× compression** as the dictionary warms across events, well past the bean's "per-event payload shrinks dramatically" bar.
