// CSS Custom Highlight API mode ("ranges").
//
// Counterpart to the default per-token-span rendering. When the session is
// in `highlight: "ranges"`, each `.row.line` arrives with its text as a
// single plain text node plus `data-tk="start,len,k|…"` — token offsets in
// UTF-16 code units, `k` indexing TOKEN_CLASS_ORDER on the server.
//
// This module turns those offsets into `Range` objects and installs them
// into six `Highlight` registry entries. It exists so the Safari paint cost
// documented in bean largediff-ta4r stays *reproducible* rather than
// folklore — flip `?hl=ranges` and measure. See CLAUDE.md for why spans
// remain the production default.
//
// Timing is recorded into `window.__ldHl` so the measurement harness (and
// an MCP-driven agent) can read build cost separately from paint cost.

// Frozen order — must match TOKEN_CLASS_ORDER in src/render/files.ts.
const REGISTRY_NAMES = ["kw", "str", "cmt", "num", "fn", "typ"] as const;

export interface HighlightBuildSample {
  // Rows carrying a data-tk attribute at build time.
  rows: number;
  // Total Range objects constructed across all six registry entries.
  ranges: number;
  // ms spent walking the DOM and constructing Ranges.
  buildMs: number;
  // ms spent in the CSS.highlights.set() calls themselves. Cheap in both
  // engines — the real WebKit cost lands in the subsequent paint, not here.
  setMs: number;
}

// TypeScript's lib.dom.d.ts declares `HighlightRegistry` and `Highlight`
// with only `forEach` — the maplike/setlike members the spec defines are
// missing (a known gap in the generated DOM lib for maplike interfaces).
// Augment rather than cast so the call sites stay type-checked.
declare global {
  interface HighlightRegistry {
    readonly size: number;
    set(name: string, highlight: Highlight): HighlightRegistry;
    get(name: string): Highlight | undefined;
    has(name: string): boolean;
    delete(name: string): boolean;
    clear(): void;
  }

  interface Window {
    __ldHl?: {
      supported: boolean;
      mode: "ranges" | "spans";
      builds: HighlightBuildSample[];
      rebuild: () => HighlightBuildSample | undefined;
    };
  }
}

// Feature detection. `Highlight` and `CSS.highlights` both need to exist —
// Safari 17.2+ and Chrome 105+ have them; anything older silently renders
// uncoloured text in ranges mode, which is the honest failure mode.
function supported(): boolean {
  return typeof Highlight === "function" && typeof CSS !== "undefined" && "highlights" in CSS;
}

// One Highlight per token class, created once and mutated in place. We
// rebuild by constructing fresh Highlight objects each pass rather than
// calling `.clear()` + re-add: WebKit's `Highlight::repaintRange()` fires
// per mutation, so incremental adds are strictly worse than a wholesale
// replace. Replacing is also what a naive implementation would reach for,
// which is the point — we're measuring the obvious approach.
function buildOnce(root: ParentNode): HighlightBuildSample | undefined {
  if (!supported()) return undefined;

  const t0 = performance.now();
  const rows = root.querySelectorAll<HTMLElement>(".row.line[data-tk]");
  const buckets: Range[][] = [[], [], [], [], [], []];
  let ranges = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const tk = row.dataset.tk;
    if (tk === undefined || tk === "") continue;
    // `.text` holds exactly one text node in ranges mode (the server emits
    // escaped plain text, no element children), so offsets map 1:1.
    const textEl = row.querySelector(".text");
    const node = textEl?.firstChild;
    if (node === undefined || node === null || node.nodeType !== Node.TEXT_NODE) continue;
    const len = node.nodeValue?.length ?? 0;

    // Hand-parse rather than split("|").map(split(",")) — this runs over
    // a few thousand rows per morph and the allocation churn of the
    // idiomatic version is measurable enough to muddy the numbers.
    let pos = 0;
    while (pos < tk.length) {
      const bar = tk.indexOf("|", pos);
      const chunkEnd = bar === -1 ? tk.length : bar;
      const c1 = tk.indexOf(",", pos);
      const c2 = tk.indexOf(",", c1 + 1);
      if (c1 === -1 || c2 === -1 || c1 > chunkEnd || c2 > chunkEnd) break;
      const start = +tk.slice(pos, c1);
      const length = +tk.slice(c1 + 1, c2);
      const k = +tk.slice(c2 + 1, chunkEnd);
      pos = chunkEnd + 1;
      const bucket = buckets[k];
      if (bucket === undefined) continue;
      const end = start + length;
      // Clamp defensively: a torn morph could leave a shorter text node
      // than the attribute describes, and Range.setEnd throws on overrun.
      if (!(start >= 0) || !(end > start) || end > len) continue;
      const r = document.createRange();
      r.setStart(node, start);
      r.setEnd(node, end);
      bucket.push(r);
      ranges++;
    }
  }
  const t1 = performance.now();

  for (let k = 0; k < REGISTRY_NAMES.length; k++) {
    const name = REGISTRY_NAMES[k];
    const bucket = buckets[k];
    if (name === undefined || bucket === undefined) continue;
    CSS.highlights.set(name, new Highlight(...bucket));
  }
  const t2 = performance.now();

  return { rows: rows.length, ranges, buildMs: t1 - t0, setMs: t2 - t1 };
}

export function setupRangeHighlights(): void {
  // Hard opt-in on the same `?hl=ranges` flag the server reads to select
  // the mode (src/server.ts). Before this bail-out the module cost every
  // spans-mode visitor a subtree MutationObserver plus a full
  // `.row.line[data-tk]` scan per morph, only to conclude "still spans".
  // Trade-off: a settings POST that flips highlight mode without the URL
  // flag won't rebuild here — reload with `?hl=ranges`, which is what the
  // documented A/B flow does anyway (a fresh page per mode keeps runs
  // comparable).
  if (new URLSearchParams(location.search).get("hl") !== "ranges") return;

  const ds = document.getElementById("ds-window");
  if (ds === null) return;

  // Within an opted-in page, ranges mode is still inferred from the
  // payload: if the server is emitting data-tk we're in ranges mode. Keeps
  // the client from needing to know the session's settings, and means the
  // switch takes effect on the very morph that carries it.
  const inRangesMode = (): boolean => ds.querySelector(".row.line[data-tk]") !== null;

  const samples: HighlightBuildSample[] = [];
  const rebuild = (): HighlightBuildSample | undefined => {
    const sample = buildOnce(ds);
    if (sample !== undefined) {
      samples.push(sample);
      // Keep the ring bounded — a long session shouldn't leak samples.
      if (samples.length > 200) samples.shift();
    }
    return sample;
  };

  window.__ldHl = {
    supported: supported(),
    get mode() {
      return inRangesMode() ? ("ranges" as const) : ("spans" as const);
    },
    builds: samples,
    rebuild,
  };

  if (!supported()) {
    console.warn("[largediff] CSS Custom Highlight API unavailable; ranges mode will render plain");
    return;
  }

  // Rebuild after every morph, coalesced to one pass per frame. Datastar
  // applies the fat morph in a single task, so a rAF right after it lands
  // catches the whole window in one go — which is exactly the "one big
  // replace per navigation" shape the API is supposed to handle well.
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!inRangesMode()) {
        // Switched back to spans mode — drop the registry so stale ranges
        // don't keep painting over server-rendered spans.
        if (CSS.highlights.size > 0) CSS.highlights.clear();
        return;
      }
      rebuild();
    });
  };

  new MutationObserver(schedule).observe(ds, { childList: true, subtree: true });
  schedule();
}
