---
# largediff-r9wv
title: Switch syntax highlighting from CSS Custom Highlight API to server-rendered per-token spans
status: completed
type: feature
priority: high
created_at: 2026-05-12T20:42:07Z
updated_at: 2026-05-12T20:49:48Z
parent: largediff-oyhu
blocked_by:
    - largediff-ta4r
---

Research bean largediff-ta4r found that no production code surface (Monaco, CodeMirror, GitHub, Sourcegraph, Zed) uses CSS.highlights for token-level coloring at scale. WebKit's `Highlight::repaintRange()` walks every node per Range with no batching — 1500 ranges × 6 names = ~9000 individual renderer repaint calls per push. No open WebKit bug, no upstream fix in sight.

Switching to GitHub's pattern: server emits per-token `<span class="kw">const</span>` directly inside `<span class="text">…</span>`. Token classes compress beautifully under brotli. Eliminates the Safari paint stall entirely.

## Changes

- [ ] Token classes: `kw` (keyword), `str` (string), `cmt` (comment), `num` (number), `fn` (function), `typ` (type). Defined alongside CSS rules.
- [ ] Helper to index `TokenSpans` → `Map<lineIdx, Array<{start, end, cls}>>` and a `tokenizedLineHTML(text, spans)` renderer.
- [ ] `renderFiles`/`FilesContext` gains a `tokensForLine(fileId, lineIdx)` callback; `renderInnerRow` emits tokenized HTML inside the `.text` span.
- [ ] `pushProjection` precomputes per-file token indices once per push; passes them via the context.
- [ ] Drop the entire highlights emission (3rd SSE event) from projection — morph carries everything now.
- [ ] Drop the inline `<script data-effect="el.remove()">window.applyHighlights(...)</script>` payload generation.
- [ ] CSS: remove `::highlight(ds-*)` rules; add `.kw`, `.str`, `.cmt`, `.num`, `.fn`, `.typ` rules.
- [ ] `client/highlights.ts`: remove `window.applyHighlights`, persistent Highlight objects, debounce timer, all related machinery. Keep log forwarding, jump scroll, sidebar prewarm.
- [ ] `CLAUDE.md`: revise "Plain text in the DOM. No per-token spans." principle — explain why we moved to per-token spans (research findings).
- [ ] Tests: update files.test.ts (expects tokenized HTML inside `.text`), projection.test.ts (no more highlights event, expect 2 events not 3).

## Verify

- [ ] bun run check clean, bun test green
- [ ] Chrome MCP: jump produces colored output in the morph payload, no `applyHighlights` traces in console.
- [ ] Safari (manual): jump → instant coloured paint; no 100-300ms post-jump stall.
- [ ] No `[hl]` log entries (function should no longer exist).

Refs largediff-ta4r.
