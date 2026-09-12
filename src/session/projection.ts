// Single point where state mutations become outgoing SSE events.
//
// Each command handler mutates the session then calls `pushProjection`. We
// compute the full app inner HTML (sidebar + diff + chrome) from session
// state and emit it as one fat `datastar-patch-elements` morph that
// replaces `#app`'s inner content. Idiomorph preserves stable-id nodes
// (`#scroller`, `#ds-window`, `#file-tree`, `.file-list`, `.file-rows`,
// per-section `#f-<fid>`, per-row `#file-row-<fid>`) so scroll position,
// focus, and Datastar's one-shot `data-init` survive the morph.
//
// A second `datastar-patch-signals` event rides only when an imperative
// action is in flight — /jump (`jumpToPx`), session reload
// (`pendingInitialScrollTop`), sidebar auto-recenter (`sidebarJumpToPx`).
// These can't be morph-driven because they need to call `scroller.scrollTo`
// via a body-level `data-effect`.

import type { DiffEngine } from "../diff/generator.ts";
import { FILE_HEADER_GAP_PX } from "../diff/layout.ts";
import { type LineSpan, renderFiles, TOKEN_CLASS } from "../render/files.tsx";
import { renderAppInner } from "../render/shell.tsx";
import {
  renderSidebarWindow,
  SIDEBAR_ROW_HEIGHT_PX,
  sidebarSliceFileIds,
} from "../render/sidebar.tsx";
import type { Metrics } from "../server/metrics.ts";
import type { FileId, HighlightKind, TokenSpans } from "../store/diff.ts";
import type { ReviewSession, SessionId } from "./types.ts";

const HIGHLIGHT_KINDS: readonly HighlightKind[] = [
  "keyword",
  "string",
  "comment",
  "number",
  "function",
  "type",
];

export interface SessionWriter {
  send(event: string, data: string): void;
  // Optional: emit several events as a single flush. See compress.ts.
  sendBatch?(events: ReadonlyArray<{ event: string; data: string }>): void;
  // Optional: write an SSE comment. Present on the real SSE writers, and
  // omitted by test doubles — hence the optional call at the use site.
  sendComment?(text: string): void;
  close(): void;
  // Optional wire-bytes telemetry — set by the SSE writer in
  // `src/server/compress.ts` so the topbar can render the running
  // brotli/identity savings ratio. Test writers can omit these.
  readonly bytesIn?: number;
  readonly bytesOut?: number;
  readonly encoding?: string;
}

export class WriterRegistry {
  private readonly writers = new Map<SessionId, SessionWriter>();

  attach(sid: SessionId, writer: SessionWriter): void {
    // A previous writer with the same sid is closed here: the client has
    // reconnected (Datastar retry, reload, second tab), so the old HTTP
    // response is dead weight — leaving it open kept a stale encoder
    // buffering bytes nobody would read. `detach` still guards against
    // the old connection's late abort yanking out the new writer.
    const prior = this.writers.get(sid);
    if (prior !== undefined && prior !== writer) {
      try {
        prior.close();
      } catch {
        // closing twice is fine; the new attach is what matters.
      }
    }
    this.writers.set(sid, writer);
  }

  // Detach the writer for `sid` from the registry. If `writer` is given,
  // we only remove the registry entry when it matches — the old SSE
  // connection's abort signal can fire AFTER a fresh reconnect has
  // already swapped in a new writer, and yanking the new writer out
  // here is what was making the reconnected stream return 0 bytes
  // (Datastar would then log "Load failed" and retry forever).
  detach(sid: SessionId, writer?: SessionWriter): void {
    const current = this.writers.get(sid);
    if (current === undefined) return;
    if (writer !== undefined && current !== writer) {
      // A newer writer is in place — close only the stale one we were
      // asked about, leave the registry alone.
      try {
        writer.close();
      } catch {
        // closing twice is fine.
      }
      return;
    }
    this.writers.delete(sid);
    try {
      current.close();
    } catch {
      // closing twice from both sides is fine.
    }
  }

  get(sid: SessionId): SessionWriter | undefined {
    return this.writers.get(sid);
  }

  has(sid: SessionId): boolean {
    return this.writers.has(sid);
  }

  get size(): number {
    return this.writers.size;
  }
}

export interface ProjectionDeps {
  writers: WriterRegistry;
  engine: DiffEngine;
  // Optional so tests and the initial-paint path don't have to construct a
  // registry; when absent, all instrumentation below compiles to no-ops.
  metrics?: Metrics;
}

// The fallback viewport height used when the client hasn't reported one yet
// (i.e. first paint right after the stream opens). Sized to cover any
// reasonable monitor — QHD (1440p) and most 4K-windowed setups land under
// this — so the first paint never shows a gap below the rendered rows. The
// extra rows beyond the actual viewport are just hidden by the scroller and
// cost ~1.5 KB on the wire after brotli warms up.
const INITIAL_VIEWPORT_PX = 2400;

// Fallback sidebar viewport height for the auto-recenter math before
// the client has reported a real `sidebarHeight`. Sized to cover any
// reasonable desktop sidebar.
const INITIAL_SIDEBAR_PX = 1200;

export interface InitialPaint {
  diffHtml: string;
  sidebarHtml: string;
  // `activeFileId` rides on the result so the projection's skip-when-
  // unchanged fingerprint can react when the active row moves from one
  // file to another — the rendered sidebar HTML length doesn't change
  // when toggling `active` between two rows in the same slice, so a
  // bytes-only fingerprint would skip the push and leave the
  // highlight on the old row.
  activeFileId: string;
  // `chrome` is stamped onto `#ds-window` (not body) so the
  // `#ds-window[data-chrome=...]` selectors invalidate only the diff
  // subtree on a chrome toggle instead of the entire descendant tree
  // of body — saves a substantial chunk of style recalc work during
  // each morph.
  chrome: string;
  // Initial scroll positions baked into the HTML response as a tiny
  // inline `<script>` so the page lands at the right spot on first
  // paint, no waiting for SSE. Reloads of a session with a non-zero
  // `scrollTop` (or one whose auto-recenter computed a sidebar offset)
  // would otherwise show a flash at the top before scrolling — the
  // diff sections are positioned at their absolute pixel tops, so a
  // scroller at `top:0` shows empty space until the scroll jumps.
  scrollerScrollTop: number;
  sidebarScrollTop: number;
  // Count of diff line rows in the rendered slice — the push-shape metric.
  // A latency percentile is uninterpretable without knowing whether the
  // slow pushes were also the big ones.
  rowsRendered: number;
}

// Server-side render of the first paint's diff slice + sidebar slice,
// baked into the initial HTML so the page is usable before the SSE
// stream has delivered any bytes. Macos Safari's fetch implementation
// buffers `text/event-stream` bodies (we've measured ~10s of delay
// before the JS reader sees the first chunk), and depending on the
// SSE for the initial paint left the page in an indeterminate state
// during that window. The SSE will still re-emit these same slices on
// attach — Idiomorph treats them as a no-op since the DOM already
// matches — but the user sees the diff + sidebar immediately on the
// HTML response, regardless of how the SSE behaves.
export function renderInitialPaint(session: ReviewSession, deps: ProjectionDeps): InitialPaint {
  const seed = session.seed;
  const meta = deps.engine.meta(seed);
  const layout = deps.engine.layout(seed);

  const lineCache = new Map<FileId, string[]>();
  const lineFor = (fileId: FileId, lineIndex: number): string => {
    let lines = lineCache.get(fileId);
    if (lines === undefined) {
      lines = deps.engine.file(seed, fileId).content.split("\n");
      lineCache.set(fileId, lines);
    }
    return lines[lineIndex] ?? "";
  };
  const tokensCache = new Map<FileId, Map<number, LineSpan[]>>();
  const tokensForLine = (fileId: FileId, lineIndex: number): readonly LineSpan[] => {
    let byLine = tokensCache.get(fileId);
    if (byLine === undefined) {
      const f = deps.engine.file(seed, fileId);
      const t = deps.engine.tokens(seed, fileId, f);
      byLine = indexTokensByLine(t);
      tokensCache.set(fileId, byLine);
    }
    return byLine.get(lineIndex) ?? EMPTY_SPANS;
  };

  const slice = renderFiles({
    layout,
    fileSummaries: meta.files,
    lineFor,
    tokensForLine,
    scrollTop: session.view.scrollTop,
    height: session.view.height > 0 ? session.view.height : INITIAL_VIEWPORT_PX,
    highlight: session.settings.highlight,
  });

  const probePixel = Math.max(0, session.view.scrollTop - FILE_HEADER_GAP_PX);
  const topRow = layout.rowAtPixel(probePixel);
  const activeFileIndex = layout.fileAtRow(topRow);
  const summary = meta.files[activeFileIndex];
  const activeFileId = summary?.id ?? "";

  // Auto-recenter the sidebar when the *diff* scroll has moved since
  // the last render. We use a fallback viewport (`INITIAL_SIDEBAR_PX`)
  // when the client hasn't reported real dimensions — the recenter
  // still needs to fire on the very first paint so the initial HTML
  // ships the right sidebar slice + an inline `scrollTop` for
  // `.file-list`. The "diff scrolled" gate is what distinguishes a
  // /view POST (recenter is wanted) from a /sidebar POST (user
  // scrolling the list independently); `lastScrollTop === undefined`
  // counts as a scroll change so reloads land on the active file.
  // Recenter is a NAVIGATION response, not a scroll response.
  //
  // Gating on "did scrollTop change" meant every throttled /view tick while
  // the user was merely reading counted as a reason to drag the file list
  // back — fighting the user's own sidebar scroll ~30x/second. The gate is
  // now the two things that actually mean "navigation happened and the
  // sidebar isn't under manual control": the active file changed, and the
  // user hasn't taken the list over. `lastActiveFileId === undefined` is a
  // first render, which should land on the active file.
  const activeFileChanged =
    session.view.lastActiveFileId === undefined || session.view.lastActiveFileId !== activeFileId;
  const sidebarIsOurs = session.view.sidebarUserScrolled !== true;
  const shouldRecenter = activeFileChanged && sidebarIsOurs;
  const sidebarHeight =
    session.view.sidebarHeight > 0 ? session.view.sidebarHeight : INITIAL_SIDEBAR_PX;
  if (shouldRecenter && activeFileIndex >= 0 && session.view.pendingSidebarJumpToPx === undefined) {
    const activeTop = activeFileIndex * SIDEBAR_ROW_HEIGHT_PX;
    const viewTop = session.view.sidebarScrollTop;
    const viewBot = viewTop + sidebarHeight;
    if (activeTop < viewTop || activeTop + SIDEBAR_ROW_HEIGHT_PX > viewBot) {
      const newTop = Math.max(0, activeTop - sidebarHeight / 3);
      session.view.sidebarScrollTop = newTop;
      // Only emit a `sidebarJumpToPx` imperative when the client has
      // already reported its dimensions. On the very first render,
      // the inline scroll script in the HTML handles landing the
      // sidebar — `pendingSidebarJumpToPx` would just fire a
      // redundant scrollTo after the inline one.
      if (session.view.sidebarHeight > 0) {
        session.view.pendingSidebarJumpToPx = newTop;
      }
    }
  }
  session.view.lastActiveFileId = activeFileId;
  session.view.lastScrollTop = session.view.scrollTop;

  const sidebar = renderSidebarWindow(
    meta.files,
    session.view.sidebarScrollTop,
    sidebarHeight,
    activeFileId,
  );

  let rowsRendered = 0;
  for (const r of slice.visibleByFile.values()) rowsRendered += r.maxLine - r.minLine + 1;

  return {
    diffHtml: slice.html,
    sidebarHtml: sidebar.html,
    activeFileId,
    chrome: session.settings.chrome,
    scrollerScrollTop: session.view.scrollTop,
    sidebarScrollTop: session.view.sidebarScrollTop,
    rowsRendered,
  };
}

// Skip-when-unchanged fingerprint. Captures every input that affects
// the rendered HTML so a no-op push is safely skipped and a real state
// change is never silently dropped. `activeFileId` is the load-bearing
// one: moving `active` between two rows in the same sidebar slice
// doesn't change the HTML length, so a bytes-only fingerprint would
// skip the push and the highlight would stick to the old row.
//
// Exported so the `/sessions/:sid` GET handler can seed
// `session.view.lastFingerprint` after the initial HTML render. That
// stops the SSE attach from re-emitting a morph that already matches
// the just-served HTML (visible as a phantom ~200 KB raw push in the
// brotli savings chip on default page load).
export function paintFingerprint(session: ReviewSession, paint: InitialPaint): string {
  return [
    paint.activeFileId,
    session.view.scrollTop,
    session.view.sidebarScrollTop,
    session.view.sidebarHeight,
    paint.diffHtml.length,
    paint.sidebarHtml.length,
  ].join("|");
}

// Incompressible padding, generated once and reused. xorshift32 over a
// 36-character alphabet: brotli gets it to roughly 65%, so the wire cost is
// about two thirds of PAD_BYTES per push. Set LARGEDIFF_SSE_PAD_BYTES=0 to
// disable (correct for an identity-only or non-Safari deployment).
const PAD_BYTES = (() => {
  const raw = Number.parseInt(process.env.LARGEDIFF_SSE_PAD_BYTES ?? "", 10);
  // Default ON, at 64KB.
  //
  // The lab says padding is the wrong shape — 16 bytes arriving late beats
  // 64KB arriving immediately, and the client poke beats both. But the APP
  // disagrees: with padding it measured 1 late jump in 24, and with the poke
  // alone it measured 3 and then 5. The app's morph is far larger and more
  // expensive than the lab's, so the lab result did not transfer, and
  // removing padding on lab evidence alone was premature.
  //
  // Both mitigations now run together. Revisit when there are enough repeat
  // runs to separate the two from run-to-run variance, which at 1-5 late
  // jumps per 24 is substantial.
  return Number.isFinite(raw) && raw >= 0 ? raw : 65536;
})();

let padCache: string | undefined;
function ssePadding(): string {
  if (PAD_BYTES === 0) return "";
  if (padCache !== undefined) return padCache;
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const out: string[] = [];
  let x = 0x9e3779b9 | 0;
  for (let i = 0; i < PAD_BYTES; i++) {
    x ^= x << 13;
    x |= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    out.push(alphabet[(x >>> 0) % alphabet.length] ?? "a");
  }
  padCache = out.join("");
  return padCache;
}

export function pushProjection(session: ReviewSession, deps: ProjectionDeps): void {
  const writer = deps.writers.get(session.id);
  // No writer yet means the SSE stream hasn't attached. Returning silently
  // is safe: `session.view.pendingAnchorFileId` (set by /jump) stays put,
  // and `onAttached`'s push will pick it up the moment a writer arrives.
  if (writer === undefined) {
    deps.metrics?.pushNoWriter();
    return;
  }

  // Phase clocks for the push metrics. performance.now() is monotonic and
  // costs tens of nanoseconds against a multi-millisecond render, and we
  // read it at most five times per emitted push — the guard keeps even
  // that off the path when metrics are disabled or absent.
  const m = deps.metrics?.enabled ? deps.metrics : undefined;
  const t0 = m !== undefined ? performance.now() : 0;

  // Read & consume the pending anchor (if any) — set by /jump, cleared
  // after the first push that reaches a writer.
  const anchorFileId = session.view.pendingAnchorFileId;
  if (anchorFileId !== undefined) session.view.pendingAnchorFileId = undefined;

  const seed = session.seed;
  const meta = deps.engine.meta(seed);
  const layout = deps.engine.layout(seed);

  // `renderInitialPaint` is the single source for diff + sidebar HTML.
  // It also applies the sidebar auto-recenter side-effect (mutates
  // session.view) when the active row falls outside the sidebar viewport.
  const paint = renderInitialPaint(session, deps);
  const tPaintEnd = m !== undefined ? performance.now() : 0;

  // Resolve all pending imperatives. They ride inside the morph as a
  // transient `<div>` carrying:
  //   - `data-init`:    raw JS for scroll calls (no signal gate, so
  //                     scroll-to-0 works cleanly).
  //   - `data-signals`: navEpoch only — the client echoes it back in
  //                     /view POSTs and `applyView` uses it to drop
  //                     stale POSTs from a prior jump's settling
  //                     scroll.
  let jumpToPxOut: number | undefined;
  let sidebarJumpToPxOut: number | undefined;
  if (anchorFileId !== undefined) {
    const targetIdx = meta.files.findIndex((f) => f.id === anchorFileId);
    if (targetIdx >= 0) jumpToPxOut = layout.pixelTopForFile(targetIdx) + FILE_HEADER_GAP_PX;
  } else if (session.view.pendingInitialScrollTop !== undefined) {
    // Page reload, back-to-top, or any server-driven scroll change.
    // The server's `scrollTop` already reflects the new position;
    // this imperative tells the client to bring its scroller along.
    jumpToPxOut = session.view.pendingInitialScrollTop;
    session.view.pendingInitialScrollTop = undefined;
  }
  if (session.view.pendingSidebarJumpToPx !== undefined) {
    sidebarJumpToPxOut = session.view.pendingSidebarJumpToPx;
    session.view.pendingSidebarJumpToPx = undefined;
  }
  // Only re-send `navEpoch` when it has changed since the last emit.
  const navEpochChanged = session.view.navEpoch !== session.view.lastSentNavEpoch;

  const initParts: string[] = [];
  if (jumpToPxOut !== undefined) {
    initParts.push(`window.__largediffJump?.(${jumpToPxOut})`);
  }
  if (sidebarJumpToPxOut !== undefined) {
    // Mark the scroll as server-driven BEFORE performing it, so the
    // resulting scroll/scrollend events don't echo back to /sidebar as a
    // user gesture and hand ownership of the list to the reader who never
    // touched it.
    initParts.push(
      `window.__sidebarServerScrolled?.(); document.querySelector('#file-tree .file-list')?.scrollTo({top:${sidebarJumpToPxOut},behavior:'instant'})`,
    );
  }
  const initExpr = initParts.join("; ");
  const commandSignals: Record<string, number> | undefined = navEpochChanged
    ? { navEpoch: session.view.navEpoch }
    : undefined;
  const hasCommands = initExpr.length > 0 || commandSignals !== undefined;

  const fingerprint = paintFingerprint(session, paint);
  // Push accounting, opt-in via LARGEDIFF_PUSH_LOG=1.
  //
  // "the client never applied this morph" and "the server chose not to send
  // one" are indistinguishable from the browser: the command POST returns
  // 204 either way and the DOM simply doesn't change. Without a per-push
  // record there is no way to tell a transport/apply bug from the
  // skip-when-unchanged fingerprint doing its job, and the two lead to
  // completely different investigations.
  const pushLog = process.env.LARGEDIFF_PUSH_LOG === "1";
  if (!hasCommands && fingerprint === session.view.lastFingerprint) {
    if (pushLog) {
      console.log(`[push] SKIP sid=${session.id} t=${Date.now()} fp=${fingerprint}`);
    }
    m?.pushSkipped(session.id);
    return;
  }
  session.view.pushSeq += 1;
  if (pushLog) {
    console.log(
      `[push] EMIT sid=${session.id} seq=${session.view.pushSeq} t=${Date.now()} cmds=${hasCommands} fp=${fingerprint}`,
    );
  }
  session.view.lastFingerprint = fingerprint;
  if (navEpochChanged) session.view.lastSentNavEpoch = session.view.navEpoch;

  // Bump the command sequence so the morphed command element has a
  // fresh id — Idiomorph would otherwise match by id and Datastar
  // wouldn't re-fire the `data-signals` binding on the new payload.
  let cmdSeq = session.view.cmdSeq;
  if (hasCommands) {
    cmdSeq = session.view.cmdSeq + 1;
    session.view.cmdSeq = cmdSeq;
  }

  const tAssembleStart = m !== undefined ? performance.now() : 0;
  const inner = renderAppInner({
    sid: session.id,
    pushSeq: session.view.pushSeq,
    totalHeight: layout.totalHeight,
    files: meta.files,
    initial: paint,
    commands: hasCommands
      ? { signals: commandSignals, init: initExpr.length > 0 ? initExpr : undefined, cmdSeq }
      : undefined,
    // Reading these *before* this push's `send()` runs gives the
    // user a running total of what the connection has cost up to but
    // not including the in-flight morph. By the next push, the
    // morph's own bytes are factored in.
    wireStats:
      writer.bytesIn !== undefined && writer.bytesOut !== undefined
        ? {
            bytesIn: writer.bytesIn,
            bytesOut: writer.bytesOut,
            encoding: writer.encoding ?? "identity",
          }
        : undefined,
  });
  const morphPieces = inner.split("\n");
  const dataLines: string[] = ["selector #app", "mode inner"];
  for (const piece of morphPieces) dataLines.push(`elements ${piece}`);
  const tWriteStart = m !== undefined ? performance.now() : 0;
  writer.send("datastar-patch-elements", dataLines.join("\n"));
  // Trailing padding, ignored by every SSE consumer.
  //
  // Safari's streaming decompressor retains a fragment of the compressed
  // stream until further compressed input arrives — measured at a full
  // inter-write interval, and unbounded when the app goes idle, which
  // reads to the user as a click that did nothing. Appending a comment
  // means the fragment it holds is padding rather than the morph.
  // Identity is unaffected, so there is nothing to pay when uncompressed.
  //
  // The padding must be incompressible to be worth its wire cost: what
  // matters is how many bytes reach the decoder AFTER the morph, and
  // repetitive filler collapses to nothing. 4KB of random padding did not
  // move the p90; 64KB dropped it from 4.9s to 68ms. See largediff-pkrf.
  if (writer.encoding !== undefined && writer.encoding !== "identity") {
    writer.sendComment?.(ssePadding());
  }

  if (m !== undefined) {
    const tEnd = performance.now();
    m.pushEmitted(session.id, {
      totalMs: tEnd - t0,
      paintMs: tPaintEnd - t0,
      assembleMs: tWriteStart - tAssembleStart,
      // Synchronous hand-off to the encoder only — node:zlib compresses
      // asynchronously, so encode cost is visible in wire ratios instead.
      writeMs: tEnd - tWriteStart,
      rows: paint.rowsRendered,
      htmlBytes: inner.length,
    });
  }

  // Prewarm the diff engine for files currently in the sidebar slice —
  // `engine.file` / `engine.tokens` are memoised, so this is free on
  // hot paths. Keeps clicks on visible rows landing on a warm cache.
  const visibleIds = sidebarSliceFileIds(
    meta.files,
    session.view.sidebarScrollTop,
    session.view.sidebarHeight > 0 ? session.view.sidebarHeight : INITIAL_SIDEBAR_PX,
  );
  for (const fid of visibleIds) {
    const f = deps.engine.file(seed, fid);
    deps.engine.tokens(seed, fid, f);
  }
}

const EMPTY_SPANS: LineSpan[] = [];

// Pre-index a file's `TokenSpans` (per-kind arrays of [lineIdx, start, end])
// into a per-line array of {start, end, cls}, sorted by `start`. The renderer
// walks this in one pass per line; building the index is O(total-tokens),
// cached once per file per push.
function indexTokensByLine(t: TokenSpans): Map<number, LineSpan[]> {
  const byLine = new Map<number, LineSpan[]>();
  for (const kind of HIGHLIGHT_KINDS) {
    const spans = t[kind];
    if (spans === undefined) continue;
    const cls = TOKEN_CLASS[kind];
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (span === undefined) continue;
      const lineIdx = span[0];
      let bucket = byLine.get(lineIdx);
      if (bucket === undefined) {
        bucket = [];
        byLine.set(lineIdx, bucket);
      }
      bucket.push({ start: span[1], end: span[2], cls });
    }
  }
  for (const bucket of byLine.values()) {
    bucket.sort((a, b) => a.start - b.start);
  }
  return byLine;
}
