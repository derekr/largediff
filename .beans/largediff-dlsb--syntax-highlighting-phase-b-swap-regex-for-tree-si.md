---
# largediff-dlsb
title: 'Syntax highlighting Phase B: swap regex for tree-sitter'
status: todo
type: feature
priority: low
created_at: 2026-05-11T19:49:57Z
updated_at: 2026-05-11T19:49:57Z
parent: largediff-oyhu
blocked_by:
    - largediff-tvb4
---

Swap the regex tokenizer in `src/highlight/tokenize.ts` for a `web-tree-sitter`-backed implementation. The `DiffSynthesizer.tokens` contract, the projection wire format, and `applyHighlights` on the client are all stable — this is a pure quality upgrade.

## Scope

- `src/highlight/parsers.ts`: `web-tree-sitter` boot, `.wasm` grammar loader (TS/TSX, Python, Go, Rust, JSON), language → parser cache.
- `wasm/`: provision pre-built grammar `.wasm` files (download from each grammar repo's release or compile).
- `src/highlight/queries/*.scm`: per-language highlight queries mapping tree-sitter captures to our six kinds (`keyword` / `string` / `comment` / `number` / `function` / `type`). Borrow from nvim-treesitter or hand-write.
- `src/highlight/tokenize.ts`: replace regex pipeline with a tree-sitter Parser → Tree → Query walk. Produce the same per-line `HighlightSpan` tuples so callers don't change.
- Tests: keep the existing `tokenize.test.ts` cases passing (they assert language-correct kinds, not implementation details).
- Browser verify with chrome-devtools MCP that visible coloring is at least as good as Phase A, ideally better (e.g., `if(...)` no longer matched as a function call, types correctly distinguished from constants).

## Out of scope

- Adding new highlight kinds beyond the existing six.
- Changing the wire format or the client's `applyHighlights` shape.
- Adding more languages.

## Acceptance criteria

- Same six kinds, same wire shape, same client.
- Better-than-regex accuracy on edge cases: keywords inside template strings, `class.method()` calls not flagged as functions for `class`, `Result<T, E>` generics flagged as types rather than identifiers, etc.
- All 107+ tests still pass; no regressions in the largediff-tvb4 Phase A test cases.
- WASM grammars committed (or fetched at install time) — server should boot from a clean checkout without an internet round-trip.
