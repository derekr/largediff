// Flat row layout for a generated diff.
//
// One entry per *display* row (file headers, hunk headers, and diff lines).
// All row data lives in parallel typed arrays so a 200k-row diff stays under
// a few MB and pixel→row lookups stay cache-friendly. Row heights are fixed
// per kind (40 / 24 / 20px), which keeps the cumulative offset table cheap
// to build and binary-search.

// Heights are fixed per row kind so pixel→row math is cheap. The file-header
// slot is intentionally 72px tall: the top 32px is reserved as a transparent
// "gap" between files in `github` chrome mode, while `bleed` mode paints the
// full 72px as continuous header chrome.
export const ROW_HEIGHTS = {
  "file-header": 72,
  "hunk-header": 24,
  line: 20,
} as const;

// Portion of the file-header slot reserved for the inter-file gap (top of the
// slot stays transparent so it visually reads as space between containers).
// Also used at the projection layer to delay `activeFileId` transitions by
// this many pixels — keeps the sticky bar on file F until F+1's *chrome*
// (not just the start of its gap) reaches the viewport top, so the user
// sees the next file's header sliding up from below before the swap.
export const FILE_HEADER_GAP_PX = 32;

// Internal tag bytes — kept tight to fit Uint8Array entries.
export const ROW_FILE_HEADER = 0;
export const ROW_HUNK_HEADER = 1;
export const ROW_LINE = 2;

export const LINE_CTX = 0;
export const LINE_ADD = 1;
export const LINE_DEL = 2;

export type RowKind = "file-header" | "hunk-header" | "line";
export type LineKind = "ctx" | "add" | "del";

export interface FileHeaderRow {
  kind: "file-header";
  rowIndex: number;
  fileIndex: number;
  pixelTop: number;
  height: number;
}

export interface HunkHeaderRow {
  kind: "hunk-header";
  rowIndex: number;
  fileIndex: number;
  hunkIndex: number;
  pixelTop: number;
  height: number;
}

export interface LineRow {
  kind: "line";
  rowIndex: number;
  fileIndex: number;
  hunkIndex: number;
  lineKind: LineKind;
  lineIndex: number;
  oldLineNo: number | undefined;
  newLineNo: number | undefined;
  pixelTop: number;
  height: number;
}

export type RowDescriptor = FileHeaderRow | HunkHeaderRow | LineRow;

const LINE_KIND_NAMES: readonly LineKind[] = ["ctx", "add", "del"];

function heightForKind(kind: number): number {
  if (kind === ROW_FILE_HEADER) return ROW_HEIGHTS["file-header"];
  if (kind === ROW_HUNK_HEADER) return ROW_HEIGHTS["hunk-header"];
  return ROW_HEIGHTS.line;
}

export class Layout {
  // Parallel arrays, length = rowCount.
  readonly kinds: Uint8Array;
  readonly fileIndices: Uint32Array;
  readonly hunkIndices: Uint32Array;
  readonly lineKinds: Uint8Array;
  readonly lineIndices: Uint32Array;
  // 0 means "absent" (line numbers are 1-based).
  readonly oldLineNos: Uint32Array;
  readonly newLineNos: Uint32Array;
  // length = rowCount + 1; pixelOffsets[i] is the top pixel of row i,
  // pixelOffsets[rowCount] == totalHeight.
  readonly pixelOffsets: Uint32Array;
  // length = fileCount; fileFirstRow[fi] is the row index of the file-header
  // row for file `fi`. Populated by the builder before finalize().
  fileFirstRow: Uint32Array = new Uint32Array(0);
  readonly rowCount: number;
  readonly totalHeight: number;

  constructor(rowCount: number) {
    this.rowCount = rowCount;
    this.kinds = new Uint8Array(rowCount);
    this.fileIndices = new Uint32Array(rowCount);
    this.hunkIndices = new Uint32Array(rowCount);
    this.lineKinds = new Uint8Array(rowCount);
    this.lineIndices = new Uint32Array(rowCount);
    this.oldLineNos = new Uint32Array(rowCount);
    this.newLineNos = new Uint32Array(rowCount);
    this.pixelOffsets = new Uint32Array(rowCount + 1);
    this.totalHeight = 0;
  }

  setFileFirstRows(arr: Uint32Array): void {
    this.fileFirstRow = arr;
  }

  pixelTopForFile(fileIndex: number): number {
    const row = this.fileFirstRow[fileIndex];
    if (row === undefined) return 0;
    return this.pixelOffsets[row] ?? 0;
  }

  fileCount(): number {
    return this.fileFirstRow.length;
  }

  firstRowOfFile(fileIndex: number): number {
    return this.fileFirstRow[fileIndex] ?? 0;
  }

  rowCountOfFile(fileIndex: number): number {
    const start = this.fileFirstRow[fileIndex] ?? 0;
    const next = this.fileFirstRow[fileIndex + 1];
    return (next === undefined ? this.rowCount : next) - start;
  }

  pixelHeightOfFile(fileIndex: number): number {
    const start = this.pixelTopForFile(fileIndex);
    const next = this.fileFirstRow[fileIndex + 1];
    const end =
      next === undefined ? this.totalHeight : (this.pixelOffsets[next] ?? this.totalHeight);
    return end - start;
  }

  // File-index range whose pixel extents intersect [topPx, bottomPx]. The
  // file-window renderer uses this to choose which sections to emit.
  filesIntersecting(topPx: number, bottomPx: number): { start: number; end: number } {
    if (this.rowCount === 0) return { start: 0, end: -1 };
    const top = Math.max(0, topPx);
    const bot = Math.max(top, bottomPx);
    const startRow = this.rowAtPixel(top);
    const endRow = this.rowAtPixel(bot);
    return { start: this.fileAtRow(startRow), end: this.fileAtRow(endRow) };
  }

  fileAtRow(rowIndex: number): number {
    return this.fileIndices[rowIndex] ?? 0;
  }

  // Called by the builder once all rows are written. Computes cumulative
  // pixel offsets and freezes `totalHeight`.
  finalize(): void {
    let pixel = 0;
    for (let i = 0; i < this.rowCount; i++) {
      this.pixelOffsets[i] = pixel;
      pixel += heightForKind(this.kinds[i] ?? 0);
    }
    this.pixelOffsets[this.rowCount] = pixel;
    (this as { totalHeight: number }).totalHeight = pixel;
  }

  // Binary search for the largest row index whose pixelTop <= pixel.
  // Clamps to [0, rowCount-1].
  rowAtPixel(pixel: number): number {
    if (this.rowCount === 0) return -1;
    if (pixel <= 0) return 0;
    if (pixel >= this.totalHeight) return this.rowCount - 1;
    let lo = 0;
    let hi = this.rowCount;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if ((this.pixelOffsets[mid] ?? 0) <= pixel) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  pixelTop(rowIndex: number): number {
    return this.pixelOffsets[rowIndex] ?? 0;
  }

  heightAt(rowIndex: number): number {
    return heightForKind(this.kinds[rowIndex] ?? 0);
  }

  describe(rowIndex: number): RowDescriptor {
    const kind = this.kinds[rowIndex] ?? 0;
    const fileIndex = this.fileIndices[rowIndex] ?? 0;
    const pixelTop = this.pixelOffsets[rowIndex] ?? 0;
    const height = heightForKind(kind);
    if (kind === ROW_FILE_HEADER) {
      return { kind: "file-header", rowIndex, fileIndex, pixelTop, height };
    }
    const hunkIndex = this.hunkIndices[rowIndex] ?? 0;
    if (kind === ROW_HUNK_HEADER) {
      return { kind: "hunk-header", rowIndex, fileIndex, hunkIndex, pixelTop, height };
    }
    const oldNo = this.oldLineNos[rowIndex] ?? 0;
    const newNo = this.newLineNos[rowIndex] ?? 0;
    return {
      kind: "line",
      rowIndex,
      fileIndex,
      hunkIndex,
      lineKind: LINE_KIND_NAMES[this.lineKinds[rowIndex] ?? 0] ?? "ctx",
      lineIndex: this.lineIndices[rowIndex] ?? 0,
      oldLineNo: oldNo === 0 ? undefined : oldNo,
      newLineNo: newNo === 0 ? undefined : newNo,
      pixelTop,
      height,
    };
  }
}

export class LayoutBuilder {
  private readonly layout: Layout;
  private cursor = 0;
  // Tracked during build so `pixelTopForFile(fi)` is O(1).
  private readonly fileFirstRow: number[] = [];

  constructor(rowCount: number) {
    this.layout = new Layout(rowCount);
  }

  pushFileHeader(fileIndex: number): void {
    const i = this.cursor++;
    this.layout.kinds[i] = ROW_FILE_HEADER;
    this.layout.fileIndices[i] = fileIndex;
    this.fileFirstRow[fileIndex] = i;
  }

  pushHunkHeader(fileIndex: number, hunkIndex: number): void {
    const i = this.cursor++;
    this.layout.kinds[i] = ROW_HUNK_HEADER;
    this.layout.fileIndices[i] = fileIndex;
    this.layout.hunkIndices[i] = hunkIndex;
  }

  pushLine(args: {
    fileIndex: number;
    hunkIndex: number;
    lineKind: number;
    lineIndex: number;
    oldLineNo: number;
    newLineNo: number;
  }): void {
    const i = this.cursor++;
    this.layout.kinds[i] = ROW_LINE;
    this.layout.fileIndices[i] = args.fileIndex;
    this.layout.hunkIndices[i] = args.hunkIndex;
    this.layout.lineKinds[i] = args.lineKind;
    this.layout.lineIndices[i] = args.lineIndex;
    this.layout.oldLineNos[i] = args.oldLineNo;
    this.layout.newLineNos[i] = args.newLineNo;
  }

  build(): Layout {
    if (this.cursor !== this.layout.rowCount) {
      throw new Error(
        `LayoutBuilder: wrote ${this.cursor} rows but allocated ${this.layout.rowCount}`,
      );
    }
    const arr = new Uint32Array(this.fileFirstRow.length);
    for (let i = 0; i < this.fileFirstRow.length; i++) {
      arr[i] = this.fileFirstRow[i] ?? 0;
    }
    this.layout.setFileFirstRows(arr);
    this.layout.finalize();
    return this.layout;
  }
}
