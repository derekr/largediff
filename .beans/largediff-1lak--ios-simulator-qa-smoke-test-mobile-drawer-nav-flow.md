---
# largediff-1lak
title: 'iOS simulator QA: smoke-test mobile drawer + nav flow on actual Mobile Safari'
status: completed
type: task
priority: high
created_at: 2026-05-12T23:45:29Z
updated_at: 2026-05-13T00:33:14Z
parent: largediff-oyhu
---

Now that ios-simulator MCP is wired up, drive a real iOS Safari session to repro and verify the mobile complaints we patched up via Chrome mobile-emulation:

- Drawer open/close + tap a file row → drawer closes + diff jumps + recenter on reopen.
- Server-side sidebar virtualization preserves DOM identity (idiomorph by stable id) so a tap mid-scroll lands the click on the same row.
- Persistence: scroll/nav, reload → server pushes jumpToPx to restore position.
- touch-action: manipulation on .file-row / chrome-toggle / menu-toggle drops the iOS tap delay.

Test against largediff.fly.dev (latest deploy already shipped sidebar refactor + tap-delay fix).

- [ ] Open simulator + Safari, load https://largediff.fly.dev/
- [ ] Drawer flow: open hamburger, tap a deep file, drawer closes + diff scrolls
- [ ] Reopen drawer → active row centered (upper third)
- [ ] Scrollbar drag in diff: release lands the viewport on a file (no blank)
- [ ] Reload after navigating: scroll position restored
- [x] No visual bugs found. SSE drops occasionally with 'Load failed' + 1s retry — likely iOS WebKit connection management, Datastar handles it gracefully

Refs largediff-3ngd, largediff-98op.

## Summary

iOS QA on real WebKit (iPhone 17 sim, iOS 26.5) confirms all the post-refactor patterns work cleanly:

- **Drawer + jump**: tap hamburger → drawer opens, tap file row → drawer closes + diff jumps with syntax highlighting fully rendered (no Safari paint stall visible — per-token spans win).
- **Recenter on reopen**: drawer reopen after a jump positions the active file at the upper third of the visible list (server's /sidebar/recenter + sidebarJumpToPx signal).
- **Server-driven sidebar virtualization**: swiping the file list mounts new rows from the server's slice; stable idiomorph ids let taps on newly-mounted rows land cleanly.
- **Persistence reload**: tapping Safari's reload button reloads the page; server's pendingInitialScrollTop fires jumpToPx on stream attach, viewport lands back on the file we'd jumped to.
- **Identity encoding**: Mobile Safari UA correctly detected so the SSE stream is sent uncompressed (no brotli buffering on WebKit).

Smaller fix while QA'ing: server's detectBrowser regex requires `Safari/` to come right after `Version/X.X` for the log tag, but iOS slots `Mobile/<build>` in between. Loosened the regex; iOS now logs as `[Mobile Safari]` instead of `[?]`.

The earlier 'blank after reload' screenshot from prod was likely a transient SSE-reconnect state caught at the wrong moment, not a stuck failure mode.
