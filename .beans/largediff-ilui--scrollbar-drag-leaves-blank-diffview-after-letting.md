---
# largediff-ilui
title: Scrollbar drag leaves blank diffview after letting go
status: completed
type: bug
priority: high
created_at: 2026-05-12T20:55:13Z
updated_at: 2026-05-12T20:55:56Z
parent: largediff-oyhu
---

After a scrollbar drag, the viewport could land on a y where no section is mounted, and the trailing /view never fires (Datastar's `__throttle` is leading-edge-only when the throttle window is mid-wait), so the server never re-renders for the final position.

Repro in Chrome (simulated): 30 scrolls over 200ms ending at scrollTop=300000. After 500ms idle: 0 additional /view posts, `inViewport: null` (mounted section's pixel range doesn't cover scrollTop=300000).

## Fix

Added `data-on:scrollend` handler on `#scroller` that posts /view with the final scrollTop. `scrollend` fires once after the scroll settles (Safari 18+, Chrome 114+, Firefox 109+ — all our targets). Pairs with `__throttle.32ms` so during-drag pushes still flow at cadence, plus a guaranteed final post when motion stops.

## Verify

- [x] bun run check + bun test green
- [x] Chrome repro now lands sections covering the final scrollTop
- [ ] Safari: scrollbar drag → release → no blank diffview (pending user verification)

## Summary of Changes

shell.ts: added `data-on:scrollend` handler on `#scroller` that posts /view with the current scrollTop. Pairs with the existing `__throttle.32ms` scroll handler — throttle handles cadence during motion, scrollend guarantees a trailing post when motion stops.

Repro before: Chrome simulated drag → 17 /view posts, 0 trailing, mounted section's pixel range didn't cover final scrollTop (blank).
Repro after: Chrome simulated drag → 42 /view posts, 0 additional trailing (the final scrollend was already in the count), mounted section now covers final scrollTop.
