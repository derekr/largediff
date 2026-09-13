---
# largediff-oyhu
title: 'v1: Large-diff PR review demo'
status: todo
type: milestone
created_at: 2026-05-11T17:22:09Z
updated_at: 2026-05-11T17:22:09Z
---

A Datastar-driven recreation of GitHub's PR "Files changed" view, designed to gracefully handle synthetic diffs of hundreds of thousands of lines across multiple languages (TypeScript, Python, Go, Rust, JSON).

## Demo goals

- Demonstrate backend-driven hypermedia UI with Datastar.
- Server-driven viewport windowing over a long-lived SSE stream with warm brotli compression.
- Tree-sitter parsing on the backend; zero parsers on the client.
- CSS Custom Highlight API for syntax highlighting (no per-token spans in HTML).
- CQRS-shaped routes around a "Review Session" resource.

## Out of scope (for v1)

- Real GitHub PRs or git operations.
- Inline comments, review threads, approvals.
- Tabs other than "Files changed".
- Multi-tab session sharing.
- Persistent storage (in-memory v1; SQLite earmarked for v1.1).

## Architecture summary

- Long-lived `GET /sessions/:sid/stream` push channel (one warm brotli encoder per session).
- Short command POSTs (`/view`, `/jump`, `/settings`, `/files/:fid/collapse`, `/files/:fid/reviewed`) return 204 and trigger a push.
- Resource model: `ReviewSession { id, diff, view, settings, perFile }`. Sessions in-memory; diffs in a shared content-addressed store keyed by seed.
- Synthetic diff generated from a seed via `mulberry32` RNG. ~200k lines target.
- Tree-sitter (web-tree-sitter WASM) loaded in Bun on boot; parse trees cached per (seed, fileId).
- Window payload = element-patch (plain `<div data-line="N">text</div>`) + execute-script (`applyHighlights({...})`) in the same SSE response.
