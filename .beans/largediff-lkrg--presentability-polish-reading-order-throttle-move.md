---
# largediff-lkrg
title: 'Presentability polish: reading order, throttle move, yagni-style doc, vendored fonts'
status: completed
type: feature
priority: normal
created_at: 2026-09-12T13:47:55Z
updated_at: 2026-09-12T13:58:28Z
---

Presentability polish for broader sharing: reading order, throttle
co-location, yagni.club-feel /doc with vendored fonts.

- [x] README "Start here" reading order for newcomers
- [x] Move view-push throttle (viewPushState/schedule/cancel/coalesce/echo)
  from server.ts to session/viewpush.ts; server.ts stays pure routes
- [x] viewpush.test.ts with fake push fn + real short timers
- [x] Vendor IBM Plex Mono 400/500 + Silkscreen 400 (OFL) under
  vendor/fonts/, /static/fonts/:name allow-list route, drop Google Fonts
- [x] Restyle /doc to yagni.club feel (paper/dark, masthead, status line,
  colophon); copy untouched

## Summary of Changes
- README: reading-order block; layout lines for session/viewpush + vendor/fonts
- New: src/session/viewpush.ts + viewpush.test.ts; vendor/fonts/*.woff2
- server.ts: throttle calls now imported; font route; doc CSS only
