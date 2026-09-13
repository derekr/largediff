---
# largediff-pwrx
title: Add deps and base config
status: completed
type: task
priority: normal
created_at: 2026-05-11T17:23:45Z
updated_at: 2026-05-11T17:32:23Z
parent: largediff-1fer
---

- [x] Add deps to package.json: `@starfederation/datastar-sdk`, `web-tree-sitter`, `@biomejs/biome` (dev)
- [x] Verify `bun install` succeeds
- [x] Create directory layout: `src/server/`, `src/session/`, `src/diff/`, `src/store/`, `src/highlight/`, `src/render/`, `src/client/`, `wasm/` (empty)
- [x] Confirm `tsconfig.json` is suitable for Bun + DOM types (for client modules)
- [x] Wire up `bun run fmt` / `bun run check` via Biome + `tsc --noEmit`
- [x] Update `CLAUDE.md` with project-specific vocabulary, architecture, beans + jj workflows
- [x] Add `.claude/settings.json` + pre-commit hook that runs `bun run check` for `jj commit` / `git commit`
- [x] Replace stub `README.md`; initialize `jj` colocated with git

## Summary of Changes

- Added runtime deps: `@starfederation/datastar-sdk@1.0.0`, `web-tree-sitter@0.25.10`. Dev dep: `@biomejs/biome@2.4.15`.
- Created the full directory layout under `src/` plus `wasm/`.
- Wrote a minimal `src/server.ts` Bun.serve placeholder so the toolchain has something to check; the full route table comes in `largediff-qtr8`.
- `biome.json` with formatter + linter enabled, 100-col line width, double quotes, trailing commas. Scripts: `dev`, `fmt`, `check`, `typecheck`, `test`.
- Replaced the generic `CLAUDE.md` with project-specific guidance: vocabulary (ReviewSession / DiffStore / Projection / Command), one-line architecture tour, beans + jj workflows, before-every-commit policy, design principles.
- Refreshed `README.md` with project goals and layout.
- `.claude/settings.json` registers a `PreToolUse` Bash hook → `.claude/hooks/check-before-commit.sh`. The hook intercepts `jj commit` / `git commit` and blocks if `bun run check` fails.
- Initialized `jj` colocated with git in the project root (`jj git init --colocate`).
- `bun run check` passes cleanly.
