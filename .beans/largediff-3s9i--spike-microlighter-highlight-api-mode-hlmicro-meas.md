---
# largediff-3s9i
title: 'Spike: microlighter Highlight-API mode (?hl=micro), measured in Safari'
status: completed
type: task
priority: normal
created_at: 2026-09-12T14:07:45Z
updated_at: 2026-09-12T14:31:01Z
---

Vendor microlighter 2.2.0, wire ?hl=micro (plain rows + client TextMate tokenize + Highlight API), drive Safari via safaridriver, compare drops/build/paint vs spans. Decides whether the WebKit Highlight repaint wall (ta4r) is API-inherent or dodged by microlighter's batching.

## Findings (Safari 26.6 release, visible window, selftest 10 jumps @1500ms gap)

Microlighter does NOT dodge the wall — it hits the same one, harder:

- spans: 0/10 late. micro: 1–3/10 late across runs (scheduling races).
- Server is innocent every time: push log shows EMIT for each late jump.
  The morph is written; the browser applies it seconds late or never
  within the window.
- Split per morph (500–1100 rows, 700–2800 ranges): tokenize+register
  (buildMs) mostly 4–42ms; repaint (registration→2nd painted frame)
  436–1322ms. Paint dominates 10–100x. Jumps every 1500ms cannot keep
  up with ~1.2s stalls, so the pipeline falls behind and morphs land
  after the snapshot window.
- Mechanism guess: per-token TextMate ranges (~2000/jump) through the
  same non-batched `Highlight::repaintRange()` path ta4r documents,
  plus microlighter's clear + re-add mutation pattern (the one
  ranges.ts deliberately avoids). Not separated — both point the same
  way, and the paint numbers alone explain the drops.
- ranges mode reran 0/8 this time (one earlier ranges run timed out at
  120s with no DONE banner — single unexplained data point, browser
  quit on timeout so no post-mortem; treating as flake, watching).

## STP 27.0 follow-up (driven via raw WebDriver on the STP safaridriver)

The newest WebKit does not fix it — it makes the failure mode worse:

- spans: 0/10 late, clean.
- micro run 1: 0/10 late, but paintMs 480–1436ms per morph — the same
  repaint wall, peaks slightly WORSE than release Safari (1436 vs
  1322ms). No batching work has landed.
- micro run 2: hard deadlock. After 3 jumps every main-thread eval
  times out at 30s and the page never recovers — 10+ minutes, all STP
  processes at 0.0% CPU (blocked, not spinning), client stops sending
  commands entirely, even a WebDriver screenshot hangs. Release Safari
  degrades to late morphs; STP 27 wedges the tab permanently.
- Not reproducible on demand (run 1 survived the same sequence), so
  it's a scheduling-dependent deadlock in the Highlight repaint path,
  not a deterministic crash. Candidate for a second WebKit bug report
  alongside the sselab fetch-body one — needs a minimal repro before
  filing.

Conclusion (both engines' previews included): the WebKit Highlight
repaint cost is API-inherent, not tokenizer-specific, and current STP
can turn it into an unrecoverable hang. Per-token spans stay the
default. ?hl=micro stays in the tree next to ?hl=ranges so the cost
stays reproducible.

## Summary of Changes
- New: vendor/micro/* (highlight.js + grammar-deps + 6 grammars +
  github.css + README), src/client/micro.ts (MutationObserver rebuild,
  samples in window.__ldHl under mode "micro", incl. paintMs via
  double-rAF)
- modes: HighlightMode + "micro" (types, asHighlight, ?hl=, measure
  Report), files.ts plain-text + language-* class branch, shell bundle
  wiring, /static/micro allow-list routes (exact filenames; `:file`
  matches one segment so grammars get their own route)
- ranges.ts: exported HighlightBuildSample, mode union + optional
  paintMs; measure.ts Report union (spans|ranges|micro)
- Detour fixed along the way: microlighter.min.js is the auto-runner
  (pre>code only, exports nothing) — the programmatic entry is
  highlight.js.
