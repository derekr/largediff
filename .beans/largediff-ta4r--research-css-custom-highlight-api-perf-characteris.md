---
# largediff-ta4r
title: 'Research: CSS Custom Highlight API perf characteristics and alternatives'
status: completed
type: task
priority: normal
created_at: 2026-05-12T19:45:33Z
updated_at: 2026-05-12T20:49:59Z
parent: largediff-oyhu
---

Investigation into the CSS Custom Highlight API style-invalidation cost (the ~100-300ms Safari paint hit we measured in largediff-f2q4). Four parallel research threads:

1. **General perf model**: how do browsers (Chromium, WebKit, Gecko) implement Highlight registration internally? What invalidates? Cost scaling vs ranges/nodes/kinds.
2. **WebKit-specific**: known WebKit bugs, blog posts, workarounds. Anything specific to Safari versions.
3. **High-volume update patterns**: best practices for incremental updates, Highlight.clear()/.add() vs replacement, batching strategies.
4. **Industry comparisons**: how do Monaco, CodeMirror 6, GitHub's diff viewer, Sourcegraph, Cursor handle scroll/jump-time syntax highlight at large scale?

## Verify

- [ ] Concrete findings on each thread
- [ ] Synthesized recommendations for largediff's situation (file-windowed sections, 200-2000 ranges per push, hits Safari hard)

## Summary

Synthesized three parallel research threads. Findings:

1. **WebKit's CSS Highlight API is fundamentally non-batched** — `Highlight::repaintRange()` walks every intersecting node per Range, no coalescing. 1500 ranges × 6 names = ~9000 individual renderer repaint calls. Chrome's Blink batches all of this in its PrePaint walk (~5ms); WebKit doesn't.
2. **No WebKit fix in sight** — no open Bugzilla issue tracking it, no TODOs in the source, no recent Safari release notes mention perf work on the API.
3. **No production code surface uses CSS.highlights for syntax** — Monaco, CodeMirror 6, GitHub PR diffs, Sourcegraph, Zed all use per-token spans (or canvas/GPU). The API is designed for cross-token annotations (search hits, blame ribbons), not per-token coloring.

Resulted in largediff-r9wv to migrate to per-token spans.
