---
# largediff-qxrh
title: Synthetic diff generator
status: completed
type: epic
priority: normal
created_at: 2026-05-11T17:22:30Z
updated_at: 2026-05-11T18:10:35Z
parent: largediff-oyhu
blocked_by:
    - largediff-qqsg
---

A deterministic, seed-driven generator that produces realistic multi-language diffs at scale (target: 200k+ lines).

## Scope

- `mulberry32` seeded RNG.
- Per-diff metadata: file count, language mix (TS/Python/Go/Rust/JSON), total lines.
- Per-file synth: language-appropriate code via a snippet bank in `src/diff/snippets.ts` (function/class/import patterns per language).
- Hunk generation: deterministic add/delete/context line ratios; multi-hunk files.
- Row descriptor model and flat layout in `src/diff/layout.ts`: each row is `{ kind: 'file-header' | 'hunk-header' | 'line', fileId, ... }`. Fixed heights (line 20px, hunk 24px, file header 40px) for O(1) pixel-to-row math.
- Cumulative offset table for binary-search pixel → row lookups.
- Lazy materialization: only synthesize file contents on first access.

## Acceptance criteria

- `generateDiff({ seed: 'demo-200k', lines: 200000 })` returns metadata + access functions.
- `layout.rowAt(pixel)` returns the right descriptor in microseconds.
- Same seed produces byte-identical output across runs.
- Memory: only the row descriptor table is mandatorily resident; file bodies populate lazily.

## Todo

- [x] `src/diff/rng.ts`: `mulberry32` + `hashSeed` string → uint32
- [x] `src/diff/snippets.ts`: per-language snippet bank (TS/Py/Go/Rust/JSON)
- [x] `src/diff/layout.ts`: typed-array-backed `Layout` with fixed row heights + `rowAt(pixel)` binary search
- [x] `src/diff/generator.ts`: `generateDiff({seed,lines})` + `createDiffEngine()` plugging into `DiffStore`
- [x] ~~Extend `DiffStore`/`DiffSynthesizer` with `layout(seed)`~~ — kept layout off the DiffStore interface; `DiffEngine` exposes it directly (avoids bending the qqsg contract for what is essentially diff-module data)
- [x] Tests: `rng.test.ts` (determinism, known-seed sequence)
- [x] Tests: `layout.test.ts` (fixed heights, total height, `rowAt` round-trip, edge pixels, 200k-row perf)
- [x] Tests: `generator.test.ts` (byte-identical determinism, lazy file synth, target-line accuracy, language mix, 200k-line scale)
- [x] `bun run check` clean

## Summary of Changes

- `src/diff/rng.ts`: `mulberry32` seeded RNG + `hashSeed` (FNV-1a 32-bit) so string seeds become a uint32 starting state. `rngFromSeed`, `pickInt`, `pickWeighted` helpers consumed throughout.
- `src/diff/snippets.ts`: snippet bank of plausible idiomatic code per language (TS / Python / Go / Rust / JSON). Each snippet is a `readonly string[]` of source lines; the generator stitches them to fill files.
- `src/diff/layout.ts`: `Layout` backed by parallel typed arrays (Uint8 kinds + lineKinds, Uint32 fileIndices / hunkIndices / lineIndices / oldLineNos / newLineNos / pixelOffsets) — ~3 MB for a 200k-row diff. Fixed row heights (40 / 24 / 20px) feed a cumulative pixel offset table; `rowAtPixel` does a clamped binary search (~17 compares at 200k rows). `LayoutBuilder` writes rows sequentially and `build()` finalizes the offsets.
- `src/diff/generator.ts`: `generateDiff({ seed, lines })` plans file count from the target, picks language (weighted: 35/25/15/15/10) and a unique path per file from per-language templates + a name bank, plans 1–8 hunks per file with deterministic ctx/add/del ratios and Fisher–Yates-shuffled line kinds, and emits all rows into a `LayoutBuilder` in one pass. File content is lazy: `file(id)` reseeds `mulberry32` from the per-file `contentSeed` and stitches snippets to exactly `totalLines` lines. `createDiffEngine()` memoizes per seed and is a `DiffSynthesizer` (plus a `layout(seed)` method) so it plugs straight into `InMemoryDiffStore`.
- `tokens()` is a stub returning empty spans; real tree-sitter spans land in the highlight epic.
- Tests: 42 cases total (rng determinism + distribution, layout pixel math + describe round-trip + 200k-row search perf, generator byte-identity across runs, lazy file synth, exact line-count fit, all 5 languages present, unique paths, end-to-end integration with `InMemoryDiffStore`).
- Deliberately did not wire the engine into `server.ts` — that consumption lives in largediff-u4me where `pushProjection` lands.

## Notes for largediff-u4me

- Wire `createDiffEngine({ defaultLines: 200_000 })` once at server boot, pass it as `synth` to `InMemoryDiffStore`, and keep a reference to call `engine.layout(seed)` from `pushProjection`.
- `Layout.rowAtPixel(scrollTop)` and `Layout.rowAtPixel(scrollTop + height)` bracket the visible window; describe the rows in between.
- File text for a row: `engine.file(seed, fileId).content.split("\n")[layout.describe(rowIndex).lineIndex]` (or pre-split once per file).
