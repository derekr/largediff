// Scriptable measurement harness for the highlight-mode A/B.
//
// Exposes `window.__ldMeasure(opts)` -> Promise<Report>. Drives a
// deterministic sequence of sidebar jumps and, for each one, records the
// timeline from click through morph, highlight installation, and the
// frames that follow.
//
// The signal we care about lives in the *frame gaps*, not in our own
// callbacks. WebKit's `Highlight::repaintRange()` walks every Range and
// repaints each intersecting node with no batching, so the cost lands in
// the browser's rendering steps between two consecutive rAFs rather than
// in any JS we can time directly. Sampling a chain of rAF timestamps after
// each morph surfaces that as a blown-out `maxFrameGapMs` in a way that
// works identically in Safari and Chrome — unlike `longtask`, which WebKit
// doesn't implement.
//
// Usage from an MCP-driven agent:
//   await window.__ldMeasure({ jumps: 12 })
// Returns plain JSON, safe to stringify straight out of evaluate_javascript.

interface MeasureOptions {
  // How many sidebar jumps to perform.
  jumps?: number;
  // Frames to sample after each morph settles. 10 frames ~= 160ms of
  // healthy rendering, which is plenty of room for a 100-300ms stall to
  // show up as a single outlier gap.
  frames?: number;
  // Bail-out for a morph that never arrives (server hiccup, dropped SSE).
  // Defaults to 15s — generous on purpose, see the note at the use site.
  timeoutMs?: number;
  // Quiet period between jumps so one sample's repaint doesn't bleed into
  // the next sample's frame chain.
  settleMs?: number;
}

interface JumpSample {
  index: number;
  fileId: string;
  // click -> first mutation on #ds-window. NaN (serialises to null) when
  // no morph arrived within the timeout — see `timedOut`.
  morphMs: number;
  // HTTP status of the jump POST itself. A command route returns 204; a
  // 410 means the session was swept out from under us. Recorded because a
  // silently-failed POST and a genuinely-skipped push look identical from
  // the DOM side, and conflating them sends you hunting the wrong bug.
  postStatus: number | string;
  // True when the jump produced no morph at all. Usually means the target
  // file was already mounted, so the server's skip-when-unchanged
  // fingerprint correctly suppressed the push. A sample with this set is
  // measuring an idle page and must NOT be pooled into the timings.
  timedOut: boolean;
  // click -> highlight registry rebuilt. Undefined in spans mode.
  highlightMs?: number;
  // Range construction and CSS.highlights.set() cost, from client/ranges.ts.
  buildMs?: number;
  setMs?: number;
  rangeCount?: number;
  // The frame chain sampled after the morph. This is where the paint
  // stall shows up. NaN (serialises to null) when rAF delivered fewer
  // than two ticks — a hidden or throttled window — because that sample
  // measured nothing; it is excluded from the pooled frame-gap stats.
  maxFrameGapMs: number;
  frameGapsMs: number[];
  // Size of the window's DOM after the morph, in UTF-16 code units of
  // `innerHTML` — the honest proxy for "what the fat morph had to carry".
  // Named chars, not bytes: it equals bytes only while the synthetic diff
  // stays ASCII.
  htmlChars: number;
  rowCount: number;
}

interface Report {
  mode: "spans" | "ranges";
  ua: string;
  highlightApiSupported: boolean;
  // Raw text of the topbar's brotli chip title, e.g.
  // "41.2 KB on the wire vs 233.9 KB uncompressed (br)". Captured verbatim
  // rather than parsed so the analysis side owns the format.
  wireChip: string | null;
  samples: JumpSample[];
  summary: {
    jumps: number;
    // Jumps that produced no morph. Any value above zero means the run is
    // not comparable to one with a different count — investigate before
    // reading anything else in this summary.
    timedOutJumps: number;
    // All medians are NaN (null in JSON) when no real morphs were pooled —
    // a deliberate "no data" marker, because the old 0 looked like a
    // spectacularly healthy run instead of an empty one.
    medianMorphMs: number;
    medianMaxFrameGapMs: number;
    worstMaxFrameGapMs: number;
    medianHtmlChars: number;
    medianRangeCount?: number;
  };
}

declare global {
  interface Window {
    __ldMeasure?: (opts?: MeasureOptions) => Promise<Report>;
    __trace?: TraceState;
    __traceDom?: () => number | null;
    __streamOpens?: Array<{ t: number; phase: string; status?: number; error?: string }>;
    __ldSelfTest?: unknown;
  }
}

function median(xs: number[]): number {
  // NaN, not 0: a median of nothing is not a small number, and 0 here has
  // already been mistaken for "this run was fast" once. NaN serialises to
  // null, which no one can misread.
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid] ?? 0;
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function raf(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves on the first childList mutation inside #ds-window after the
// click — i.e. when Datastar's fat morph actually touches the DOM. Times
// out rather than hanging so a dropped SSE push doesn't wedge the run.
function waitForMorph(ds: HTMLElement, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (t: number): void => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      resolve(t);
    };
    const obs = new MutationObserver(() => finish(performance.now()));
    obs.observe(ds, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(Number.NaN), timeoutMs);
  });
}

// Records animation-frame gaps continuously until stopped.
//
// Sampling only a fixed chain *after* the morph resolves is not good enough:
// Safari's SSE delivery is jittery enough that a push can land outside the
// window we would have sampled, and the repaint it triggers would be missed
// entirely — reporting a healthy 16ms when the stall actually happened.
// Recording across the whole jump, from the POST until well after the morph,
// means the paint is inside the interval no matter when it lands. Idle time
// contributes only ~16ms gaps, so it cannot manufacture a false positive.
function startFrameRecorder(): { stop: () => number[] } {
  const gaps: number[] = [];
  let prev = -1;
  let running = true;
  const tick = (t: number): void => {
    if (!running) return;
    if (prev >= 0) gaps.push(t - prev);
    prev = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      running = false;
      return gaps;
    },
  };
}

async function waitFrames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await raf();
}

export function setupMeasure(): void {
  window.__ldMeasure = async (opts: MeasureOptions = {}): Promise<Report> => {
    const jumps = opts.jumps ?? 12;
    // Clamped to at least 1: `frames: 0` (or NaN) would sample no frame
    // gaps at all, and an empty gap chain used to surface as
    // `Math.max() === -Infinity` — which JSON.stringify writes as null and
    // which sorts below every real gap, silently dragging the pooled
    // median down.
    const frames = Math.max(1, opts.frames ?? 10);
    // Safari can sit on an SSE push for seconds. A short timeout here
    // does not just lose one sample — the late morph lands inside the
    // NEXT jump's window and is misattributed to it, which is how a run
    // ends up alternating TIMEOUT / suspiciously-fast.
    const timeoutMs = opts.timeoutMs ?? 15000;
    const settleMs = opts.settleMs ?? 600;

    const ds = document.getElementById("ds-window");
    if (ds === null) throw new Error("#ds-window not found");

    // Drive jumps by POSTing the jump command directly rather than
    // clicking sidebar rows. The sidebar is itself server-virtualized —
    // only rows around the active file are mounted — so clicking whatever
    // happens to be on screen walks a path that depends on where previous
    // jumps landed. In practice that made the two modes visit *different*
    // files, which quietly invalidates any bytes-per-push comparison.
    //
    // POSTing a fixed, evenly-spaced set of file ids makes both runs
    // traverse the identical sequence. It is the same code path for
    // everything we actually measure: the server pushes the fat morph over
    // the already-open SSE stream exactly as it would for a real click.
    // The only thing skipped is Datastar's click handler, which is
    // identical in both modes and lost in the noise.
    const sid = location.pathname.split("/")[2] ?? "";
    if (sid === "") throw new Error("could not derive session id from path");

    const countText = document.querySelector("#file-tree .count")?.textContent ?? "";
    const fileCount = Number.parseInt(countText, 10);
    if (!Number.isFinite(fileCount) || fileCount <= 0) {
      throw new Error(`could not read file count (got ${JSON.stringify(countText)})`);
    }

    const samples: JumpSample[] = [];
    // Evenly spaced across the whole diff so every jump crosses a file
    // boundary into an unmounted section — a real morph, not a no-op.
    const stride = Math.max(1, Math.floor(fileCount / (jumps + 1)));

    for (let i = 0; i < jumps; i++) {
      const fileIndex = ((i + 1) * stride) % fileCount;
      const fileId = `f${fileIndex}`;
      const hlBefore = window.__ldHl?.builds.length ?? 0;
      const rec = startFrameRecorder();
      const t0 = performance.now();
      const morphWait = waitForMorph(ds, timeoutMs);
      // Fire-and-forget: the 204 tells us nothing, the morph arrives on
      // the SSE stream and `morphWait` is what we time against.
      let postStatus: number | string = "pending";
      const posted = fetch(`/sessions/${sid}/files/${fileId}/jump`, { method: "POST" })
        .then((r) => {
          postStatus = r.status;
        })
        .catch((e: unknown) => {
          postStatus = `error: ${String(e)}`;
        });
      const tMorph = await morphWait;
      // Never blocks the morph timing — by here the POST has long resolved
      // in the success case, and we only need its status for the report.
      await posted;

      // Let ranges.ts's rAF-coalesced rebuild run, then read what it did.
      await raf();
      const hlAfter = window.__ldHl?.builds ?? [];
      const built = hlAfter.length > hlBefore ? hlAfter[hlAfter.length - 1] : undefined;
      const tHl = built !== undefined ? performance.now() : undefined;

      // Keep recording past the morph so the repaint it causes is captured.
      await waitFrames(frames);
      const frameGapsMs = rec.stop();

      const timedOut = Number.isNaN(tMorph);
      samples.push({
        index: i,
        fileId,
        postStatus,
        timedOut,
        morphMs: tMorph - t0,
        highlightMs: tHl === undefined ? undefined : tHl - t0,
        buildMs: built?.buildMs,
        setMs: built?.setMs,
        rangeCount: built?.ranges,
        // NaN when the recorder saw fewer than two rAF ticks (hidden or
        // throttled window) — `Math.max()` of nothing is -Infinity, which
        // JSON writes as null while ALSO sorting below every real gap and
        // dragging the pooled median down. NaN is the same null on the
        // wire but is filtered out of the pooled stats below.
        maxFrameGapMs: frameGapsMs.length === 0 ? Number.NaN : Math.max(...frameGapsMs),
        frameGapsMs: frameGapsMs.map((g) => Math.round(g * 100) / 100),
        htmlChars: ds.innerHTML.length,
        rowCount: ds.querySelectorAll(".row").length,
      });

      await sleep(settleMs);
    }

    // Every pooled statistic below is computed over real morphs only.
    const real = samples.filter((s) => !s.timedOut);
    const rangeCounts = real
      .map((s) => s.rangeCount)
      .filter((n): n is number => typeof n === "number");
    // A real morph can still carry a NaN frame gap (rAF never ticked twice
    // — see the JumpSample comment). Pool only finite gaps so one throttled
    // sample cannot poison the median's sort order.
    const frameGaps = real.map((s) => s.maxFrameGapMs).filter((n) => Number.isFinite(n));

    return {
      mode: window.__ldHl?.mode ?? "spans",
      ua: navigator.userAgent,
      highlightApiSupported: window.__ldHl?.supported ?? false,
      wireChip: document.querySelector(".wire-chip")?.getAttribute("title") ?? null,
      samples,
      summary: {
        jumps: samples.length,
        timedOutJumps: samples.length - real.length,
        medianMorphMs: Math.round(median(real.map((s) => s.morphMs)) * 100) / 100,
        medianMaxFrameGapMs: Math.round(median(frameGaps) * 100) / 100,
        worstMaxFrameGapMs:
          frameGaps.length === 0 ? Number.NaN : Math.round(Math.max(...frameGaps) * 100) / 100,
        medianHtmlChars: Math.round(median(real.map((s) => s.htmlChars))),
        medianRangeCount: rangeCounts.length > 0 ? Math.round(median(rangeCounts)) : undefined,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Self-driving drop test: `?selftest=1` on a session URL.
//
// Exists because Safari marks every WebDriver/automation window
// `document.hidden` and offers no way to un-hide it, while a hidden page has
// its timers throttled and rAF suspended. Every Safari number taken through
// automation is therefore a measurement of a throttled page. The only way to
// see what a user sees is to run inside a real, visible window with nothing
// attached — which means the page has to drive itself and report its own
// result.
//
// Records, per jump, whether #ds-window actually changed, and stamps the
// whole run with the page's visibility so a throttled run declares itself
// instead of being mistaken for a clean one.
//
//   open -a Safari "https://…/sessions/<sid>?selftest=1&jumps=24"
//
// and read the verdict off the on-page banner. Incremental and final
// results are recorded on window.__ldSelfTest for a driver that wants them
// programmatically (they were POSTed to /sse-lab/result back when the lab
// routes lived on the app server; the lab has since moved to ../sselab).
// ---------------------------------------------------------------------------

interface SelfTestJump {
  fileId: string;
  postStatus: number | string;
  before: string;
  after: string;
  changed: boolean;
  tClick: number;
  // Three observation points per jump, so a loss localises instead of just
  // being counted. `?trace=1` must be on for the tap fields to be present.
  //   tapBefore/tapAfter — pushes seen by the SSE reader (the wire)
  //   domPushBefore/After — the `data-push` the DOM is showing
  // Wire advanced but DOM did not => received, never applied.
  // Neither advanced => never reached the reader at all.
  tapBefore?: number;
  tapAfter?: number;
  tapPushes?: Array<number | null>;
  domPushBefore?: number | null;
  domPushAfter?: number | null;
}

interface TraceState {
  events: Array<{ push: number | null; t: number; bytes: number }>;
  bytes: number;
  errors: string[];
  streamOpened: number;
}

function setupSelfTest(): void {
  const params = new URLSearchParams(location.search);
  if (params.get("selftest") !== "1") return;

  // Robust against a malformed param. `Number('24"')` is NaN, and NaN
  // survives both Math.min and Math.max, so a stray character on the URL
  // silently produced `jumps = NaN`, a loop that never executed, and a
  // posted result of zero jumps and zero drops — indistinguishable at a
  // glance from a clean run. Parse digits only and fall back.
  const num = (key: string, def: number, lo: number, hi: number): number => {
    const digits = (params.get(key) ?? "").replace(/[^0-9]/g, "");
    const n = Number.parseInt(digits, 10);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.max(lo, Math.min(hi, n));
  };
  const jumps = num("jumps", 24, 1, 200);
  const gap = num("gap", 2500, 300, 10_000);
  const sid = location.pathname.split("/")[2] ?? "";
  if (sid === "") return;

  const vis = {
    initial: document.visibilityState,
    everHidden: document.hidden,
    changes: [] as Array<{ state: string; t: number }>,
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) vis.everHidden = true;
    vis.changes.push({ state: document.visibilityState, t: Date.now() });
  });

  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;bottom:8px;right:8px;z-index:9999;background:#161b22;color:#e6edf3;" +
    "border:1px solid #30363d;border-radius:6px;padding:8px 10px;font:12px ui-monospace,Menlo,monospace";
  banner.textContent = "selftest: starting…";
  document.body.appendChild(banner);

  const snap = (): string => {
    const ds = document.getElementById("ds-window");
    if (ds === null) return "none";
    return `${ds.querySelectorAll(".row").length}:${ds.innerHTML.length}`;
  };

  // Hoisted so both the incremental and final reports share one shape.
  const post = (results: SelfTestJump[], final: boolean): void => {
    const dropped = results.filter((r) => !r.changed);
    window.__ldSelfTest = {
      kind: "app-selftest",
      final,
      ran: results.length > 0,
      jumpsExecuted: results.length,
      sid,
      jumps,
      gap,
      ua: navigator.userAgent,
      visibility: vis,
      streamOpens: window.__streamOpens ?? null,
      droppedCount: dropped.length,
      droppedFiles: dropped.map((d) => d.fileId),
      droppedDiagnosis: dropped.map((d) => ({
        fileId: d.fileId,
        wireAdvanced: (d.tapAfter ?? 0) > (d.tapBefore ?? 0),
        domAdvanced: d.domPushAfter !== d.domPushBefore,
        tapPushes: d.tapPushes,
        domPush: d.domPushAfter,
        verdict:
          d.tapAfter === undefined
            ? "no trace (add ?trace=1)"
            : (d.tapAfter ?? 0) > (d.tapBefore ?? 0)
              ? "RECEIVED BUT NOT APPLIED"
              : "NOT YET AT THE READER (may arrive late)",
      })),
      trace: window.__trace
        ? {
            totalEvents: window.__trace.events.length,
            bytes: window.__trace.bytes,
            errors: window.__trace.errors,
            streamOpened: window.__trace.streamOpened,
            events: window.__trace.events,
          }
        : null,
      results,
    };
  };

  const run = async (): Promise<void> => {
    const results: SelfTestJump[] = [];
    const fileCountText = document.querySelector("#file-tree .count")?.textContent ?? "";
    const fileCount = Number.parseInt(fileCountText, 10);
    // Bail exactly like `__ldMeasure` does. The old `|| 500` fallback
    // invented a 500-file universe when the count element was missing,
    // every jump then targeted nonexistent file ids, and the run reported
    // 24/24 "late" — a meaningless result that looked real.
    if (!Number.isFinite(fileCount) || fileCount <= 0) {
      banner.textContent = `selftest FAILED: could not read file count (got ${JSON.stringify(fileCountText)})`;
      throw new Error(`selftest: could not read file count (got ${JSON.stringify(fileCountText)})`);
    }
    const stride = Math.max(1, Math.floor(fileCount / (jumps + 1)));

    for (let i = 0; i < jumps; i++) {
      const fileId = `f${((i + 1) * stride) % fileCount}`;
      const before = snap();
      const tapBefore = window.__trace?.events.length;
      const domPushBefore = window.__traceDom?.() ?? null;
      const tClick = Date.now();
      let postStatus: number | string = "pending";
      try {
        const r = await fetch(`/sessions/${sid}/files/${fileId}/jump`, { method: "POST" });
        postStatus = r.status;
      } catch (e) {
        postStatus = `error: ${String(e)}`;
      }
      await new Promise((res) => setTimeout(res, gap));
      const after = snap();
      const tapAfter = window.__trace?.events.length;
      const domPushAfter = window.__traceDom?.() ?? null;
      results.push({
        fileId,
        postStatus,
        before,
        after,
        changed: before !== after,
        tClick,
        tapBefore,
        tapAfter,
        tapPushes:
          tapBefore !== undefined && tapAfter !== undefined
            ? (window.__trace?.events.slice(tapBefore, tapAfter).map((e) => e.push) ?? [])
            : undefined,
        domPushBefore,
        domPushAfter,
      });
      const lost = results.filter((x) => !x.changed).length;
      banner.textContent = `selftest: ${results.length}/${jumps}  late=${lost}`;
      // Record as we go. The previous run produced nothing at all because the
      // tab was closed before the single end-of-run report — a whole run's
      // data lost to an instrument that only reported at the finish.
      if (results.length % 4 === 0) post(results, false);
    }

    post(results, true);
    const lateTotal = results.filter((r) => !r.changed).length;
    banner.textContent =
      `selftest DONE: ${lateTotal}/${jumps} late` +
      (vis.everHidden ? " (WAS HIDDEN — untrustworthy)" : " (stayed visible)");
  };

  // Let the SSE stream attach before the first jump.
  setTimeout(() => {
    void run();
  }, 4000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupSelfTest);
} else {
  setupSelfTest();
}
