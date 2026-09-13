# Prod baseline — 2026-09-12

First benchmark against production after the JSX render layer + hardening
deploy (prod commit `216626d9`). Single client (MacBook Air, headless
Chrome + release Safari), driving `https://largediff.yagni.club` over the
real TLS + proxy path. JSON alongside: `2026-09-prod-baseline.json`.

Re-run this after any change that touches the render/projection path;
compare medians + worst, not single numbers.

## First load (Chrome)

| metric | value |
| --- | --- |
| navigation → 100+ diff rows painted | **378 ms** |
| first sidebar click → morph applied (over the proxy) | **88 ms** |

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
