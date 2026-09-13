---
# largediff-ph4n
title: Stale /view from programmatic scrollTo overrides newer /jump projection
status: completed
type: bug
priority: high
created_at: 2026-05-12T01:15:35Z
updated_at: 2026-05-12T01:15:35Z
parent: largediff-oyhu
---

## Symptom

On mobile (also reproducible at desktop with rapid clicks), tapping multiple files in the drawer in quick succession leaves the viewport blank — the scroller is at the right position for the last-tapped file but the rendered window covers an earlier file's region. Repro: open drawer, tap 5+ files within ~1 second.

## Root cause

The /jump handler emits a morph + an inline scrollTo so the row replacement and the scroll snap apply atomically. But `scroller.scrollTo(...)` fires a native scroll event on the scroller, which trips `data-on:scroll__debounce.16ms` and posts /view. That /view body contains the new scrollTop.

In rapid-tap sequences, the server side now sees this interleave:

1. /jump f25 → setScrollTop = px_f25 → emit projection_f25
2. /jump f80 → setScrollTop = px_f80 → emit projection_f80
3. /view (from f25's programmatic scroll) arrives with scrollTop = px_f25 → applyView resets scrollTop = px_f25 → emit projection_at_px_f25_again

The client gets projection_f80 (scroller jumps to px_f80, window=f80), then projection_at_px_f25 morphs the window BACK to the f25 region. Scroller is at px_f80, rendered rows are around px_f25 → blank.

## Fix

Client-side suppress flag. The inline scrollTo script sets `window.__suppressScrollPost = true` before scrolling and clears it via setTimeout 300ms later. The scroller's scroll handler short-circuits its @post when the flag is set, so the synthetic scroll event from a /jump never becomes a /view POST.

- src/session/projection.ts: inline scrollTo script now toggles the flag.
- src/render/shell.ts: scroll handler reads `window.__suppressScrollPost` and skips the /view POST when set.

## Verification

Stress test: 9 rapid taps spanning the diff (f8 → f25 → f80 → f12 → f200 → f3 → f150 → f400 → f50) with 80ms gaps. Pre-fix: ~6 /view POSTs leaked through, multiple snapshots showed `coversViewport: false`. Post-fix: 0 blank samples, /view count dropped from 6 to 2 (the 2 fire during settle phase as the suppress timer expires naturally). Manual scroll after a jump still fires /view promptly (~27ms after manual scroll). Deployed to Fly.
