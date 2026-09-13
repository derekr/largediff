---
# largediff-ye41
title: 'Safari: replace @container scroll-state(stuck) with JS-driven body.is-stuck class'
status: completed
type: bug
priority: high
created_at: 2026-05-12T05:21:59Z
updated_at: 2026-05-12T05:21:59Z
parent: largediff-oyhu
---

## Symptom

After the navigation redesign, the sticky file-header bar never appeared on Safari (desktop or iOS) when scrolling. It worked in Chromium.

## Diagnosis

The sticky bar's CSS used `@container scroll-state(stuck: top)` to trigger the visibility-visible + flat-corner styling when the bar pins. Scroll-state container queries are Chromium-only (Chrome 134+); Safari and Firefox ignore the rule. Without it the bar's default `visibility: hidden` stayed in effect at every scroll position, so the sticky never showed on Safari.

## Fix

Toggle a `body.is-stuck` class from a passive scroll listener in highlights.ts whenever `#scroller.scrollTop > 0`. Replace the `@container scroll-state(stuck: top)` block with `body.is-stuck #sticky-file-header > .bar { … }`. Also dropped the now-unused `container-type: scroll-state` from `#sticky-file-header`.

## Verification

At scrollTop=0: is-stuck=false, bar hidden. After scroll to 35000: is-stuck=true, bar visible, bar's path matches the active file. After a /jump to f100: scrollTop=825972, is-stuck=true, bar shows 'src/lib/config.ts'. Same behavior expected in Safari since the rule is plain class-based now.
