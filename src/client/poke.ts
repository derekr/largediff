// WebKit SSE flush poke.
//
// WebKit strands a fragment of a compressed SSE stream inside the decoder
// whenever data arrives while the page's consumer is busy, and releases it
// only when further compressed input arrives — not when the consumer reads
// again, and not on any timer. On an idle stream the last update can be
// withheld indefinitely, which reads to a user as a click that did nothing
// followed by a click that shows the previous click's result.
//
// So after the page finishes applying a patch, it tells the server it is
// idle, and the server puts a few bytes on the wire. See bean
// largediff-pkrf for the measurements.
//
// Measured against the reproduction (Safari 26.4, brotli, 250KB morphs, two
// events per interaction, five seconds apart):
//
//   nothing                       median ~5,000ms   21 of 22 past a second
//   64KB padding, immediate       partial, ~14KB per push on the wire
//   16-byte comment at +500ms     median   363ms    none past a second
//   this poke                     median   165ms    none past a second
//
// The poke wins because a server-side timer has to guess how long the client
// will be busy: at +150ms it fires while the consumer is still working and
// does nothing at all, and +500ms only works by overshooting. The client
// knows exactly when it went idle.
//
// ---------------------------------------------------------------------------
// Deliberately written to be liftable into a Datastar plugin.
//
// It touches no Datastar internals: it watches the morph target for
// mutations rather than hooking a patch lifecycle, so it works with any
// server-driven-DOM library, and the endpoint arrives as a data attribute
// rather than being derived from framework state. As a plugin this would be
// `data-sse-poke="/path"` on the element being patched.
// ---------------------------------------------------------------------------

function pokeEnabled(): boolean {
  // Opt-in, not default-on.
  //
  // The poke won decisively in the LAB — 165ms median against 363ms for a
  // server-side timer, and it needs no guess at how long the client will be
  // busy. It did not transfer to the app: measured over 24 jumps, padding
  // alone gave 1 late, the poke alone gave 3 and then 5, and both together
  // gave 1. Adding it on top of padding bought nothing while costing a
  // request per patch, so it stays available rather than enabled.
  //
  // The app's morph is far larger than the lab's, which is the obvious
  // suspect for why the lab result did not carry. At 1-5 late per 24 the
  // run-to-run variance is also large enough that none of those differences
  // are individually solid — this default is the simplest config consistent
  // with the best measurement, not a settled verdict.
  //
  // ?poke=on enables it anywhere (including non-WebKit, so the two engines
  // can be compared on equal terms); anything else leaves it off.
  return new URLSearchParams(location.search).get("poke") === "on";
}

// Retained for when this becomes the default again: only WebKit strands, so
// on other engines a poke is a pointless request per patch.
//
// Sniffing the UA is crude and normally the wrong instinct, but there is
// nothing to feature-detect — the defect is a timing behaviour with no API
// surface, and probing for it would mean deliberately stranding an update to
// see whether it comes back. Every browser on iOS is WebKit, so this is not
// a "Safari" check.
export function isWebKit(): boolean {
  const ua = navigator.userAgent;
  return ua.includes("AppleWebKit") && !ua.includes("Chrome") && !ua.includes("Chromium");
}

// Coalescing delay before poking.
//
// Not zero: while patches are arriving steadily — a scroll, say — each one
// is itself the input that releases whatever the previous one stranded, so
// poking per patch would be a request per frame for no benefit. The poke
// only matters once the stream goes quiet, so it fires on the trailing edge.
// Small enough that the worst-case stranded update is bounded by roughly
// this plus a round trip.
const POKE_DEBOUNCE_MS = 50;

export function setupPoke(): void {
  if (!pokeEnabled()) return;

  const app = document.getElementById("app");
  if (app === null) return;

  const sid = location.pathname.split("/")[2] ?? "";
  if (sid === "") return;
  const url = `/sessions/${sid}/poke`;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;

  const poke = (): void => {
    timer = undefined;
    // One at a time. A second poke while one is outstanding adds no
    // information — the first one's response is already the input that
    // releases anything stranded.
    if (inFlight) return;
    inFlight = true;
    void fetch(url, { method: "POST", keepalive: true })
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  };

  // A patch landing is a DOM mutation on the morph target. Scheduling from
  // here means the timer is queued while the main thread is still applying
  // and fires once it is free — which is precisely the moment the server
  // needs to hear about.
  const observer = new MutationObserver(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(poke, POKE_DEBOUNCE_MS);
  });
  observer.observe(app, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupPoke);
} else {
  setupPoke();
}
