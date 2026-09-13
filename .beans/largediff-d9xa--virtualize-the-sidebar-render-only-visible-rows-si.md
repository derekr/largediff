---
# largediff-d9xa
title: Virtualize the sidebar — render only visible rows, single delegated scroll listener
status: completed
type: feature
priority: normal
created_at: 2026-05-12T21:09:23Z
updated_at: 2026-05-12T21:16:25Z
parent: largediff-oyhu
blocked_by:
    - largediff-j615
---

Sidebar currently mounts all 500 file rows on page load (DOMSize insight from perf audit largediff-j615 flagged this — "Most children: 500, for parent 'DIV class=file-list'"). Plus 500 IntersectionObservers from setupSidebarPrewarm. Virtualize so only ~25 rows are mounted at any time.

## Changes

- [ ] Server (renderSidebar): emit file metadata as compact JSON (`[id, path, lang, adds, dels]` rows) in a `<script type="application/json" id="file-tree-data">`. Render empty `.file-list > .file-rows` with explicit total height so the scrollbar geometry is correct.
- [ ] Client module `src/client/sidebar.ts`: read JSON, virtualize via scroll handler. Render rows absolutely positioned at `top: index * ROW_HEIGHT`. Re-render visible window on scroll.
- [ ] Reuse Datastar per-row bindings (`data-on:click__prevent`, `data-class:active`) so Datastar's mutation observer attaches handlers automatically.
- [ ] Replace 500 IntersectionObservers with: prewarm each row when it mounts. No observer needed at all.
- [ ] Update the active-file scroll-into-view data-effect to call a virtualizer entry point (the active row may not be in DOM, so we scroll the list to its computed pixel position).
- [ ] Update mobile-drawer-open active-row scroll to use the same entry point.
- [ ] CSS: explicit row height (CSS variable for mobile bigger height).
- [ ] Remove `setupSidebarPrewarm` from highlights.ts.
- [ ] Update sidebar.test.ts for the new shape.

## Verify

- [ ] bun run check + bun test green
- [ ] Chrome MCP: DOM size dropped, active-file follow still works, sidebar scroll still smooth, sidebar clicks still jump
- [ ] Drawer open on mobile still scrolls to active file

## Summary of Changes

- src/render/sidebar.ts: renderSidebar now emits an empty .file-list > .file-rows container with explicit total height + a compact JSON tuple array `[id, path, lang, adds, dels]` in a <script type="application/json" id="file-tree-data">. Added renderSidebarRow helper for tests/debugging.
- src/client/sidebar.ts (new): parses the JSON, mounts rows in the visible window with one viewport of overscan, re-renders on scroll via rAF-coalesced handler. Exposes window.__sidebarShowActive(fileId) for the active-row scroll-into-view effect. Prewarm fires on row mount (Set-guarded so no duplicate POSTs).
- src/client/highlights.ts: imports ./sidebar.ts; setupSidebarPrewarm + its 500 IntersectionObservers removed; setupMobileSidebarSyncOnOpen reads the activeFileId from data-signals and calls window.__sidebarShowActive.
- src/render/shell.ts: aside data-effect routes through window.__sidebarShowActive($activeFileId) instead of querySelector + scrollIntoView.
- src/client/styles.css: --sidebar-row-height variable (32px desktop, 44px mobile); .file-row uses position:absolute and pulls the height from the variable; .file-list and .file-rows tweaked as the scroll + positioning hosts.
- src/render/sidebar.test.ts: rewritten for the new shape (empty container + JSON payload + renderSidebarRow assertions).

## Perf comparison (Chrome MCP performance traces)

| | Before | After |
|---|---|---|
| Cold-load LCP | 65 ms | **57 ms** |
| CLS | 0.00 | 0.00 |
| DocumentLatency wasted bytes | 141.9 kB | **18.3 kB** |
| Total DOM elements | 7814 | **5254** |
| Largest child cluster | .file-list 500 rows | .file-rows ~430 (diff sections — sidebar no longer largest) |
| IntersectionObservers | 500 | **0** (prewarm at mount via Set guard) |
