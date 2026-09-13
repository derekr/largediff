---
# largediff-qtr8
title: Bun.serve routes skeleton
status: completed
type: task
priority: normal
created_at: 2026-05-11T17:23:49Z
updated_at: 2026-05-11T17:34:09Z
parent: largediff-1fer
---

Stand up the routes table with stubs that return real status codes but no business logic yet.

- [x] `src/server.ts` with `Bun.serve({ routes, development: { hmr: true, console: true } })`
- [x] `GET /` → mints a fresh sid, 302 to `/sessions/:sid`
- [x] `POST /sessions` → 201 `{ id }` (stubbed sid generator via `crypto.randomUUID`)
- [x] `GET /sessions/:sid` → serves a placeholder shell HTML body
- [x] `GET /sessions/:sid/stream` → 501 stub (real impl in largediff-kazd)
- [x] Command POSTs (`/view`, `/jump`, `/settings`, `/files/:fid/collapse`, `/files/:fid/reviewed`) → 501 stubs
- [x] `DELETE /sessions/:sid` → 204; 410 Gone on unknown sid
- [x] `bun src/server.ts` boots cleanly; smoke-tested all routes via curl

## Summary of Changes

- Expanded `src/server.ts` from the placeholder into the full routes table.
- Stubbed session store is a single `Set<string>`; real `SessionStore` interface + impl come in `largediff-u4me`.
- `crypto.randomUUID()`-derived 12-char hex sids for now.
- Placeholder shell HTML is inline; the real Datastar-wired shell lands in `largediff-kflj`.
- Smoke-tested via curl: `GET /` → 302, `POST /sessions` → 201, `GET /sessions/:sid` → 200 HTML, `DELETE` → 204 then 410, unknown sid → 410, all 501 stubs return 501.
- `bun run check` passes.
