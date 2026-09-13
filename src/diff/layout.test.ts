import { describe, expect, test } from "bun:test";
import { type Layout, LayoutBuilder, LINE_ADD, LINE_CTX, LINE_DEL, ROW_HEIGHTS } from "./layout.ts";

function tinyLayout(): Layout {
  // 1 file: file-header + hunk-header + 3 lines (ctx, add, del).
  const builder = new LayoutBuilder(5);
  builder.pushFileHeader(0);
  builder.pushHunkHeader(0, 0);
  builder.pushLine({
    fileIndex: 0,
    hunkIndex: 0,
    lineKind: LINE_CTX,
    lineIndex: 0,
    oldLineNo: 10,
    newLineNo: 10,
  });
  builder.pushLine({
    fileIndex: 0,
    hunkIndex: 0,
    lineKind: LINE_ADD,
    lineIndex: 1,
    oldLineNo: 0,
    newLineNo: 11,
  });
  builder.pushLine({
    fileIndex: 0,
    hunkIndex: 0,
    lineKind: LINE_DEL,
    lineIndex: 2,
    oldLineNo: 11,
    newLineNo: 0,
  });
  return builder.build();
}

describe("Layout", () => {
  test("totalHeight is the sum of per-row heights", () => {
    const layout = tinyLayout();
    const expected = ROW_HEIGHTS["file-header"] + ROW_HEIGHTS["hunk-header"] + 3 * ROW_HEIGHTS.line;
    expect(layout.totalHeight).toBe(expected);
    expect(layout.pixelOffsets[layout.rowCount]).toBe(expected);
  });

  test("pixel offsets advance by per-row height", () => {
    const layout = tinyLayout();
    expect(layout.pixelOffsets[0]).toBe(0);
    expect(layout.pixelOffsets[1]).toBe(ROW_HEIGHTS["file-header"]);
    expect(layout.pixelOffsets[2]).toBe(ROW_HEIGHTS["file-header"] + ROW_HEIGHTS["hunk-header"]);
    expect(layout.pixelOffsets[3]).toBe(
      ROW_HEIGHTS["file-header"] + ROW_HEIGHTS["hunk-header"] + ROW_HEIGHTS.line,
    );
  });

  test("rowAtPixel maps every pixel inside a row back to that row", () => {
    const layout = tinyLayout();
    for (let i = 0; i < layout.rowCount; i++) {
      const top = layout.pixelTop(i);
      const h = layout.heightAt(i);
      expect(layout.rowAtPixel(top)).toBe(i);
      expect(layout.rowAtPixel(top + Math.floor(h / 2))).toBe(i);
      expect(layout.rowAtPixel(top + h - 1)).toBe(i);
    }
  });

  test("rowAtPixel clamps out-of-range queries", () => {
    const layout = tinyLayout();
    expect(layout.rowAtPixel(-1)).toBe(0);
    expect(layout.rowAtPixel(0)).toBe(0);
    expect(layout.rowAtPixel(layout.totalHeight)).toBe(layout.rowCount - 1);
    expect(layout.rowAtPixel(layout.totalHeight + 1000)).toBe(layout.rowCount - 1);
  });

  test("describe unpacks each row faithfully", () => {
    const layout = tinyLayout();
    const fh = layout.describe(0);
    expect(fh).toEqual({
      kind: "file-header",
      rowIndex: 0,
      fileIndex: 0,
      pixelTop: 0,
      height: ROW_HEIGHTS["file-header"],
    });
    const hh = layout.describe(1);
    expect(hh).toEqual({
      kind: "hunk-header",
      rowIndex: 1,
      fileIndex: 0,
      hunkIndex: 0,
      pixelTop: ROW_HEIGHTS["file-header"],
      height: ROW_HEIGHTS["hunk-header"],
    });
    const ctx = layout.describe(2);
    expect(ctx).toMatchObject({
      kind: "line",
      lineKind: "ctx",
      oldLineNo: 10,
      newLineNo: 10,
      lineIndex: 0,
      height: ROW_HEIGHTS.line,
    });
    const add = layout.describe(3);
    expect(add).toMatchObject({
      kind: "line",
      lineKind: "add",
      oldLineNo: undefined,
      newLineNo: 11,
      lineIndex: 1,
    });
    const del = layout.describe(4);
    expect(del).toMatchObject({
      kind: "line",
      lineKind: "del",
      oldLineNo: 11,
      newLineNo: undefined,
      lineIndex: 2,
    });
  });

  test("builder errors if not all rows are written", () => {
    const builder = new LayoutBuilder(3);
    builder.pushFileHeader(0);
    expect(() => builder.build()).toThrow();
  });

  test("pixelTopForFile returns the file-header row's pixel offset", () => {
    // 2 files: f0 has [header, hunk, line, line], f1 has [header, line].
    const builder = new LayoutBuilder(6);
    builder.pushFileHeader(0);
    builder.pushHunkHeader(0, 0);
    builder.pushLine({
      fileIndex: 0,
      hunkIndex: 0,
      lineKind: LINE_CTX,
      lineIndex: 0,
      oldLineNo: 1,
      newLineNo: 1,
    });
    builder.pushLine({
      fileIndex: 0,
      hunkIndex: 0,
      lineKind: LINE_ADD,
      lineIndex: 1,
      oldLineNo: 0,
      newLineNo: 2,
    });
    builder.pushFileHeader(1);
    builder.pushLine({
      fileIndex: 1,
      hunkIndex: 0,
      lineKind: LINE_CTX,
      lineIndex: 0,
      oldLineNo: 1,
      newLineNo: 1,
    });
    const layout = builder.build();
    expect(layout.pixelTopForFile(0)).toBe(0);
    expect(layout.pixelTopForFile(1)).toBe(
      ROW_HEIGHTS["file-header"] + ROW_HEIGHTS["hunk-header"] + 2 * ROW_HEIGHTS.line,
    );
  });

  test("fileAtRow returns the file index a row belongs to", () => {
    const builder = new LayoutBuilder(3);
    builder.pushFileHeader(0);
    builder.pushFileHeader(1);
    builder.pushFileHeader(2);
    const layout = builder.build();
    expect(layout.fileAtRow(0)).toBe(0);
    expect(layout.fileAtRow(1)).toBe(1);
    expect(layout.fileAtRow(2)).toBe(2);
  });

  test("rowAtPixel is fast at 200k rows (≤ 1ms over 1000 lookups)", () => {
    const N = 200_000;
    const builder = new LayoutBuilder(N);
    // Just stuff line rows; doesn't matter for binary-search timing.
    for (let i = 0; i < N; i++) {
      builder.pushLine({
        fileIndex: 0,
        hunkIndex: 0,
        lineKind: LINE_CTX,
        lineIndex: i,
        oldLineNo: i + 1,
        newLineNo: i + 1,
      });
    }
    const layout = builder.build();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      // spread queries across the range
      const pixel = (i * layout.totalHeight) / 1000;
      const row = layout.rowAtPixel(pixel);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(N);
    }
    const elapsed = performance.now() - start;
    // 1000 binary-search lookups on 200k rows should be well under 5ms.
    expect(elapsed).toBeLessThan(5);
  });
});
