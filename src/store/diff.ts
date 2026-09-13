// The shared vocabulary for a synthetic diff: seeds, files, and token spans.
//
// The diff is recomputable from its seed; the seed *is* the content hash, so
// two sessions on the same seed share one cache. That cache lives in
// `createDiffEngine` (src/diff/generator.ts), which memoises per seed under an
// LRU cap — this file is types only.

export type Seed = string;
export type FileId = string;
export type Language = "typescript" | "python" | "go" | "rust" | "json";

export interface DiffFileSummary {
  id: FileId;
  path: string;
  language: Language;
  totalLines: number;
  additions: number;
  deletions: number;
}

export interface DiffMeta {
  seed: Seed;
  totalFiles: number;
  totalLines: number;
  files: DiffFileSummary[];
}

export interface DiffFile {
  path: string;
  language: Language;
  content: string;
  totalLines: number;
}

// Syntax-highlight token spans for a single file. Each kind maps to an
// ordered list of `[lineIdx, startCol, endCol]` tuples — column-based so the
// client can build CSS Custom Highlight API `StaticRange`s into each row's
// text node without re-tokenizing on the browser side.
export type HighlightKind = "keyword" | "string" | "comment" | "number" | "function" | "type";

export type HighlightSpan = readonly [lineIdx: number, startCol: number, endCol: number];

export type TokenSpans = Partial<Record<HighlightKind, HighlightSpan[]>>;

export interface DiffSynthesizer {
  meta(seed: Seed): DiffMeta;
  file(seed: Seed, fileId: FileId): DiffFile;
  tokens(seed: Seed, fileId: FileId, file: DiffFile): TokenSpans;
}
