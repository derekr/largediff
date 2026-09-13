---
# largediff-1fer
title: Project scaffolding and shell HTML
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:22:24Z
updated_at: 2026-05-11T17:39:42Z
parent: largediff-oyhu
---

Set up the Bun project skeleton, dependencies, directory layout, and the static shell HTML that Datastar mounts onto.

## Scope

- `package.json` deps: `bun-types`, `@starfederation/datastar-sdk`, `web-tree-sitter`. No express, no node-tree-sitter, no vite.
- `Bun.serve` entry with a routes table covering: `GET /`, `POST /sessions`, `GET /sessions/:sid`, `GET /sessions/:sid/stream`, command POSTs.
- `index.html` shell loaded via HTML imports: header, file-tree placeholder (`#file-tree`), main scroller (`#scroller` with `data-on-load="@get('/sessions/:sid/stream')"`), inner window container (`#ds-window`).
- `src/client/highlights.ts` stub exporting `applyHighlights` on `window`.
- `src/client/styles.css` with base layout and `::highlight(ds-*)` rules.
- Wire HMR (`bun --hot`).

## Acceptance criteria

- `bun --hot src/server.ts` boots and serves the shell at `/`. ✓
- Visiting `/` redirects to a freshly minted `/sessions/:sid` page. ✓
- The shell renders empty file-tree and scroller divs with no console errors (other than the expected `/stream` 501 until largediff-kazd lands). ✓
- No tree-sitter, no diff data exercised yet — just the static frame and routing wiring. ✓

## Summary of Changes

Completed across three commits:

- `largediff-pwrx` — scaffold: project foundation, deps, biome, beans, pre-commit hook.
- `largediff-qtr8` — routes: skeleton with session lifecycle and 501 stubs for all command endpoints.
- `largediff-kflj` — shell: server-rendered HTML with Datastar wiring and static assets.

Notable choices beyond the original scope:

- Used server-rendered HTML (`src/render/shell.ts`) over Bun HTML imports so the sid can be baked into a Datastar `_sid` signal per request. Bun HTML imports may revisit if static-asset bundling becomes more useful.
- Added Biome + `bun run check` + `bun run fmt`. Wired `.claude/settings.json` PreToolUse hook that runs `bun run check` before `jj commit` / `git commit`.
- jj colocated with git in the project root.

Next: storage layer (`largediff-qqsg`) is unblocked and ready.
