---
# largediff-op6h
title: File tree sidebar and jump-to-file navigation
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:23:17Z
updated_at: 2026-05-11T19:06:46Z
parent: largediff-oyhu
blocked_by:
    - largediff-u4me
    - largediff-kazd
---

A scrollable sidebar listing every file in the diff, with per-file add/delete counts and click-to-jump behavior that drives the scroller to the file's pixel offset.

## Scope

- Sidebar HTML rendered server-side once during the initial shell load (`GET /sessions/:sid`). Lists all files with `{path, language, additions, deletions}`.
- Each file row: `<a data-on:click="@post('/sessions/:sid/jump')" data-file-id="N">…</a>`.
- `/jump` handler updates `session.view.scrollTop` to the file's offset and emits a `datastar-patch-signals` event setting `$scrollTo = <px>`, plus the usual window push.
- `data-effect="$scrollTo"` on the scroller assigns `el.scrollTop = $scrollTo`, which triggers the normal scroll handler and natural window painting.
- Active-file highlight in the sidebar follows `session.view.selectedFileId`.

## Acceptance criteria

- Clicking any file scrolls smoothly to its position; the active file is highlighted in the sidebar.
- Scrolling the main view updates the active file in the sidebar (server-derived from `view.scrollTop`).
- The sidebar handles 200+ files without choking (consider its own light virtualization if needed, but probably fine to render all).

## Todo

- [x] Extend `DiffFileSummary` with `additions` + `deletions`; populate in the generator
- [x] `Layout.pixelTopForFile(fileIndex)` (via a precomputed `fileFirstRow` table on the builder) + `Layout.fileAtRow(rowIndex)`
- [x] `src/render/sidebar.ts`: pure renderer over `meta.files`, one anchor per file with path / lang / `+N -N` and `data-class:active="$activeFileId === 'fN'"` + `data-on:click__prevent="$selectedFileId = 'fN'; @post('/jump')"`
- [x] `src/render/shell.ts`: drop the file-tree placeholder, render the sidebar inline; seed `$activeFileId` and `$selectedFileId` signals on the body
- [x] `pushProjection` derives `activeFileId` from `scrollTop` via `layout.fileAtRow(rowAtPixel(scrollTop))` and emits a `datastar-patch-signals` event alongside the elements patch
- [x] Custom `/jump` handler in `src/server.ts`: `applyJump` → compute pixel offset via `layout.pixelTopForFile` → set `view.scrollTop` → `pushProjection` with `extras: { scrollTo }` so it also emits a self-removing `<script>` that smooth-scrolls the scroller. `applyJump` accepts `selectedFileId` (Datastar signal name) or `fileId` (API name).
- [x] `src/client/styles.css`: file-row chrome, hover + active states, add/del counts, sticky header
- [x] Tests: `sidebar.test.ts` (renders all files, active class signal binding, click handler attrs, HTML escaping, count header)
- [x] Tests: extended `layout.test.ts` for `pixelTopForFile` and `fileAtRow`
- [x] Tests: extended `generator.test.ts` to assert per-file `additions`/`deletions` are non-negative, sum ≤ totalLines, and aggregate ratios stay within expected bounds
- [x] Browser verify with chrome-devtools MCP: clicking row 10 (f9) smooth-scrolled to its pixel offset (~243k px) and updated the active highlight. Manual scrolls (50k → 3M px) tracked sidebar active across f1 → f17 → f50 → f99.
- [x] `bun run check` clean

## Summary of Changes

- `src/store/diff.ts`: extended `DiffFileSummary` with `additions` and `deletions`.
- `src/diff/generator.ts`: counts `LINE_ADD` / `LINE_DEL` per hunk → per file during planning; populates the new summary fields.
- `src/diff/layout.ts`: `LayoutBuilder` tracks `fileFirstRow[fileIndex]` as it emits file headers; `Layout.pixelTopForFile(fileIndex)` returns the file-header pixel offset in O(1); `Layout.fileAtRow(rowIndex)` is the inverse.
- `src/render/sidebar.ts`: new pure renderer. One anchor per file with path / language / `+adds -dels`. Per-row `data-class:active="$activeFileId === 'fN'"` follows the server-pushed signal. `data-on:click__prevent="$selectedFileId = 'fN'; @post('/sessions/' + $_sid + '/jump')"` sends the click to the server.
- `src/render/shell.ts`: drops the file-tree placeholder, renders the sidebar inline at shell-load time. Body signals now seed `activeFileId` and `selectedFileId` (both empty strings).
- `src/session/projection.ts`: `pushProjection` now emits THREE events per push: (1) `datastar-patch-signals` with `{activeFileId}` derived from `layout.fileAtRow(rowAtPixel(scrollTop))` so the sidebar highlight follows scroll, (2) the existing `datastar-patch-elements` morphing `#ds-window`, (3) when `extras.scrollTo` is set, an auto-removing `<script data-effect="el.remove()">scroller.scrollTo({top:N,behavior:'smooth'})</script>` appended to `body`.
- `src/server.ts`: custom `/jump` handler — `applyJump` sets `selectedFileId`, then computes the file's pixel offset via `engine.layout(seed).pixelTopForFile(idx)`, updates `session.view.scrollTop`, and calls `pushProjection` with `extras: { scrollTo }`. The `GET /sessions/:sid` route now also passes `meta.files` to `renderShell` for the sidebar.
- `src/session/commands.ts`: `applyJump` accepts `selectedFileId` (Datastar signal name from the click handler) or `fileId` (API convention).
- `src/client/styles.css`: sidebar layout with sticky header, file-row hover + active states, color-coded add/del counts, ellipsis-truncated paths.
- Tests: 11 new cases across `sidebar.test.ts`, `layout.test.ts`, `generator.test.ts`, `commands.test.ts`, and `projection.test.ts`. Total 95 across 11 files.

## Browser-verified acceptance

- Clicking any file row smooth-scrolls the viewport to its pixel offset; the sidebar's `.active` highlight switches to that file. Verified by clicking row 10 (f9) — scroller landed at ~243k px, sidebar active = f9.
- Manual scrolling drives the sidebar's active highlight from the server: scroll positions 50k / 500k / 1.5M / 3M produced active = f1 / f17 / f50 / f99 respectively.
- 134 files in the sidebar render without issue; the sidebar's own scroll handles overflow.

## How the wire fits together

Three event types now flow on the SSE stream:

1. `datastar-patch-signals` carries `activeFileId` (on every push, drives sidebar highlight via per-row `data-class:active`).
2. `datastar-patch-elements` morphs `#ds-window` to the visible row slice (the 1qjv work).
3. `datastar-patch-elements` appended-script that smooth-scrolls the scroller — only emitted on `/jump`, auto-removes via `data-effect="el.remove()"`.
