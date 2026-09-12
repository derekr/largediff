---
# largediff-uqry
title: 'Pre-publication hardening: vendor Datastar, rate limits, robots.txt, headers'
status: completed
type: feature
priority: high
created_at: 2026-09-12T13:19:39Z
updated_at: 2026-09-12T13:23:18Z
---

Pre-publication hardening batch for putting largediff on GitHub.
Audit found no leaks and a mostly-hardened surface; this closes the gaps.

- [x] Vendor Datastar (was jsdelivr CDN pin): bundle in-repo, served from
  /static/datastar.js — removes the supply-chain XSS lever entirely
- [x] Per-IP rate limiting on session creation + command routes (token
  bucket, X-Forwarded-For behind trusted proxy, 429 + retry-after)
- [x] robots.txt (Disallow: /) so crawlers don't mint sessions at line rate
- [x] `nosniff` on HTML + static responses
- [x] Junk-fid /jump returns 204 without a full render push
- [x] .gitignore: bare .env.production/.env.development/.env.test
- [x] Abuse-verified on a scratch server (flood → 429s, junk fid → no
  stream bytes, robots served, vendored bundle served locally)

## Summary of Changes
- New: vendored Datastar bundle, src/server/ratelimit.ts + tests
- server.ts: limiter wiring, /static/datastar.js + /robots.txt routes,
  nosniff headers, doJump unknown-fid no-push
- render/shell.ts: Datastar from /static instead of CDN
