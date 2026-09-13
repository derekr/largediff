---
# largediff-a29m
title: Mobile-responsive layout and touch optimizations
status: completed
type: feature
priority: normal
created_at: 2026-05-11T23:11:08Z
updated_at: 2026-05-11T23:56:24Z
parent: largediff-oyhu
---

Today the app is a fixed two-column desktop layout: a 280px sidebar + a flexible diff column, sticky bars sized in pixels, and a topbar that overflows below ~720px. Hover-only interactions like sidebar prewarm don't fire on touch. This bean makes largediff usable (and pleasant) on a phone.

## Why

The demo and the /doc page both want to be shareable links — someone scrolling Twitter on their phone, an interviewer pulling up the link in a meeting, an engineer reading the architecture brief on the train. The current layout breaks below ~720px (sidebar dominates, topbar wraps, code rows overflow), and the touch profile loses the cache-prewarm win because mouseenter never fires.

## Shape

Single shell, no separate mobile route — just responsive CSS at a 768px breakpoint plus a few touch-targeted JS hooks. Same SSE + projection architecture serves both form factors.

## Layout

- Breakpoint at `@media (max-width: 768px)`.
- Sidebar collapses into a slide-out drawer overlaid on the diff column. New hamburger button in the topbar toggles a `$drawerOpen` signal; CSS transform animates the drawer in/out. Tapping outside or on a file row closes it.
- Topbar collapses: brand stays, tabs hide, chrome-toggle moves behind an overflow menu (or hides entirely — full-bleed becomes the only mobile mode if togglability adds clutter). Session id chip hides.
- Diff column gets the full viewport width when drawer is closed.
- Sticky file-header bar stays — already pixel-stable across the stuck transition, no change needed.
- Use `100dvh` (dynamic viewport height) for the scroller so iOS Safari's collapsing URL bar doesn't break the sticky math mid-scroll.
- `overscroll-behavior: contain` on the scroller to prevent rubber-band from yanking the whole page.

## Diff content

- Long lines currently `white-space: pre` — on narrow viewports they overflow horizontally. Decide between (a) horizontal scroll within the diff column (preserves alignment, requires touch-friendly horizontal scroll), or (b) soft-wrap on mobile only with a continuation marker. (a) matches GitHub mobile and is preferred.
- Line-number columns currently fixed-width (`.ln`). On phones, drop to a single combined column or compress to 3 digits + ellipsis on overflow.
- Code font size stays at 13px (legible enough); could bump to 14px on mobile if testing shows otherwise.

## Touch interaction

- Replace the desktop-only mouseenter prewarm with an IntersectionObserver on `#file-tree` that fires the prewarm POST when a sidebar file row scrolls into the visible portion of the drawer. `\__once` semantics still apply (only the first time per row per session).
- Keep the existing `click` handler — no change needed.
- Tap targets sized to ≥ 44×44 logical px per Apple HIG / Material 48dp: file rows currently render with ~28px height; bump to 44px on mobile.
- Drawer-open should disable background scroll (`body { overflow: hidden }` while `$drawerOpen`).

## /doc page

The doc page already has a media query at 880px (stat strip and lessons stack to single column) so it mostly works. Audit for:
- Hero headline word-wrap balance at 360–414px
- Diagram SVGs scale down gracefully (`width: 100%` is already set on `.diagram svg`)
- Code blocks remain readable (font-size + horizontal scroll on overflow)

## Performance considerations

- Brotli for non-Safari mobile (Chrome on Android) still works — we keep the per-session warm encoder.
- Smaller viewports mean smaller rendered windows: ~1200px overscan is generous for 800px-tall mobile screens, so consider scaling overscan to `min(viewport.height, 1200)` on smaller devices. Already the natural behavior since we pass session.view.height.
- Mobile networks: per-push wire bytes already fit in a single TCP segment; nothing to change.

## Out of scope (follow-ups)

- Native gestures (pinch-zoom inside the diff, swipe between files)
- PWA install / offline support
- Separate `/m` route or any UA-sniffed redirect — responsive is sufficient

## Todo

- [x] CSS: @media (max-width: 768px) block adding drawer + collapsed topbar styles
- [x] Shell: hamburger button + `$_drawerOpen` (underscore-prefixed = client-only) + ARIA wiring
- [x] Sidebar: drawer behavior (slide-in transform via `body.drawer-open`, backdrop click closes, file-row tap closes)
- [x] Scroller: `100dvh` height, `overscroll-behavior: contain`
- [x] Tap target size up to 44px on file rows
- [x] Prewarm: REPLACED mouseenter with IntersectionObserver — same trigger for mouse + touch + keyboard. Rooted on `.file-list` with 200px rootMargin; unobserves after fire so each row prewarms at most once per session
- [x] /doc audit at 393×852: passes — hero balances, stat strip stacks (existing 880px breakpoint), code blocks readable
- [x] Verified locally at iPhone 15 size: drawer opens cleanly below the topbar (z 30 vs z 40), 23 prewarms fire on drawer-open for the visible rows, tap-jump scrolls + closes drawer + marks active
- [x] Sanity-checked at 1440×900: sidebar still docked, hamburger hidden, observer-based prewarm fires for the visible 43 rows
- [x] bun run check passes
- [x] Deployed to Fly
- [ ] Horizontal scroll within the diff column for long lines on mobile — DEFERRED, see notes

## Summary of Changes

- src/client/styles.css: `@media (max-width: 768px)` block: topbar collapses (tabs/chrome-toggle/sid hidden, hamburger shown), `.layout` collapses to 1fr, `#file-tree` becomes `position: fixed; top: 53px; transform: translateX(-101%)` with class-based open transition, backdrop fades in. Tap targets bumped to ≥ 44px. Diff right-margin trimmed since no sidebar gap to balance. Outside the @media block: `html/body { height: 100dvh }`, `#scroller { overscroll-behavior: contain }`, topbar lifted to `z-index: 40` so the hamburger stays tappable while the drawer is open, hamburger `.menu-toggle` base styling, persistent `#drawer-backdrop` element with z 25 + opacity transition.
- src/render/shell.ts: new `$_drawerOpen` signal, `<button class='menu-toggle'>` in topbar, body gets `data-class:drawer-open`, `<div id='drawer-backdrop'>` after the header.
- src/render/sidebar.ts: dropped per-row `data-on:mouseenter__once` (observer covers it). File-row click handler now sets `$_drawerOpen = false` so a tap jumps + closes.
- src/client/highlights.ts: `setupSidebarPrewarm()` registers an IntersectionObserver rooted on `.file-list` (rootMargin 200px) that fires the prewarm POST as each row scrolls into view and unobserves itself after firing. Universal — works for mouse, touch, keyboard, and programmatic scroll. Reads the session id straight off the body's `data-signals` payload.

## Deferred (follow-up)

Horizontal scroll within diff rows for long lines on mobile. Currently long lines truncate with an ellipsis via the existing `.text { overflow: hidden; text-overflow: ellipsis }` style — functional but loses information. The right answer is per-row horizontal scroll (matches GitHub mobile), but the row layout currently relies on a fixed grid template and would need a wrapping container. Worth its own bean once someone hits it on a real phone.
