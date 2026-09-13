---
# largediff-258s
title: Editorial /doc page explaining the architecture
status: completed
type: feature
priority: normal
created_at: 2026-05-11T21:30:18Z
updated_at: 2026-05-11T21:34:06Z
parent: largediff-oyhu
---

A single self-contained HTML page at /doc that introduces the largediff approach to a visitor — backend-driven state, virtualized window, warm brotli SSE, Custom Highlight API — with animated SVG diagrams and editorial typography. Not a typical docs page; closer to a Bloomberg/Pudding-style piece.

## Shape

- New route in src/server.ts: GET /doc returns inline HTML (no static assets to wrangle).
- New module src/render/doc.ts exports renderDoc(): string. Same pattern as renderShell.
- Inline CSS + inline SVG for diagrams, so the page is one self-contained file the way the rest of the project's render functions are.

## Content sketch

- Hero: display serif headline + headline numbers from performance.md (200k lines, 76 live DOM rows, 13× brotli ratio).
- The window: hero diagram — a vertical 'tape' of the full diff with a viewport frame fixed in place while the tape scrolls behind it; ghost rows outside the viewport, wireframe rows inside. CSS keyframe animation, loops.
- The contract: short prose on Datastar Tao / CQRS / state-on-the-server.
- The pipe: secondary diagram — animated POST /view → server → SSE patch loop between Browser and Server columns.
- The DOM stays simple: a note on the Custom Highlight API approach.
- By the numbers: performance.md headline table, restyled.
- Lessons: short, opinionated bullets (stable row IDs killed CLS; sticky outer-height stability; scroll-driven CSS animations beat rAF loops).
- Outro: built with Bun + Datastar.

## Todo

- [x] Draft renderDoc() returning the full HTML (single Write)
- [x] Wire GET /doc in src/server.ts
- [x] Hero diagram: virtualized ribbon + sliding viewport, all SVG + CSS animation
- [x] Secondary diagram: browser ↔ server with animated packets along the pipe
- [x] Match the project's dark palette (close to GitHub's #0d1117) with a warm-yellow accent for key numbers
- [x] Verify in Chrome DevTools MCP: /doc loads, both diagrams animate, no console errors, no broken responsive layout at 1280×800 and 1920×1080
- [x] bun run check passes

## Summary of Changes

Added editorial-style architecture brief at GET /doc (src/render/doc.ts + 4-line server.ts wire-up). Single self-contained module — inline CSS, inline SVG, no extra static assets. Newsreader display serif headline, JetBrains Mono for chrome, warm-yellow (#ffd86e) accent on stats and accent text.

Hero diagram: a vertical 'backing tape' representing the 200k-line diff scrolls inside a clip-path (CSS keyframe, 14s loop). Beside it, a fixed 'viewport' frame contains wireframe rendered rows (file card, hunk header, add/del/context lines with row numbers) — communicates the virtualization metaphor without needing an animation legend.

Secondary diagram: BROWSER and SERVER columns with animated 'packet' dots travelling along POST (cold, dashed) and SSE (warm, accent-colored) wires. Two separate keyframe animations with staggered delays so the cycle reads as 'send a 204, get a brotli frame back.'

Six headline numbers from performance.md restyled as a quiet table (metric / value / delta), plus three lesson cards (CLS-from-row-ids, scroll-driven animation lag, sticky outer-height stability) — each card framed as a correction the project actually made.

Verified live in Chrome DevTools MCP: full-page screenshot looks correct, all four CSS animations are computed and running, zero console errors. Responsive: stat strip and lessons stack to single column under 880px (@media query). Honors prefers-reduced-motion.
