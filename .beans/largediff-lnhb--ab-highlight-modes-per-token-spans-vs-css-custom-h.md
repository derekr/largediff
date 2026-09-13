---
# largediff-lnhb
title: 'A/B highlight modes: per-token spans vs CSS Custom Highlight API, with real numbers'
status: in-progress
type: feature
priority: high
created_at: 2026-08-25T15:58:16Z
updated_at: 2026-08-25T16:36:09Z
parent: largediff-oyhu
---

Re-introduce the CSS Custom Highlight API as a runtime-selectable highlight mode (`?hl=ranges`) alongside the current per-token spans, plus instrumentation to measure both axes (wire bytes AND paint cost) in Safari Technology Preview and Chrome. Backs a blog post that quantifies what largediff-ta4r only described qualitatively.

## Design

- `SessionSettings.highlight: 'spans' | 'ranges'` (default 'spans')
- Seam is `renderRow`/`renderTokenizedLine` in src/render/files.ts — ranges mode emits plain escaped text plus a compact `data-tk="start,len,cls|..."` attribute on each `.row.line`
- Payload rides the SAME fat morph (no signal/morph ordering race, and a fair bytes comparison)
- Client module rebuilds `CSS.highlights` on each morph via MutationObserver + rAF
- `::highlight(kw|str|cmt|num|fn|typ)` CSS mirroring the existing `.kw` etc. rules

## Measurement

Per jump: click -> morph applied -> highlights built -> painted (double rAF), Long Task entries, and wire bytes (reuse the brotli chip plumbing). Driven by the official Safari MCP server (safaridriver --mcp, STP 27) and chrome-devtools MCP as the control.

## Verify

- [x] `highlight` setting plumbed through session + /settings command + URL param
- [x] ranges mode emits plain text + data-tk, spans mode unchanged
- [x] ::highlight CSS rules match the span colors
- [x] client rebuilds highlights on every morph
- [x] instrumentation exposes a scriptable jump-sequence harness returning JSON
- [x] numbers captured in Safari STP and Chrome
- [x] findings written up in the bean

## Chrome control numbers (2026-08-25)

Chrome 141, macOS 26.4.1, 500-file synthetic diff, 12 jumps evenly spaced across the file list (f52 -> f499). Both runs traverse the IDENTICAL file sequence with identical row counts, on fresh sessions so the wire chip is not cumulative across runs.

| metric | spans | ranges |
|---|---|---|
| median morph (click -> DOM) | 45.1 ms | 47.9 ms |
| median max frame gap | 7.7 ms | 10.9 ms |
| worst max frame gap | 14.0 ms | 14.1 ms |
| median #ds-window innerHTML | 274,142 B | 253,733 B |
| wire, 12 jumps + load (brotli) | 204.1 KB | 214.9 KB |
| wire, uncompressed | 6.79 MB | 6.39 MB |
| median ranges built | - | 1,285 |
| Range construction + set() | - | ~0.9 ms |

### The finding that inverts the premise

The going-in assumption was that ranges mode trades a Safari paint stall for a meaningful wire-byte win, and that the post would be about that trade. **There is no wire-byte win.** Raw HTML is only ~7% smaller, and *after brotli ranges is ~5% LARGER* (214.9 KB vs 204.1 KB).

Reason: `<span class="str">` repeated a thousand times is almost free under brotli - it is one dictionary entry plus a back-reference per occurrence. `data-tk="12,6,1|24,9,0"` is high-entropy decimal digits that brotli cannot fold. The verbose-looking markup compresses; the compact-looking offsets do not.

So on Chrome - the engine where the CSS Custom Highlight API works exactly as designed, batching all of it into the PrePaint walk for ~1 ms - the API still buys nothing. Paint is a wash, bytes are slightly worse.

That is the real shape of the story: the API is not a tempting-but-Safari-hostile optimisation. It is not an optimisation at all for per-token syntax, in any engine. Safari just makes the absence of upside expensive instead of free.

### Harness note

First pass drove jumps by clicking sidebar rows. The sidebar is server-virtualized, so only rows near the active file are mounted and the walk ping-ponged between three files - the two modes visited different files and the byte comparison was meaningless. The harness now POSTs `/sessions/:sid/files/:fid/jump` for a fixed evenly-spaced id list, which is the same server push path and makes both runs identical.

## Secondary finding: `::highlight()` cannot express comment italics

Verified in Chrome on the same Python file (`app/registry.py`, line `# TODO: handle the empty case`):

- **spans mode** — `getComputedStyle(.cmt).fontStyle` is `italic`, colour `rgb(139, 148, 158)`.
- **ranges mode** — the comment paints the right colour but renders **upright**.

Highlight pseudo-elements accept only a restricted property set (colour, background-color, text-decoration and friends, text-shadow, -webkit-text-stroke). `font-style` is not in it. Note that the CSSOM still *retains* the declaration — reading `rule.style.fontStyle` back returns `"italic"` — so a feature-detect that checks the CSSOM will wrongly report support. The property is dropped at style-application time, not at parse time.

For a code viewer this is a functional regression rather than a perf one: you cannot italicise comments at all, which is table stakes for every syntax theme. Worth stating in the post alongside the perf numbers, because it means the API was never a drop-in replacement even before Safari enters the picture.

## Final 2x2 (2026-08-25, post largediff-f518)

All four cells on one harness, one 12-file sequence (f38..f456, stride 38), identical range counts per file across engines (1549, 1317, 1006, 1594, ...), 0 timed-out jumps everywhere. Safari STP 27.0 driven over plain WebDriver (`safaridriver -p 4444`), Chrome via devtools MCP.

| metric | Chrome spans | Chrome ranges | Safari spans | Safari ranges |
|---|---|---|---|---|
| encoding | br | br | gzip | gzip |
| median morph (ms) | 44.3 | 46.6 | 71.5 | 61.5 |
| **median max frame gap (ms)** | **49.3** | **48.9** | **50.5** | **405.5** |
| **worst max frame gap (ms)** | **62.5** | **55.9** | **60.0** | **1028** |
| median window HTML (B) | 258,410 | 242,358 | 258,410 | 242,358 |
| wire, 12 jumps + load | 204.1 KB | 212.9 KB | 559.3 KB | 569.3 KB |
| Range build, JS (ms) | - | ~1.0 | - | ~1.0 |
| median ranges | - | 1,378 | - | 1,378 |

### What the numbers say

1. **The Safari stall is real and worse than largediff-ta4r estimated.** The bean said 100-300 ms; the median is **405 ms** and the worst frame is **1,028 ms** — a full second of frozen UI on a single navigation. Against spans in the same browser (50.5 ms) that is an **8x median regression**.

2. **It is entirely paint, not script.** Range construction plus `CSS.highlights.set()` costs **~1 ms** for ~1,400 ranges, and it costs the same ~1 ms in Chrome. Nothing in JS is slow. The cost is WebKit walking every Range and repainting each intersecting node with no batching, which is exactly the mechanism largediff-ta4r inferred from the source and could not previously measure.

3. **Chrome shows the API working as designed — and it still buys nothing.** 48.9 ms vs 49.3 ms is a wash, and ranges is ~4% *larger* on the wire (212.9 vs 204.1 KB) despite ~6% less raw HTML: repeated `<span class="str">` folds into brotli back-references, while `data-tk="12,6,1|24,9,0"` is high-entropy decimal that does not compress.

So the honest framing is not "a promising optimisation that Safari ruins". It is **not an optimisation for per-token syntax in any engine** — it costs bytes everywhere, buys nothing in Blink, and costs up to a second per navigation in WebKit. Safari merely makes the absence of upside expensive instead of free.

### Methodology notes worth keeping

Three harness defects were found and fixed before any of the above was trustworthy — each initially produced plausible-looking numbers:

- **Stale bundle.** `src/client/*.ts` reaches the browser through a `Bun.build` at server module scope. `bun --hot` does not rebuild it because `server.ts` does not import those files, so client edits silently do not apply until a full server restart. Two Chrome runs were measured against the old harness before this was caught.
- **Post-hoc frame sampling.** Sampling a frame chain only *after* the morph resolves misses the repaint when SSE delivery jitters. Replaced with a recorder running continuously from the POST until well past the morph. This changed Chrome spans from an apparent 7.5 ms to a true 49 ms — the earlier number was measuring an idle page.
- **Silent timeouts.** A morph that never arrived produced `NaN` -> `null` and was pooled into the medians. Now surfaced as `timedOutJumps`, which is what exposed largediff-f518.

General lesson for the writeup: every one of these bugs made the numbers look *better* and more stable than reality. A measurement harness needs its own falsification pass before its output is quotable.
