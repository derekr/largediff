// Server-rendered HTML shell.
//
// Layout: <body> contains a `<div id="app">` whose inner HTML is the whole
// content tree (topbar, drawer backdrop, sidebar, scroller). Every server
// push morphs `#app` in one go — the "fat morph" model. There's no diff
// vs sidebar vs signals split anymore: all state feeds into `<AppInner>`
// and ships as one `datastar-patch-elements` event per push.
//
// Signal categories on body:
//   - `_sid`, `_drawerOpen` — client-only (underscore-prefixed, never POSTed).
//   - `scrollTop`, `height`, `navEpoch` — telemetry, posted back on /view.
//   - `chrome` — server-seeded, client-toggleable via the chrome-toggle.
//   - `jumpToPx`, `sidebarJumpToPx` — imperative one-shots; a body-level
//     `data-effect` scrolls the respective host then resets the signal to 0.
//
// The active-file display fields (`activeFileId`, `activeFilePath`, etc.)
// used to live as signals patched by the projection, but no template
// binding reads them anymore — the sticky `.file-card-header` per section
// handles the visual "current file" and the sidebar's `.active` class is
// baked into the row HTML. Dropped as part of the fat-morph switch.

import type { InitialPaint } from "../session/projection.ts";
import type { DiffFileSummary } from "../store/diff.ts";
import { type JsxNode, renderToString, StaticHtml } from "./jsx-runtime.ts";
import { renderSidebarShell } from "./sidebar.tsx";

// One token per server process. Each deploy spins a new VM, so the token
// rotates on deploy — any stale HTML that survived a cache will reference
// asset URLs that don't match the freshly-served pair, forcing a re-fetch
// of the JS+CSS the moment the browser sees the URL mismatch. Cheaper and
// more robust than relying on `Cache-Control: no-store` alone, which iOS
// Safari has been observed to ignore intermittently.
const BUILD_ID = Date.now().toString(36);

// `data-signals` carries JSON in a double-quoted attribute. The runtime
// escapes `"` (and `&`) on the way out and the HTML parser decodes the
// entities before Datastar reads the value, so the JSON round-trips
// intact — including a future user-influenced string signal, which can't
// terminate the attribute. `sid` is server-generated hex today, but the
// same rule covers the topbar `<code>` sink: escape at the runtime,
// not at scattered call sites.
function signalsAttr(signals: unknown): string {
  return JSON.stringify(signals);
}

export interface AppInnerArgs {
  sid: string;
  // Which server push produced this markup. Rendered as a `data-push`
  // marker so the DOM records the push it is showing.
  pushSeq?: number;
  totalHeight: number;
  files: ReadonlyArray<DiffFileSummary>;
  initial: InitialPaint;
  // Optional one-shot command baked into the morph on a unique-id element.
  // Replaces the separate `datastar-patch-signals` SSE event — the server
  // drives every state change through one morph.
  //
  //   - `signals`: merged into Datastar's signal store via `data-signals`
  //     (used for `navEpoch` which the client echoes back in /view POSTs).
  //   - `init`:    raw JS expression evaluated by Datastar's `data-init`
  //     plugin when the new element is bound. Used for imperative scroll
  //     calls — no signal gate, so a scroll-to-0 (back to top, cmd+up,
  //     active file changes to f0) propagates cleanly.
  //
  // `cmdSeq` bumps every emit so Idiomorph treats this as a fresh element
  // and Datastar re-binds both plugins. Without the bump the binding
  // wouldn't re-fire on subsequent pushes.
  commands?: { signals?: Record<string, number>; init?: string; cmdSeq: number };
  // Wire-bytes telemetry from the SSE writer — drives the running
  // brotli/identity savings chip in the topbar. `undefined` when no
  // SSE stream is attached (initial HTML response) or when the writer
  // doesn't track them (test mocks).
  wireStats?: { bytesIn: number; bytesOut: number; encoding: string };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function WireChip(props: { stats: AppInnerArgs["wireStats"] }): JsxNode | null {
  const stats = props.stats;
  if (stats === undefined) return null;
  const { bytesIn, bytesOut, encoding } = stats;
  // First push the user sees: the writer's counters are sampled
  // *before* this push's bytes flow, so on the very first emit
  // bytesIn is still 0. Show a placeholder so the chip is there
  // from the moment the SSE attaches, and transitions to real
  // numbers on the next push — without the placeholder the chip
  // would only appear after the user did one or two things.
  if (bytesIn === 0) {
    return (
      <span class="wire-chip" title="Waiting for the first SSE push">
        <span class="wire-label">wire</span>
        <span class="wire-hint">measuring…</span>
      </span>
    );
  }
  if (encoding === "identity") {
    // Safari path — no compression by design. Surface the raw
    // bytes so the user knows what the wire is costing.
    return (
      <span
        class="wire-chip"
        title="No compression for Safari — text/event-stream body buffering forces identity encoding"
      >
        <span class="wire-label">wire</span>
        <span class="wire-value">{formatBytes(bytesIn)}</span>
        <span class="wire-hint">identity</span>
      </span>
    );
  }
  const saved = Math.max(0, bytesIn - bytesOut);
  const pct = bytesIn > 0 ? Math.round((saved / bytesIn) * 100) : 0;
  return (
    <span
      class="wire-chip"
      title={`${formatBytes(bytesOut)} on the wire vs ${formatBytes(bytesIn)} uncompressed (${encoding})`}
    >
      <span class="wire-label">wire</span>
      <span class="wire-value">{formatBytes(bytesOut)}</span>
      <span class="wire-hint">
        saved {formatBytes(saved)} · {pct}%
      </span>
    </span>
  );
}

// The one-shot command element: a transient `<div>` carrying the morph's
// signal updates and imperative init script on a unique id.
function CmdElement(props: NonNullable<AppInnerArgs["commands"]>) {
  const { signals, init, cmdSeq } = props;
  return (
    <div
      id={`cmd-${cmdSeq}`}
      data-signals={signals === undefined ? undefined : signalsAttr(signals)}
      data-init={init !== undefined && init.length > 0 ? init : undefined}
    ></div>
  );
}

// Renders the inner HTML of `<div id="app">` — both for the initial shell
// response and for every subsequent fat morph push. The output structure
// is identical in both paths so Idiomorph preserves stable-id nodes
// (`#scroller`, `#ds-window`, `#file-tree`, `.file-list`, `.file-rows`,
// `#f-<fid>`, `#file-row-<fid>`) across morphs, keeping scroll position,
// focus, and Datastar's one-shot `data-init` from re-firing.
export function renderAppInner(args: AppInnerArgs): string {
  return renderToString(<AppInner {...args} />);
}

function AppInner(args: AppInnerArgs) {
  const { sid, totalHeight, files, initial, commands, wireStats, pushSeq } = args;
  // The scroller's stream + scroll telemetry carry Datastar expressions
  // with dots in their attribute names (`data-on:scroll__throttle.32ms`),
  // which JSX attribute syntax cannot spell — they ride in a spread object.
  const scrollerAttrs = {
    "data-on:scroll__throttle.32ms":
      "$scrollTop = $scroller.scrollTop; $height = $scroller.clientHeight; @post('/sessions/' + $_sid + '/view')",
    "data-on:scrollend":
      "$scrollTop = $scroller.scrollTop; $height = $scroller.clientHeight; @post('/sessions/' + $_sid + '/view')",
  };
  return (
    <>
      <div id="push-seq" data-push={pushSeq ?? 0} hidden></div>
      {commands !== undefined ? <CmdElement {...commands} /> : null}
      <header id="topbar" class="topbar">
        <button
          id="menu-toggle"
          class="menu-toggle"
          type="button"
          aria-label="Toggle file list"
          data-attr:aria-expanded="$_drawerOpen ? 'true' : 'false'"
          data-on:click="$_drawerOpen = !$_drawerOpen"
        >
          ☰
        </button>
        <h1>largediff</h1>
        <nav class="tabs" aria-label="review tabs">
          <span class="tab active">Files changed</span>
        </nav>
        <button
          id="back-to-top"
          class="back-to-top"
          type="button"
          title="Back to top"
          aria-label="Back to top"
          data-on:click__prevent="@post('/sessions/' + $_sid + '/top')"
        >
          ↑ Top
        </button>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would
            restyle the toggle and break morph stability; the group role
            here is intentional and long-standing. */}
        <div id="chrome-toggle" class="chrome-toggle" role="group" aria-label="Rendering mode">
          <button
            id="chrome-github"
            type="button"
            data-class:active="$chrome === 'github'"
            data-on:click="$chrome = 'github'; @post('/sessions/' + $_sid + '/settings')"
          >
            GitHub
          </button>
          <button
            id="chrome-bleed"
            type="button"
            data-class:active="$chrome === 'bleed'"
            data-on:click="$chrome = 'bleed'; @post('/sessions/' + $_sid + '/settings')"
          >
            Full bleed
          </button>
        </div>
        <WireChip stats={wireStats} />
        <span class="sid">
          session <code>{sid}</code>
        </span>
      </header>
      <div id="drawer-backdrop" aria-hidden="true" data-on:click="$_drawerOpen = false"></div>
      <div id="layout" class="layout">
        <aside id="file-tree" aria-label="File tree">
          <StaticHtml html={renderSidebarShell(files, initial.sidebarHtml)} />
        </aside>
        <main
          id="scroller"
          data-ref:scroller
          data-init="@get('/sessions/' + $_sid + '/stream', {requestCancellation: 'none', openWhenHidden: true})"
          {...scrollerAttrs}
        >
          <div
            id="ds-window"
            data-attr:data-chrome="$chrome"
            data-chrome={initial.chrome}
            style={`height:${totalHeight}px`}
          >
            <StaticHtml html={initial.diffHtml} />
          </div>
        </main>
      </div>
    </>
  );
}

// `?trace=1` — SSE tap, installed ahead of everything else.
//
// A classic inline script, deliberately: both real scripts are
// `type="module"` and therefore deferred, so a module-based tap would
// install after Datastar has already opened the stream and missed the
// events it exists to count.
//
// The tap wraps the response body in a pass-through stream rather than
// calling `.tee()`. tee gives two independently-paced branches and buffers
// for whichever falls behind, which changes backpressure — precisely the
// kind of thing that could create or mask the bug being measured. A
// pass-through preserves the original single-reader flow exactly: Datastar
// pulling is what drives the counting.
//
// Records, per `datastar-patch-elements` record, the `data-push` value the
// server stamped into it. Cross-referenced with the DOM's own `#push-seq`
// marker and the server's `[push] EMIT` log, a lost morph localises to one
// of three places: never written, written but never read, or read but never
// applied.
// Installed only with `?trace=1`, ahead of the tap. Counts stream opens
// WITHOUT touching the response body, so "does the stream reconnect" can
// be answered without the tap in the picture at all. The tap rebuilds the
// Response, and a fault there would surface as exactly the `TypeError:
// Load failed` + retry storm we are trying to explain — this separates
// instrument from subject. measure.ts reads `window.__streamOpens ?? null`
// and tolerates its absence on untraced pages.
const STREAM_COUNTER_SCRIPT = `<script>
(function () {
  window.__streamOpens = [];
  var of = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var p = of.apply(this, arguments);
    if (url.indexOf('/stream') === -1) return p;
    window.__streamOpens.push({ t: Date.now(), phase: 'request' });
    return p.then(function (res) {
      window.__streamOpens.push({ t: Date.now(), phase: 'response', status: res.status });
      return res;
    }).catch(function (e) {
      window.__streamOpens.push({ t: Date.now(), phase: 'error', error: String(e) });
      throw e;
    });
  };
})();
</script>`;

const TRACE_SCRIPT = `<script>
(function () {
  window.__trace = { events: [], bytes: 0, errors: [], streamOpened: 0 };
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var p = origFetch.apply(this, arguments);
    if (url.indexOf('/stream') === -1) return p;
    return p.then(function (res) {
      if (!res.body) return res;
      window.__trace.streamOpened++;
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var passthrough = new ReadableStream({
        pull: function (controller) {
          return reader.read().then(function (r) {
            if (r.done) { controller.close(); return; }
            window.__trace.bytes += r.value.byteLength;
            buf += dec.decode(r.value, { stream: true });
            var i;
            while ((i = buf.indexOf('\\n\\n')) !== -1) {
              var rec = buf.slice(0, i);
              buf = buf.slice(i + 2);
              if (rec.indexOf('event: datastar-patch-elements') === 0) {
                var m = /data-push="(\\d+)"/.exec(rec);
                window.__trace.events.push({
                  push: m ? +m[1] : null, t: Date.now(), bytes: rec.length,
                });
              }
            }
            controller.enqueue(r.value);
          }).catch(function (e) {
            window.__trace.errors.push(String(e));
            controller.error(e);
          });
        },
        cancel: function (reason) { return reader.cancel(reason); },
      });
      // content-encoding is dropped on purpose: the body handed back here is
      // already decoded, and re-declaring it would invite a second decode.
      var headers = new Headers();
      res.headers.forEach(function (v, k) {
        if (k.toLowerCase() !== 'content-encoding') headers.append(k, v);
      });
      return new Response(passthrough, {
        status: res.status, statusText: res.statusText, headers: headers,
      });
    });
  };
  window.__traceDom = function () {
    var el = document.getElementById('push-seq');
    return el ? +el.getAttribute('data-push') : null;
  };
})();
</script>`;

// Inline scroll-restore for reloads. Built as a JS string and embedded via
// `<script>{js}</script>` — the runtime treats script content as raw text,
// so the single quotes survive verbatim, byte-identical to before.
function scrollRestoreJs(initial: InitialPaint): string | null {
  if (initial.scrollerScrollTop === 0 && initial.sidebarScrollTop === 0) return null;
  const setScroller =
    initial.scrollerScrollTop > 0
      ? `var s=document.getElementById('scroller');if(s)s.scrollTop=${initial.scrollerScrollTop};`
      : "";
  const setSidebar =
    initial.sidebarScrollTop > 0
      ? `var f=document.querySelector('#file-tree .file-list');if(f)f.scrollTop=${initial.sidebarScrollTop};`
      : "";
  return `(function(){${setScroller}${setSidebar}})();`;
}

export function renderShell(
  sid: string,
  totalHeight: number,
  files: ReadonlyArray<DiffFileSummary>,
  initial: InitialPaint,
  trace = false,
): string {
  const signals = signalsAttr({
    _sid: sid,
    scrollTop: 0,
    height: 0,
    navEpoch: 0,
    chrome: initial.chrome,
    _drawerOpen: false,
  });
  const scrollJs = scrollRestoreJs(initial);
  return (
    "<!doctype html>\n" +
    renderToString(
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>largediff — review</title>
          <link rel="stylesheet" href={`/static/styles.css?v=${BUILD_ID}`} />
          {trace ? <StaticHtml html={STREAM_COUNTER_SCRIPT} /> : null}
          {trace ? <StaticHtml html={TRACE_SCRIPT} /> : null}
          <script type="module" src={`/static/datastar.js?v=${BUILD_ID}`}></script>
          <script type="module" src={`/static/highlights.js?v=${BUILD_ID}`}></script>
        </head>
        <body data-signals={signals} data-class:drawer-open="$_drawerOpen">
          <div id="app">
            <AppInner sid={sid} totalHeight={totalHeight} files={files} initial={initial} />
          </div>
          {scrollJs !== null ? <script>{scrollJs}</script> : null}
        </body>
      </html>,
    )
  );
}
