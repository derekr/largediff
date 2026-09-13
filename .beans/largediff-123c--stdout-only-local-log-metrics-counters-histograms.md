---
# largediff-123c
title: Stdout-only local-log metrics (counters, histograms, per-session usage)
status: completed
type: feature
priority: normal
created_at: 2026-09-12T05:47:53Z
updated_at: 2026-09-12T05:47:53Z
---

Stdout-only usage + performance telemetry for the deployed box, which was
previously running blind. Created post-hoc to track work already done: the
metrics change set predates this bean.

- [x] `src/server/metrics.ts`: registry — counters, per-command counts,
  48-bucket histograms ({n,p50,p90,p99,max}), per-session usage records,
  per-encoding wire bytes, 60s `[metrics]` JSON rollup + budgeted
  per-session-end lines. No HTTP endpoint, fixed-cadence unref'd timer.
- [x] Wiring: per-kind command counts + latencies (server.ts), push phase
  clocks + shape (projection.ts, incl. `rowsRendered` on InitialPaint),
  stream attach/detach + wire accounting (stream.ts), diff-engine cache
  hit rates + tokenize/seed timings (generator.ts)
- [x] `src/server/metrics.test.ts` (283 lines); README env-var docs
- [x] Verified live: all 7 command kinds counted, push/engine/sse/wire
  sections populated, wire bytes match observed stream bytes exactly,
  session-end line on DELETE, `LARGEDIFF_METRICS=0` fully silent

## Summary of Changes
- New: `src/server/metrics.ts`, `src/server/metrics.test.ts`
- Instrumented (all optional/no-op when disabled): `src/server.ts`,
  `src/session/projection.ts`, `src/session/stream.ts`,
  `src/diff/generator.ts`, `src/render/shell.test.ts` (fixture)
- Docs: README env-var table + journalctl recipe
- Runtime-verified against a scratch server before landing
