---
# largediff-px4r
title: Pre-warm file caches on sidebar hover
status: completed
type: feature
priority: normal
created_at: 2026-05-11T22:10:11Z
updated_at: 2026-05-11T22:11:31Z
parent: largediff-oyhu
---

On mouseenter of a file-row in the sidebar, fire a no-op POST that prompts the server to call engine.file() and engine.tokens() for that file. Both calls are memoized in the DiffStore, so the result is a warm cache by the time the user actually clicks to jump. Click-jump rendering then skips the synthesis + tokenization work and projects from already-resident data.

## Why

DiffStore caches are populated lazily on the first projection that touches a file. A click-jump to a file the user has never visited triggers synthetic-content generation + regex tokenization inline during pushProjection — a few ms of latency added to the SSE round trip. Hover-to-prewarm flips the typical interaction order (move mouse to file → click) into a cache warmer: by the time the click commits, the work has already happened.

Caches are seed-scoped, so one user warming a file benefits every session on the same seed (free win on a single-seed demo).

## Shape

- Route: POST /sessions/:sid/files/:fid/prewarm → 204 No Content. Calls engine.file(seed, fid) and engine.tokens(seed, fid, file). No projection push.
- Sidebar: each .file-row gets data-on:mouseenter__once that POSTs the prewarm. __once removes the listener after firing so we don't re-fire on every hover.
- No new client state. No protocol changes.

## Todo

- [x] Add POST /sessions/:sid/files/:fid/prewarm route
- [x] Add data-on:mouseenter__once='@post(...)' to each .file-row in sidebar.ts
- [x] Verified locally — two synthetic mouseenter dispatches produced one POST (204); second is a no-op
- [x] bun run check passes
- [x] Deploy to Fly

## Summary of Changes

- src/server.ts: new POST /sessions/:sid/files/:fid/prewarm route. Idempotent — calls engine.file() and engine.tokens() to populate the seed-scoped DiffStore caches and returns 204 without projecting.
- src/render/sidebar.ts: each .file-row now carries data-on:mouseenter__once that POSTs the prewarm. Datastar's __once modifier detaches the listener after the first fire so re-hovers are free.

Effect: first click-jump to a sidebar file the user has previously hovered avoids the synthetic content generation + regex tokenization that would otherwise happen inline during pushProjection. On a cold cache that's a few ms of latency moved out of the click-to-render path. Caches are seed-scoped, so a user warming a file benefits every session on the same seed.
