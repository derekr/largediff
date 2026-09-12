// largediff entry — Bun.serve route table.
//
// Session lifecycle, command routes, SSE stream, and server-driven windowing
// are all here. Remaining downstream epic:
//   - file tree + jump navigation     → largediff-op6h

import { createDiffEngine } from "./diff/generator.ts";
import { FILE_HEADER_GAP_PX } from "./diff/layout.ts";
import { renderDoc } from "./render/doc.ts";
import { renderShell } from "./render/shell.ts";
import { type CommandKind, metricsFromEnv } from "./server/metrics.ts";
import { clientIp, IpRateLimiter, parseBucketSpec } from "./server/ratelimit.ts";
import {
  applySettings,
  applySidebarView,
  applyTop,
  applyView,
  applyViewHeight,
} from "./session/commands.ts";
import {
  type ProjectionDeps,
  paintFingerprint,
  pushProjection,
  renderInitialPaint,
  WriterRegistry,
} from "./session/projection.ts";
import { attachStream } from "./session/stream.ts";
import type { ReviewSession, SessionId } from "./session/types.ts";
import {
  beginCoalesce,
  cancelPendingViewPush,
  dropViewPushState,
  isEchoScroll,
  scheduleViewPush,
} from "./session/viewpush.ts";
import { type SessionStore, SqliteSessionStore } from "./store/sessions.ts";

const port = Number(process.env.PORT ?? 3000);

// Build the client-side highlights module to JS once at startup.
const highlightsBuild = await Bun.build({
  entrypoints: ["./src/client/highlights.ts"],
  target: "browser",
  format: "esm",
});
if (!highlightsBuild.success) {
  console.error("client build failed:");
  for (const log of highlightsBuild.logs) console.error(log);
  process.exit(1);
}
const [highlightsOutput] = highlightsBuild.outputs;
if (!highlightsOutput) {
  console.error("client build produced no outputs");
  process.exit(1);
}
const highlightsJS = await highlightsOutput.text();

// Default seed used until a future epic lets callers specify one on create.
const DEFAULT_SEED = "demo";

// `/tmp` on Fly is ephemeral per-machine, which matches the `immediate`
// deploy strategy — every deploy lands on a freshly booted VM with no
// prior DB. Inside a single VM's lifetime the file persists, so a process
// restart (Bun crash, hot reload locally) recovers sessions.
const SQLITE_PATH = process.env.LARGEDIFF_DB_PATH ?? "/tmp/largediff.db";

// Hard cap on live sessions. `GET /` mints one per hit, so every crawler,
// prefetch, and curl loop creates sessions at line rate — unbounded, an
// attacker holds millions (each one a map entry, a sqlite row, and a
// rewrite on every command). 10k bounds the worst case to trivial memory
// while the 30-min idle sweep frees slots far faster than any organic
// audience fills them. Reject with 503 rather than LRU-evict: eviction
// would let a flood silently kill live readers' sessions.
const MAX_LIVE_SESSIONS = 10_000;

const writers = new WriterRegistry();
const sessions: SessionStore = new SqliteSessionStore({
  path: SQLITE_PATH,
  // Both hooks close the loop between the store and the per-session side
  // state this module keeps:
  //  - onEvict drops the coalesce/throttle map entries and the SSE writer,
  //    which otherwise leaked two map entries per session for the life of
  //    the process (nothing else ever deleted them).
  //  - isPinned exempts sessions with a live SSE stream from the idle
  //    sweep. A reader who jumps somewhere and then just reads issues no
  //    commands, so only the pin keeps the session from being deleted
  //    under the open tab (the next command would 410 a live page).
  onEvict: (sid) => evictSessionSideState(sid),
  isPinned: (sid) => writers.has(sid),
});
// Usage + performance telemetry, emitted to stdout only — no route exposes
// it (see src/server/metrics.ts for why that constraint is load-bearing).
const metrics = metricsFromEnv({
  gauges: () => ({ sessions_live: sessions.size }),
});
metrics.start();

// Per-IP rate limits (see src/server/ratelimit.ts for the threat model).
// Creation is tight: each mint is cheap but the 10k session cap is shared.
// Commands are generous: a fling posts /view every ~40ms per tab, and NATs
// share one bucket across many users.
const trustProxy = process.env.LARGEDIFF_TRUST_PROXY !== "0";
const limiter = new IpRateLimiter(
  parseBucketSpec(process.env.LARGEDIFF_RATE_LIMIT_CREATE, { burst: 60, perSecond: 1 }),
  parseBucketSpec(process.env.LARGEDIFF_RATE_LIMIT_COMMANDS, { burst: 150, perSecond: 60 }),
);
limiter.start();

const engine = createDiffEngine({
  defaultLines: 200_000,
  // Skip the instrument entirely when metrics are off so the engine's
  // per-call `performance.now()` reads vanish along with the counters.
  ...(metrics.enabled
    ? {
        instrument: {
          fileHit: () => metrics.engineFileHit(),
          fileMiss: () => metrics.engineFileMiss(),
          tokensHit: () => metrics.engineTokensHit(),
          tokensMiss: (ms: number) => metrics.engineTokensMiss(ms),
          seedGenerate: (ms: number) => metrics.engineSeedGenerate(ms),
          seedEvict: () => metrics.engineSeedEvict(),
        },
      }
    : {}),
});
const projectionDeps: ProjectionDeps = { writers, engine, metrics };

// Drop everything this module holds for a session that has left the store.
// Called by the store's onEvict hook (sweep + DELETE route).
function evictSessionSideState(sid: SessionId): void {
  dropViewPushState(sid);
  // Flush the live writer's byte counters into the metrics BEFORE the
  // registry closes it — after detach the totals are unreachable and the
  // session-end line would under-report bytes served.
  const writer = writers.get(sid);
  if (writer !== undefined) metrics.streamDetached(writer);
  writers.detach(sid);
  metrics.sessionEnded(sid);
}

// 503 when the session table is full — see MAX_LIVE_SESSIONS.
function overCapacity(): Response {
  metrics.sessionRejected();
  return new Response("Too many live sessions, try again shortly", {
    status: 503,
    headers: { "retry-after": "60" },
  });
}

// 410 for command POSTs that target a stale session: the page that
// issued them was already loaded, the user can reload to get a fresh
// session. For page-load GETs we redirect to `/` instead so users who
// land on a URL whose session was swept (or wiped by a deploy) get a
// usable view automatically — see the `/sessions/:sid` GET route.
function gone(): Response {
  metrics.gone();
  return new Response("Session not found", { status: 410 });
}

function requestIp(req: Request): string {
  // `server` is assigned before the first request arrives; this closure only
  // runs per request, so the forward reference never touches the TDZ.
  return clientIp(
    req.headers.get("x-forwarded-for"),
    server.requestIP(req)?.address ?? null,
    trustProxy,
  );
}

// 429 for a request over its per-IP budget. Callers check this before any
// session state is touched so a flood is rejected at constant cost.
function limitCreate(req: Request): Response | null {
  return overLimit(limiter.takeCreate(requestIp(req)));
}

function limitCommand(req: Request): Response | null {
  return overLimit(limiter.takeCommand(requestIp(req)));
}

function overLimit(retryAfterSec: number): Response | null {
  if (retryAfterSec <= 0) return null;
  metrics.count("rate_limited");
  return new Response("Rate limited, try again shortly", {
    status: 429,
    headers: { "retry-after": String(retryAfterSec) },
  });
}

async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function doJump(session: ReviewSession, fid: string | undefined): Response {
  if (fid === undefined || fid === "") {
    pushProjection(session, projectionDeps);
    return new Response(null, { status: 204 });
  }
  const meta = engine.meta(session.seed);
  const idx = meta.files.findIndex((f) => f.id === fid);
  if (idx < 0) {
    // Unknown id: no-op WITHOUT a render. A junk fid used to cost a full
    // window render + encode here, so any anonymous POST could burn ~10ms
    // of server CPU per request for free.
    metrics.count("jump_unknown_fid");
    return new Response(null, { status: 204 });
  }
  // Server's scrollTop = file's chrome pixel (row's top + the 32px transparent
  // padding above .file-card-header). The data-anchor is stamped on the
  // chrome element itself (inside the row, after the padding), so the
  // client's `scrollIntoView({block:'start'})` lands scrollTop at the same
  // value. Both ends agree, and the sticky bar visually covers the in-
  // window chrome at this scrollTop (z-index 10 over the row beneath).
  const px = engine.layout(session.seed).pixelTopForFile(idx) + FILE_HEADER_GAP_PX;
  session.view.scrollTop = px;
  // Bump the nav-epoch. Any /view in flight from a prior jump's settling
  // scroll will carry a smaller epoch and `applyView` will drop it before
  // it can overwrite `session.view.scrollTop` with the stale pre-jump
  // position. Single counter, single comparison, no wall-clock.
  session.view.navEpoch += 1;
  // Explicit navigation hands the sidebar back to the server: whatever the
  // user had scrolled the file list to, they've now asked to go somewhere,
  // so the list should follow. Cleared here and set again by the next
  // /sidebar POST that carries a real scrollTop. See largediff-2ht5.
  session.view.sidebarUserScrolled = false;
  // Park the jump target on the session itself. `pushProjection` reads from
  // here and clears the field after emitting. If the writer isn't attached
  // yet (the user clicked before the SSE stream finished connecting), the
  // first call is a silent no-op and the field stays set — `onAttached`'s
  // initial push will then pick it up. No "click twice" race.
  session.view.pendingAnchorFileId = fid;
  // /jump pushes immediately AND cancels any pending coalesced view push,
  // so the user's click response never queues behind scroll-driven /view
  // pushes that haven't fired yet.
  cancelPendingViewPush(session.id);
  sessions.persist(session.id);
  pushProjection(session, projectionDeps);
  beginCoalesce(session.id);
  return new Response(null, { status: 204 });
}

async function handleCommand(
  req: Request,
  sid: SessionId,
  kind: CommandKind,
  apply: (session: ReviewSession, body: unknown) => void,
): Promise<Response> {
  const session = sessions.get(sid);
  if (session === undefined) return gone();
  const limited = limitCommand(req);
  if (limited) return limited;
  metrics.commandReceived(sid, kind);
  // POST received → projection write completed. This is the latency a user
  // actually feels on a click, and it is per-command-type because a slow
  // /jump and a slow /settings point at different code.
  const t0 = performance.now();
  const body = await parseBody(req);
  apply(session, body);
  cancelPendingViewPush(sid);
  sessions.persist(sid);
  pushProjection(session, projectionDeps);
  beginCoalesce(sid);
  metrics.commandLatency(kind, performance.now() - t0);
  return new Response(null, { status: 204 });
}

async function handleViewCommand(req: Request, sid: SessionId): Promise<Response> {
  const session = sessions.get(sid);
  if (session === undefined) return gone();
  const limited = limitCommand(req);
  if (limited) return limited;
  metrics.commandReceived(sid, "view");
  const t0 = performance.now();
  const body = await parseBody(req);
  // Apply `height` BEFORE the echo-drop: a resize racing a jump produces a
  // /view whose scrollTop echoes within tolerance but whose height is
  // genuinely new, and returning early on the echo alone swallowed the
  // resize entirely (the window stayed sliced for the old viewport). When
  // the height did change, skip the drop — the state changed, so a push is
  // warranted (it still lands on the coalesced trailing edge).
  const heightChanged = applyViewHeight(session, body);
  // Drop the scroll our own jump provoked, before it can become a push.
  if (!heightChanged && isEchoScroll(session, body)) {
    metrics.count("view_echo_dropped");
    return new Response(null, { status: 204 });
  }
  applyView(session, body);
  // Clamp to the document extent — `layout` is memoized per seed so this is
  // a lookup, and it stops a forged scrollTop from parking the session
  // billions of pixels past the end of the diff.
  const totalHeight = engine.layout(session.seed).totalHeight;
  if (session.view.scrollTop > totalHeight) session.view.scrollTop = totalHeight;
  sessions.persist(sid);
  scheduleViewPush(session, (s) => pushProjection(s, projectionDeps), metrics);
  // For a deferred /view the projection lands later on the trailing timer;
  // this histogram then measures apply+persist+schedule only. The
  // leading/deferred split in the coalesce counters says which was which.
  metrics.commandLatency("view", performance.now() - t0);
  return new Response(null, { status: 204 });
}

const server = Bun.serve({
  port,
  // SSE streams stay open for the life of the session — disable Bun's 10s
  // request idle timeout (`0` means "no timeout").
  idleTimeout: 0,
  // Every legitimate body here is a small JSON command patch, well under
  // 1KB. Bun's default is 128MB, which let a loop of oversized POSTs chew
  // server CPU on body parsing for free. 16KB leaves generous headroom.
  maxRequestBodySize: 16 * 1024,
  routes: {
    "/": (req) => {
      const limited = limitCreate(req);
      if (limited) return limited;
      if (sessions.size >= MAX_LIVE_SESSIONS) return overCapacity();
      const session = sessions.create(DEFAULT_SEED);
      metrics.sessionCreated(session.id);
      return Response.redirect(`/sessions/${session.id}`, 302);
    },

    "/sessions": {
      POST: (req) => {
        const limited = limitCreate(req);
        if (limited) return limited;
        if (sessions.size >= MAX_LIVE_SESSIONS) return overCapacity();
        const session = sessions.create(DEFAULT_SEED);
        metrics.sessionCreated(session.id);
        return Response.json({ id: session.id }, { status: 201 });
      },
    },

    "/sessions/:sid": {
      GET: (req) => {
        const sid = req.params.sid;
        const session = sessions.get(sid);
        // Stale URL (session swept, DB wiped by a deploy, etc.) — send the
        // user back to `/` which mints a fresh one. Cheaper than a 410 the
        // user has to interpret, and the bookmark stays usable.
        if (session === undefined) return Response.redirect("/", 302);
        // Full initial paint is the most expensive GET here (~20ms + cold
        // tokenize), so page loads draw from the command budget — creation
        // limiting alone wouldn't slow a crawler that follows its redirects.
        const limited = limitCommand(req);
        if (limited) return limited;
        // `?hl=spans|ranges` selects the syntax-highlight delivery mode for
        // the session and sticks. Lets a reader (or a measurement agent)
        // A/B the CSS Custom Highlight API against per-token spans on the
        // same seed without touching the settings UI. Anything else is
        // ignored — the session keeps its current mode.
        const hl = new URL(req.url).searchParams.get("hl");
        if (hl === "spans" || hl === "ranges") session.settings.highlight = hl;
        const layout = engine.layout(session.seed);
        const meta = engine.meta(session.seed);
        const initial = renderInitialPaint(session, projectionDeps);
        // Seed `lastFingerprint` so the SSE attach-time push skips when
        // the rendered state already matches the HTML we just served.
        // Without this, every fresh load + reload paid a redundant
        // ~200 KB raw morph that re-emitted what was already on the
        // page (Idiomorph no-op'd visually but the bytes still flowed,
        // showing up as a phantom "saved 195 KB" in the topbar chip
        // before any user interaction).
        session.view.lastFingerprint = paintFingerprint(session, initial);
        // Also seed `lastSentNavEpoch`. The HTML's `data-signals`
        // includes the current navEpoch, so the client already knows
        // it — re-emitting it via a cmd element on the attach push
        // would just force the morph to fire and re-stamp the same
        // value. The seed pairs with the fingerprint seed to make
        // the attach push truly skippable when nothing has changed.
        session.view.lastSentNavEpoch = session.view.navEpoch;
        const trace = new URL(req.url).searchParams.get("trace") === "1";
        return new Response(renderShell(sid, layout.totalHeight, meta.files, initial, trace), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // iOS Safari has been observed serving cached HTML from a
            // previous deploy even when the URL is fresh — the old click
            // handlers persist and hit the legacy /jump route, where the
            // iOS-specific signal-snapshot-timing bug shows up as an
            // off-by-one navigation. Forcing a re-fetch each load keeps
            // users on the current click-handler shape.
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      },
      DELETE: (req) => {
        const sid = req.params.sid;
        if (sessions.get(sid) === undefined) return gone();
        // The store's onEvict hook detaches the writer and drops the
        // coalesce/throttle entries — same path the idle sweep takes.
        sessions.delete(sid);
        return new Response(null, { status: 204 });
      },
    },

    "/sessions/:sid/stream": {
      GET: (req) => {
        const sid = req.params.sid;
        // Count the attach before doing the work: the initial push renders
        // a full window, so a reconnect loop would otherwise render for free.
        const limited = limitCommand(req);
        if (limited) return limited;
        const response = attachStream({
          sid,
          request: req,
          sessions,
          writers,
          metrics,
          onAttached: () => {
            const session = sessions.get(sid);
            if (session === undefined) return;
            // The fingerprints track what the *previous* writer was last
            // shown. A new SSE attach (Datastar reconnect after a network
            // blip, page reload, second tab, etc.) means the client's DOM
            // state is unknown — pushProjection's skip-when-unchanged
            // would silently emit zero events on the new connection and
            // the page would stay blank. Clear them so the first push
            // for this writer always emits a full slice.
            // Don't clear `lastFingerprint` here: the GET
            // `/sessions/:sid` handler seeded it to match what was
            // just rendered into the HTML, so the attach push's
            // `pushProjection` correctly skips when nothing has
            // changed. Clearing would re-emit a ~200 KB-raw
            // no-op morph on every fresh page load.
            //
            // For reconnect (network blip, no page reload) the
            // fingerprint reflects whatever was last morphed to the
            // client. If session state shifted during the blip, the
            // fingerprint differs and the push fires; if not, the
            // skip is correct.
            //
            // No scroll-restore needed — the initial HTML inlines a
            // `<script>` that sets `#scroller.scrollTop` and
            // `.file-list.scrollTop` to the saved values
            // synchronously before first paint. `/top`, `/jump`, and
            // any other server-initiated scrolls still use
            // `pendingInitialScrollTop` / `pendingSidebarJumpToPx`.
            pushProjection(session, projectionDeps);
          },
        });
        return response ?? gone();
      },
    },

    "/sessions/:sid/view": {
      POST: (req) => handleViewCommand(req, req.params.sid),
    },
    "/sessions/:sid/sidebar": {
      POST: (req) => handleCommand(req, req.params.sid, "sidebar", applySidebarView),
    },
    "/sessions/:sid/top": {
      POST: (req) => {
        const sid = req.params.sid;
        const session = sessions.get(sid);
        if (session === undefined) return gone();
        const limited = limitCommand(req);
        if (limited) return limited;
        metrics.commandReceived(sid, "top");
        const t0 = performance.now();
        applyTop(session);
        cancelPendingViewPush(sid);
        sessions.persist(sid);
        pushProjection(session, projectionDeps);
        metrics.commandLatency("top", performance.now() - t0);
        return new Response(null, { status: 204 });
      },
    },
    // Navigation lives at a single URL-addressable route. The file id is in
    // the path, not the body — clicks become pure hypermedia: `POST this
    // resource` and the server interprets it as "make this file the active
    // one". No signal-state coupling, no body parsing.
    "/sessions/:sid/files/:fid/jump": {
      POST: (req) => {
        const sid = req.params.sid;
        const session = sessions.get(sid);
        if (session === undefined) return gone();
        const limited = limitCommand(req);
        if (limited) return limited;
        metrics.commandReceived(sid, "jump");
        const t0 = performance.now();
        const res = doJump(session, req.params.fid);
        metrics.commandLatency("jump", performance.now() - t0);
        return res;
      },
    },
    // Server opt-in half of the WebKit flush poke. Deliberately does NOT
    // run a projection: a poke exists to put a few bytes on the wire so
    // WebKit releases a stranded fragment, and pushing a real morph would
    // be another event — the very thing that causes the stranding.
    //
    // Cheap enough to be called after every applied patch. See
    // largediff-pkrf and src/client/poke.ts.
    "/sessions/:sid/poke": {
      POST: (req) => {
        const session = sessions.get(req.params.sid);
        if (session === undefined) return gone();
        const limited = limitCommand(req);
        if (limited) return limited;
        metrics.commandReceived(req.params.sid, "poke");
        const writer = writers.get(req.params.sid);
        writer?.sendComment?.(".");
        if (process.env.LARGEDIFF_PUSH_LOG === "1") {
          console.log(
            `[poke] sid=${req.params.sid} t=${Date.now()} writer=${writer !== undefined}`,
          );
        }
        return new Response(null, { status: 204 });
      },
    },
    "/sessions/:sid/settings": {
      POST: (req) => handleCommand(req, req.params.sid, "settings", applySettings),
    },
    "/sessions/:sid/files/:fid/prewarm": {
      POST: (req) => {
        const sid = req.params.sid;
        const session = sessions.get(sid);
        if (session === undefined) return gone();
        const limited = limitCommand(req);
        if (limited) return limited;
        metrics.commandReceived(sid, "prewarm");
        // Unknown ids no-op rather than reach `engine.file`, which throws —
        // in dev mode that surfaced a stack-trace error page (absolute
        // paths included) to any anonymous POST with a junk fid.
        const fid = req.params.fid;
        if (!engine.meta(session.seed).files.some((f) => f.id === fid)) {
          return new Response(null, { status: 204 });
        }
        // Calling these is idempotent — both are memoized per (seed, fileId)
        // in the engine, so the second hover does nothing on the server. No
        // projection push: the user hasn't actually navigated.
        const f = engine.file(session.seed, fid);
        engine.tokens(session.seed, fid, f);
        return new Response(null, { status: 204 });
      },
    },

    "/doc": () =>
      new Response(renderDoc(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      }),

    "/favicon.ico": () => new Response(null, { status: 204 }),

    // Every crawler, prefetcher, and uptime probe mints a review session via
    // GET / — unbounded, at line rate. There is no SEO value in a demo whose
    // pages are per-visit sessions, so disallow everything. (Determined
    // abuse still hits the per-IP creation bucket.)
    "/robots.txt": () =>
      new Response("User-agent: *\nDisallow: /\n", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "max-age=86400",
          "x-content-type-options": "nosniff",
        },
      }),

    // `no-store` because the asset filenames aren't versioned — without it
    // browsers happily serve a stale CSS/JS from a previous deploy and the
    // user keeps seeing fixed bugs (the drawer animation glitch and the
    // jump-blank stutter both reappeared in testing because of this). The
    // bytes are tiny (~24 KB total) so the wire cost is negligible.
    "/static/styles.css": () =>
      new Response(Bun.file("src/client/styles.css"), {
        headers: {
          "content-type": "text/css; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      }),

    "/static/highlights.js": () =>
      new Response(highlightsJS, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      }),

    // Vendored font files for the /doc brief (both OFL-licensed: IBM Plex
    // Mono for body/code, Silkscreen for display). Allow-listed by exact
    // filename — `:file` straight into Bun.file would be a path traversal.
    // Filenames pin the upstream version (v20/v6), so immutable caching is
    // honest: a new upstream version arrives under a new name.
    "/static/fonts/:file": (req) => {
      const file = req.params.file;
      if (
        file === undefined ||
        (file !== "v20-ibm-plex-mono-400-latin.woff2" &&
          file !== "v20-ibm-plex-mono-500-latin.woff2" &&
          file !== "v6-silkscreen-400-latin.woff2")
      ) {
        return new Response("not found", { status: 404 });
      }
      return new Response(Bun.file(`vendor/fonts/${file}`), {
        headers: {
          "content-type": "font/woff2",
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    },

    // Vendored Datastar bundle (vendor/datastar-1.0.3.js) — was a jsdelivr
    // CDN pin; serving it from here removes the supply-chain
    // script-injection lever entirely. Same no-store + BUILD_ID treatment
    // as the other static assets.
    "/static/datastar.js": () =>
      new Response(Bun.file("vendor/datastar-1.0.3.js"), {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      }),
  },
  // Dev conveniences (HMR, in-browser console mirroring, detailed error
  // pages) must not ship: the error pages include stack frames with
  // absolute server paths, reachable by any request that trips a throw.
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
});

console.log(`largediff: http://localhost:${server.port}/`);
