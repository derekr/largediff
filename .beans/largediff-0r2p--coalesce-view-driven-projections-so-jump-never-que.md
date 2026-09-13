---
# largediff-0r2p
title: Coalesce /view-driven projections so /jump never queues behind scroll telemetry
status: completed
type: bug
priority: high
created_at: 2026-05-12T05:38:19Z
updated_at: 2026-05-12T05:41:32Z
parent: largediff-oyhu
---

## Symptom

After scrolling the diff, the first click on a sidebar file row sometimes did nothing on Fly (prod). The second click navigated. Local repro: nope. Order of operations mattered — clicks BEFORE any scrolling worked first time.

## Root cause

Every /view POST (one per debounced scroll event, every 16ms during a fling) immediately triggered a pushProjection. Each pushProjection emits 3 SSE events (~3 KB compressed each, ~70 KB decoded). A few hundred ms of fling-scrolling produced 10–20 pushes. Even with brotli, the SSE stream backs up — events queue waiting to be drained on the wire, the browser receives them in batches, and Datastar applies them sequentially.

When the user clicked a file row mid-fling or just after, the /jump's pushProjection went into the stream BEHIND this backlog. The user saw "nothing happened" because the /jump's SSE response was still queued. By the second click, the queue had drained and the navigation appeared — perceived as the second click being the one that worked.

## Fix

Server-side debounce of the /view-driven pushProjection only. State mutation in applyView stays immediate (so the latest scrollTop is always captured), but the SSE emission is coalesced with a 40 ms timer. Multiple /view POSTs within that window produce a single push at the end with the latest state.

/jump's pushProjection is NOT debounced — it fires immediately AND cancels any pending /view push, so the click's response never queues behind scroll telemetry. Other commands (settings, collapse, reviewed) likewise cancel the pending /view push before their immediate push.

Cleanup wiring: session DELETE clears any pending view-push timer to avoid timer leaks.

## Implementation

src/server.ts adds a per-session pending-timer map and two helpers: scheduleViewPush(session) for /view, cancelPendingViewPush(sid) for everything else.

## Verification

Tests still green (115). Deployed to Fly. Locally not reproducible because scroll-spam doesn't back up SSE on zero-RTT, but the coalescing makes the prod symptom go away by construction.

## Follow-up: switch from debounce to leading+trailing throttle

The 40 ms pure debounce made small isolated scrolls and continuous flings feel laggy/blank:
- Continuous fling: every 16 ms /view kept rescheduling the timer, so no push fired until the user stopped. The rendered window stayed frozen while the user scrolled past the overscan edge → blank.
- Single scroll: 40 ms trailing delay was visible.

Replaced with throttle (leading + trailing). First /view's push fires immediately so a small scroll updates the view with no added latency. Subsequent /views within the throttle window coalesce into one trailing push. Then the next /view after the window pushes immediately again. Continuous scroll now produces a steady ~25 pushes/sec — enough cadence to keep the rendered window fresh, few enough that /jump never queues behind the scroll backlog.
