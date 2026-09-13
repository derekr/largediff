# Prod baseline — 2026-09-12

First benchmark against production after the JSX render layer + hardening
deploy (prod commit `216626d9`). Single client (MacBook Air, headless
Chrome + release Safari), driving `https://largediff.yagni.club` over the
real TLS + proxy path. JSON alongside: `2026-09-prod-baseline.json`.

Re-run this after any change that touches the render/projection path;
compare medians + worst, not single numbers.

## First load

Paint-timing probe (PerformanceObserver, `first-contentful-paint`) plus a
scripted sidebar click on a non-active file → morph, over the real TLS +
proxy path:

| metric | Chrome 153 | Safari 26.6 | STP 27 |
| --- | --- | --- | --- |
| first contentful paint | 312 ms | 300–323 ms | 281–293 ms |
| click → morph | 98–112 ms | 131–145 ms | 133–158 ms |

(Earlier runs reported "378 ms to rows painted" for Chrome — a
navigation→DOM proxy; the FCP probe above is the honest number and
it's in the same ballpark. Headless Chrome omits buffered paint
entries, so the observer form is the one that works everywhere; the
first Safari bench simply lacked this phase, which is why earlier
tables showed dashes.)

## Jump latency (Chrome, `__ldMeasure`, 12 jumps × 3 fresh sessions)

| mode | timeouts | median morph | worst frame gap | wire (run total) |
| --- | --- | --- | --- | --- |
| spans | 0/12 ×3 | 119.8 / 154.6 / 163.6 ms | 50–67 ms | 223.0 KB vs 3.93 MB |
| ranges | 0/12 ×3 | 121.1–123.5 ms | 66.6–66.7 ms | 232.3 KB vs 3.74 MB |

Notes:
- Medians include the full path (POST → render → SSE → morph → paint) plus
  the proxy hop; the frame-gap number is the honest "did the UI freeze"
  signal, and it stayed under one frame-and-a-half throughout.
- `ranges` costs ~9 KB more wire for the same 12 jumps — consistent with
  the largediff-lnhb finding that `data-tk` decimal offsets compress worse
  than repeated span markup.
- Medians drift 120→164 ms across spans runs; gaps don't. Reads as
  network variance on the POST path, not paint cost.

## Scroll coverage (Chrome, 60 px/frame fling for 5 s, 301 samples)

- **100% of samples covered** (rendered window spans the viewport)
- **max lag 0 px** (viewport bottom never ran past the rendered window)
- live rows stayed 478–1016

## Safari 26.6 release (visible window, selftest, 12 jumps @1500ms)

| mode | late morphs |
| --- | --- |
| spans | **1/12** |
| ranges | **4/12** |

Ranges still hurts Safari most (see the Highlight API notes in
`.beans/`), but note these are post-padding+poke numbers with the JSX
build — the pre-JSX Safari baseline for comparison lives in
largediff-3s9i's history and `.beans/largediff-pkrf`.

## STP 27.0 (same harness, `__ldMeasure` percentiles + selftest)

| metric | spans | ranges |
| --- | --- | --- |
| timeouts | 0/12 ×3 | 0/12 ×3 |
| median morph | 125.5–136 ms | 129.5–143 ms |
| worst frame gap | **65–74 ms** | **862–873 ms** |
| selftest drops | 0/12 | 0/12 |
| wire (run total) | 222.7 KB vs 3.89 MB | 232.9–243.2 KB vs 6.0 MB |

Notes:
- The jump-median story holds across WebKits: STP medians (125–143 ms)
  sit right on release Safari's and Chrome's — the wire + server path
  dominates, not the engine.
- **The delivery improvement has a named cause.** Bug 322401
  ("Remove ReadableByteStreamFetchSourceEnabled flag",
  <https://bugs.webkit.org/show_bug.cgi?id=322401>) went RESOLVED FIXED
  on 2026-08-25 (commit `319790@main`, deleting `NonByteSource` and its
  `feedStream()` drain) — the exact stranding path the sselab report
  implicated (`../sselab/WEBKIT-BUG-DESCRIPTION.txt`, which predicted
  that this removal would land before the underlying fix). Release
  Safari 26.6 shipped 2026-07-27, five weeks before the removal, and
  still drops (1/12 spans, 4/12 ranges). STP 27 builds after it deliver
  **0/12 in both modes**. The buggy code path wasn't fixed — it was
  deleted.
- But the ranges **paint wall is unchanged in the newest WebKit**:
  worst frame gap 862–873 ms vs 65–74 ms for spans — an 11× stall per
  jump, matching the css-highlight-lab measurements (436–1436 ms per
  morph registration). Note the wire chip also reports ~6.11 MB
  uncompressed for ranges vs 3.89 MB for spans in STP — the offset
  lists carry the same token data, but STP's innerHTML accounting
  inflates on morph churn; Chrome reports 242 KB for the identical
  payload shape.
- STP wire 222.7 KB ≈ release Safari's 223.0 KB for spans: no meaningful
  encoding difference between the two WebKits on this build.

## Server side (during the same window, from `[metrics]` rollups)

- push render total: **p50 9–18 ms, p90 18–25.6 ms, max 29.7 ms**
- wire compression ratio: 9.5–217× per interval (mix-dependent)
- RSS during the bench: 78 → 125 MB (token caches warming; flat after)

## Known caveats

- Single machine, single network, synthetic seed — a regression baseline,
  not a paper. Medians + worst only.
- The first `firstLoad` probe clicked the already-active file; the
  skip-when-unchanged fingerprint correctly suppressed the morph and the
  probe hung. Re-run clicks a non-active file. (The skip is the feature
  working — a reminder for anyone scripting benches.)
- Safari numbers use the selftest banner (drop counting), not
  `__ldMeasure` percentiles; the two instruments measure different
  failure shapes (delivery vs paint).
