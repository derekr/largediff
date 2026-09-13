---
# largediff-2ht5
title: Sidebar auto-recenter fights the user's own scroll
status: completed
type: bug
priority: high
created_at: 2026-08-25T16:42:15Z
updated_at: 2026-08-25T16:47:23Z
---

Two defects make sidebar navigation feel stuck. Diagnosed in detail via subagent investigation; symptoms confirmed in-browser.

## Defect 1: any diff scroll destroys the user's sidebar scroll position

`ViewState.lastActiveFileId` is documented in `src/session/types.ts` as the recenter gate — *"Auto-recenter only fires when this CHANGES"* — but `grep -rn lastActiveFileId src/` returns exactly two hits: the declaration and one assignment in `projection.ts`. **Nothing ever reads it.**

The gate that actually runs is `lastScrollTop`, i.e. "did the diff move by any number of pixels". Every `data-on:scroll__throttle.32ms` tick satisfies it, so the recenter fires while the user is simply *reading*, not navigating.

Repro: click a file, scroll the sidebar down to look ahead, then scroll the diff by 60px inside the same file — the sidebar snaps back. `applySidebarView` writes the user's authoritative `sidebarScrollTop` and the next `/view` POST overwrites it ~30x/second.

## Defect 2: clicking the last fully-visible row is a fixed point

The recenter condition is *strictly outside* the viewport. With `clientHeight=859` and 32px rows, rows 0-25 are fully visible, so clicking row 25 never recenters and never mounts new rows. Repeated clicks on the last visible row make no progress at all.

## Chosen fix

Explicit `sidebarUserScrolled` bit on `ViewState`, plus actually reading `lastActiveFileId`:

```
applySidebarView() -> sidebarUserScrolled = true
applyJump()        -> sidebarUserScrolled = false
applyTop()         -> sidebarUserScrolled = false

recenter if (!sidebarUserScrolled && activeFileChanged)
```

Invariant: **the sidebar follows navigation; once you scroll the list by hand it is yours until you navigate again.** One bit of server state, greppable and testable, consistent with the "state on the backend" principle. Chosen over the one-line `activeFileChanged`-only fix because that still yanks the list when a reading-scroll crosses a file boundary.

## Also noted (not in scope unless trivial)

`src/client/sidebar.ts` defines `window.__sidebarServerScrolled` and reads `serverScrollUntil` at line 54, but **nothing ever calls the setter** — the body data-effect it was meant to pair with was replaced by the `data-init` string built in `projection.ts`, which emits a bare `scrollTo`. Currently benign (the echo posts the same value) but it costs a round trip per server scroll and is a trap if smooth scrolling is ever added. Either wire it up or delete it.

## Verify

- [x] `sidebarUserScrolled` added, set/cleared in the right commands
- [x] recenter gate reads both the bit and `activeFileChanged`
- [x] `lastActiveFileId` is no longer dead state
- [x] tests: reading-scroll does not move the sidebar; navigation does
- [x] verified in-browser: scroll sidebar, scroll diff, sidebar stays put
- [x] dead `__sidebarServerScrolled` hook resolved either way

## Summary of Changes

`ViewState.sidebarUserScrolled` added. Set only on an explicit gesture, cleared by `doJump` and `applyTop`. The recenter gate in `renderInitialPaint` now reads `activeFileChanged && !sidebarUserScrolled` instead of `lastScrollTop` — which also makes `lastActiveFileId` live state for the first time.

### The trap this uncovered

Ownership tracking initially made things *worse*, in two ways that only appear once you look at what the client actually posts:

1. `send()` always included `scrollTop`, so inferring "user scrolled" server-side from its presence meant the **initial measurement on page load claimed ownership** — suppressing the first auto-recenter of every session.
2. The dead `__sidebarServerScrolled` hook stopped being benign. A server-driven recenter scroll fires `scroll`/`scrollend`, which echoed back to `/sidebar`; under ownership tracking that echo would mark the reader as owning a list they never touched, so **one recenter would cancel every recenter after it**.

Fixed by making the client state its intent: `/sidebar` now carries a `user` boolean, true only from the scroll listeners. The initial measurement and the resize handler send `user: false`. `pushProjection` emits `window.__sidebarServerScrolled?.()` immediately before its `scrollTo`, and `scrollend` honours the suppression window instead of being bound straight to the sender.

### Verified in Chrome

| step | sidebar scrollTop | expected |
|---|---|---|
| jump to f60 | 1634 | recentered |
| user scrolls list to 4000 | 4000 | user gesture |
| diff +60px, same file | **4000** | unchanged — this was the bug |
| diff +20000px, crosses files | **4000** | user still owns it |
| jump to f200 | 6114 | handed back, recentered |
| jump to f350 | 10914 | still recenters (echo trap) |

The two reading-scroll tests were confirmed to fail against the old `lastScrollTop` gate before being committed.

### Not a bug

The original 3-cycle report was a measurement-harness artifact, not a product defect: navigation walked all 500 files correctly and then hit the end of the list, where the harness cycle-breaker bounced between the last mounted rows.
