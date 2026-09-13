import { describe, expect, test } from "bun:test";
import { Histogram, Metrics, resolveMetricsEnv } from "./metrics.ts";

function makeMetrics(overrides: Partial<ConstructorParameters<typeof Metrics>[0]> = {}): {
  metrics: Metrics;
  lines: string[];
} {
  const lines: string[] = [];
  const metrics = new Metrics({
    enabled: true,
    intervalMs: 60_000,
    emit: (line) => lines.push(line),
    ...overrides,
  });
  return { metrics, lines };
}

interface RollupJson {
  kind: string;
  interval: {
    sessions: { created: number; ended: number; rejected_capacity: number };
    commands: Record<string, number>;
    push: { emit: number; skip_unchanged: number; no_writer: number };
    push_ms: Record<string, { n: number } | undefined>;
    push_shape: Record<string, { max: number } | undefined>;
    sse: { attach: number; detach: number };
    wire: Record<string, { in: number; out: number; ratio: number }>;
    session_lines_dropped: number;
  };
  gauges: Record<string, number>;
}

interface SessionJson {
  kind: string;
  sid: string;
  lifetime_s: number;
  commands: Record<string, number>;
  pushes: { emit: number; skip: number };
  wire: { encoding: string; in: number; out: number };
  streams: number;
}

function parseLine(line: string): unknown {
  expect(line.startsWith("[metrics] ")).toBe(true);
  expect(line).not.toInclude("\n");
  return JSON.parse(line.slice("[metrics] ".length));
}

function parseRollup(line: string): RollupJson {
  return parseLine(line) as RollupJson;
}

function parseSession(line: string): SessionJson {
  return parseLine(line) as SessionJson;
}

describe("resolveMetricsEnv", () => {
  test("defaults: enabled, 60s interval", () => {
    expect(resolveMetricsEnv({})).toEqual({ enabled: true, intervalMs: 60_000 });
  });

  test("LARGEDIFF_METRICS=0 disables", () => {
    expect(resolveMetricsEnv({ LARGEDIFF_METRICS: "0" }).enabled).toBe(false);
  });

  test("interval is clamped to [1s, 1h] and garbage falls back to default", () => {
    expect(resolveMetricsEnv({ LARGEDIFF_METRICS_INTERVAL_MS: "10" }).intervalMs).toBe(1_000);
    expect(resolveMetricsEnv({ LARGEDIFF_METRICS_INTERVAL_MS: "99999999" }).intervalMs).toBe(
      3_600_000,
    );
    expect(resolveMetricsEnv({ LARGEDIFF_METRICS_INTERVAL_MS: "5000" }).intervalMs).toBe(5_000);
    expect(resolveMetricsEnv({ LARGEDIFF_METRICS_INTERVAL_MS: "banana" }).intervalMs).toBe(60_000);
  });
});

describe("Histogram", () => {
  test("single observation reports itself exactly at every percentile", () => {
    const h = new Histogram(0.05);
    h.record(42);
    const s = h.snapshot();
    expect(s).toEqual({ n: 1, p50: 42, p90: 42, p99: 42, max: 42 });
  });

  test("percentiles land within one sqrt(2) bucket of the true value", () => {
    const h = new Histogram(0.05);
    for (let v = 1; v <= 1000; v++) h.record(v);
    const s = h.snapshot();
    if (s === undefined) throw new Error("expected snapshot");
    expect(s.n).toBe(1000);
    // Bucket upper-bound reporting: result is >= the true quantile and at
    // most one bucket ratio (sqrt 2) above it, clamped to the observed max.
    expect(s.p50).toBeGreaterThanOrEqual(500);
    expect(s.p50).toBeLessThanOrEqual(500 * Math.SQRT2);
    expect(s.p90).toBeGreaterThanOrEqual(900);
    expect(s.p90).toBeLessThanOrEqual(1000);
    expect(s.p99).toBeGreaterThanOrEqual(990);
    expect(s.p99).toBeLessThanOrEqual(1000);
    expect(s.max).toBe(1000);
  });

  test("memory stays bounded regardless of observation count", () => {
    const h = new Histogram(1);
    // A reservoir would grow (or churn) here; the bucketed histogram just
    // increments fixed counters. 200k spread over 7 orders of magnitude.
    for (let i = 0; i < 200_000; i++) h.record(((i * 37) % 7_000_000) + 0.5);
    const s = h.snapshot();
    if (s === undefined) throw new Error("expected snapshot");
    expect(s.n).toBe(200_000);
    expect(s.max).toBeGreaterThan(1_000_000);
  });

  test("ignores negative and non-finite values, resets cleanly", () => {
    const h = new Histogram(0.05);
    h.record(-1);
    h.record(Number.NaN);
    h.record(Number.POSITIVE_INFINITY);
    expect(h.snapshot()).toBeUndefined();
    h.record(5);
    h.reset();
    expect(h.snapshot()).toBeUndefined();
  });
});

describe("Metrics rollup", () => {
  test("emits one single-line JSON object with the [metrics] prefix", () => {
    const { metrics, lines } = makeMetrics();
    metrics.sessionCreated("s1");
    metrics.commandReceived("s1", "view");
    metrics.commandReceived("s1", "jump");
    metrics.pushEmitted("s1", {
      totalMs: 5,
      paintMs: 3,
      assembleMs: 1,
      writeMs: 1,
      rows: 120,
      htmlBytes: 40_000,
    });
    metrics.pushSkipped("s1");
    const line = metrics.rollup();
    if (line === undefined) throw new Error("expected a rollup line");
    expect(lines).toEqual([line]);
    const obj = parseRollup(line);
    expect(obj.kind).toBe("rollup");
    const interval = obj.interval;
    expect(interval.sessions.created).toBe(1);
    expect(interval.commands).toEqual({ view: 1, jump: 1 });
    expect(interval.push).toEqual({ emit: 1, skip_unchanged: 1, no_writer: 0 });
    expect(interval.push_ms.total?.n).toBe(1);
    expect(interval.push_shape.rows?.max).toBe(120);
  });

  test("interval fields are deltas: a second rollup with no activity reads zero", () => {
    const { metrics } = makeMetrics();
    metrics.sessionCreated("s1");
    metrics.commandReceived("s1", "view");
    metrics.pushEmitted("s1", {
      totalMs: 2,
      paintMs: 1,
      assembleMs: 0.5,
      writeMs: 0.5,
      rows: 10,
      htmlBytes: 1000,
    });
    const first = parseRollup(metrics.rollup() ?? "");
    expect(first.interval.push.emit).toBe(1);
    expect(first.interval.push_ms.total).toBeDefined();

    const interval = parseRollup(metrics.rollup() ?? "").interval;
    expect(interval.sessions.created).toBe(0);
    expect(interval.commands).toEqual({});
    expect(interval.push.emit).toBe(0);
    // Empty histograms are omitted (undefined), never stale.
    expect(interval.push_ms.total).toBeUndefined();
  });

  test("wire bytes are attributed per encoding as interval deltas", () => {
    const { metrics } = makeMetrics();
    const writer = { bytesIn: 0, bytesOut: 0, encoding: "br" };
    metrics.sessionCreated("s1");
    metrics.streamAttached("s1", writer);
    writer.bytesIn = 10_000;
    writer.bytesOut = 1_000;
    let interval = parseRollup(metrics.rollup() ?? "").interval;
    expect(interval.wire.br).toEqual({ in: 10_000, out: 1_000, ratio: 10 });
    expect(interval.sse.attach).toBe(1);

    writer.bytesIn = 15_000;
    writer.bytesOut = 1_500;
    metrics.streamDetached(writer);
    // Second detach must not double-count or bump sse_detach again.
    metrics.streamDetached(writer);
    interval = parseRollup(metrics.rollup() ?? "").interval;
    expect(interval.wire.br).toEqual({ in: 5_000, out: 500, ratio: 10 });
    expect(interval.sse.detach).toBe(1);
    expect(metrics.openStreamCount).toBe(0);
  });
});

describe("Metrics session summaries", () => {
  test("session end emits a summary line with lifetime, commands, and bytes", () => {
    let t = 1_000_000;
    const { metrics, lines } = makeMetrics({ now: () => t });
    const writer = { bytesIn: 0, bytesOut: 0, encoding: "gzip" };
    metrics.sessionCreated("abc");
    metrics.streamAttached("abc", writer);
    metrics.commandReceived("abc", "view");
    metrics.commandReceived("abc", "view");
    metrics.commandReceived("abc", "jump");
    metrics.pushEmitted("abc", {
      totalMs: 1,
      paintMs: 1,
      assembleMs: 0,
      writeMs: 0,
      rows: 5,
      htmlBytes: 100,
    });
    writer.bytesIn = 2_000;
    writer.bytesOut = 400;
    metrics.streamDetached(writer);
    t += 42_500;
    metrics.sessionEnded("abc");
    expect(lines.length).toBe(1);
    const obj = parseSession(lines[0] ?? "");
    expect(obj.kind).toBe("session");
    expect(obj.sid).toBe("abc");
    expect(obj.lifetime_s).toBe(42.5);
    expect(obj.commands).toEqual({ view: 2, jump: 1 });
    expect(obj.pushes).toEqual({ emit: 1, skip: 0 });
    expect(obj.wire).toEqual({ encoding: "gzip", in: 2_000, out: 400 });
    expect(obj.streams).toBe(1);
    // Ending it twice must not emit twice — the record is gone.
    metrics.sessionEnded("abc");
    expect(lines.length).toBe(1);
  });

  test("session lines are budgeted per interval; overflow is counted, not printed", () => {
    const { metrics, lines } = makeMetrics();
    for (let i = 0; i < 60; i++) {
      const sid = `s${i}`;
      metrics.sessionCreated(sid);
      metrics.sessionEnded(sid);
    }
    expect(lines.length).toBe(50);
    const interval = parseRollup(metrics.rollup() ?? "").interval;
    expect(interval.session_lines_dropped).toBe(10);
    expect(interval.sessions.ended).toBe(60);
  });

  test("per-session records are capped so a lost end event cannot leak forever", () => {
    const { metrics } = makeMetrics();
    for (let i = 0; i < 20_050; i++) metrics.sessionCreated(`s${i}`);
    expect(metrics.sessionRecordCount).toBeLessThanOrEqual(20_000);
  });
});

describe("Metrics disabled", () => {
  test("all paths are inert: no lines, no rollup, no records", () => {
    const lines: string[] = [];
    const metrics = new Metrics({
      enabled: false,
      intervalMs: 60_000,
      emit: (line) => lines.push(line),
    });
    metrics.start();
    metrics.sessionCreated("s1");
    metrics.commandReceived("s1", "view");
    metrics.pushEmitted("s1", {
      totalMs: 1,
      paintMs: 1,
      assembleMs: 0,
      writeMs: 0,
      rows: 1,
      htmlBytes: 1,
    });
    metrics.streamAttached("s1", { bytesIn: 0, bytesOut: 0, encoding: "br" });
    metrics.sessionEnded("s1");
    expect(metrics.rollup()).toBeUndefined();
    expect(lines).toEqual([]);
    expect(metrics.sessionRecordCount).toBe(0);
    expect(metrics.openStreamCount).toBe(0);
    metrics.stop();
  });
});
