---
# largediff-tvb4
title: 'Syntax highlighting: tree-sitter backend + CSS Custom Highlight API'
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:23:12Z
updated_at: 2026-05-11T19:49:38Z
parent: largediff-oyhu
blocked_by:
    - largediff-qxrh
    - largediff-1qjv
---

Tree-sitter parses files server-side; per-line token spans ride the same SSE response as the window patch and are applied client-side via the CSS Custom Highlight API. Zero parsers ship to the browser.

## Scope

### Backend
- `src/highlight/parsers.ts`: load `web-tree-sitter` once at boot, load `.wasm` grammars from `wasm/` lazily per language (TypeScript, Python, Go, Rust, JSON).
- `src/highlight/tokens.ts`: walk the syntax tree, group nodes by highlight kind (`keyword`, `string`, `function`, `type`, `comment`, `number`), emit a per-line span array `Record<kind, Array<[lineIdx, startCol, endCol]>>`.
- Cache parse output in `DiffStore.tokens(seed, fileId)`.
- During `pushProjection`, slice tokens to the visible line range and emit a `datastar-execute-script` event containing `applyHighlights({ keyword: [...], string: [...], ... })`.

### Frontend
- `src/client/highlights.ts`: `applyHighlights(byKind)` looks up each `<div data-line="N">` in `#ds-window`, builds `StaticRange`s into its first Text node, and calls `CSS.highlights.set("ds-<kind>", new Highlight(...ranges))` per kind. Each call replaces the prior set, so old ranges vanish naturally.
- `src/client/styles.css`: one `::highlight(ds-keyword) { color: ... }` rule per kind.

## Acceptance criteria

- Line HTML contains plain text only — no `<span>` per token.
- Visible code is syntax-colored across TS/Python/Go/Rust/JSON.
- Highlights update correctly when scrolling between files of different languages.
- Network payload for highlight data is small and gzips/brotlis well within the existing stream.


## Scope split

User-confirmed approach: ship a **regex-based tokenizer first** through the full pipeline, then a follow-up bean for tree-sitter accuracy. The tokenizer is swappable behind `DiffSynthesizer.tokens`, so the architecture matches the original spec — only the parsing engine changes between phases.

## Todo (phase A: regex)

- [x] Replaced `TokenSpans` in `src/store/diff.ts` with a per-file `Partial<Record<HighlightKind, Array<[lineIdx, startCol, endCol]>>>` (fileId is added at the projection layer when slicing for the wire)
- [x] `src/highlight/tokenize.ts`: per-language regex tokenizer covering all six kinds. Strings + comments processed first via a Uint8Array `consumed` mask; remaining kinds skip consumed offsets. Multi-line matches are split into per-line spans by `pushSpans` so the client only needs single-line `Range`s.
- [x] `src/diff/generator.ts`: `tokens(fileId, file)` calls `tokenize(f.content, f.language)`. Bonus: added per-result memoization for both `file()` and `tokens()` so repeated pushes for the same seed don't re-stitch content or re-run regexes.
- [x] `src/session/projection.ts`: after the elements patch, derives the visible file → line-range map from the layout, slices each visible file's cached tokens down to that range, and emits a `<script data-effect="el.remove()">window.applyHighlights({...})</script>` appended to body via `datastar-patch-elements`.
- [x] `src/client/highlights.ts`: `applyHighlights(byKind)` iterates all 6 kinds, builds `Range`s into each row's first Text node via `[data-file][data-line]` selectors, and calls `CSS.highlights.set('ds-<kind>', new Highlight(...ranges))`. Empty kinds get an empty Highlight so the previous push's stale ranges always clear.
- [x] Tests: `tokenize.test.ts` (8 cases across TS/Py/Go/Rust/JSON — keyword/string/comment/number/type detection, no keyword-leak into strings, multi-line spans split per line, empty input). Extended `projection.test.ts` to verify the highlights `<script>` event with `window.applyHighlights`.
- [x] Browser verify with chrome-devtools MCP: TS file showed 67 keywords / 23 functions / 27 types / 10 strings / 1 comment, all coloured. Confirmed `.text` span has exactly one Text node (no per-token `<span>`s). Jumped between Python (63/20/6/19/1) → Rust (67/33/47/5/1) → Go (44/3/36/5/0) → JSON (0/0/0/84/0) — highlight counts adapt per language correctly.
- [x] `bun run check` clean, all 107 tests pass

## Out of scope (phase B follow-up)

File a follow-up bean for: `web-tree-sitter` runtime loading, per-language `.wasm` grammars under `wasm/`, highlight `.scm` queries, `src/highlight/parsers.ts` + tree-sitter-backed `tokenize.ts`. Visual quality upgrade only — no API or wire-format changes needed.

## Summary of Changes

- `src/store/diff.ts`: redefined `TokenSpans` as `Partial<Record<HighlightKind, Array<[lineIdx, startCol, endCol]>>>`. Exported `HighlightKind` and `HighlightSpan` for cross-module use.
- `src/highlight/tokenize.ts` (new): regex-based per-language tokenizer for TS / Python / Go / Rust / JSON. Per-language keyword lists; language-tuned string regexes (Python `"""…"""`, TS template literals, Go raw backticks, Rust `r"…"`); comment regex; number regex; lowercase-ident-before-`(` heuristic for `function`; PascalCase identifiers for `type`. Strings + comments scanned first into a `Uint8Array` consumed mask; subsequent passes skip consumed offsets. `pushSpans` splits multi-line matches into per-line `[lineIdx, startCol, endCol]` tuples.
- `src/diff/generator.ts`: `tokens(fileId, f)` now calls `tokenize(f.content, f.language)`. Added per-result memoization to `file()` and `tokens()` so the engine doesn't re-stitch snippets or re-run the tokenizer on every push (the engine is itself per-seed cached, so the memo is shared across sessions on the same seed).
- `src/session/projection.ts`: walks the visible row range to derive `Map<FileId, {minLine, maxLine}>`, looks up each visible file's tokens, filters spans down to the visible line range, packages into `Record<kind, Array<[fileId, lineIdx, startCol, endCol]>>`. Wire format: a `datastar-patch-elements` event with `mode append`, `selector body`, and an `elements <script data-effect="el.remove()">window.applyHighlights({...JSON...})</script>` payload. `<` in JSON is escaped to `\u003c` so the payload can't break out of the script tag.
- `src/client/highlights.ts`: real `applyHighlights(byKind)` implementation. For each of the six kinds, selects rows by `[data-file][data-line]`, finds the row's first Text node inside `.text`, builds a `Range` over `[startCol, endCol]`, and registers them as a single `Highlight` under `ds-<kind>` via `CSS.highlights.set`. Empty kinds register an empty Highlight so stale ranges from the prior push always clear. CSS Custom Highlight API support is feature-detected and silently no-ops otherwise.
- Tests: 8 cases for the tokenizer (per-language + multi-line + empty input), plus updated projection tests to assert the highlights script event arrives.

## Browser-verified acceptance

- TS file showed coloured keywords (`switch`, `case`, `export`, `const`, `async`, `await`, `return`, …), strings (`"open"`, `"close"`, `"utf8"`, `"zod"`), types (`Promise<Config>`, `Result`, `Error`, `Config`, `JSON`, `Map`), functions (`loadConfig`, `readFile`, `parse`, `filter`, `map`, `handleOpen`/`Close`/`Unknown`, `set`), comments (`// TODO …`).
- `.text` spans contain exactly one Text node — confirmed `isPlainText: true` for a sample row. No per-token `<span>` wrappers.
- Highlight counts adapt per language: TS 67-keyword/27-type/23-fn dominant; Rust shows 47 types reflecting the trait/struct-heavy style; JSON degenerates to 84 strings / 0 of everything else.
- Highlights update correctly on scroll between files of different languages (CSS.highlights replaced per push, no leakage).

## Phase B (tree-sitter) — to be filed as a follow-up

The `DiffSynthesizer.tokens` contract and the wire format are stable. Swapping `tokenize` for a tree-sitter-backed implementation is a pure quality upgrade — load `web-tree-sitter`, provision `.wasm` grammars under `wasm/`, write or borrow `highlights.scm` queries, walk the resulting tree and map captures to the same six kinds. No changes to projection, client, or CSS.
