// File-windowed HTML fragment renderer.
//
// Given the layout and the session's viewport (scrollTop + height), returns
// the inner HTML for `#ds-window`: one `<section data-file="…">` per file
// whose pixel range intersects the (overscanned) viewport.
//
// Why sections instead of a flat row list:
//   - Most scrolls happen within a single file. With sections, the morph for
//     those scrolls is byte-identical (the section's subtree doesn't change),
//     so Idiomorph does nothing. Today's flat layout re-stamps `top:Npx` on
//     every visible row each /view tick.
//   - The per-file `.file-card-header` is `position:sticky; top:0`; the
//     browser pushes prior chrome up as the next section enters the
//     viewport. Replaces the JS scroll listener + `body.is-stuck` plumbing.
//
// Two tiers:
//   - Inline file (rowCount <= INLINE_FILE_ROW_LIMIT): every row of the file
//     is rendered. The section's subtree is stable across scrolls.
//   - Virtualized file (over the limit): only rows intersecting the
//     overscanned viewport are emitted; the section claims its full pixel
//     height so scroll geometry stays correct. Inner morph still happens as
//     the user scrolls within the file.

import { type Layout, ROW_HEIGHTS, ROW_LINE, type RowDescriptor } from "../diff/layout.ts";
import type { HighlightMode } from "../session/types.ts";
import type { DiffFileSummary, FileId, HighlightKind } from "../store/diff.ts";
import { type JsxNode, renderToString } from "./jsx-runtime.ts";

// Single-glance class names for syntax tokens. Short to keep wire bytes
// low — they repeat ~hundreds of times per push and compress as a single
// dictionary entry under brotli. Matches the `::highlight()` priors we
// retired (see styles.css for the colour mapping).
export const TOKEN_CLASS: Record<HighlightKind, string> = {
  keyword: "kw",
  string: "str",
  comment: "cmt",
  number: "num",
  function: "fn",
  type: "typ",
};

// Sorted by `start` (ascending) so the renderer can walk text + spans
// in one pass. The tokenizer CAN emit overlaps — it scans strings before
// comments, so `/* "abc" */` yields a comment span and an interior string
// span. `TokenLine` clamps and skips so the earlier-starting span
// wins and no text is lost.
export type LineSpan = { start: number; end: number; cls: string };

// Positional encoding for `data-tk` in "ranges" highlight mode. The index
// into this array is what ships on the wire, so a token costs
// `start,len,k|` instead of a full `<span class="kw"></span>` wrapper.
// Order is frozen — the client's registry (client/ranges.ts) maps the same
// indices back to Highlight registry names.
export const TOKEN_CLASS_ORDER = ["kw", "str", "cmt", "num", "fn", "typ"] as const;

const TOKEN_CLASS_INDEX: Record<string, number> = {
  kw: 0,
  str: 1,
  cmt: 2,
  num: 3,
  fn: 4,
  typ: 5,
};

export type TokensForLine = (fileId: FileId, lineIndex: number) => readonly LineSpan[];

// Two viewports of overscan: with sections, the morph at a file boundary is
// heavier than the row-granularity morphs of the prior architecture, so a
// fast fling needs more lead distance to ensure the next section is already
// in the DOM before the user reaches it. Costs a few extra KB per push
// after brotli warm-up.
export const DEFAULT_OVERSCAN_PX = 2400;

// Threshold above which a file virtualizes its own rows inside its section.
// Inline files of ~2000 rows are still cheap to render whole; the wire cost
// is a few hundred KB before brotli. Synthetic huge files get the inner-
// virtualization path.
export const INLINE_FILE_ROW_LIMIT = 2000;

export interface FilesContext {
  layout: Layout;
  fileSummaries: ReadonlyArray<DiffFileSummary>;
  lineFor: (fileId: FileId, lineIndex: number) => string;
  // Returns the (sorted, by start position) syntax token spans for a line.
  // Empty array when the line has no tokens. Pre-indexed per file by
  // `pushProjection` so the renderer doesn't re-walk the per-kind token
  // arrays for each row.
  tokensForLine: TokensForLine;
  scrollTop: number;
  height: number;
  overscanPx?: number;
  // Defaults to "spans" when omitted, matching DEFAULT_SETTINGS.
  highlight?: HighlightMode;
}

export interface FilesSlice {
  fileStart: number;
  fileEnd: number; // -1 when nothing is visible
  html: string;
  visibleByFile: Map<FileId, { minLine: number; maxLine: number }>;
}

export function renderFiles(ctx: FilesContext): FilesSlice {
  const layout = ctx.layout;
  if (layout.rowCount === 0 || layout.fileCount() === 0) {
    return { fileStart: 0, fileEnd: -1, html: "", visibleByFile: new Map() };
  }
  const overscanPx = ctx.overscanPx ?? DEFAULT_OVERSCAN_PX;
  const topPx = Math.max(0, ctx.scrollTop - overscanPx);
  const botPx = Math.max(topPx, ctx.scrollTop) + Math.max(0, ctx.height) + overscanPx;
  const { start, end } = layout.filesIntersecting(topPx, botPx);

  const visibleByFile = new Map<FileId, { minLine: number; maxLine: number }>();
  const sections: string[] = [];

  for (let fi = start; fi <= end; fi++) {
    const summary = ctx.fileSummaries[fi];
    if (summary === undefined) continue;
    sections.push(
      renderToString(
        <FileSection
          ctx={ctx}
          fileIndex={fi}
          summary={summary}
          topPx={topPx}
          botPx={botPx}
          visibleByFile={visibleByFile}
        />,
      ),
    );
  }

  return { fileStart: start, fileEnd: end, html: sections.join("\n"), visibleByFile };
}

interface FileSectionProps {
  ctx: FilesContext;
  fileIndex: number;
  summary: DiffFileSummary;
  topPx: number;
  botPx: number;
  visibleByFile: Map<FileId, { minLine: number; maxLine: number }>;
}

function FileSection(props: FileSectionProps) {
  const { ctx, fileIndex, summary, topPx, botPx, visibleByFile } = props;
  const layout = ctx.layout;
  const fileTop = layout.pixelTopForFile(fileIndex);
  const fileHeight = layout.pixelHeightOfFile(fileIndex);
  const firstRow = layout.firstRowOfFile(fileIndex);
  const rowCount = layout.rowCountOfFile(fileIndex);
  const lastRow = firstRow + rowCount - 1;
  const inline = rowCount <= INLINE_FILE_ROW_LIMIT;

  // Row range to emit inside the section's `.file-rows` (excludes the
  // file-header row at firstRow — that's the section's <header>).
  let rowStart = firstRow + 1;
  let rowEnd = lastRow;
  if (!inline) {
    const viewportStart = layout.rowAtPixel(topPx);
    const viewportEnd = layout.rowAtPixel(botPx);
    rowStart = Math.max(rowStart, viewportStart);
    rowEnd = Math.min(lastRow, viewportEnd);
  }

  const fileId = summary.id;

  // `.file-rows` is a positioning container for the inner rows. Its content
  // box starts at `fileTop + 72` in absolute coords (file-header occupies
  // the section's first 72px); rows inside use `top: pixelTop - 72px`.
  const rowsOriginAbs = fileTop + ROW_HEIGHTS["file-header"];
  const rowsHeight = Math.max(0, fileHeight - ROW_HEIGHTS["file-header"]);

  return (
    <section
      id={`f-${fileId}`}
      data-file={fileId}
      data-fi={fileIndex}
      class="file-section"
      style={`top:${fileTop}px;height:${fileHeight}px`}
    >
      <FileCardHeader summary={summary} />
      <div class="file-rows" style={`height:${rowsHeight}px`}>
        <InnerRows
          ctx={ctx}
          summary={summary}
          fileIndex={fileIndex}
          rowStart={rowStart}
          rowEnd={rowEnd}
          lastRow={lastRow}
          rowsOriginAbs={rowsOriginAbs}
          visibleByFile={visibleByFile}
        />
      </div>
    </section>
  );
}

// Jump targeting lives on the server's `jumpToPx` signal rather than a
// `data-anchor` attribute; the body-level data-effect reads the signal
// and calls scrollTo with the exact pixel. Robust to the target
// section's content-visibility:auto skipping its subtree's layout, and
// to Safari's inconsistent scrollIntoView behaviour on sticky elements.
function FileCardHeader(props: { summary: DiffFileSummary }) {
  const { summary } = props;
  return (
    <header class="file-card-header">
      <span class="caret" aria-hidden="true">
        ▾
      </span>
      <span class="path" title={summary.path}>
        {summary.path}
      </span>
      <span class="meta">
        <span class="lang">{summary.language}</span>
        <span class="adds">+{summary.additions ?? 0}</span>
        <span class="dels">-{summary.deletions ?? 0}</span>
      </span>
    </header>
  );
}

interface InnerRowsProps {
  ctx: FilesContext;
  summary: DiffFileSummary;
  fileIndex: number;
  rowStart: number;
  rowEnd: number;
  lastRow: number;
  rowsOriginAbs: number;
  visibleByFile: Map<FileId, { minLine: number; maxLine: number }>;
}

function InnerRows(props: InnerRowsProps) {
  const { ctx, summary, fileIndex, rowStart, rowEnd, lastRow, rowsOriginAbs, visibleByFile } =
    props;
  const layout = ctx.layout;
  if (rowStart > rowEnd) return null;
  const out: (JsxNode | null)[] = [];
  for (let i = rowStart; i <= rowEnd; i++) {
    // Defensive — the file-window slice can extend across file boundaries
    // when overscan crosses them; skip rows that don't belong to this file.
    if ((layout.fileIndices[i] ?? -1) !== fileIndex) continue;
    if (layout.kinds[i] === ROW_LINE) {
      const li = layout.lineIndices[i] ?? 0;
      const range = visibleByFile.get(summary.id);
      if (range === undefined) {
        visibleByFile.set(summary.id, { minLine: li, maxLine: li });
      } else {
        if (li < range.minLine) range.minLine = li;
        if (li > range.maxLine) range.maxLine = li;
      }
    }
    out.push(
      <Row
        desc={layout.describe(i)}
        ctx={ctx}
        summary={summary}
        lastInFile={i === lastRow}
        rowsOriginAbs={rowsOriginAbs}
      />,
    );
  }
  return <>{out}</>;
}

interface RowProps {
  desc: RowDescriptor;
  ctx: FilesContext;
  summary: DiffFileSummary;
  lastInFile: boolean;
  rowsOriginAbs: number;
}

// Position relative to `.file-rows` so the section subtree is stable
// across scrolls (the row's `top` doesn't depend on scrollTop).
function Row(props: RowProps) {
  const { desc, ctx, summary, lastInFile, rowsOriginAbs } = props;
  const fileId = summary.id;
  const relTop = desc.pixelTop - rowsOriginAbs;
  const rowId = `r-${desc.rowIndex}`;
  const lastInFileAttr = lastInFile ? "" : undefined;

  if (desc.kind === "hunk-header") {
    return (
      <div
        id={rowId}
        data-row={desc.rowIndex}
        data-file={fileId}
        data-hunk={desc.hunkIndex}
        data-last-in-file={lastInFileAttr}
        class="row hunk-header"
        style={`top:${relTop}px`}
      >
        <span class="hunk-label">@@ hunk {desc.hunkIndex + 1} @@</span>
      </div>
    );
  }

  if (desc.kind === "line") {
    const rawText = ctx.lineFor(fileId, desc.lineIndex);
    const spans = ctx.tokensForLine(fileId, desc.lineIndex);
    // "ranges" mode ships the line as a single plain text node plus a
    // compact offset list; the client turns those into Ranges and hands
    // them to CSS.highlights. "spans" mode inlines the markup. Both carry
    // their token information in the same fat morph, so the wire-byte
    // comparison between the two is apples-to-apples.
    const ranges = ctx.highlight === "ranges";
    const marker = desc.lineKind === "add" ? "+" : desc.lineKind === "del" ? "-" : " ";
    return (
      <div
        id={rowId}
        data-row={desc.rowIndex}
        data-file={fileId}
        data-line={desc.lineIndex}
        data-lang={summary.language}
        data-last-in-file={lastInFileAttr}
        data-tk={ranges ? tokenRanges(rawText, spans) : undefined}
        class={`row line ${desc.lineKind}`}
        style={`top:${relTop}px`}
      >
        <span class="ln old">{desc.oldLineNo ?? ""}</span>
        <span class="ln new">{desc.newLineNo ?? ""}</span>
        <span class="marker" aria-hidden="true">
          {marker}
        </span>
        <span class="text">{ranges ? rawText : <TokenLine text={rawText} spans={spans} />}</span>
      </div>
    );
  }

  // file-header rows belong to the section's <header>, not `.file-rows`.
  return null;
}

// A line of source as alternating plain text + token-span chunks.
// Sorted-by-start spans let us walk in one pass. The runtime escapes both
// the plain runs and the token text, so user-provided content can't break
// out of the row.
function TokenLine(props: { text: string; spans: readonly LineSpan[] }) {
  const { text, spans } = props;
  if (spans.length === 0) return <>{text}</>;
  const parts: (string | JsxNode)[] = [];
  let pos = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span === undefined) continue;
    // Skip a span whose range fell off the line (defensive — shouldn't
    // happen with a well-formed token index).
    if (span.end <= pos) continue;
    const start = span.start < pos ? pos : span.start;
    const end = span.end > text.length ? text.length : span.end;
    if (end <= start) continue;
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(<span class={span.cls}>{text.slice(start, end)}</span>);
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

// "ranges" mode counterpart to `TokenLine`. Computes the row's token
// offsets as `start,len,k|start,len,k`, where `k` indexes
// TOKEN_CLASS_ORDER. Offsets are UTF-16 code units into the *raw* line —
// which is exactly what the browser's text node contains once the escaped
// entities are parsed back, so the client can build Ranges against it
// without any re-mapping.
//
// Returns undefined (no attribute) for a line with no tokens.
function tokenRanges(text: string, spans: readonly LineSpan[]): string | undefined {
  if (spans.length === 0) return undefined;
  const parts: string[] = [];
  let pos = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span === undefined) continue;
    // Same clamping as TokenLine so both modes highlight byte-for-byte the
    // same regions — otherwise the comparison is measuring two different
    // amounts of work.
    if (span.end <= pos) continue;
    const start = span.start < pos ? pos : span.start;
    const end = span.end > text.length ? text.length : span.end;
    if (end <= start) continue;
    const k = TOKEN_CLASS_INDEX[span.cls];
    if (k === undefined) continue;
    parts.push(`${start},${end - start},${k}`);
    pos = end;
  }
  if (parts.length === 0) return undefined;
  return parts.join("|");
}
