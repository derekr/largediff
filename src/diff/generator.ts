// Deterministic synthetic-diff generator.
//
// Phase 1 plans every file's shape (path, language, hunks, line counts) and
// writes the full row descriptor table into a `Layout`. Phase 2 — actual file
// text — is lazy: callers ask for a file by id and the snippet bank stitches
// content together. Same seed → byte-identical output.

import { tokenize } from "../highlight/tokenize.ts";
import type {
  DiffFile,
  DiffFileSummary,
  DiffMeta,
  DiffSynthesizer,
  FileId,
  Language,
  Seed,
  TokenSpans,
} from "../store/diff.ts";
import { type Layout, LayoutBuilder, LINE_ADD, LINE_CTX, LINE_DEL } from "./layout.ts";
import { mulberry32, pickInt, pickWeighted, type Rng, rngFromSeed } from "./rng.ts";
import { snippetsFor } from "./snippets.ts";

export interface GenerateOptions {
  seed: Seed;
  lines: number;
  instrument?: DiffEngineInstrument;
}

// Optional observability hook, wired to the metrics registry by server.ts.
// Declared here (not imported from the server layer) so the diff engine
// stays dependency-free and tests can pass a plain object. Cache hit rates
// are the leading indicator for a gradual slowdown — synthesizing content
// or re-tokenizing a 200k-line seed on what should be a warm path is
// invisible in the code (both paths return the same value) and only shows
// up as a mysteriously fat latency tail.
export interface DiffEngineInstrument {
  fileHit(): void;
  fileMiss(): void;
  tokensHit(): void;
  tokensMiss(ms: number): void;
  seedGenerate(ms: number): void;
  seedEvict(): void;
}

export interface GenerateResult {
  meta: DiffMeta;
  layout: Layout;
  file(fileId: FileId): DiffFile;
  tokens(fileId: FileId, file: DiffFile): TokenSpans;
}

const LANGUAGE_WEIGHTS: ReadonlyArray<readonly [Language, number]> = [
  ["typescript", 35],
  ["python", 25],
  ["go", 15],
  ["rust", 15],
  ["json", 10],
];

const PATH_TEMPLATES: Record<Language, readonly string[]> = {
  typescript: [
    "src/components/{Pascal}.tsx",
    "src/lib/{snake}.ts",
    "src/server/{snake}.ts",
    "src/hooks/use{Pascal}.ts",
    "src/api/{snake}/handler.ts",
    "tests/{snake}.test.ts",
  ],
  python: [
    "app/{snake}.py",
    "app/models/{snake}.py",
    "tests/test_{snake}.py",
    "scripts/{snake}.py",
    "src/{snake}/__init__.py",
  ],
  go: [
    "pkg/{snake}/{snake}.go",
    "cmd/{snake}/main.go",
    "internal/{snake}/handler.go",
    "internal/{snake}/{snake}_test.go",
  ],
  rust: ["src/{snake}.rs", "src/{snake}/mod.rs", "src/bin/{snake}.rs", "tests/{snake}.rs"],
  json: [
    "package.json",
    "tsconfig.json",
    "config/{snake}.json",
    "data/{snake}.json",
    ".github/{snake}.json",
  ],
};

const NAME_BANK: readonly string[] = [
  "auth",
  "cache",
  "client",
  "config",
  "context",
  "fetch",
  "handler",
  "logger",
  "metrics",
  "middleware",
  "parser",
  "queue",
  "registry",
  "render",
  "router",
  "server",
  "session",
  "store",
  "stream",
  "user",
  "worker",
];

function pickLanguage(rng: Rng): Language {
  const idx = pickWeighted(
    rng,
    LANGUAGE_WEIGHTS.map(([, w]) => w),
  );
  return LANGUAGE_WEIGHTS[idx]?.[0] ?? "typescript";
}

function toPascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function pickPath(rng: Rng, lang: Language, used: Set<string>): string {
  const templates = PATH_TEMPLATES[lang];
  const tpl = templates[pickInt(rng, 0, templates.length)] ?? templates[0] ?? "{snake}.txt";
  const name = NAME_BANK[pickInt(rng, 0, NAME_BANK.length)] ?? "thing";
  const base = tpl.replace("{snake}", name).replace("{Pascal}", toPascal(name));
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  // On collision, suffix the basename with an incrementing counter.
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "" : base.slice(dot);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  used.add(base);
  return base;
}

// Every file gets at least this many lines — `planFileSizes` clamps to it,
// so no smaller diff can exist. `generateDiff` clamps `targetLines` to the
// same floor so the exactness contract below holds for every input.
const MIN_LINES_PER_FILE = 10;

// Per-file target line counts that sum exactly to `targetLines` with each
// file at least `minPerFile` lines. Variance comes from the RNG so different
// seeds yield different distributions.
function planFileSizes(rng: Rng, fileCount: number, targetLines: number): number[] {
  const minPerFile = MIN_LINES_PER_FILE;
  const base = Math.max(minPerFile, Math.floor(targetLines / fileCount));
  const raw: number[] = [];
  let sum = 0;
  for (let i = 0; i < fileCount; i++) {
    const jitter = 0.5 + rng();
    const v = Math.max(minPerFile, Math.round(base * jitter));
    raw.push(v);
    sum += v;
  }
  // Scale to the target then patch the last file to make the sum exact.
  const scale = targetLines / sum;
  let scaled = 0;
  const sizes = raw.map((v) => {
    const s = Math.max(minPerFile, Math.round(v * scale));
    scaled += s;
    return s;
  });
  const diff = targetLines - scaled;
  const last = sizes.length - 1;
  if (last >= 0) {
    sizes[last] = Math.max(minPerFile, (sizes[last] ?? minPerFile) + diff);
  }
  return sizes;
}

interface HunkPlan {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  // Per-display-row line kinds (LINE_CTX | LINE_ADD | LINE_DEL).
  lineKinds: Uint8Array;
}

interface FilePlan {
  id: FileId;
  index: number;
  path: string;
  language: Language;
  totalLines: number;
  contentSeed: number;
  hunks: HunkPlan[];
}

function planHunks(rng: Rng, totalLines: number): HunkPlan[] {
  const hunkCount = Math.max(1, Math.min(8, Math.round(totalLines / 80)));
  const baseLines = Math.floor(totalLines / hunkCount);
  const remainder = totalLines - baseLines * hunkCount;
  const hunks: HunkPlan[] = [];
  let oldCursor = pickInt(rng, 1, 40);
  let newCursor = oldCursor;

  for (let i = 0; i < hunkCount; i++) {
    const lines = baseLines + (i < remainder ? 1 : 0);
    if (lines <= 0) continue;

    const ctxRatio = 0.45 + rng() * 0.3;
    const addRatio = 0.1 + rng() * 0.25;

    let ctx = Math.round(lines * ctxRatio);
    let add = Math.round(lines * addRatio);
    let del = lines - ctx - add;
    if (del < 0) {
      add = Math.max(0, add + del);
      del = 0;
    }
    ctx = lines - add - del;

    const lineKinds = new Uint8Array(lines);
    let j = 0;
    for (let n = 0; n < ctx; n++) lineKinds[j++] = LINE_CTX;
    for (let n = 0; n < add; n++) lineKinds[j++] = LINE_ADD;
    for (let n = 0; n < del; n++) lineKinds[j++] = LINE_DEL;
    // Deterministic Fisher-Yates shuffle so adds/dels scatter through ctx.
    for (let k = lineKinds.length - 1; k > 0; k--) {
      const m = Math.floor(rng() * (k + 1));
      const tmp = lineKinds[k] ?? 0;
      lineKinds[k] = lineKinds[m] ?? 0;
      lineKinds[m] = tmp;
    }

    const oldLines = ctx + del;
    const newLines = ctx + add;
    hunks.push({
      oldStart: oldCursor,
      oldLines,
      newStart: newCursor,
      newLines,
      lineKinds,
    });

    const gap = pickInt(rng, 10, 60);
    oldCursor += oldLines + gap;
    newCursor += newLines + gap;
  }

  return hunks;
}

// Stitch snippets together until we have at least `totalLines` lines, then
// truncate. The RNG is seeded from the file's `contentSeed`, so a given file
// always produces the same text.
function synthesizeContent(seed: number, totalLines: number, lang: Language): string {
  const rng = mulberry32(seed);
  const snippets = snippetsFor(lang);
  const lines: string[] = [];
  while (lines.length < totalLines) {
    const snippet = snippets[pickInt(rng, 0, snippets.length)];
    if (!snippet) break;
    for (const line of snippet) {
      lines.push(line);
      if (lines.length >= totalLines) break;
    }
    if (lines.length < totalLines && lang !== "json" && rng() < 0.25) {
      lines.push("");
    }
  }
  while (lines.length < totalLines) lines.push("");
  return lines.slice(0, totalLines).join("\n");
}

export function generateDiff(opts: GenerateOptions): GenerateResult {
  // Below MIN_LINES_PER_FILE the floor wins anyway (`lines: 1` used to
  // come back as `totalLines: 10` with nothing saying why) — clamp here
  // so `meta.totalLines === max(lines, MIN_LINES_PER_FILE)` is the stated
  // contract rather than an accident of planFileSizes.
  const targetLines = Math.max(MIN_LINES_PER_FILE, Math.floor(opts.lines));
  const rng = rngFromSeed(opts.seed);

  // ~400 lines / file averages out to PR-realistic per-file sizes. With
  // jitter from `planFileSizes` individual files land in roughly [100, 800]
  // display lines, which keeps the scroll-distance-to-next-file felt
  // comparable to a real GitHub diff.
  const fileCount = Math.max(1, Math.min(1000, Math.ceil(targetLines / 400)));
  const sizes = planFileSizes(rng, fileCount, targetLines);

  const plans: FilePlan[] = [];
  const summaries: DiffFileSummary[] = [];
  const usedPaths = new Set<string>();
  let rowCount = 0;
  let actualLines = 0;

  for (let i = 0; i < fileCount; i++) {
    const lines = sizes[i] ?? 10;
    const lang = pickLanguage(rng);
    const path = pickPath(rng, lang, usedPaths);
    const contentSeed = (rng() * 0xffffffff) >>> 0;
    const id: FileId = `f${i}`;
    const hunks = planHunks(rng, lines);
    let additions = 0;
    let deletions = 0;
    for (const h of hunks) {
      for (let li = 0; li < h.lineKinds.length; li++) {
        const k = h.lineKinds[li];
        if (k === LINE_ADD) additions++;
        else if (k === LINE_DEL) deletions++;
      }
    }
    const plan: FilePlan = {
      id,
      index: i,
      path,
      language: lang,
      totalLines: lines,
      contentSeed,
      hunks,
    };
    plans.push(plan);
    summaries.push({ id, path, language: lang, totalLines: lines, additions, deletions });
    rowCount += 1 + hunks.length; // file header + hunk headers
    for (const h of hunks) rowCount += h.lineKinds.length;
    actualLines += lines;
  }

  // Emit layout rows by walking the plans.
  const builder = new LayoutBuilder(rowCount);
  for (let fi = 0; fi < plans.length; fi++) {
    const plan = plans[fi];
    if (!plan) continue;
    builder.pushFileHeader(fi);
    let lineIndex = 0;
    for (let hi = 0; hi < plan.hunks.length; hi++) {
      const hunk = plan.hunks[hi];
      if (!hunk) continue;
      builder.pushHunkHeader(fi, hi);
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;
      for (let li = 0; li < hunk.lineKinds.length; li++) {
        const kind = hunk.lineKinds[li] ?? LINE_CTX;
        let oldLineNo = 0;
        let newLineNo = 0;
        if (kind === LINE_CTX) {
          oldLineNo = oldNo++;
          newLineNo = newNo++;
        } else if (kind === LINE_ADD) {
          newLineNo = newNo++;
        } else {
          oldLineNo = oldNo++;
        }
        builder.pushLine({
          fileIndex: fi,
          hunkIndex: hi,
          lineKind: kind,
          lineIndex,
          oldLineNo,
          newLineNo,
        });
        lineIndex++;
      }
    }
  }
  const layout = builder.build();

  const meta: DiffMeta = {
    seed: opts.seed,
    totalFiles: plans.length,
    totalLines: actualLines,
    files: summaries,
  };

  const plansById = new Map<FileId, FilePlan>();
  for (const plan of plans) plansById.set(plan.id, plan);

  // Memoize file content + tokens per-result. Memoization lives inside the
  // generateDiff closure, which is itself per-seed-cached by `createDiffEngine`,
  // so repeated pushes for the same seed reuse already-synthesized text and
  // token spans instead of re-running snippet stitching / regex tokenization.
  const fileCache = new Map<FileId, DiffFile>();
  const tokenCache = new Map<FileId, TokenSpans>();

  const instrument = opts.instrument;

  function file(fileId: FileId): DiffFile {
    const cached = fileCache.get(fileId);
    if (cached !== undefined) {
      instrument?.fileHit();
      return cached;
    }
    instrument?.fileMiss();
    const plan = plansById.get(fileId);
    if (!plan) {
      throw new Error(`unknown fileId: ${fileId}`);
    }
    const content = synthesizeContent(plan.contentSeed, plan.totalLines, plan.language);
    const result: DiffFile = {
      path: plan.path,
      language: plan.language,
      content,
      totalLines: plan.totalLines,
    };
    fileCache.set(fileId, result);
    return result;
  }

  function tokens(fileId: FileId, f: DiffFile): TokenSpans {
    const cached = tokenCache.get(fileId);
    if (cached !== undefined) {
      instrument?.tokensHit();
      return cached;
    }
    // performance.now() is monotonic and costs nanoseconds against a
    // tokenize pass that costs milliseconds; timed only on the miss path.
    const t0 = instrument !== undefined ? performance.now() : 0;
    const result = tokenize(f.content, f.language);
    instrument?.tokensMiss(performance.now() - t0);
    tokenCache.set(fileId, result);
    return result;
  }

  return { meta, layout, file, tokens };
}

export interface DiffEngine extends DiffSynthesizer {
  layout(seed: Seed): Layout;
}

export interface DiffEngineOptions {
  // Default number of display lines when a seed is first seen. The engine
  // memoizes per seed, so calls after the first ignore this value.
  defaultLines?: number;
  // Optional override: lets a caller map a seed name to a target size,
  // e.g. derive 200000 from "demo-200k".
  linesForSeed?: (seed: Seed) => number;
  // Max seeds memoized at once (LRU beyond it). Defaults to
  // MAX_CACHED_SEEDS; override in tests to exercise eviction cheaply.
  maxCachedSeeds?: number;
  // Observability hook — see DiffEngineInstrument.
  instrument?: DiffEngineInstrument;
}

const DEFAULT_LINES = 50_000;

// A cached GenerateResult is heavyweight: the layout's typed arrays plus
// the lazily-filled file/token caches run to tens of MB per seed at 200k
// lines. Today the server pins a single seed, but the seed is meant to
// become user-supplied (`?seed=`), and an unbounded Map would let any
// visitor mint fresh entries until the process OOMs. A small LRU keeps
// the single-seed deployment on the fast path and forecloses that.
const MAX_CACHED_SEEDS = 4;

export function createDiffEngine(opts: DiffEngineOptions = {}): DiffEngine {
  const defaultLines = opts.defaultLines ?? DEFAULT_LINES;
  const maxSeeds = Math.max(1, opts.maxCachedSeeds ?? MAX_CACHED_SEEDS);
  const cache = new Map<Seed, GenerateResult>();

  function get(seed: Seed): GenerateResult {
    let entry = cache.get(seed);
    if (entry !== undefined) {
      // Map iterates in insertion order — re-inserting marks recency.
      cache.delete(seed);
      cache.set(seed, entry);
      return entry;
    }
    const lines = opts.linesForSeed?.(seed) ?? defaultLines;
    const t0 = opts.instrument !== undefined ? performance.now() : 0;
    entry = generateDiff({ seed, lines, instrument: opts.instrument });
    opts.instrument?.seedGenerate(performance.now() - t0);
    cache.set(seed, entry);
    if (cache.size > maxSeeds) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
        opts.instrument?.seedEvict();
      }
    }
    return entry;
  }

  return {
    meta: (seed) => get(seed).meta,
    file: (seed, fileId) => get(seed).file(fileId),
    tokens: (seed, fileId, file) => get(seed).tokens(fileId, file),
    layout: (seed) => get(seed).layout,
  };
}

// Re-exported so callers don't have to know the underlying RNG.
export { hashSeed, mulberry32 } from "./rng.ts";
