// Byte-parity harness: renders a full session page + a fat morph payload
// through the current JSX render layer on a fixed session state, so the
// conversion can be verified against the pre-conversion tree without any
// guessing. Run: bun run scripts/render-parity.ts
//
// The output is deterministic (fixed clock-independent inputs; BUILD_ID is
// the one intentional variable — pass JSXBUILD to pin it across runs).

import { renderFiles } from "../src/render/files.tsx";
import { renderAppInner, renderShell } from "../src/render/shell.tsx";
import { renderSidebarShell, renderSidebarWindow } from "../src/render/sidebar.tsx";
import { createDiffEngine } from "../src/diff/generator.ts";
import type { InitialPaint } from "../src/session/projection.ts";

const BUILD_PIN = process.env.JSXBUILD ?? "parity";
process.env.JSXBUILD = BUILD_PIN;

const engine = createDiffEngine({ defaultLines: 2000 });
const seed = "parity-seed";
const meta = engine.meta(seed);
const layout = engine.layout(seed);

const files = meta.files.map((f, i) => ({
  ...f,
  additions: 10 + i,
  deletions: 5 + i,
}));

const initial: InitialPaint = {
  diffHtml: "",
  sidebarHtml: "",
  activeFileId: files[3]!.id,
  chrome: "github",
  scrollerScrollTop: 12_345,
  sidebarScrollTop: 640,
  rowsRendered: 0,
};

// Diff slice at an arbitrary mid-document scroll (crosses file boundaries).
const slice = renderFiles({
  layout,
  fileSummaries: files,
  lineFor: (fid, li) => engine.file(seed, fid).content.split("\n")[li] ?? "",
  tokensForLine: (fid, li) => {
    const spans = engine.tokens(seed, fid, engine.file(seed, fid));
    const out: { start: number; end: number; cls: string }[] = [];
    for (const [kind, list] of Object.entries(spans)) {
      for (const [lineIdx, s, e] of list ?? []) {
        if (lineIdx === li) out.push({ start: s, end: e, cls: kindToCls(kind) });
      }
    }
    return out;
    function kindToCls(k: string): string {
      return { keyword: "kw", string: "str", comment: "cmt", number: "num", function: "fn", type: "typ" }[k] ?? k;
    }
  },
  scrollTop: 55_000,
  height: 800,
  highlight: "spans",
});
initial.diffHtml = slice.html;
initial.rowsRendered = [...slice.visibleByFile.values()].reduce((a, r) => a + (r.maxLine - r.minLine + 1), 0);

initial.sidebarHtml = renderSidebarWindow(files, 640, 900, initial.activeFileId).html;

const report = {
  build: BUILD_PIN,
  seed,
  totalFiles: meta.totalFiles,
  totalRows: layout.rowCount,
  slice: { fileStart: slice.fileStart, fileEnd: slice.fileEnd, bytes: slice.html.length },
  sidebarShell: renderSidebarShell(files, initial.sidebarHtml),
  sidebarWindow: initial.sidebarHtml,
  appInner: renderAppInner({
    sid: "abc123def456",
    pushSeq: 41,
    totalHeight: layout.totalHeight,
    files,
    initial,
    commands: {
      signals: { navEpoch: 7 },
      init: "window.__largediffJump?.(51234)",
      cmdSeq: 12,
    },
    wireStats: { bytesIn: 1_234_567, bytesOut: 45_678, encoding: "br" },
  }),
  shell: renderShell("abc123def456", layout.totalHeight, files, initial, true),
  shellPlain: renderShell("abc123def456", layout.totalHeight, files, initial, false),
};

console.log(
  JSON.stringify(report, null, 1)
    // BUILD_ID rotates per boot; hash with it zeroed for stability.
    .replaceAll(/v=[a-z0-9]+/g, "v=PINNED"),
);
