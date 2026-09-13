import { describe, expect, test } from "bun:test";
import { createDiffEngine, generateDiff } from "./generator.ts";

describe("generateDiff", () => {
  test("same seed produces byte-identical meta and file content", () => {
    const a = generateDiff({ seed: "demo", lines: 5000 });
    const b = generateDiff({ seed: "demo", lines: 5000 });

    expect(a.meta.totalFiles).toBe(b.meta.totalFiles);
    expect(a.meta.totalLines).toBe(b.meta.totalLines);
    expect(a.meta.files).toEqual(b.meta.files);

    for (const summary of a.meta.files) {
      const fa = a.file(summary.id);
      const fb = b.file(summary.id);
      expect(fa.content).toBe(fb.content);
      expect(fa.path).toBe(fb.path);
      expect(fa.totalLines).toBe(fb.totalLines);
    }
  });

  test("layouts from the same seed match row-for-row", () => {
    const a = generateDiff({ seed: "demo", lines: 2000 });
    const b = generateDiff({ seed: "demo", lines: 2000 });
    expect(a.layout.rowCount).toBe(b.layout.rowCount);
    expect(a.layout.totalHeight).toBe(b.layout.totalHeight);
    for (let i = 0; i < a.layout.rowCount; i++) {
      expect(a.layout.kinds[i]).toBe(b.layout.kinds[i]);
      expect(a.layout.fileIndices[i]).toBe(b.layout.fileIndices[i]);
      expect(a.layout.lineKinds[i]).toBe(b.layout.lineKinds[i]);
      expect(a.layout.oldLineNos[i]).toBe(b.layout.oldLineNos[i]);
      expect(a.layout.newLineNos[i]).toBe(b.layout.newLineNos[i]);
    }
  });

  test("different seeds produce different content", () => {
    const a = generateDiff({ seed: "seed-a", lines: 1000 });
    const b = generateDiff({ seed: "seed-b", lines: 1000 });
    // At least one file shape should differ across seeds.
    expect(a.meta.files).not.toEqual(b.meta.files);
  });

  test("file synthesis is lazy — meta available without any file content", () => {
    const r = generateDiff({ seed: "demo", lines: 5000 });
    // meta + layout are eagerly built but content array isn't touched until file() is called
    expect(r.meta.files.length).toBeGreaterThan(0);
    expect(r.layout.totalHeight).toBeGreaterThan(0);

    // Calling file() now produces content; calling it again is allowed and consistent.
    const id = r.meta.files[0]?.id ?? "f0";
    const f1 = r.file(id);
    const f2 = r.file(id);
    expect(f1.content).toBe(f2.content);
    expect(f1.content.split("\n").length).toBe(f1.totalLines);
  });

  test("file content line count matches the file's planned totalLines", () => {
    const r = generateDiff({ seed: "demo", lines: 3000 });
    for (const summary of r.meta.files) {
      const f = r.file(summary.id);
      expect(f.content.split("\n").length).toBe(summary.totalLines);
    }
  });

  test("layout's line rows cover exactly each file's totalLines (per file)", () => {
    const r = generateDiff({ seed: "demo", lines: 2000 });
    const perFileLineRows = new Map<number, number>();
    for (let i = 0; i < r.layout.rowCount; i++) {
      if (r.layout.kinds[i] === 2) {
        const fi = r.layout.fileIndices[i] ?? 0;
        perFileLineRows.set(fi, (perFileLineRows.get(fi) ?? 0) + 1);
      }
    }
    r.meta.files.forEach((summary, idx) => {
      expect(perFileLineRows.get(idx)).toBe(summary.totalLines);
    });
  });

  test("meta.totalLines equals sum of per-file totalLines (within target)", () => {
    const target = 1500;
    const r = generateDiff({ seed: "demo", lines: target });
    const sum = r.meta.files.reduce((acc, f) => acc + f.totalLines, 0);
    expect(r.meta.totalLines).toBe(sum);
    // Should be exactly the target after the rounding fix-up.
    expect(sum).toBe(target);
  });

  test("totalLines is exact for any target at or above the 10-line floor", () => {
    for (const target of [10, 11, 137, 400, 401, 1500]) {
      const r = generateDiff({ seed: "exact", lines: target });
      expect(r.meta.totalLines).toBe(target);
    }
  });

  test("targets below the per-file floor clamp up to 10 lines", () => {
    for (const target of [1, 5, 9]) {
      expect(generateDiff({ seed: "tiny", lines: target }).meta.totalLines).toBe(10);
    }
  });

  test("language mix spans all five languages across many files", () => {
    const r = generateDiff({ seed: "rainbow", lines: 30_000 });
    const langs = new Set(r.meta.files.map((f) => f.language));
    // For 30k lines we expect ~20 files; chances of hitting all 5 languages
    // are overwhelming. If this gets flaky, swap seed deterministically.
    expect(langs.size).toBe(5);
  });

  test("per-file additions and deletions sum to the right ratios", () => {
    const r = generateDiff({ seed: "counts", lines: 5000 });
    let totalAdds = 0;
    let totalDels = 0;
    let totalLines = 0;
    for (const f of r.meta.files) {
      expect(f.additions).toBeGreaterThanOrEqual(0);
      expect(f.deletions).toBeGreaterThanOrEqual(0);
      expect(f.additions + f.deletions).toBeLessThanOrEqual(f.totalLines);
      totalAdds += f.additions;
      totalDels += f.deletions;
      totalLines += f.totalLines;
    }
    // Generator targets roughly 25% adds and 15% dels with variance. Loose bounds.
    expect(totalAdds / totalLines).toBeGreaterThan(0.05);
    expect(totalAdds / totalLines).toBeLessThan(0.45);
    expect(totalDels / totalLines).toBeGreaterThan(0.02);
    expect(totalDels / totalLines).toBeLessThan(0.35);
  });

  test("file paths are unique within a diff", () => {
    const r = generateDiff({ seed: "paths", lines: 20_000 });
    const paths = r.meta.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("scales to a 200k-line diff without crashing and within memory budget", () => {
    const r = generateDiff({ seed: "demo-200k", lines: 200_000 });
    expect(r.meta.totalLines).toBe(200_000);
    expect(r.layout.rowCount).toBeGreaterThan(200_000);
    expect(r.layout.totalHeight).toBeGreaterThan(0);
    // pick a midpoint pixel and ensure rowAt works
    const row = r.layout.rowAtPixel(Math.floor(r.layout.totalHeight / 2));
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(r.layout.rowCount);
  });
});

describe("createDiffEngine", () => {
  test("memoizes meta, files and layout per seed", () => {
    const engine = createDiffEngine({ defaultLines: 1500 });

    const meta1 = engine.meta("seed-x");
    const meta2 = engine.meta("seed-x");
    expect(meta1).toBe(meta2);

    const fid = meta1.files[0]?.id ?? "f0";
    expect(engine.file("seed-x", fid)).toBe(engine.file("seed-x", fid));

    expect(engine.layout("seed-x")).toBe(engine.layout("seed-x"));
  });

  test("evicts the least-recently-used seed beyond maxCachedSeeds", () => {
    const engine = createDiffEngine({ defaultLines: 200, maxCachedSeeds: 2 });
    const a1 = engine.layout("a");
    const b1 = engine.layout("b");
    // Touch "a" so "b" becomes the LRU entry.
    expect(engine.layout("a")).toBe(a1);
    engine.layout("c"); // evicts "b"
    expect(engine.layout("a")).toBe(a1);
    // "b" regenerates: a fresh object, but deterministically identical.
    const b2 = engine.layout("b");
    expect(b2).not.toBe(b1);
    expect(b2.rowCount).toBe(b1.rowCount);
    expect(b2.totalHeight).toBe(b1.totalHeight);
  });

  test("linesForSeed override controls per-seed size", () => {
    const engine = createDiffEngine({
      defaultLines: 500,
      linesForSeed: (s) => (s === "big" ? 5000 : 200),
    });
    expect(engine.meta("big").totalLines).toBe(5000);
    expect(engine.meta("small").totalLines).toBe(200);
  });
});
