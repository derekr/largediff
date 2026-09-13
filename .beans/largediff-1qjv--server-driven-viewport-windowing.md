---
# largediff-1qjv
title: Server-driven viewport windowing
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:23:06Z
updated_at: 2026-05-11T18:52:50Z
parent: largediff-oyhu
blocked_by:
    - largediff-u4me
    - largediff-qxrh
    - largediff-kazd
---

The scrolling experience: client reports viewport, server slices the row offset table and emits a fat-morph patch for the visible window only.

## Scope

- Scroller div has fixed `height: <totalPixels>px` set on initial render so the native scrollbar reflects the full diff.
- `data-on:scroll__debounce.16ms="@post('/sessions/:sid/view')"` sends `scrollTop` and `clientHeight` as Datastar signals.
- Server handler updates `session.view`, calls `pushProjection(session)`.
- `pushProjection` computes `[startRow, endRow]` for the visible window with a small overscan (e.g. 10 rows), renders absolutely-positioned `<div data-line="N" data-file="F" style="top:Npx">…</div>` rows into a single fragment, and writes a `datastar-patch-elements` event that morphs `#ds-window`.
- Old rows outside the window are dropped by morph; DOM stays bounded (~80–120 rows live).
- Initial view triggered by client posting `{ scrollTop: 0, clientHeight }` after the stream opens.

## Acceptance criteria

- Scrolling through a 200k-line diff stays smooth (no scrollbar jumping, no DOM ballooning).
- Live DOM node count stays within a fixed budget regardless of scroll position.
- The native scrollbar represents the full diff (anchor-pixel-mapped to row offsets).

## Todo

- [x] `src/render/window.ts`: pure renderer — given `(layout, file lookup, session.view)`, produce the inner HTML for `#ds-window` (absolutely-positioned rows with `data-row`/`data-file`/`data-line` and `top:Npx`)
- [x] Replace `pushProjection` body in `src/session/projection.ts` with the real windowing: compute `[startRow, endRow]` from `engine.layout(seed).rowAtPixel(scrollTop±overscan)`, render window, emit `datastar-patch-elements` (`mode: inner`, selector `#ds-window`)
- [x] Extend `ProjectionDeps` with `engine: DiffEngine`; wire it in `src/server.ts`
- [x] Update `src/render/shell.ts`: scroller gets fixed `height: <totalHeight>px`, `data-ref:scroller`, and `data-on:scroll__debounce.16ms` posting `view`. **Plus `{requestCancellation: 'none', openWhenHidden: true}` on the `@get('/stream')`** — Datastar's default `auto` cancellation aborts any prior request from the same element, so every `/view` POST was killing the open stream (manifested as `ERR_ABORTED`).
- [x] Server-side initial render: `attachStream`'s `onAttached` callback fires `pushProjection` for the current `session.view`; projection falls back to a 800px viewport when `view.height` is 0 so the first paint contains real rows
- [x] `src/client/styles.css`: row positioning (absolute; line/header heights match `ROW_HEIGHTS`) plus add/del/ctx coloring with `+`/`-`/` ` prefixes
- [x] Tests: `window.test.ts` (overscan bounds, one row element per row in slice, `top` matches `layout.pixelTop`, all three row kinds present, HTML escaping)
- [x] Tests: extended `projection.test.ts` (verifies `datastar-patch-elements` event, `selector`/`mode` data lines, `elements` lines, fallback viewport when height=0)
- [x] Browser verify with chrome-devtools MCP: 5 scrolls (100k → 3.5M px) each morphed correctly (row 4979 → 24944 → 49902 → 99813 → 174688). DOM stayed at 73 rows throughout. Native scrollbar reflects full ~4M px height.
- [x] `bun run check` clean

## Summary of Changes

- `src/render/window.ts`: pure renderer `renderWindow({layout, fileSummaries, lineFor, scrollTop, height, overscan?})` returns `{startRow, endRow, html}`. Window is `[rowAtPixel(scrollTop) - overscan, rowAtPixel(scrollTop+height) + overscan]` clamped to layout bounds. Default overscan = 10. Each row is an absolutely-positioned `<div data-row=… data-file=… class="row file-header|hunk-header|line ctx|add|del" style="top:Npx">` with HTML-escaped contents. Rows joined with `\n` so each row becomes its own `data: elements <html>` SSE line.
- `src/session/projection.ts`: replaced placeholder ack with real pushProjection. Pulls `meta` + `layout` from the engine, splits each touched file's content into lines (cached for the call), renders the window, builds the Datastar SSE payload (`selector #ds-window\nmode inner\nelements …`), and emits `datastar-patch-elements`. Falls back to 800px viewport when `session.view.height` is 0 so the first paint is meaningful.
- `src/server.ts`: instantiated `createDiffEngine({ defaultLines: 200_000 })`, added it to `ProjectionDeps`, set `idleTimeout: 0` on `Bun.serve` so long-lived SSE survives, and passed `onAttached` to `attachStream` for the initial render.
- `src/render/shell.ts`: scroller now has fixed `height: <totalHeight>px` on `#ds-window`, `data-ref:scroller`, `data-init="@get('/stream', {requestCancellation: 'none', openWhenHidden: true})"`, and `data-on:scroll__debounce.16ms="$scrollTop = $scroller.scrollTop; $height = $scroller.clientHeight; @post('/view')"`. Body signals seeded with `scrollTop: 0, height: 0`.
- `src/client/styles.css`: row positioning (absolute, flex), per-kind heights (40 / 24 / 20), file-header/hunk-header chrome, add/del tinting + `+`/`-` markers.

## Two non-obvious gotchas

1. **Datastar's `requestCancellation: 'auto'` default** aborts any prior request from the *same element*. Since `data-init="@get('/stream')"` and `data-on:scroll="@post('/view')"` were both on the scroller, every scroll-driven `/view` was killing the open `/stream`. Fix: explicit `{requestCancellation: 'none', openWhenHidden: true}` on the `@get`. This was the actual root cause behind hours of red herrings.
2. **Bun.serve's default 10s `idleTimeout`** kills long-lived SSE responses (covered in the kazd summary).

## Browser-verified acceptance

- Scrolling through a 200k-line / ~4 M px diff: 5 jumps across the full range each produced a correctly-positioned window patch.
- Live DOM stays at 73 rows regardless of scroll position (49 initial + overscan growth as height settles).
- Native scrollbar represents the full diff (scroller's `#ds-window` height = `layout.totalHeight`).
- 14.5× brotli compression across 21 warm events (see kazd).
