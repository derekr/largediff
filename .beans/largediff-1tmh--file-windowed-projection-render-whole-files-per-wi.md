---
# largediff-1tmh
title: 'File-windowed projection: render whole files per window instead of pixel-row slice'
status: completed
type: feature
priority: high
created_at: 2026-05-12T16:39:58Z
updated_at: 2026-05-12T16:55:10Z
parent: largediff-oyhu
---

Shift from per-row pixel windowing to per-file windowing. The visible window becomes the set of files whose pixel range intersects [scrollTop - overscan, scrollTop + height + overscan]. Files with row count <= INLINE_FILE_ROW_LIMIT (2000) render fully; larger files virtualize internally using today's logic scoped to that file.

## Why

- Today every scroll re-stamps `top:Npx` on every visible row -> full morph payload per /view tick. With sections, scrolls within an inline file produce a byte-identical subtree -> Idiomorph sees no diff, zero per-row work.
- Sticky chrome becomes pure CSS (`position:sticky; top:0` on `.file-card-header` inside each section). Retires the scroll-listener sticky-push, `is-stuck` toggle, and the Chromium-only `@container scroll-state` story.
- Jumps land on a section already mounted (when within window) -> iOS WebKit mid-row anchor weirdness goes away.
- Active-file probe simplifies; per-file collapse becomes natural.

## Scope (local-only, no deploy)

- [x] Add `pixelHeightOfFile`, `rowCountOfFile`, `firstRowOfFile`, `filesIntersecting` to `Layout`
- [x] Create `src/render/files.ts` (replaces window.ts model) with two-tier rendering: inline-file (full) and huge-file (windowed within section)
- [x] Section HTML: `<section id="f-{fileId}" data-file="{fileId}" style="top:Apx;height:Bpx">` with sticky `.file-card-header` and `.file-rows`. Row `top` becomes relative to its section.
- [x] Stable row ids `r-{rowIndex}` (kept global indexing — works for both inline and virtualized cases)
- [x] Update `pushProjection` to call `renderFiles`; harvest `visibleByFile` directly from the slice (drop the row-walk in highlights)
- [x] CSS updates: section absolute positioning; sticky header inside; drop is-stuck-driven rules
- [x] Retire `body.is-stuck` scroll listener in `client/highlights.ts` (sticky is CSS-driven now)
- [x] Decide on `#sticky-file-header` top-bar: removed (each section's own sticky chrome carries the path now)
- [x] Update tests (renamed to `files.test.ts`; projection.test.ts adjusted for section morph wire shape)
- [x] Verify locally: scroll within file (no morph payload, sameNode + identical outerHTML confirmed), cross file boundary (chrome handoff is pure CSS, no JS), jump to file (200 at scrollTop 1.66M lands clean, 2 sections mounted)
- [x] Browser smoke via chrome-devtools MCP: scroll, sidebar jump (f20, f200), sticky behavior across file boundaries, both chrome modes (github/bleed), 0 console errors beyond debug message

Refs sketch in conversation 2026-05-12.


## Status

- bun test: 117 pass, 0 fail
- bun run check: clean (no warnings)
- SSE wire format verified: emits `<section data-fi=\"0\" class=\"file-section\" style=\"top:0px;height:Npx\">` with `<header class=\"file-card-header\">` and `<div class=\"file-rows\">` containing rows with section-relative `top`.

**Local server smoke pending visual confirmation** — chrome-devtools MCP is in a bad state and could not drive the browser this run. Asking user to refresh http://localhost:3000/ and verify visually.


## Summary of Changes

- **Layout helpers**: `pixelHeightOfFile`, `rowCountOfFile`, `firstRowOfFile`, `fileCount`, `filesIntersecting` (src/diff/layout.ts).
- **render/files.ts** replaces window.ts. Two-tier rendering: inline files (rowCount <= 2000) emit whole `<section>` subtree; large files virtualize rows within their section. Visible line ranges per file harvested in-place into `slice.visibleByFile` so the projection no longer re-walks rows for highlights.
- **Section markup**: `<section id="f-{fileId}" data-fi="N" class="file-section" style="top:Apx;height:Bpx">` with sticky `<header class="file-card-header">` and `<div class="file-rows">` containing absolutely-positioned rows (`top` relative to the section, not the scroller).
- **CSS** rewrite: removed `#sticky-file-header` and all `body.is-stuck` rules. Sticky chrome is now pure CSS (`position:sticky; top:0` inside each section). Section absolute positioning, github vs bleed differentiated by `padding-top` on section + chrome `height` (40 vs 72).
- **shell.ts**: dropped `#sticky-file-header` div from the page shell.
- **client/highlights.ts**: dropped `setupStuckState` and the `body.is-stuck` toggle. Anchor MutationObserver now also watches `attributes: data-anchor` with `subtree: true` (sections may already exist when the jump arrives) and removes `data-anchor` after scrollIntoView so subsequent re-emissions of the same section subtree do not re-scroll.
- **Tests**: window.test.ts removed; files.test.ts added with 10 scenarios including the subtree-stability invariant. projection.test.ts adjusted for section-shape morph wire output. 117 pass / 0 fail.

## Verified locally

- bun run check: clean (0 warnings, 0 errors)
- chrome-devtools MCP smoke: github chrome scroll, bleed toggle, jump to f20 + f200, file 0 -> file 1 sticky handoff, no console errors.
- Wire stability: `section[data-fi="200"].outerHTML` is byte-identical before and after a 100px scroll within the file (sameNode=true, length unchanged at 158344 bytes).
