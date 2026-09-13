# largediff

A Datastar-driven recreation of GitHub's PR "Files changed" view, designed to gracefully handle synthetic diffs of hundreds of thousands of lines across multiple languages (TypeScript, Python, Go, Rust, JSON).

## Vocabulary

- **ReviewSession** (resource) — a user's current view of a diff. `{ id, seed, view, settings }`. In-memory, tiny per session.
- **Diff engine** (shared, content-addressed) — `createDiffEngine` synthesizes files and caches them, plus their token spans, keyed by seed. Shared across every session on that seed, under an LRU cap.
- **Projection** — the SSE output emitted on `GET /sessions/:sid/stream`. Element patches + execute-script in one response per push.
- **Command** — any POST that mutates a session (`/view`, `/jump`, `/settings`, …). Always returns 204; the real payload flows down the open stream.

## Architecture (one-line tour)

Browser opens long-lived SSE → server keeps a warm brotli encoder per session → on every command POST, server slices the row offset table for the visible window, tokenizes the visible lines with a cached regex-based per-language tokenizer, and pushes a single morph + signal patch per response. Frontend has no parsers; rows are `<div class="row line">…<span class="text">…<span class="kw">const</span>…</span></div>` — token spans rendered server-side as part of the morph payload, coloured by per-class CSS rules.

## Working with beans

Issues live in `.beans/`. Use the `beans` CLI to track epics and tasks.

- `beans list --ready` — what's actionable right now
- `beans show <id>` — full details of a bean
- `beans update <id> -s in-progress` — when starting
- Update todo checkboxes in the bean body as work lands (`- [ ]` → `- [x]`) via `beans update <id> --body-replace-old "..." --body-replace-new "..."`
- `beans update <id> -s completed` only when all todos are checked, with a `## Summary of Changes` section appended

**Always use beans instead of TodoWrite.** Bean files belong in the same commit as the code change.

## Version control

This repo uses [jj](https://github.com/jj-vcs/jj), colocated with git.

- `jj status` — working copy state
- `jj describe -m "..."` — set the current commit's message
- `jj new` — start a new commit on top of `@`
- `jj commit -m "..."` — describe + new in one step
- `jj log` — recent commits

Each landed task is its own commit. Include the bean ID in the message footer:

```
scaffold: add deps and base directory layout

Refs largediff-pwrx
```

## Before every commit

```
bun run check
```

Runs Biome (fmt + lint, no writes) and `tsc --noEmit`. There's a `PreToolUse` hook configured to enforce this for `jj commit` and `git commit` invocations — the commit is blocked until check passes.

If it fails, run `bun run fmt` to auto-fix formatting and re-run check.

## Bun conventions

- Use `bun` not `node` / `npm` / `yarn` / `pnpm`
- `Bun.serve()` (no express), `bun:sqlite` (no better-sqlite3), `Bun.file` over `node:fs`
- Bun auto-loads `.env`; no dotenv
- Format/lint via Biome; type-check via `tsc --noEmit`
- `bun --hot` for dev with HMR

## Scripts

- `bun run dev` — hot-reload server
- `bun run fmt` — Biome auto-fix (writes)
- `bun run check` — Biome check + `tsc --noEmit` (no writes)
- `bun run typecheck` — `tsc --noEmit` only
- `bun test` — bun test runner

## Directory layout

```
src/
├── server.ts         entry: Bun.serve route table
├── server/           SSE writer + per-session compression
├── session/          ReviewSession model, commands, projection, stream attach
├── diff/             synthetic diff generator, snippets, row layout
├── store/            shared diff types + SessionStore
├── highlight/        regex-based per-language tokenizer
├── render/           HTML fragment builders (shell, files, sidebar, /doc)
└── client/           browser modules (highlights.ts, styles.css, …)
.beans/               issue tracker (beans CLI)
.claude/              project-shared Claude Code config + hooks
```

## Design principles

- **State on the backend.** The frontend is a projection. Signals are minimal — viewport scroll + session id are basically it. Don't reach for frontend state when a server push can replace it.
- **Fat morphs are fine.** The brotli stream is warm; sending a whole window's worth of DOM is cheap. Don't hand-craft fine-grained patches.
- **Server-rendered per-token spans.** Each line's text contains `<span class="kw|str|cmt|num|fn|typ">` chunks emitted by the projection. CSS rules colour them. We tried the CSS Custom Highlight API first; WebKit's implementation walks every range and repaints each intersecting node with no batching, stalling Safari's paint pipeline 100–300ms per jump on a 1500-range payload (see bean largediff-ta4r). Per-token spans match what every production code surface (Monaco, CodeMirror, GitHub, Sourcegraph) actually uses at scale.
- **One projection function.** `pushProjection(session)` is the single place that produces the SSE payload. All commands mutate state, then call it.
- **Sessions are tiny; diffs are shared.** Per-session state is bytes. The diff and its parse caches are shared across all sessions on the same seed.

## Reference

- Datastar Tao: keep state on the backend, patch elements/signals, prefer morphing, use CQRS, enable compression.
- CSS Custom Highlight API (no longer used for syntax — see principle above): <https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API>
