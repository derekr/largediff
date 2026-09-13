---
# largediff-kflj
title: Shell HTML and Datastar wiring
status: completed
type: task
priority: normal
created_at: 2026-05-11T17:23:54Z
updated_at: 2026-05-11T17:39:11Z
parent: largediff-1fer
---

- [x] Shell HTML rendered server-side in `src/render/shell.ts` with header, `#file-tree` aside, and `#scroller > #ds-window` main column
- [x] Datastar `<script type="module">` import from jsdelivr CDN (`v1.0.0`); verified the URL returns 200
- [x] Session id baked as the local Datastar signal `_sid` via `data-signals='{"_sid":"..."}'` on `<body>`
- [x] Scroller has `data-on-load="@get('/sessions/' + $_sid + '/stream')"` (will 501 until largediff-kazd lands — expected)
- [x] `src/client/styles.css` with two-column layout, monospace lines, dark/light variables, GitHub-ish palette
- [x] `src/client/highlights.ts` exporting `HighlightKind` / `HighlightSpans` types and assigning a stub `window.applyHighlights` that `console.debug`s
- [x] Toolchain wiring: client TS bundled at startup via `Bun.build`, served at `/static/highlights.js`; CSS served at `/static/styles.css`
- [x] Smoke-tested via curl: shell renders with sid + signals + scripts + links; CSS served as `text/css`; bundled JS served as `application/javascript`
- [x] Datastar CDN URL verified reachable (`v1.0.0` → 200; `v1.0.0-RC.11` → 404, so pinned to `v1.0.0`)

## Summary of Changes

- Added `src/render/shell.ts` exporting `renderShell(sid)`. Baked the sid into a Datastar local signal `_sid` so command attributes construct URLs like `'/sessions/' + $_sid + '/stream'` without round-tripping the path.
- Added `src/client/styles.css` with a two-column GitHub-inspired layout (sidebar + scroller), monospace diff rows, dark/light variables, and `::highlight(ds-*)` rules ready for the syntax-highlighting epic.
- Added `src/client/highlights.ts`: `window.applyHighlights` stub plus the `HighlightKind` / `HighlightSpans` types that the projection emitter will use in `largediff-tvb4`.
- Updated `src/server.ts`: bundles `highlights.ts` via `Bun.build` at startup; serves the bundled JS at `/static/highlights.js` and the CSS at `/static/styles.css` (via `Bun.file` for hot-reloadable dev). Replaced the inline placeholder shell with `renderShell(sid)`.
- Added `DOM` to `tsconfig.json` `lib` so client TS sees `window`, `CSS.highlights`, etc.
- Pinned Datastar CDN to `v1.0.0` after probing the URL (RC.11 not published).
- Browser visual check deferred: the page is still a placeholder, and the stream endpoint 501s until `largediff-kazd` — the only "console error" right now is the expected fetch failure on `/stream`. Real browser verification happens once that epic lands.
- `bun run check` passes.
