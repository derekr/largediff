import { describe, expect, test } from "bun:test";
import type { DiffFileSummary } from "../store/diff.ts";
import {
  renderSidebarRow,
  renderSidebarShell,
  renderSidebarWindow,
  SIDEBAR_ROW_HEIGHT_PX,
} from "./sidebar.ts";

function files(): DiffFileSummary[] {
  return [
    {
      id: "f0",
      path: "src/a.ts",
      language: "typescript",
      totalLines: 100,
      additions: 30,
      deletions: 12,
    },
    { id: "f1", path: "src/b.py", language: "python", totalLines: 50, additions: 5, deletions: 8 },
    { id: "f2", path: "pkg/<x>.go", language: "go", totalLines: 20, additions: 0, deletions: 4 },
  ];
}

describe("renderSidebarShell", () => {
  test("emits the count header and a positioning container with total height + initial rows", () => {
    const html = renderSidebarShell(files(), '<a class="file-row" id="file-row-f0"></a>');
    expect(html).toContain('<span class="count">3 files</span>');
    const expectedHeight = files().length * SIDEBAR_ROW_HEIGHT_PX;
    expect(html).toContain(`<div class="file-rows" style="height:${expectedHeight}px;`);
    // Initial rows are inlined so the page is usable before the SSE attaches.
    expect(html).toContain('id="file-row-f0"');
  });
});

describe("renderSidebarWindow", () => {
  test("emits only the rows inside the visible range plus overscan", () => {
    // 100 files; viewport at top, height 200 → without overscan that's
    // ~6 rows; SIDEBAR_OVERSCAN_PX=800 adds another ~25 rows on each side
    // (top clamped to 0).
    const many: DiffFileSummary[] = Array.from({ length: 100 }, (_, i) => ({
      id: `f${i}`,
      path: `src/file-${i}.ts`,
      language: "typescript",
      totalLines: 10,
      additions: 1,
      deletions: 1,
    }));
    const w = renderSidebarWindow(many, 0, 200, "f0");
    expect(w.start).toBe(0);
    // 200px viewport + 800px overscan / 32px row ≈ 32 rows (Math.ceil)
    expect(w.end).toBeGreaterThanOrEqual(31);
    expect(w.end).toBeLessThanOrEqual(33);
    const rowMatches = w.html.match(/<a [^>]*class="file-row[^"]*"/g) ?? [];
    expect(rowMatches.length).toBe(w.end - w.start + 1);
  });

  test("bakes the active class on the row whose id matches activeFileId", () => {
    const w = renderSidebarWindow(files(), 0, 800, "f1");
    expect(w.html).toContain('class="file-row active" href="#" data-file-id="f1"');
    // Other rows shouldn't be active.
    expect(w.html).toContain('class="file-row" href="#" data-file-id="f0"');
    expect(w.html).toContain('class="file-row" href="#" data-file-id="f2"');
  });

  test("rows carry stable ids for idiomorph identity-matching", () => {
    const w = renderSidebarWindow(files(), 0, 800, "");
    expect(w.html).toContain('id="file-row-f0"');
    expect(w.html).toContain('id="file-row-f1"');
    expect(w.html).toContain('id="file-row-f2"');
  });

  test("escapes HTML in file paths", () => {
    const w = renderSidebarWindow(files(), 0, 800, "");
    expect(w.html).not.toContain("<x>");
    expect(w.html).toContain("pkg/&lt;x&gt;.go");
  });

  test("empty file list returns an empty slice", () => {
    const w = renderSidebarWindow([], 0, 800, "");
    expect(w).toEqual({ start: 0, end: -1, html: "" });
  });
});

describe("renderSidebarRow", () => {
  test("includes per-file metadata, stable id, and the Datastar click handler", () => {
    const html = renderSidebarRow(files()[0] as DiffFileSummary, 64, false);
    expect(html).toContain('id="file-row-f0"');
    expect(html).toContain('class="file-row" href="#" data-file-id="f0"');
    expect(html).toContain('style="top:64px"');
    expect(html).toContain(
      `data-on:click__prevent="$_drawerOpen = false; @post('/sessions/' + $_sid + '/files/f0/jump')"`,
    );
    expect(html).toContain('class="adds">+30');
    expect(html).toContain('class="dels">-12');
  });

  test("appends `active` to the class when the row is the active file", () => {
    const html = renderSidebarRow(files()[1] as DiffFileSummary, 32, true);
    expect(html).toContain('class="file-row active" href="#" data-file-id="f1"');
  });
});
