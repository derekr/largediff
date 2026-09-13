---
# largediff-5iki
title: Pixel-based viewport overscan to mask scroll latency
status: completed
type: feature
priority: normal
created_at: 2026-05-11T22:01:33Z
updated_at: 2026-05-11T22:04:13Z
parent: largediff-oyhu
---

The current overscan is row-based (DEFAULT_OVERSCAN = 10 rows above/below). With rows averaging ~20px, that's only ~200px of buffer in either direction — not enough to hide a 50–150ms server round trip during fast scrolls.

## Change

Switch renderWindow's overscan from rows to pixels and default it to one viewport-height above + below the visible region (clamped to a sane min/max). A small scroll within that buffer doesn't reveal any blank space; the bytes for the next push land before the user reaches the rendered edge.

## Math

- Default overscan = clamp(viewport.height, 800px, 2400px)
- Total rendered region ≈ 3× viewport (1 visible + 2× overscan)
- Estimated impact: live DOM rows 76 → ~225, decoded SSE payload 22KB → ~66KB, wire bytes (warm brotli) 1.7KB → ~3-4KB per push. All still well inside one frame.

## Todo

- [x] Update renderWindow to accept and apply overscanPx semantics (replaces row-based overscan)
- [x] ~~projection.ts computes overscanPx from session.view.height with clamps~~ — kept the default 1200px constant; projection.ts didn't need to be aware
- [x] Verify in Chrome DevTools MCP at https://largediff.fly.dev: rendered window covers ~1200px above + below; small 200px scrolls stay fully covered (verified at scrollTop=50000)
- [x] bun run check passes
- [x] Deploy to Fly

## Summary of Changes

Replaced renderWindow's row-based overscan (DEFAULT_OVERSCAN = 10 rows) with a pixel-based overscan defaulting to 1200px each side. With ~20px rows and a typical 800–1200px viewport, this changes the rendered window from ~76 rows to ~160 rows — total rendered range goes from ~viewport-height to ~3× viewport-height.

Live measurement at https://largediff.fly.dev/ at scrollTop=50000 (837px viewport): rendered rows span [48792, 52032] — 1208px above the viewport, 1195px below. A 200px scroll within that buffer is fully covered by already-rendered rows; the next SSE push lands while the user is still looking at content, not blank space.

Test update: src/render/window.test.ts dropped the row-based assertion and now asserts on the pixel-based slice boundaries. bun test green.

Wire impact (estimated): per-push decoded payload grows from ~22 KB to ~50 KB, brotli-encoded wire from ~1.7 KB to ~3–4 KB. All still well inside one frame on client and far inside the available bandwidth on Fly's edge proxy.
