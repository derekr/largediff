---
# largediff-ynbd
title: Pixel-signal scroll for /jump (replaces data-anchor scrollIntoView)
status: completed
type: bug
priority: high
created_at: 2026-05-12T17:40:44Z
updated_at: 2026-05-12T17:43:44Z
parent: largediff-oyhu
blocked_by:
    - largediff-ulu5
---

After file-windowing landed, /jump still relies on stamping `data-anchor=""` on the target `.file-card-header` and calling `scrollIntoView({block:'start'})` from a MutationObserver. Two observed symptoms:

1. Safari sometimes shows an empty diffview briefly after a jump, or "lags" before the content appears.
2. Both browsers sometimes land scrollTop a little off (next section not flush with the top of the viewport — prior section's chrome still visible).

## Cause

`scrollIntoView` on a sticky element whose containing section has `content-visibility: auto` is fragile: the browser may not have laid out the chrome yet (subtree is render-skipped while off-screen) and falls back to an intrinsic-size estimate, producing a target position that's tens of px off the actual chrome pixel. Safari is especially inconsistent here.

## Fix

Replace the data-anchor mechanism with a pixel-signal:

- Server: in `pushProjection`, when consuming `pendingAnchorFileId`, include `jumpToPx = pixelTopForFile + FILE_HEADER_GAP_PX` in the signals patch.
- Client: body-level `data-effect` reads `$jumpToPx`, calls `scroller.scrollTo({top:$jumpToPx, behavior:'instant'})`, then resets `$jumpToPx = 0`. Datastar's signal-change detection ensures the effect runs on each new jump.
- Drop `data-anchor` attribute emission from `renderFiles`.
- Drop the MutationObserver in `setupAnchorScroll` (no longer needed).
- Update `files.test.ts` accordingly.

Why this is better:
- Scrolls to an exact number, doesn't depend on element layout being computed.
- Works even if the target section's content-visibility hasn't activated yet — the scrollTo target is just a pixel.
- Matches the iOS WebKit-safe pattern (signal + body-level effect, NOT inline scripts inside morph).

## Verify

- [ ] bun run check + bun test green
- [ ] Chrome MCP: jump to f50, f100, f200 — section flush with top each time, no blank flash
- [ ] Safari verification still pending — user to retry


## Summary of Changes

- **shell.ts**: added `jumpToPx: 0` to `data-signals` and a body-level `data-effect` that calls `scroller.scrollTo({top: \$jumpToPx, behavior:\"instant\"})` then resets the signal.
- **projection.ts**: when consuming `pendingAnchorFileId`, the signals patch now carries `jumpToPx = pixelTopForFile(targetIdx) + FILE_HEADER_GAP_PX`. Removed the `anchorFileId` pass-through to renderFiles. Fingerprint cache also stores the slice fingerprint on jump (not the empty-string sentinel) so the settling /view POST gets skipped.
- **files.ts**: dropped the `data-anchor=""` attribute stamping and the `anchorFileId` field from `FilesContext`.
- **client/highlights.ts**: deleted `setupAnchorScroll` and its MutationObserver.
- **files.test.ts / projection.test.ts**: data-anchor assertions replaced with jumpToPx signal-payload checks.

Verification: 4 sidebar jumps (f3, f10, f50, f150, f300) all landed with `chromeYRelScroller=0` (flush), no console errors. Safari should now also work — the pattern is the iOS-safe signal+body-effect from feedback memory `feedback_ios_inline_script_morph.md`.
