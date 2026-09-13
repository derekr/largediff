---
# largediff-k49f
title: Pre-open-source review fixes across the largediff app
status: completed
type: task
priority: high
created_at: 2026-08-27T21:11:42Z
updated_at: 2026-08-27T21:11:43Z
---

Four independent reviews covering the 13,526 lines the earlier sse-lab review
never touched, then a fix pass. Findings verified before fixing, and fixes
verified after.

- [x] Three anonymous-visitor DoS holes
- [x] Unauthenticated debug surface removed entirely
- [x] Dev mode gated on NODE_ENV
- [x] README/CLAUDE.md architecture claims corrected
- [x] Dead docs, code and directories deleted
- [x] LICENSE added

## Summary of Changes

**Security.** Three holes, each reproduced before and after:

- Viewport height was clamped only at zero. Measured against a live stream:
  height=800 gave 810KB, height=2,000,000 gave **103MB and 0.8s server CPU
  from one anonymous POST**, with nothing stopping 1e9. Now `MAX_VIEWPORT_PX
  = 4096`; re-measured at 607KB flat for 800, 2e6 and 1e9 alike.
- `POST /sessions/<sid>/files/<junk>/collapse` returned 204 and inserted any
  string into `perFile`, which was re-serialized to sqlite on every command:
  40 junk ids produced an 83,911-byte blob. Nothing ever read `perFile`, so
  the routes, the state and the column are gone.
- `/log` accepted arbitrary unauthenticated writes to `/tmp` — where the
  session DB lives — with no body cap under Bun's 128MB default. Deleted,
  along with the client-side console monkey-patch that forwarded every
  visitor's console output to it. Bodies now cap at 16KB.

Also: `development` was hardcoded on, so an unknown fileId on `/prewarm`
surfaced a dev 500 with stack frames and absolute paths. Now `NODE_ENV`-gated,
and `/prewarm` validates the id. The seven `/sse-lab/*` routes are gone from
the app server; the lab is deployed standalone and keeps them.

**The README described software that does not exist.** Both headline
architecture claims were false — "Tree-sitter on the backend via
`web-tree-sitter` WASM" (the tokenizer says "intentionally regex-based", and
the package was imported nowhere) and "CSS Custom Highlight API — no per-token
spans" (the exact approach the design principles document abandoning).
Rewritten, along with CLAUDE.md, and the same stale claims chased out of
comments in five source files so the mismatch cannot regrow.

**A comment that was wrong and would have caused a bad fix.**
`sidebar.ts` justified its `"\n"` row join with "Safari drops monolithic
`data:` lines over a few KB", while `files.ts` shipped 78,685-byte single data
lines. Tested in Safari: one 250KB data line per event delivered 6/6, nothing
missing, 746ms median. The claim is false and the join is not load-bearing —
`pushProjection` splits the morph on newlines either way. Comment corrected;
no behaviour changed. Left as-is, someone would eventually have "fixed" the
working path to satisfy it.

**Deleted as dead:** `WEBKIT-SSE-REPORT.md`/`.html` (superseded theory that
contradicted the current bug description on compression-necessity, CFNetwork
attribution and EventSource), `WEBKIT-BUG-DRAFT.txt` (duplicate),
`performance.md` (profiles removed code and a deleted file), `Dockerfile`,
`fly.toml`, `.dockerignore`, the `.tldraw` scratch file, the empty `wasm/`
directory, `src/store/schema.sql`, `applySidebarRecenter`, and
`InMemoryDiffStore`/`LruCache`/`DiffStore` with their tests — no production
consumer, only tests referenced them. Memoization coverage was preserved
against the real engine rather than deleted with them.

**Correctness:** LRU cap on the per-seed engine cache; `escapeHtml` on the
`sid` sinks plus a `data-signals` attribute robust to string values; a session
cap with 503; `coalesceUntil`/`viewPushState` cleaned up on eviction; sessions
with a live stream exempt from the idle sweep; an orphaned 300ms scroll timer
cleared; and two measurement-validity bugs in `measure.ts` where an empty
frame-gap array produced `-Infinity` (serialising to `null`) and an
all-timeout run reported `medianMorphMs: 0` — a plausible "spectacularly fast"
number for a run that measured nothing.

**Packaging:** MIT LICENSE, `license` field, `private` dropped, and two unused
dependencies removed. Stream logging flipped to opt-in `LARGEDIFF_STREAM_LOG=1`.

## Verification

`bun run check` clean, 147 tests pass. Live in production mode: `/log`,
`/sse-lab`, `/collapse` all 404; a 20KB body 413s; a junk-fid prewarm 204s
with no stack leak; height 1e9 streams the same 607KB as height 800.

## Notes

DEPLOY.md was rewritten to strip the ops detail, but the original is still in
git history — publication must be from a fresh repo, as with sse-lab.
