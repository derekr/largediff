---
# largediff-9plh
title: iOS WebKit doesn't run inline scripts injected via Idiomorph morph reliably
status: completed
type: bug
priority: high
created_at: 2026-05-12T04:11:09Z
updated_at: 2026-05-12T04:11:09Z
parent: largediff-oyhu
---

## Symptom

On iOS, after the URL-path-based /jump fix landed, taps would highlight the right file in the sidebar but the diff wouldn't update (the user saw blank or old content under the new sticky header path). The sidebar highlight works through a signal patch — that succeeded. The morph + inline scrollTo script — that did not.

## Diagnosis

Inline `<script>` tags injected into the DOM via Idiomorph's morph (which uses DOMParser + cloneNode / appendChild) do not execute on iOS WebKit. The HTML spec says scripts only execute during parser-driven insertion, and WebKit follows it strictly here while Chromium has lenient behavior. So the script payload that did `window.__suppressScrollPost = true; scroller.scrollTo(...); setTimeout(...)` was running on desktop but silently skipped on iOS, leaving the scroller at the old position while the morph replaced rows around the new (unscrolled-to) target.

Sidebar highlight worked because it's driven by the `data-class:active` binding watching the `activeFileId` signal — pure Datastar reactivity, no DOM script execution required.

## Fix

Move the scroll target out of the morph payload and onto the signal patch (`scrollTo` field). Add a body-level `data-effect` that watches `$scrollTo` and performs the scroll via Datastar's reactivity — which is browser-uniform. Reset `$scrollTo` to 0 inside the effect so the next /jump's value-change triggers the effect again. Same `__suppressScrollPost` guard moves into the effect.

Reorder the SSE event emission to morph → signals → highlights. Now when the scrollTo signal fires its effect, the rows are already in the DOM at their new pixel positions, so the viewport lands on rendered rows immediately.

## Reinforcement

Also pinned the bug from coming back via caching:
- Session shell HTML now sends Cache-Control: no-store so iOS can't reuse stale HTML from before a deploy.
- Static asset URLs in the shell get a per-server-boot ?v=<token> suffix so cached HTML referencing old asset URLs is forced to re-fetch on each deploy.

## Verification

4 sequential taps across f3, f10, f25, f5 in Chrome DevTools mobile emulation: each sticky path matches the tapped file's path, each scrollTop matches the file's pixel position, viewport fully covered every time. Deployed; rendered HTML confirmed to carry the new `data-effect` for the scroll trigger.
