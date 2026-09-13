---
# largediff-98op
title: Drop iOS Safari tap delay; persist sessions in sqlite; redirect 404 sessions to new
status: completed
type: feature
priority: normal
created_at: 2026-05-12T22:15:56Z
updated_at: 2026-05-12T22:42:08Z
parent: largediff-oyhu
---

Two small improvements:

1. Drop the iOS Safari ~300ms tap delay on interactive controls (`.file-row`, `.menu-toggle`, `.chrome-toggle button`). The standard fix is `touch-action: manipulation` — disables the double-tap-zoom heuristic, which we don't need on those elements.

2. Persist sessions in sqlite (Bun's bun:sqlite). Write-through on every mutation; hydrate map on startup. DB lives at `/tmp/largediff.db` so it blows away on Fly deploy (which is fine — each deploy already starts fresh per the immediate deploy strategy). Survives in-VM process restarts.

3. When a request hits a non-existent session, redirect GET /sessions/:sid → / (creates fresh session, redirects to it). POSTs keep returning 410 for now — those come from already-loaded pages and will surface as a load error → user reloads naturally.

## Changes

- [ ] CSS: `touch-action: manipulation` on .file-row, .menu-toggle, .chrome-toggle button
- [ ] New SqliteSessionStore in src/store/sessions.ts (alongside InMemorySessionStore)
- [ ] SessionStore interface gains persist(sid) method (no-op for in-memory)
- [ ] commands.ts / server.ts: call persist after each mutation
- [ ] server.ts: GET /sessions/:sid for missing session → 302 to /
- [ ] Server boot: hydrate from sqlite if present
- [x] 5 new tests: round-trip, restart hydration, transient-field scrub, delete, sweep

## Summary

- Single commit (jj 5ad032c4) covering all three changes.
- Deployed to fly (image deployment-01KRF5KN5Q33AYTDA8H2XT5HH2).
- Prod verified: stale /sessions/X → 302 to /; fresh session create + /jump → 204; sqlite write-through working.
- /tmp/largediff.db on the Fly VM is the durable home; survives process restarts inside one VM, blows away on deploy (matches the immediate deploy strategy already in fly.toml).
