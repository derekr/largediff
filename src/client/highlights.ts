// Client-side helpers for the diff viewer.
//
// Syntax highlighting lives in the morph payload itself — each token
// renders as `<span class="kw">…</span>` (etc.) inside the row's `.text`
// span. The CSS rules in styles.css colour these classes.
//
// The sidebar scroll reporter lives in `./sidebar.ts` — imported here
// so it ships in the same bundle.
//
// Why we stopped using the CSS Custom Highlight API: WebKit's
// implementation walks every range and repaints each intersecting node
// with no batching, stalling Safari's paint pipeline for 100–300ms per
// jump on a 1500-range payload (see bean largediff-ta4r). Server-
// rendered per-token spans match what every production code surface
// (Monaco, CodeMirror, GitHub, Sourcegraph) actually uses at scale.

import "./sidebar.ts";
import { setupMeasure } from "./measure.ts";
import "./poke.ts";
import { setupRangeHighlights } from "./ranges.ts";

// Flag the body as ready for transitions on the second animation frame.
// CSS uses `body.ready` to gate the mobile drawer's transform transition
// so the initial style application (an effective no-transform → translateX
// (-101%) change) doesn't animate on page load.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.body.classList.add("ready");
  });
});

// ---------------------------------------------------------------------------
// Deferred jump-scroll.
//
// On /jump, the server pushes a signal patch with `jumpToPx`. The body's
// data-effect calls `window.__largediffJump(px)` instead of scrolling
// directly. This module then waits for the target's section to actually
// be in the DOM before calling scrollTo — covering the Safari/JSC case
// where Datastar applies signals (microtask) noticeably ahead of morphs
// (task). Without this, scroll lands at a pixel where no section is yet
// mounted, the user sees a blank viewport, then the morph applies and
// content pops in.
//
// Chrome's morph→signal gap is small enough to be invisible, so the
// "already ready" fast path here just scrolls immediately.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __largediffJump?: (px: number) => void;
    __jt?: number;
  }
}

function setupJumpScroll(): void {
  const ds = document.getElementById("ds-window");
  const scroller = document.getElementById("scroller");
  if (ds === null || scroller === null) return;

  // `[jump]` timing lines are diagnostics, not product behaviour — gate
  // them behind the same `?trace=1` flag that installs the SSE reader tap
  // (render/shell.ts) so a public visitor's console stays quiet. The
  // timestamps come from `window.__jt`, stamped by whatever is driving the
  // measurement; without the flag we never even read it.
  const traceOn = new URLSearchParams(location.search).get("trace") === "1";

  // True when any mounted section's pixel range covers `px` (with a small
  // upward grace band so a jump that lands inside a section's transparent
  // top gap still counts).
  const ready = (px: number): boolean => {
    const sections = ds.querySelectorAll<HTMLElement>("section[data-fi]");
    for (let i = 0; i < sections.length; i++) {
      const el = sections[i];
      if (el === undefined) continue;
      const top = parseFloat(el.style.top || "0");
      const height = parseFloat(el.style.height || "0");
      if (px >= top - 64 && px <= top + height) return true;
    }
    return false;
  };

  window.__largediffJump = (px: number): void => {
    const clickT = traceOn ? window.__jt : undefined;
    const doScroll = (): void => {
      scroller.scrollTo({ top: px, behavior: "instant" });
      if (clickT) {
        const sectionCount = ds.querySelectorAll("section[data-fi]").length;
        const rowCount = ds.querySelectorAll(".row").length;
        console.log(
          `[jump] click→painted ${Math.round(performance.now() - clickT)}ms sections=${sectionCount} rows=${rowCount}`,
        );
        requestAnimationFrame(() => {
          console.log(`[jump] click→raf1 ${Math.round(performance.now() - clickT)}ms`);
          requestAnimationFrame(() => {
            console.log(`[jump] click→raf2 ${Math.round(performance.now() - clickT)}ms`);
          });
        });
        window.__jt = 0;
      }
    };
    if (ready(px)) {
      if (clickT) console.log(`[jump] morph already applied at effect time`);
      doScroll();
      return;
    }
    if (clickT) console.log(`[jump] waiting for morph at effect time`);
    const morphObs = new MutationObserver(() => {
      if (clickT) {
        // First mutation since effect — log it; ready check below decides if
        // it's the morph we wanted.
        console.log(`[jump] click→morphSeen ${Math.round(performance.now() - clickT)}ms`);
      }
      if (!ready(px)) return;
      morphObs.disconnect();
      // Kill the safety net: left armed, it re-fires doScroll() at +300ms
      // and yanks the viewport back to the jump pixel from wherever the
      // user has flick-scrolled to in the meantime.
      clearTimeout(fallbackTimer);
      doScroll();
    });
    morphObs.observe(ds, { childList: true });
    // Safety net: don't hang forever if the morph never arrives.
    const fallbackTimer = setTimeout(() => {
      morphObs.disconnect();
      doScroll();
    }, 300);
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupJumpScroll);
} else {
  setupJumpScroll();
}

// `?hl=ranges` mode: build Ranges from each row's `data-tk` offsets and
// install them into CSS.highlights. Bails immediately unless the URL
// carries `?hl=ranges` — the default spans mode pays nothing for it.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupRangeHighlights);
} else {
  setupRangeHighlights();
}

// `window.__ldMeasure()` — scriptable jump-sequence harness used to compare
// the two highlight modes. Registering it is free; it only runs when called.
setupMeasure();
