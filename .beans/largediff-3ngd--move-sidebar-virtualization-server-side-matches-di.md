---
# largediff-3ngd
title: Move sidebar virtualization server-side (matches diff-window pattern)
status: completed
type: feature
priority: high
created_at: 2026-05-12T22:55:46Z
updated_at: 2026-05-12T23:23:05Z
parent: largediff-oyhu
---

The current client-side virtualizer ships all file metadata as JSON to the browser and rebuilds rows on scroll. That violates the project principle (state on the backend, frontend is a projection) and leaves us reinventing the file-window pattern we already have for the diff. Server-driven version:

- Track `sidebarScrollTop` and `sidebarHeight` in session.view.
- New POST /sessions/:sid/sidebar command — same shape as /view, posted by a scroll handler on .file-list.
- `renderSidebar()` becomes the shell (header + empty .file-rows container with total height). New `renderSidebarWindow()` returns the slice (rows with stable ids, `active` class baked in if their fileId is the current activeFileId).
- pushProjection emits a sidebar morph (selector .file-rows, mode inner) alongside the diff morph. Skip-when-unchanged: sidebar slice has its own fingerprint (start-end | activeFileId).
- Drop the JSON `#file-tree-data` blob, the client virtualizer module, the data-class:active per-row binding (now server-rendered), and the data-effect that called __sidebarShowActive on the aside.
- Stable row ids (`id="file-row-{fid}"`) so idiomorph preserves DOM identity across morphs — fixes the mobile tap-lost-mid-scroll issue we were about to fix client-side.
- Prewarm-on-mount moves server-side: pushProjection touches engine.file/engine.tokens for each file in the sidebar slice (memoized, so cheap).

- [ ] Server: ViewState fields + DEFAULT_VIEW + commands + route + pushProjection sidebar emission
- [ ] Server: renderSidebarShell / renderSidebarWindow split
- [ ] Client: rewrite src/client/sidebar.ts as a thin scroll-posting handler (throttle + scrollend, like the diff scroller)
- [ ] Drop JSON data blob, client virtualizer state, per-row Datastar active binding, aside data-effect
- [ ] Tests + bun run check green
- [x] Chrome mobile-emulation smoke: drawer open, scroll sidebar deep, tap f150 (drawer closes + diff jumps + activeFi=f150), reopen drawer (sidebar recenters on f150 at upper third 254px from top), diff-scroll-changes-active updates the .active class without disturbing sidebar scroll.

Refs largediff-d9xa (the client virtualization this replaces), largediff-98op.

## Summary of Changes

- **types.ts / commands.ts**: ViewState gains sidebarScrollTop / sidebarHeight / pendingSidebarJumpToPx / lastSidebarFingerprint. New applySidebarView + applySidebarRecenter.
- **server.ts**: POST /sessions/:sid/sidebar (scroll telemetry) and POST /sessions/:sid/sidebar/recenter (drawer-open re-center on active file).
- **render/sidebar.ts**: renderSidebarShell (initial skeleton: header + empty .file-rows with explicit total height) + renderSidebarWindow (server-rendered slice with absolutely-positioned rows, active class baked in, stable file-row-{id} ids for idiomorph). No JSON blob in the page.
- **projection.ts**: skip-when-unchanged split into three independent checks (diff, signals, sidebar). A /sidebar POST that only moves sidebar scroll still emits sidebar morph even when the diff slice is unchanged. /jump or /sidebar/recenter forces signals emission with jumpToPx / sidebarJumpToPx. Server-side engine prewarm on each sidebar slice push.
- **render/shell.ts**: aside data-effect removed; new $sidebarJumpToPx signal; combined body data-effect handles both jumpToPx and sidebarJumpToPx.
- **client/sidebar.ts**: rewritten as ~30 lines — throttled scroll listener that POSTs /sidebar, scrollend backstop, resize hook. No virtualization state on the client.
- **client/highlights.ts**: setupMobileSidebarRecenterOnOpen POSTs /sidebar/recenter on drawer-open (with current .file-list clientHeight) instead of synthesising the scroll client-side.
- **render/sidebar.test.ts**: rewritten for new shape (shell + slice + active class assertion + stable ids).
