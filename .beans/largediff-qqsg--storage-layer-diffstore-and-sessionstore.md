---
# largediff-qqsg
title: 'Storage layer: DiffStore and SessionStore'
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:22:36Z
updated_at: 2026-05-11T17:58:07Z
parent: largediff-oyhu
---

Define the storage abstractions used by the rest of the system. v1 is in-memory; SQLite is earmarked but not implemented.

## Scope

- `src/store/diff.ts` exports `DiffStore` interface:
  - `meta(seed): DiffMeta`
  - `file(seed, fileId): { path, language, content, totalLines }`
  - `tokens(seed, fileId): TokenSpans`
- `InMemoryDiffStore` with LRU bounds (e.g. cap 100 cached files, 50 cached parse-token sets).
- `src/store/sessions.ts` exports `SessionStore` interface and an in-memory implementation:
  - `create(seed): ReviewSession`
  - `get(sid): ReviewSession | undefined`
  - `delete(sid): void`
  - TTL sweep (evict idle > 30min).
- `src/store/schema.sql` placeholder documenting the future bun:sqlite schema for both stores.

## Acceptance criteria

- All call sites consume the interface, never the concrete impl.
- LRU eviction keeps memory bounded under repeated scroll over a 200k-line diff.
- Swapping to a SQLite-backed impl later requires zero changes outside `src/store/`.

## Why content-addressed

The synthetic diff is recomputable from its seed; the seed is its content hash. Two sessions on the same seed must share the diff cache — don't per-session SQLite.

## Todo

- [x] `src/store/diff.ts`: `DiffStore`/`DiffSynthesizer` interfaces + types
- [x] `src/store/diff.ts`: `InMemoryDiffStore` with LRU caches (files=100, tokens=50)
- [x] `src/session/types.ts`: `ReviewSession` and supporting types
- [x] `src/store/sessions.ts`: `SessionStore` interface + `InMemorySessionStore` with TTL sweep
- [x] `src/store/schema.sql`: placeholder bun:sqlite schema notes
- [x] Wire `InMemorySessionStore` into `src/server.ts` (replace `Set<string>` stub)
- [x] Tests: `src/store/diff.test.ts` (cache hit/miss, LRU eviction)
- [x] Tests: `src/store/sessions.test.ts` (create/get/delete, TTL eviction)
- [x] `bun run check` clean

## Summary of Changes

- `src/store/diff.ts`: `DiffStore` and `DiffSynthesizer` interfaces with `DiffMeta`/`DiffFile`/`TokenSpans` types; `InMemoryDiffStore` caches meta per seed and uses a touch-on-access LRU (insertion-ordered `Map`) for files (default cap 100) and tokens (default cap 50). Token lookup reuses the cached file rather than re-synthesizing it.
- `src/session/types.ts`: `ReviewSession` shape matching the largediff-u4me spec (view, settings, perFile, createdAt/lastSeenAt) plus `DEFAULT_VIEW` / `DEFAULT_SETTINGS`. Defined here so `SessionStore` has something to store; the review-session epic can extend it without a rewrite.
- `src/store/sessions.ts`: `SessionStore` interface (`create`/`get`/`delete`) and `InMemorySessionStore`. `get` bumps `lastSeenAt`; a 5-min interval sweeper evicts sessions idle >30min. `now`, `generateId`, and `sweepIntervalMs` are injectable for tests.
- `src/store/schema.sql`: documentary placeholder for the future bun:sqlite schema (diff_meta/diff_file/diff_tokens/sessions). Not loaded anywhere.
- `src/server.ts`: dropped the `Set<string>` stub in favour of `InMemorySessionStore`, accessed via the `SessionStore` interface so the SQLite cutover can land without touching consumers. New sessions use a placeholder `"demo"` seed until largediff-u4me adds seed selection.
- Tests: 13 cases across `diff.test.ts` (caching, LRU eviction, per-seed isolation) and `sessions.test.ts` (create/get/delete defaults, TTL sweep, refresh-on-get, injected id generator). `bun run check` and `bun test` both green.
