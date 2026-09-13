# largediff

A Datastar-driven recreation of GitHub's PR "Files changed" view, built to
stay smooth on synthetic diffs of hundreds of thousands of lines across five
languages (TypeScript, Python, Go, Rust, JSON). The browser holds almost no
state and no parsers; everything heavy — diff synthesis, tokenization,
windowing, rendering — happens on the server and arrives as HTML patches over
a long-lived SSE stream.

## Run

Requires Bun 1.x (developed against 1.3).

```
bun install
bun run dev
```

Open <http://localhost:3000/>. Each visit to `/` mints a review session and
redirects to `/sessions/:sid`. An architecture brief is served at `/doc`.

Checks and tests:

```
bun run check      # Biome (fmt + lint, no writes) + tsc --noEmit
bun run typecheck  # tsc --noEmit only
bun run fmt        # Biome auto-fix (writes)
bun test
```

## Architecture

- **CQRS over one stream.** The browser opens a long-lived SSE stream per
  session (`GET /sessions/:sid/stream`). Every mutation is a plain POST that
  returns 204; the real payload — element morphs plus signal patches — flows
  down the open stream. `pushProjection(session)` is the single function that
  produces that payload; commands mutate state and call it.
- **Server-driven viewport windowing.** The client reports scroll position;
  the server slices the row offset table for the visible window (plus
  overscan) and morphs the whole window into the DOM. Fat morphs are fine:
  the per-session brotli encoder stays warm across pushes, so repeated row
  structure compresses to near-zero incremental bytes.
- **Server-rendered per-token spans.** Each line arrives as
  `<div class="row line">…<span class="kw">const</span>…</div>`, with token
  spans emitted by a regex-based per-language tokenizer on the server
  (`src/highlight/tokenize.ts` — intentionally regex, behind a contract that
  a real parser could fill later). CSS class rules do the colouring. The CSS
  Custom Highlight API was tried first and abandoned: WebKit repaints every
  intersecting node per range with no batching, stalling Safari's paint
  pipeline 100–300 ms per jump on a 1500-range payload. The ranges path is
  kept only as an A/B mode (`?hl=ranges`).
- **Sessions are tiny; diffs are shared.** Per-session state is a few bytes
  (scroll position, settings), persisted in SQLite so restarts recover
  sessions. The synthetic diff and its token caches are content-addressed by
  `(seed, fileId)` and shared across every session on the same seed.

### Start here

New to the codebase? Read in this order — it follows one scroll event
through the system:

1. `/doc` (the architecture brief, served by the app) for the pattern
   vocabulary: projection, command, window, warm stream.
2. `src/server.ts` — the route table: every URL the browser can touch.
3. `src/session/stream.ts` — the long-lived SSE stream those pushes ride on.
4. `src/session/projection.ts` — `pushProjection`, the single function that
   turns state into wire bytes.
5. `src/diff/layout.ts` — the flat pixel-offset table that makes windowing
   O(1) instead of a tree walk.
6. `src/session/commands.ts` + `src/session/viewpush.ts` — what a scroll
   POST validates, and how the throttle turns a fling into a steady
   cadence of pushes.

### The pattern vs the demo

Roughly 1,700 lines carry the two ideas this repo exists to show
(hypermedia + windowing); everything else is demo scaffolding or
production plumbing. The seams are interfaces, so you can read the
pattern without the scaffolding:

**The pattern — read these, in this order:**

| Code | Pattern role |
| --- | --- |
| `src/session/projection.ts` | `pushProjection` — state → wire bytes, the one read-side function |
| `src/server.ts` (route table) | URL-addressable commands, every POST → 204 |
| `src/session/stream.ts` | the long-lived SSE stream payloads ride on |
| `src/session/commands.ts` | validated command mutations |
| `src/session/viewpush.ts` | scroll→push cadence: throttle, coalesce, echo-drop |
| `src/render/files.tsx` | the window slice rendered as components (`<FileSection>`, `<Row>`, `<TokenLine>`) |
| `src/diff/layout.ts` | the flat pixel table that makes slicing O(1) |
| client Datastar attributes in `render/shell.tsx` | the read-side contract: signals in, one morph out |

**Scaffolding — ignore on first read, swap freely:**

- `src/diff/{generator,snippets,rng}.ts` — synthetic diff generator. The
  app only touches it through `DiffSynthesizer` (`meta`/`file`/`tokens`,
  `src/store/diff.ts`) plus `layout()`. Point those four methods at a
  real backend and the pattern is unchanged.
- `src/highlight/tokenize.ts` — intentionally-regex tokenizer behind the
  same `tokens()` contract.
- `src/server/{compress,metrics,ratelimit}.ts` — production concerns
  (SSE compression, stdout telemetry, rate limits), none of it
  pattern-relevant.
- `src/client/{measure,ranges,poke}.ts` + `scripts/render-parity.ts` —
  measurement apparatus for the A/B modes and render parity.

The one thing that can't be abstracted away is the *interplay* — the
throttle→push→slice loop spans those four session/render files, which is
why it's presented as a unit rather than a module.

### Numbers (prod, 200k-line diff, real TLS + proxy path)

Full run: [`benchmarks/2026-09-prod-baseline.md`](benchmarks/2026-09-prod-baseline.md).

| | Chrome 153 | Safari 26.6 | STP 27 |
| --- | --- | --- | --- |
| first paint | 378 ms | — | — |
| click → morph | 88 ms | — | — |
| jump median | 120–164 ms | 131–136 ms | 125–143 ms |
| worst frame gap | 50–67 ms | — | 65–74 ms |
| late morphs / 12 | 0 | 1 (spans) · 4 (ranges) | 0 · 0 |
| scroll fling (60px/frame) | 100% covered, 0 px lag | — | — |
| wire, 12 jumps | 223 KB vs 3.93 MB | 223 KB | 223 KB |

Jump latency is a property of the path (wire + server + proxy — every
engine lands together); delivery is a property of the engine; and the
CSS Custom Highlight ranges mode stalls WebKit's paint 11× (862–873 ms
frame gaps in STP) — which is why spans is the default.

## SSE delivery lab

The standalone SSE-delivery harness — built to isolate a WebKit regression
in which a streaming `fetch()` body is withheld from the reader until the
next network chunk arrives — now lives next door in `../sselab`:
entrypoint, harness, EventSource transport plugin, WebKit bug report, and
notebook included.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `3000` | Listen port (app server and lab server). |
| `LARGEDIFF_DB_PATH` | `/tmp/largediff.db` | SQLite file for session persistence. Point it somewhere durable in production. |
| `LARGEDIFF_MAX_ENCODING` | `br` | Ceiling for negotiated SSE encoding: `identity`, `gzip`, `zstd`, or `br`. Exists because `Accept-Encoding` is a forbidden header — encoding can only be varied server-side. |
| `LARGEDIFF_SSE_PAD_BYTES` | `65536` | Incompressible SSE comment padding appended per push, a mitigation for WebKit's stranded-fetch-body bug. `0` disables. |
| `LARGEDIFF_PUSH_LOG` | off | `1` logs every projection emit/skip decision per push. |
| `LARGEDIFF_STREAM_LOG` | off | `1` logs one line per SSE stream attach/detach/abort — flip on when investigating lost pushes. |
| `LARGEDIFF_METRICS` | on | `0` disables the local-log metrics (periodic `[metrics]` rollup + per-session summary lines on stdout). |
| `LARGEDIFF_METRICS_INTERVAL_MS` | `60000` | Rollup cadence, clamped to 1s–1h. Fields under `interval` are per-interval deltas; `gauges` are instantaneous. |
| `LARGEDIFF_TRUST_PROXY` | `1` | Trust the leftmost `X-Forwarded-For` entry as the client IP for rate limiting. The app requires a TLS-terminating proxy; set `0` if the process is ever directly reachable (a direct client can spoof XFF into a fresh bucket per request). |
| `LARGEDIFF_RATE_LIMIT_CREATE` | `60/1` | Session-creation budget as `burst/per-second` per IP. |
| `LARGEDIFF_RATE_LIMIT_COMMANDS` | `150/60` | Command + page + stream-attach budget as `burst/per-second` per IP. Generous on purpose — NATs share one bucket. Over-budget requests get 429 + `retry-after` and are counted as `rate_limited` in the metrics. |
| `NODE_ENV` | — | `production` disables Bun's development mode (HMR, browser console echo). |

Metrics land on stdout only (no HTTP endpoint); under systemd read them with
`journalctl -u largediff | grep '\[metrics\]' | jq`.

## Demo query flags

On a session URL (`/sessions/:sid?…`):

- `?hl=spans|ranges` — select the syntax-highlight delivery mode for the
  session (per-token spans, the default, vs CSS Custom Highlight ranges).
  A third mode built on microlighter was measured (same wall, plus a tab
  deadlock in STP 27) and parked in `../css-highlight-lab`.
- `?trace=1` — install a pass-through tap on the SSE reader; exposes
  `window.__trace` (per-event arrival times, byte counts, errors).
- `?poke=on` — enable the WebKit flush poke: a tiny POST after each applied
  patch that provokes the server into writing a few bytes, releasing any
  stranded fragment. Off by default on every engine — the SSE padding
  mitigation measured at least as well in the app — but kept for A/B runs.
- `?selftest=1&jumps=N` — self-driving drop test: the page jumps through N
  files, records whether each morph actually applied, and reports its own
  visibility. Exists because Safari marks automation windows hidden and
  throttles them, so only a self-driving visible page measures what users see.
- `window.__ldMeasure({ jumps: 12 })` — scripted jump benchmark returning a
  JSON report over a fixed file sequence.

## Layout

```
src/
├── server.ts         entry: Bun.serve route table
├── server/           SSE writer + per-session compression
├── session/          ReviewSession model, commands, projection, stream attach,
│                    view-push throttle (scroll fling → push cadence)
├── diff/             seeded synthetic diff generator, snippet bank, row layout
├── highlight/        regex-based per-language tokenizer
├── render/           HTML builders: shell, file windows, sidebar, /doc page
├── store/            DiffStore (shared, content-addressed) + SessionStore (SQLite)
└── client/           browser modules: highlights, sidebar, poke, measure, styles
vendor/               datastar bundle + OFL fonts — no CDN anywhere
.beans/               issue tracker (beans CLI); the engineering notes live here
.claude/              project-shared Claude Code config + hooks
```

The `.beans/` files double as the project's lab notebook — the WebKit SSE
investigation (`largediff-pkrf`), the highlight-mode A/B (`largediff-lnhb`),
and the Safari-specific fixes are all written up there.

## License

MIT — see `LICENSE`.
