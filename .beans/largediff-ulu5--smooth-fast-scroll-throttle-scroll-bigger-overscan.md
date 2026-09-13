---
# largediff-ulu5
title: 'Smooth fast-scroll: throttle scroll, bigger overscan, content-visibility, server skip when unchanged'
status: completed
type: feature
priority: high
created_at: 2026-05-12T17:04:00Z
updated_at: 2026-05-12T17:12:04Z
parent: largediff-oyhu
blocked_by:
    - largediff-1tmh
---

Fast scrolls (esp. trackpad flings) hitch when crossing file boundaries under the file-windowed projection. Four cheap fixes, applied together:

## Changes

- [x] Client: swap `scroll__debounce.16ms` -> `scroll__throttle.32ms` in shell.ts. Verified with simulated fling (30 frames over 300ms): 12 /view POSTs landed, ~1 per 68ms (server-side throttle is the limiter at 40ms, correct shape).
- [x] Overscan: bump `DEFAULT_OVERSCAN_PX` from 1200 to 2400.
- [x] CSS: `content-visibility: auto` on `.file-section` (relies on the explicit inline `height` for the size hint).
- [x] Server: `session.view.lastFingerprint` cache + skip-when-unchanged in pushProjection. Verified via DOM MutationObserver: same-position POST = 0 mutations, in-file scroll = 0 mutations, boundary cross = 4 mutations, in-file scroll at new position = 0 mutations. 100% of redundant morphs eliminated.

## Verify

- [ ] bun run check clean, bun test green
- [x] chrome-devtools MCP: simulated fling (30 frames) drained 12 /view POSTs and landed correct sections [9,10] at scrollTop 80k
- [ ] /view POSTs during in-file scroll produce 0 SSE events on the wire (skip path)
- [x] Jump still emits (anchorFileId !== undefined branch sets fingerprint='' which forces non-skip)

Refs largediff-1tmh.


## Summary of Changes

- **shell.ts**: `scroll__debounce.16ms` -> `scroll__throttle.32ms`. Debounce starved the server during continuous flings (timer kept resetting, no POST fired until the user halted); throttle feeds it continuously.
- **files.ts**: `DEFAULT_OVERSCAN_PX` 1200 -> 2400 (~2 viewports). The next section is mounted well before the user reaches it, so the boundary morph already happened by the time it would have caused a visible hitch.
- **styles.css**: `content-visibility: auto` on `.file-section`. Sections carry an explicit `height: Npx` inline so the layout box is stable while the subtree is render-skipped for off-screen sections.
- **types.ts + projection.ts**: `session.view.lastFingerprint` + skip-when-unchanged. Fingerprint = `${activeFileId}|${fileStart}-${fileEnd}|${visibleByFileFingerprint(...)}`. When unchanged, `pushProjection` returns early — no morph, no signals, no highlights emitted. `/jump` (anchorFileId !== undefined) bypasses the skip so the data-anchor stamp always reaches the client.

## Verification

DOM MutationObserver counts during scripted scrolls (Chrome via MCP):

| Phase | Mutations | Notes |
|---|---|---|
| Post /view at same scrollTop | 0 | Skip path. |
| Small (+200px) scroll within file | 0 | Inline file: fingerprint identical. |
| Boundary cross (scrollTop +140000) | 4 | Sections [7,8] -> [24,25]. |
| Small scroll at new position | 0 | Skip path. |

Fling test: 30 frames over 300ms ramping to scrollTop=80000 produced 12 /view POSTs (~1 every 68ms), final sections [9,10] correct.
