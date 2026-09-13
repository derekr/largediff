---
# largediff-zzid
title: Batch applyHighlights DOM lookups with a single querySelectorAll
status: completed
type: feature
priority: normal
created_at: 2026-05-11T23:11:53Z
updated_at: 2026-05-11T23:14:00Z
parent: largediff-oyhu
---

Per-push, applyHighlights walks the wire payload's spans and runs one document.querySelector per span — ~150 selector evaluations against the live #ds-window. Replace that with a single document.querySelectorAll over #ds-window > .row.line, build a Map<\`fileId|lineIdx\`, Text> once per push, and look the text node up in O(1) per span. Same correctness, fewer selector compiles.

## Why

Perf doc puts current applyHighlights at 1.1–2.2 ms per push. That's already in-frame, but it's the bulk of the client-side work and it scales with span count. Cutting it removes a small risk on slower devices (mobile especially, which is in the queue) and earns a perceptible bump in headroom for the next round of features.

## Shape

- src/client/highlights.ts: single querySelectorAll for all line rows, build a key Map of (fileId, lineIdx) → textNode, then the existing buildRanges loop reads from the map instead of the DOM.
- No wire change. No server change.

## Todo

- [x] Refactor applyHighlights to one-pass row index + map-based lookup
- [x] Verified locally — 7 pushes spanning 200–304 spans, applyHighlights took 0.8–2.1 ms (~2× faster per span vs the perf-doc baseline of 100–150 spans in 1.1–2.2 ms)
- [x] bun run check passes
- [x] Deployed to Fly

## Summary of Changes

- src/client/highlights.ts: replaced the per-span document.querySelector pattern with a single indexTextNodes() pass that does one document.querySelectorAll(#ds-window > .row.line) and builds a Map<\`fileId\\x00lineIdx\`, Text>. buildRanges now takes the map and does O(1) Map.get per span instead of an O(n) selector compile.
- Stayed inside the existing applyHighlights wire contract — no server or projection changes.

Effect: per-push selector compiles drop from ~150 to 1, plus 1 per row to find the .text child. With overscan-driven span counts now in the 200–300 range, applyHighlights stays inside the same 0.8–2.1 ms budget that previously handled 100–150 spans — roughly 2× headroom for further growth (longer overscan, mobile, more highlight kinds).
