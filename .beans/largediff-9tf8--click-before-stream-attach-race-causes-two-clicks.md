---
# largediff-9tf8
title: Click-before-stream-attach race causes 'two clicks needed' on prod / slow networks
status: completed
type: bug
priority: high
created_at: 2026-05-12T05:32:47Z
updated_at: 2026-05-12T05:32:47Z
parent: largediff-oyhu
---

## Symptom

On Fly (prod), the first click on a sidebar file row sometimes did nothing. The second click navigated. Didn't repro locally where the SSE stream attaches instantly.

## Root cause

The /jump handler synchronously calls pushProjection, which looks up the writer in WriterRegistry. If the SSE stream from data-init hasn't fully connected yet, writers.get returns undefined and pushProjection returns silently — no morph, no signals, no anchor, no scroll. Server returned 204 but the client got nothing.

The window for this race is the time between page render and the SSE stream completing its handshake. Locally that's a few ms; on Fly it's 50–200ms depending on latency. Fast enough for a user to click before the writer attaches.

## Fix

Park the jump intent on the session. session.view.pendingAnchorFileId is set by /jump before calling pushProjection. pushProjection reads it, emits the data-anchor in the morph, then clears it. If the writer is missing, pushProjection returns silently — pendingAnchorFileId stays set — and the next push (onAttached's initial push after writer attach) consumes it and emits the anchor. No second click required.

While I was there, also dropped the PushProjectionExtras type entirely. session is now the single source of truth for projection content; no per-call extras parameter.

## Verification

bun test passes the new 'preserves pendingAnchorFileId when no writer is attached' regression. Deployed; first-click navigation on prod should work even when the click lands before the stream is up.
