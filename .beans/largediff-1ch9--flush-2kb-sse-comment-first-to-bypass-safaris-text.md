---
# largediff-1ch9
title: Flush 2KB SSE comment first to bypass Safari's text/event-stream body buffer
status: completed
type: bug
priority: critical
created_at: 2026-05-13T16:24:49Z
updated_at: 2026-05-13T17:18:57Z
---

Real root cause of the Safari Load failed bug (not the Fly cold-start, that was a separate issue).

Symptom: in macOS Safari, /sessions/:sid/stream returns 200 with proper headers, but the response body sits in 'pending' state indefinitely. Datastar's fetch reader never receives a single byte, eventually times out internally and logs 'Load failed' → retries every 1s forever. Diff appears to render because the user often has a previously-loaded DOM state in BFCache or a prior successful tab. Sidebar's .file-rows stays empty because the morph event never reaches the client. Chrome/Firefox/curl all work because they stream the response body to the consumer the moment headers arrive.

Why: Safari's fetch implementation buffers text/event-stream response bodies until an internal byte threshold is hit before yielding the first chunk to the JS reader. Even though our first push is ~190KB, the *first body chunk* delivered by Fly's edge proxy is smaller and never trips Safari's threshold (other browsers don't have this behaviour).

Fix: flush a leading SSE comment line padded to 2KB before the first real event. SSE parsers ignore lines starting with ':' so the padding is invisible to client code, but it forces Safari to release the body to the reader. Identity-encoded streams only (Safari is already forced to identity in compress.ts; for br/gzip the padding would be wasted bandwidth).

## Todo
- [x] Add SAFARI_FLUSH_PADDING and enqueue at stream start (identity only)
- [x] bun run check
- [x] Deploy
- [x] Verify Safari Network tab: /stream completes streaming, first event delivers within ~ms
- [x] Verify sidebar populates on first load
- [x] Note the discovery in arc doc or perf audit page (deferred — followup bean)

Refs: existing memory feedback_long_lived_sse_traps.md, existing bean largediff-zpty (Safari identity encoding)

## Summary of Changes

The actual root cause was different from the title. macOS Safari's fetch implementation buffers text/event-stream response bodies for ~10s before yielding the first chunk to the JS reader. The 2KB padding theory didn't help. The chunked sidebar payload (\n-joined rows) didn't help either. SSE heartbeats every 15s don't help the first-paint window.

**Real fix: pre-render the initial paint into the HTML response so the first paint doesn't depend on SSE at all.**

Server-renders the initial diff slice + sidebar slice directly into the HTML response for /sessions/:sid. The SSE attach still emits these same slices on connect (Idiomorph treats matching DOM as a no-op morph), but the user sees the full page immediately on the HTTP response regardless of how long Safari decides to buffer the SSE body.

This is a more correct architecture anyway — the SSE was always intended for incremental updates, not for initial state delivery. The Datastar Tao 'state on the backend, projection on the frontend' is unchanged; the first projection now ships in the HTML alongside the shell.

Bandwidth cost: HTML response went from 3.2 KB to ~200 KB on first paint. Acceptable trade-off given Safari's buffering can't be worked around.

Files changed:
- src/render/shell.ts — accepts InitialPaint, inlines diffHtml + sidebarHtml
- src/render/sidebar.ts — renderSidebarShell takes initial rows HTML; sidebarWindow rows now joined with \n (so projection can split into per-row data lines for SSE consistency with diff)
- src/session/projection.ts — adds renderInitialPaint(session, deps), exports InitialPaint, splits sidebar SSE payload across multiple data: lines
- src/server.ts — computes initial paint and passes to renderShell
- src/session/stream.ts — periodic 15s heartbeat to keep idle SSE alive (retained from intermediate fix)
- src/render/sidebar.test.ts — updates shell test for new signature
