---
# largediff-f2q4
title: 'QA: measure content-visibility''s impact on Safari vs Chrome jump latency'
status: completed
type: task
priority: normal
created_at: 2026-05-12T17:52:17Z
updated_at: 2026-05-12T20:53:17Z
parent: largediff-oyhu
---

Empirical test of `content-visibility: auto` on `.file-section`. Hypothesis: Safari's content-visibility activation is slower than Chrome's; stripping it should make Safari jumps feel closer to Chrome.

## Method

1. Baseline measurement with content-visibility ON (current state):
   - Time from /jump POST to scroll settle in both browsers
   - Sample several files at varying depths
2. Comment out the content-visibility rule
3. Re-measure in both browsers
4. Decide: keep / remove / gate via @supports or UA-sniff

## Decision criteria

- If Safari delta is significant (>50ms improvement) and Chrome delta is small: gate it Chromium-only
- If both browsers improve when removed: drop it (the perf assumption was wrong)
- If only Chrome benefits and Safari is unaffected: keep as-is

## Verify

- [ ] Capture timings in both browsers, both states
- [ ] No regression in scroll smoothness (the original reason content-visibility was added)
- [ ] Console clean in both browsers

## Summary

Tested content-visibility: auto on .file-section in both browsers.

- Chrome: no measurable jump-latency improvement.
- Safari: not only no improvement, but introduced a 'blank diffview after jump' bug — Safari sometimes deferred layout of newly-mounted sections so the scroll landed on an unrendered subtree.

Removed it. Sections now use plain absolute positioning with no containment. All other perf wins (throttle, overscan, skip-when-unchanged, per-token spans) carried the day on their own.
