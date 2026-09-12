// Microlighter mode ("micro") — spike largediff-3s9i.
//
// Same contract as client/ranges.ts: rows arrive as plain text and this
// module feeds token ranges to `CSS.highlights`, with samples in
// `window.__ldHl` (mode `"micro"`) so `__ldMeasure` reports both modes
// identically. Two deliberate differences from ranges.ts, both part of
// what the spike measures:
//   - the tokenize step runs HERE, per morph, in the browser (ranges mode
//     only walks the DOM; tokenizing happened on the server and rode in
//     `data-tk`). So `buildMs` here covers tokenize + Range construction,
//     where ranges mode's covers construction alone.
//   - microlighter keeps module-level Highlight objects and clears +
//     re-adds per call — the incremental-mutation pattern ranges.ts
//     deliberately avoids because WebKit repaints per mutation. Whether
//     that matters at our range counts is an open measurement, not an
//     assumption, which is why this file exists.
//
// Rows carry `language-*` on the `.text` span (rendered by
// render/files.ts in micro mode); microlighter reads the language off the
// matched block itself. Grammars load on demand from /static/micro.

import type { HighlightBuildSample } from "./ranges.ts";

// TypeScript's lib.dom.d.ts declares `Highlight` without the Set-like
// `size` member (same maplike gap ranges.ts works around for the
// registry) — augment so the range census stays type-checked.
declare global {
  interface Highlight {
    readonly size: number;
  }
}

interface MicrolighterLib {
  highlightAll: (opts: { root: ParentNode; selector: string }) => Promise<unknown[]>;
}

const MICRO_URL = "/static/micro/highlight.js";

export function setupMicroHighlights(): void {
  // Hard opt-in on `?hl=micro`, mirroring ranges.ts: the module costs
  // nothing to every other visitor, and a settings POST that flips the
  // mode without the flag won't rebuild here — reload with the flag, same
  // documented A/B flow (fresh page per mode keeps runs comparable).
  if (new URLSearchParams(location.search).get("hl") !== "micro") return;

  const ds = document.getElementById("ds-window");
  if (ds === null) return;

  // Theme for microlighter's ::highlight() categories (vendored). Injected
  // here rather than in the shell so spans/ranges pages never fetch it.
  const theme = document.createElement("link");
  theme.rel = "stylesheet";
  theme.href = "/static/micro/github.css";
  document.head.appendChild(theme);
  document.documentElement.dataset.syntaxTheme = "github";

  const samples: HighlightBuildSample[] = [];
  let lib: MicrolighterLib | undefined;

  const rebuild = async (): Promise<HighlightBuildSample | undefined> => {
    if (lib === undefined) {
      try {
        // Non-literal URL so neither tsc nor the Bun build tries to
        // resolve/bundle the vendored file — it loads natively at runtime.
        const url: string = MICRO_URL;
        lib = (await import(url)) as MicrolighterLib;
      } catch {
        return undefined;
      }
    }
    const active = lib;
    if (active === undefined) return undefined;
    const t0 = performance.now();
    await active.highlightAll({ root: ds, selector: ".row.line > .text" });
    const t1 = performance.now();
    let ranges = 0;
    CSS.highlights.forEach((highlight) => {
      ranges += highlight.size;
    });
    // Paint cost, measured as time to the second animation frame after
    // registration. WebKit's Highlight repaint cost lands here, not in the
    // JS above: `CSS.highlights.set()` only invalidates, and the per-range
    // node walk happens when the browser actually paints. Two rAFs bracket
    // one painted frame; in a throttled/hidden page rAF never fires, so
    // this resolves when visibility returns and the number stays honest.
    const t2 = await new Promise<number>((resolve) => {
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
    });
    const sample: HighlightBuildSample = {
      rows: ds.querySelectorAll(".row.line").length,
      ranges,
      buildMs: t1 - t0,
      // highlightAll tokenizes, builds, and sets in one call — there is no
      // separate set phase to time, unlike ranges.ts.
      setMs: 0,
      paintMs: t2,
    };
    samples.push(sample);
    // Keep the ring bounded — a long session shouldn't leak samples.
    if (samples.length > 200) samples.shift();
    return sample;
  };

  window.__ldHl = {
    supported: typeof Highlight === "function" && typeof CSS !== "undefined" && "highlights" in CSS,
    get mode() {
      return "micro" as const;
    },
    builds: samples,
    rebuild: () => {
      void rebuild();
      return samples[samples.length - 1];
    },
  };

  // Rebuild after every morph, coalesced to one pass per frame — same
  // "one big replace per navigation" shape ranges.ts measures.
  let scheduled = false;
  let pending = false;
  const schedule = (): void => {
    if (scheduled) {
      pending = true;
      return;
    }
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      void rebuild().then(() => {
        if (pending) {
          pending = false;
          schedule();
        }
      });
    });
  };

  new MutationObserver(schedule).observe(ds, { childList: true, subtree: true });
  schedule();
}
