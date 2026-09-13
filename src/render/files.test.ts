import { describe, expect, test } from "bun:test";
import { generateDiff } from "../diff/generator.ts";
import { LayoutBuilder, ROW_HEIGHTS } from "../diff/layout.ts";
import { INLINE_FILE_ROW_LIMIT, type LineSpan, renderFiles } from "./files.ts";

const NO_SPANS: readonly LineSpan[] = [];
const tokensForLine = (): readonly LineSpan[] => NO_SPANS;

function makeFixture() {
  const diff = generateDiff({ seed: "render-test", lines: 800 });
  const lineCache = new Map<string, string[]>();
  const lineFor = (fileId: string, lineIndex: number) => {
    let lines = lineCache.get(fileId);
    if (lines === undefined) {
      lines = diff.file(fileId).content.split("\n");
      lineCache.set(fileId, lines);
    }
    return lines[lineIndex] ?? "";
  };
  return { diff, lineFor, tokensForLine };
}

describe("renderFiles", () => {
  test("returns empty slice for an empty layout", () => {
    // generateDiff can't produce a zero-row layout (it floors at one
    // file), so build one directly.
    const slice = renderFiles({
      layout: new LayoutBuilder(0).build(),
      fileSummaries: [],
      lineFor: () => "",
      tokensForLine,
      scrollTop: 0,
      height: 600,
    });
    expect(slice).toEqual({ fileStart: 0, fileEnd: -1, html: "", visibleByFile: new Map() });
  });

  test("emits one <section> per file in the visible range", () => {
    const { diff, lineFor } = makeFixture();
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: 0,
      height: 600,
      overscanPx: 200,
    });
    const sectionCount = (slice.html.match(/<section [^>]*class="file-section"/g) ?? []).length;
    expect(sectionCount).toBe(slice.fileEnd - slice.fileStart + 1);
  });

  test("sections are positioned at pixelTopForFile and height pixelHeightOfFile", () => {
    const { diff, lineFor } = makeFixture();
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: 0,
      height: 400,
      overscanPx: 0,
    });
    const matches = Array.from(
      slice.html.matchAll(/<section [^>]*data-fi="(\d+)"[^>]*style="top:(\d+)px;height:(\d+)px"/g),
    );
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const fi = Number(m[1]);
      const top = Number(m[2]);
      const height = Number(m[3]);
      expect(top).toBe(diff.layout.pixelTopForFile(fi));
      expect(height).toBe(diff.layout.pixelHeightOfFile(fi));
    }
  });

  test("each section has a sticky-eligible .file-card-header child", () => {
    const { diff, lineFor } = makeFixture();
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: 0,
      height: 400,
    });
    const headers = slice.html.match(/<header class="file-card-header"[\s\S]*?<\/header>/g) ?? [];
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) {
      expect(h).toContain('class="caret"');
      expect(h).toContain('class="path"');
      expect(h).toContain('class="meta"');
    }
  });

  test("inner rows use relative top within .file-rows (origin = fileTop+72)", () => {
    const { diff, lineFor } = makeFixture();
    // Scroll to file 1 so the section is large enough to inspect.
    const fi = 1;
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: diff.layout.pixelTopForFile(fi),
      height: 400,
      overscanPx: 0,
    });
    const rowsOrigin = diff.layout.pixelTopForFile(fi) + ROW_HEIGHTS["file-header"];
    const matches = slice.html.matchAll(/data-row="(\d+)"[^>]*style="top:(-?\d+)px"/g);
    let checked = 0;
    for (const m of matches) {
      const row = Number(m[1]);
      const top = Number(m[2]);
      // Only check rows that belong to file `fi`.
      if ((diff.layout.fileIndices[row] ?? -1) !== fi) continue;
      expect(top).toBe(diff.layout.pixelTop(row) - rowsOrigin);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("populates visibleByFile with line index range for files in view", () => {
    const { diff, lineFor } = makeFixture();
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: 0,
      height: 400,
      overscanPx: 0,
    });
    expect(slice.visibleByFile.size).toBeGreaterThan(0);
    for (const [, range] of slice.visibleByFile) {
      expect(range.minLine).toBeGreaterThanOrEqual(0);
      expect(range.maxLine).toBeGreaterThanOrEqual(range.minLine);
    }
  });

  test("marks the last row of each file with data-last-in-file", () => {
    const { diff, lineFor } = makeFixture();
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: 0,
      height: diff.layout.totalHeight,
      overscanPx: 0,
    });
    // Each file's last *content* row (not the file-header) gets the marker.
    const matches = slice.html.match(/data-last-in-file=""/g) ?? [];
    expect(matches.length).toBe(diff.meta.files.length);
  });

  test("line rows expose a dedicated marker column with the +/- glyph", () => {
    const { diff, lineFor } = makeFixture();
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: 0,
      height: 400,
    });
    expect(slice.html).toMatch(/class="marker"[^>]*>\+</);
    expect(slice.html).toMatch(/class="marker"[^>]*>-</);
    expect(slice.html).toMatch(/class="marker"[^>]*> </);
  });

  test("inline file inside an unrelated section stays fully rendered (subtree-stable)", () => {
    const { diff, lineFor } = makeFixture();
    // Render once when scrolled to file 0
    const sliceA = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: diff.layout.pixelTopForFile(0),
      height: 400,
      overscanPx: 0,
    });
    // Render again at a slightly different scrollTop within the same file
    const sliceB = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor,
      tokensForLine,
      scrollTop: diff.layout.pixelTopForFile(0) + 50,
      height: 400,
      overscanPx: 0,
    });
    // If file 0 is inline (smaller than the limit), its section's HTML
    // should be byte-identical across these two renders — that's the whole
    // point of file-windowing.
    if (diff.layout.rowCountOfFile(0) <= INLINE_FILE_ROW_LIMIT) {
      const sectionA = sliceA.html.match(/<section [^>]*data-fi="0"[\s\S]*?<\/section>/)?.[0];
      const sectionB = sliceB.html.match(/<section [^>]*data-fi="0"[\s\S]*?<\/section>/)?.[0];
      expect(sectionA).toBeDefined();
      expect(sectionB).toBe(sectionA);
    }
  });

  test("escapes HTML in line text and paths", () => {
    const { diff } = makeFixture();
    const slice = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor: () => '<script>alert("xss")</script>',
      tokensForLine,
      scrollTop: 0,
      height: ROW_HEIGHTS["file-header"] * 2 + ROW_HEIGHTS.line * 5,
    });
    expect(slice.html).not.toContain("<script>");
    expect(slice.html).toContain("&lt;script&gt;");
  });
});

describe("highlight modes", () => {
  // A line with a keyword, a string and a character that HTML-escapes, so
  // the offset mapping is exercised against text whose escaped form is
  // longer than its raw form.
  const LINE = 'const greeting = "a<b";';
  //            0123456789012345678901
  //            const=[0,5)  "a<b"=[17,22)
  const SPANS: readonly LineSpan[] = [
    { start: 0, end: 5, cls: "kw" },
    { start: 17, end: 22, cls: "str" },
  ];

  function renderOne(highlight: "spans" | "ranges"): string {
    const diff = generateDiff({ seed: "hl-modes", lines: 40 });
    return renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor: () => LINE,
      tokensForLine: () => SPANS,
      scrollTop: 0,
      height: 600,
      overscanPx: 0,
      highlight,
    }).html;
  }

  test("spans mode inlines token markup and emits no data-tk", () => {
    const html = renderOne("spans");
    expect(html).toContain('<span class="kw">const</span>');
    expect(html).toContain('<span class="str">&quot;a&lt;b&quot;</span>');
    expect(html).not.toContain("data-tk");
  });

  test("ranges mode emits plain escaped text plus data-tk offsets", () => {
    const html = renderOne("ranges");
    expect(html).not.toContain('<span class="kw">');
    expect(html).not.toContain('<span class="str">');
    // kw is index 0, str is index 1 in TOKEN_CLASS_ORDER.
    expect(html).toContain('data-tk="0,5,0|17,5,1"');
    // The row text is the whole line, escaped, as a single text node.
    expect(html).toContain('<span class="text">const greeting = &quot;a&lt;b&quot;;</span>');
  });

  test("data-tk offsets index the raw line, not its escaped form", () => {
    const html = renderOne("ranges");
    const m = /data-tk="([^"]+)"/.exec(html);
    expect(m).not.toBeNull();
    const first = (m?.[1] ?? "").split("|")[0] ?? "";
    const [start, len] = first.split(",").map(Number);
    // Slicing the RAW line by the emitted offsets must reproduce the
    // token. This is the invariant the client depends on: after the
    // parser decodes entities, the DOM text node equals the raw line.
    expect(LINE.slice(start, (start ?? 0) + (len ?? 0))).toBe("const");
    const second = (m?.[1] ?? "").split("|")[1] ?? "";
    const [s2, l2] = second.split(",").map(Number);
    expect(LINE.slice(s2, (s2 ?? 0) + (l2 ?? 0))).toBe('"a<b"');
  });

  test("defaults to spans when the mode is omitted", () => {
    const diff = generateDiff({ seed: "hl-default", lines: 40 });
    const html = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor: () => LINE,
      tokensForLine: () => SPANS,
      scrollTop: 0,
      height: 600,
      overscanPx: 0,
    }).html;
    expect(html).toContain('<span class="kw">const</span>');
    expect(html).not.toContain("data-tk");
  });

  test("a line with no tokens emits no data-tk attribute", () => {
    const diff = generateDiff({ seed: "hl-empty", lines: 40 });
    const html = renderFiles({
      layout: diff.layout,
      fileSummaries: diff.meta.files,
      lineFor: () => LINE,
      tokensForLine: () => NO_SPANS,
      scrollTop: 0,
      height: 600,
      overscanPx: 0,
      highlight: "ranges",
    }).html;
    expect(html).not.toContain("data-tk");
  });
});
