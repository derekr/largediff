---
# largediff-n64s
title: Sidebar auto-recenters when active file scrolls out of its viewport
status: in-progress
type: bug
priority: high
created_at: 2026-05-13T17:41:44Z
updated_at: 2026-05-13T17:41:52Z
---

User reported: 'when interacting with the scrollbar instead of swiping/mouse wheel the sidebar nav doesn't follow the current file'.

Repro: drag the diff scrollbar from file 0 to file ~300 in one motion. The sidebar's active highlight is supposed to move to f300's row, but the row is at top=9600px while the sidebar's visible window is parked at scrollTop=0 (showing files 0-30). The active class is correctly applied to the f300 row in the morph — it's just off-screen in the sidebar. With wheel/swipe the active file changes slowly enough that it stays in view organically; with a scrollbar drag it jumps too far.

Fix: in pushProjection, after computing activeFileIndex, check if its row is outside session.view.sidebarScrollTop..sidebarScrollTop+sidebarHeight. If so AND no pendingSidebarJumpToPx is already set AND sidebarHeight > 0, update sidebarScrollTop to land the active row in the upper third (matching applySidebarRecenter's policy) and set pendingSidebarJumpToPx so the client's .file-list scrolls to match.

## Todo
- [x] Add auto-recenter block in pushProjection
- [x] bun run check
- [x] Deploy
- [ ] Verify in Safari + Chrome with scrollbar drag
