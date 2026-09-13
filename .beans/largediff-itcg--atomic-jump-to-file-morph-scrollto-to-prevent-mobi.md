---
# largediff-itcg
title: Atomic jump-to-file morph + scrollTo to prevent mobile blank-viewport stutter
status: completed
type: bug
priority: high
created_at: 2026-05-12T00:05:33Z
updated_at: 2026-05-12T00:05:33Z
parent: largediff-oyhu
---

Symptom: on mobile, tapping a file in the drawer reliably scrolls the diff but the viewport stays blank until the user manually scrolls. Also: a refresh briefly shows the drawer in its on-screen position before sliding off-screen.

## Diagnosis

Two independent issues.

**Jump blank**: pushProjection emitted the row-window morph and the scrollTo `<script>` as separate `datastar-patch-elements` SSE events, each with its own brotli flush. On mobile networks the two frames can land in different paints — the morph applies first (placing rows at `top: 32808px` for f5), leaving the scroller still at scrollTop=0 with no rendered rows in the visible 0–852px range. The user sees blank space until they touch the scroller, which fires a fresh `/view` that projects for scrollTop=0 and fills the visible window.

**Drawer slide-out on refresh**: `#file-tree { transition: transform 200ms; transform: translateX(-101%) }` unconditionally — the browser treats the initial application of the @media-scoped rule as a property change, animating from no-transform to -101% on first paint.

## Fix

- Inlined the scrollTo `<script>` as the trailing piece of the morph's `elements` payload in `src/session/projection.ts`. Morph + scrollTo now apply in one DOM mutation = one paint = no in-between blank.
- Dropped the now-unused separate scrollTo `patch-elements` event.
- Gated the drawer's transition behind `body.ready` in `src/client/styles.css`. Added a 2× rAF callback in `src/client/highlights.ts` that adds the class after the first paint, so the initial drawer position renders instantly and only subsequent toggles animate.
- Updated `src/session/projection.test.ts` to expect 3 events instead of 4 and to assert the scrollTo lives in the morph payload.

## Summary

Verified on local emulation at iPhone 15 size: frame-by-frame snapshots show the viewport is fully covered by rendered rows from the very first frame after tapping; refresh no longer slides the drawer off-screen. Deployed to Fly.
