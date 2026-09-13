---
# largediff-u4me
title: Review Session resource and CQRS routes
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:22:43Z
updated_at: 2026-05-11T18:15:20Z
parent: largediff-oyhu
blocked_by:
    - largediff-qqsg
    - largediff-1fer
---

Model the "review session" as the canonical resource. CQRS shape: one read projection (stream), many command POSTs.

## Scope

- `src/session/types.ts`: `ReviewSession { id, seed, view: { scrollTop, height, selectedFileId? }, settings: { mode, ignoreWhitespace, hideDeletions, theme, fontSize, tabWidth }, perFile: Map<FileId, { collapsed, reviewed }>, createdAt, lastSeenAt }`.
- Routes:
  - `POST /sessions` → 201 with `{ id }`
  - `GET /sessions/:sid` → shell HTML, hydrates `$_sid` signal
  - `GET /sessions/:sid/stream` → long-lived SSE (handled in compression epic)
  - `POST /sessions/:sid/view` → body `{ scrollTop, height }` → 204, triggers push
  - `POST /sessions/:sid/jump` → body `{ fileId }` → 204, triggers push
  - `POST /sessions/:sid/settings` → partial settings patch → 204
  - `POST /sessions/:sid/files/:fid/collapse` → `{ collapsed }` → 204
  - `POST /sessions/:sid/files/:fid/reviewed` → `{ reviewed }` → 204
  - `DELETE /sessions/:sid` → 204
- Internal `pushProjection(session)` is the single place that builds the current window + highlights and writes to the open stream.

## Acceptance criteria

- Command handlers do `(session, body) → mutate → pushProjection(session)`. No business logic in route layer.
- Unknown sid on any command → 410 Gone; client knows to reopen.
- Refreshing `/sessions/:sid` rehydrates a still-live session.

## Todo

- [x] `src/session/projection.ts`: `SessionWriter` interface, `WriterRegistry`, `pushProjection(session, deps)` stub that delegates to attached writer
- [x] `src/session/commands.ts`: `applyView` / `applyJump` / `applySettings` / `applyCollapse` / `applyReviewed` pure mutators with input validation
- [x] `src/server.ts`: wire `WriterRegistry`, replace 501 stubs with `handleCommand(req, sid, apply)` that does session lookup → mutate → push → 204
- [x] Unknown sid on any command returns 410 (smoke-tested via curl)
- [x] Refreshing `GET /sessions/:sid` rehydrates the live session (smoke-tested via curl)
- [x] Tests: `commands.test.ts` (each mutator validates and patches in place; bad input is ignored)
- [x] Tests: `projection.test.ts` (no-op when no writer; writer.send called when attached; registry attach/detach)
- [x] `bun run check` clean

## Summary of Changes

- `src/session/projection.ts`: `SessionWriter` interface (`send(event, data)` + `close()`), `WriterRegistry` for sid → writer mapping (attach/detach/get/has/size — detach closes the writer too), and `ProjectionDeps`. `pushProjection(session, deps)` looks up the session's writer and, when present, emits a placeholder `largediff-ack` event (the real window slicing + element patches land in largediff-1qjv).
- `src/session/commands.ts`: five in-place mutators (`applyView`, `applyJump`, `applySettings`, `applyCollapse`, `applyReviewed`) that each validate fields individually and silently ignore unknown/invalid input. `applySettings` clamps `fontSize` to [8,40] and `tabWidth` to [1,8]; per-file mutators auto-create the entry on first touch.
- `src/server.ts`: dropped the 501 stubs for the five command routes plus the static lifecycle ones. Added a `handleCommand(req, sid, apply)` helper that does session lookup → 410 on miss → JSON parse (bad bodies tolerated) → mutate → `pushProjection` → 204. DELETE also detaches any attached writer. `/sessions/:sid/stream` still 501s — that's owned by largediff-kazd.
- Tests: 19 cases across `commands.test.ts` (validation + clamping + perFile defaults) and `projection.test.ts` (registry lifecycle, no-op without writer, single event with attached writer, writer isolation across sessions).
- Smoke-tested via curl: `POST /sessions` → 201, `GET /sessions/:sid` → 200, unknown sid → 410, every command POST → 204, command after DELETE → 410.

## Notes for downstream epics

- **largediff-kazd**: build the warm-brotli SSE writer in `src/server/compress.ts`, attach it to `WriterRegistry` from the `/sessions/:sid/stream` handler, detach on `request.signal.aborted`. The `SessionWriter` interface (`send(event, data)`, `close()`) is the only surface area you need to satisfy.
- **largediff-1qjv**: replace `pushProjection`'s body with the real window slicing. You'll want to extend `ProjectionDeps` with a `DiffEngine` (from `createDiffEngine` in `src/diff/generator.ts`), then compute `[startRow, endRow]` via `engine.layout(session.seed).rowAtPixel(scrollTop)` and emit `datastar-patch-elements` events morphing `#ds-window`.
