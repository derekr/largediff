// Local-log metrics: in-process counters + bucketed histograms, emitted as
// one greppable JSON line per interval on stdout. Deliberately no routes and
// no client input of any kind — the /log endpoint and the /sse-lab routes
// were removed precisely because inbound debug surface is attacker-facing.
// Everything here is outbound-only, and the rollup fires on a fixed timer,
// so no visitor can drive the output rate.
//
// Reading it on the deployed box (stdout → journald under systemd):
//
//   journalctl -u largediff | grep '\[metrics\]' | jq
//
// Semantics, so a reader never has to guess:
//   - every field under `"interval"` is a DELTA for the elapsed interval and
//     resets to zero after each rollup;
//   - everything under `"gauges"` is an instantaneous reading taken at
//     rollup time;
//   - histograms render as {n,p50,p90,p99,max} and reset with the interval;
//   - a missing key inside `interval.commands` / `interval.cmd_ms` /
//     `interval.wire` means zero activity for that key this interval.
//
// A `"kind":"session"` line is also emitted when a session leaves the store
// (explicit DELETE or idle sweep) — that is where per-user usage patterns
// show up: lifetime, command mix, bytes served, negotiated encoding. Those
// lines are budgeted per interval (see MAX_SESSION_LINES_PER_INTERVAL) so a
// create/delete loop cannot turn session-end into a stdout flood.

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

// Fixed bucketed histogram rather than a sampling reservoir. 48 counters
// with sqrt(2)-ratio boundaries bound the memory at ~200 bytes per
// histogram regardless of how many observations land (a reservoir needs
// either random eviction bookkeeping or unbounded growth), recording is a
// single log2 + array increment with zero allocation — this runs on the
// projection push path — and p50/p90/p99 fall out of one cumulative walk at
// rollup time. The price is quantization: a reported percentile is the
// bucket's upper bound, at most ~41% above the true value (one sqrt(2)
// step), which is plenty for "which phase regressed" questions.
const HIST_BUCKETS = 48;

export class Histogram {
  private readonly buckets = new Uint32Array(HIST_BUCKETS);
  // Values at or below `unit` land in bucket 0; bucket i's upper bound is
  // unit * 2^(i/2). With 48 buckets the range spans unit → unit * ~11.8M,
  // e.g. 0.05ms → ~10 minutes for latencies.
  private readonly unit: number;
  private count = 0;
  private lo = Number.POSITIVE_INFINITY;
  private hi = 0;

  constructor(unit: number) {
    this.unit = unit;
  }

  record(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    const idx =
      v <= this.unit
        ? 0
        : Math.min(HIST_BUCKETS - 1, Math.max(1, Math.ceil(2 * Math.log2(v / this.unit))));
    const cur = this.buckets[idx] ?? 0;
    this.buckets[idx] = cur + 1;
    this.count++;
    if (v < this.lo) this.lo = v;
    if (v > this.hi) this.hi = v;
  }

  get n(): number {
    return this.count;
  }

  // Upper bound of the bucket containing the q-quantile observation,
  // clamped to the exact observed min/max so tiny samples read sanely
  // (n=1 reports the actual value, not a bucket edge).
  percentile(q: number): number {
    if (this.count === 0) return 0;
    const rank = Math.max(1, Math.ceil(q * this.count));
    let seen = 0;
    for (let i = 0; i < HIST_BUCKETS; i++) {
      seen += this.buckets[i] ?? 0;
      if (seen >= rank) {
        const upper = this.unit * 2 ** (i / 2);
        return Math.min(Math.max(upper, this.lo), this.hi);
      }
    }
    return this.hi;
  }

  snapshot(): HistogramSnapshot | undefined {
    if (this.count === 0) return undefined;
    return {
      n: this.count,
      p50: round2(this.percentile(0.5)),
      p90: round2(this.percentile(0.9)),
      p99: round2(this.percentile(0.99)),
      max: round2(this.hi),
    };
  }

  reset(): void {
    this.buckets.fill(0);
    this.count = 0;
    this.lo = Number.POSITIVE_INFINITY;
    this.hi = 0;
  }
}

export interface HistogramSnapshot {
  n: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// Env resolution
// ---------------------------------------------------------------------------

export interface ResolvedMetricsEnv {
  enabled: boolean;
  intervalMs: number;
}

const DEFAULT_INTERVAL_MS = 60_000;
// Clamp the interval: below 1s the "fixed cadence" that makes this safe to
// leave on becomes its own stdout flood; above 1h the process looks dead in
// the journal for long enough that the heartbeat property is lost.
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 3_600_000;

export function resolveMetricsEnv(env: Record<string, string | undefined>): ResolvedMetricsEnv {
  const enabled = env.LARGEDIFF_METRICS !== "0";
  const raw = Number.parseInt(env.LARGEDIFF_METRICS_INTERVAL_MS ?? "", 10);
  const intervalMs = Number.isFinite(raw)
    ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, raw))
    : DEFAULT_INTERVAL_MS;
  return { enabled, intervalMs };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type CommandKind = "view" | "jump" | "top" | "sidebar" | "settings" | "poke" | "prewarm";

// Phase breakdown of one emitted projection push. One opaque total is
// nearly useless for "where did the slow push go" — paint (slice + tokenize
// + render HTML), assemble (outer shell + SSE line splitting), and write
// (hand-off to the encoder) point at different suspects. Note the write
// number covers the synchronous hand-off only: node:zlib compresses
// asynchronously, so actual encode cost shows up in wire byte ratios, not
// here.
export interface PushTimings {
  totalMs: number;
  paintMs: number;
  assembleMs: number;
  writeMs: number;
  rows: number;
  htmlBytes: number;
}

// Structural subset of SseWriter/SessionWriter — declared here so this
// module imports nothing from the session layer and stays dependency-free.
export interface WireSource {
  readonly bytesIn?: number;
  readonly bytesOut?: number;
  readonly encoding?: string;
}

export interface MetricsOptions {
  enabled: boolean;
  intervalMs: number;
  // Injectable for tests; defaults to a `[metrics] `-prefixed console.log.
  emit?: (line: string) => void;
  // Instantaneous readings sampled at rollup time (e.g. live session count).
  gauges?: () => Record<string, number>;
  // Injectable wall clock for tests (session lifetimes).
  now?: () => number;
}

interface SessionUsage {
  createdAt: number;
  commands: Map<string, number>;
  pushEmit: number;
  pushSkip: number;
  bytesIn: number;
  bytesOut: number;
  streams: number;
  encoding?: string;
}

interface TrackedStream {
  sid: string;
  writer: WireSource;
  lastIn: number;
  lastOut: number;
  encoding: string;
}

// Session-end lines are the one per-event emission here, and session
// create/delete is client-drivable (GET / + DELETE in a loop), so budget
// them per interval. Overflow is counted, not printed.
const MAX_SESSION_LINES_PER_INTERVAL = 50;

// Per-session usage records are dropped when the session ends, so the
// steady-state bound is the live-session cap. The hard cap here is a
// backstop for the case where an end event is lost (a code path that
// forgets onEvict): stop creating records rather than grow forever.
const MAX_SESSION_RECORDS = 20_000;

export class Metrics {
  readonly enabled: boolean;
  readonly intervalMs: number;
  private readonly emit: (line: string) => void;
  private readonly gauges: (() => Record<string, number>) | undefined;
  private readonly now: () => number;

  // Flat named counters, reset each rollup. String-keyed Map increments
  // with literal keys allocate nothing on the hot path.
  private readonly counters = new Map<string, number>();
  private readonly commandCounts = new Map<string, number>();
  private readonly cmdLatency = new Map<string, Histogram>();
  private readonly wireByEncoding = new Map<string, { in: number; out: number }>();

  private readonly pushTotalMs = new Histogram(0.05);
  private readonly pushPaintMs = new Histogram(0.05);
  private readonly pushAssembleMs = new Histogram(0.05);
  private readonly pushWriteMs = new Histogram(0.05);
  private readonly pushRows = new Histogram(1);
  private readonly pushHtmlBytes = new Histogram(64);
  private readonly tokenizeMs = new Histogram(0.05);
  private readonly seedGenerateMs = new Histogram(1);

  private readonly sessionRecords = new Map<string, SessionUsage>();
  private readonly openStreams = new Map<WireSource, TrackedStream>();
  private sessionLinesThisInterval = 0;

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: MetricsOptions) {
    this.enabled = opts.enabled;
    this.intervalMs = opts.intervalMs;
    this.emit = opts.emit ?? ((line) => console.log(line));
    this.gauges = opts.gauges;
    this.now = opts.now ?? Date.now;
  }

  // -- lifecycle ------------------------------------------------------------

  start(): void {
    if (!this.enabled || this.timer !== undefined) return;
    this.timer = setInterval(() => this.rollup(), this.intervalMs);
    // The rollup is telemetry, never a reason to keep the process alive.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // -- counters -------------------------------------------------------------

  count(name: string, n = 1): void {
    if (!this.enabled) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + n);
  }

  gone(): void {
    if (!this.enabled) return;
    this.commandCounts.set("410", (this.commandCounts.get("410") ?? 0) + 1);
  }

  // -- sessions -------------------------------------------------------------

  sessionCreated(sid: string): void {
    if (!this.enabled) return;
    this.count("sessions_created");
    this.usage(sid);
  }

  sessionRejected(): void {
    this.count("sessions_rejected_capacity");
  }

  // Emits the per-session usage summary (budgeted) and frees the record.
  sessionEnded(sid: string): void {
    if (!this.enabled) return;
    this.count("sessions_ended");
    const u = this.sessionRecords.get(sid);
    if (u === undefined) return;
    this.sessionRecords.delete(sid);
    if (this.sessionLinesThisInterval >= MAX_SESSION_LINES_PER_INTERVAL) {
      this.count("session_lines_dropped");
      return;
    }
    this.sessionLinesThisInterval++;
    const commands: Record<string, number> = {};
    for (const [k, v] of u.commands) commands[k] = v;
    this.emit(
      `[metrics] ${JSON.stringify({
        kind: "session",
        sid,
        lifetime_s: round2((this.now() - u.createdAt) / 1000),
        commands,
        pushes: { emit: u.pushEmit, skip: u.pushSkip },
        // in = raw bytes handed to the encoder, out = post-compression
        // wire bytes; identical for identity streams.
        wire: { encoding: u.encoding ?? "none", in: u.bytesIn, out: u.bytesOut },
        streams: u.streams,
      })}`,
    );
  }

  // -- commands -------------------------------------------------------------

  commandReceived(sid: string, kind: CommandKind): void {
    if (!this.enabled) return;
    this.commandCounts.set(kind, (this.commandCounts.get(kind) ?? 0) + 1);
    const u = this.usage(sid);
    if (u !== undefined) u.commands.set(kind, (u.commands.get(kind) ?? 0) + 1);
  }

  // POST received → handler returned, including any synchronous projection
  // write. For /view this excludes throttled trailing pushes (they complete
  // on a timer after the 204); the deferral itself is visible in the
  // coalesce counters.
  commandLatency(kind: CommandKind, ms: number): void {
    if (!this.enabled) return;
    let h = this.cmdLatency.get(kind);
    if (h === undefined) {
      h = new Histogram(0.05);
      this.cmdLatency.set(kind, h);
    }
    h.record(ms);
  }

  // -- projection pushes ----------------------------------------------------

  pushSkipped(sid: string): void {
    if (!this.enabled) return;
    this.count("push_skip_unchanged");
    const u = this.sessionRecords.get(sid);
    if (u !== undefined) u.pushSkip++;
  }

  pushNoWriter(): void {
    this.count("push_no_writer");
  }

  pushEmitted(sid: string, t: PushTimings): void {
    if (!this.enabled) return;
    this.count("push_emit");
    this.pushTotalMs.record(t.totalMs);
    this.pushPaintMs.record(t.paintMs);
    this.pushAssembleMs.record(t.assembleMs);
    this.pushWriteMs.record(t.writeMs);
    this.pushRows.record(t.rows);
    this.pushHtmlBytes.record(t.htmlBytes);
    const u = this.sessionRecords.get(sid);
    if (u !== undefined) u.pushEmit++;
  }

  // -- diff engine ----------------------------------------------------------
  // Adapter target for generator.ts's DiffEngineInstrument. Cache hit rates
  // are the leading indicator for a gradual slowdown — a collapsing token
  // cache hit rate is invisible in latency alone until it is severe.

  engineFileHit(): void {
    this.count("engine_file_hit");
  }
  engineFileMiss(): void {
    this.count("engine_file_miss");
  }
  engineTokensHit(): void {
    this.count("engine_tokens_hit");
  }
  engineTokensMiss(ms: number): void {
    if (!this.enabled) return;
    this.count("engine_tokens_miss");
    this.tokenizeMs.record(ms);
  }
  engineSeedGenerate(ms: number): void {
    if (!this.enabled) return;
    this.count("engine_seed_generate");
    this.seedGenerateMs.record(ms);
  }
  engineSeedEvict(): void {
    this.count("engine_seed_evict");
  }

  // -- SSE streams ----------------------------------------------------------

  streamAttached(sid: string, writer: WireSource): void {
    if (!this.enabled) return;
    this.count("sse_attach");
    const u = this.usage(sid);
    if (u !== undefined) {
      u.streams++;
      u.encoding = writer.encoding ?? u.encoding;
    }
    this.openStreams.set(writer, {
      sid,
      writer,
      lastIn: writer.bytesIn ?? 0,
      lastOut: writer.bytesOut ?? 0,
      encoding: writer.encoding ?? "identity",
    });
  }

  // Idempotent — cancel and abort can both fire for one stream, and the
  // server also flushes here before force-detaching on session eviction.
  streamDetached(writer: WireSource): void {
    if (!this.enabled) return;
    const st = this.openStreams.get(writer);
    if (st === undefined) return;
    this.flushWire(st);
    this.openStreams.delete(writer);
    this.count("sse_detach");
  }

  get openStreamCount(): number {
    return this.openStreams.size;
  }

  get sessionRecordCount(): number {
    return this.sessionRecords.size;
  }

  // -- rollup ---------------------------------------------------------------

  // Build the rollup line, emit it, and reset all interval state. Public so
  // tests (and a graceful-shutdown hook) can trigger it without the timer.
  rollup(): string | undefined {
    if (!this.enabled) return undefined;
    // Fold open streams' byte deltas into this interval before reporting —
    // a long-lived stream would otherwise contribute nothing until detach.
    for (const st of this.openStreams.values()) this.flushWire(st);

    const commands: Record<string, number> = {};
    for (const [k, v] of this.commandCounts) commands[k] = v;

    const cmdMs: Record<string, HistogramSnapshot> = {};
    for (const [k, h] of this.cmdLatency) {
      const s = h.snapshot();
      if (s !== undefined) cmdMs[k] = s;
    }

    const wire: Record<string, { in: number; out: number; ratio: number }> = {};
    for (const [enc, w] of this.wireByEncoding) {
      if (w.in === 0 && w.out === 0) continue;
      wire[enc] = { in: w.in, out: w.out, ratio: w.out > 0 ? round2(w.in / w.out) : 0 };
    }

    const mem = process.memoryUsage();
    const line = `[metrics] ${JSON.stringify({
      kind: "rollup",
      t: new Date(this.now()).toISOString(),
      interval_ms: this.intervalMs,
      interval: {
        sessions: {
          created: this.take("sessions_created"),
          ended: this.take("sessions_ended"),
          rejected_capacity: this.take("sessions_rejected_capacity"),
        },
        commands,
        coalesce: {
          view_echo_dropped: this.take("view_echo_dropped"),
          view_leading: this.take("view_leading"),
          view_deferred: this.take("view_deferred"),
          view_trailing_fired: this.take("view_trailing_fired"),
        },
        push: {
          emit: this.take("push_emit"),
          skip_unchanged: this.take("push_skip_unchanged"),
          no_writer: this.take("push_no_writer"),
        },
        push_ms: {
          total: this.pushTotalMs.snapshot(),
          paint: this.pushPaintMs.snapshot(),
          assemble: this.pushAssembleMs.snapshot(),
          write: this.pushWriteMs.snapshot(),
        },
        push_shape: {
          rows: this.pushRows.snapshot(),
          html_bytes: this.pushHtmlBytes.snapshot(),
        },
        cmd_ms: cmdMs,
        engine: {
          file_hit: this.take("engine_file_hit"),
          file_miss: this.take("engine_file_miss"),
          tokens_hit: this.take("engine_tokens_hit"),
          tokens_miss: this.take("engine_tokens_miss"),
          tokenize_ms: this.tokenizeMs.snapshot(),
          seed_generate: this.take("engine_seed_generate"),
          seed_generate_ms: this.seedGenerateMs.snapshot(),
          seed_evict: this.take("engine_seed_evict"),
        },
        sse: { attach: this.take("sse_attach"), detach: this.take("sse_detach") },
        wire,
        session_lines_dropped: this.take("session_lines_dropped"),
        // Abuse counters: rate-limited requests and junk-fid jumps are
        // rejected before doing work, so they show up here and nowhere
        // else — a flood is visible as a spike in exactly one place.
        limits: {
          rate_limited: this.take("rate_limited"),
          jump_unknown_fid: this.take("jump_unknown_fid"),
        },
      },
      gauges: {
        ...(this.gauges?.() ?? {}),
        sse_open: this.openStreams.size,
        uptime_s: Math.round(process.uptime()),
        rss_mb: round2(mem.rss / (1024 * 1024)),
        heap_used_mb: round2(mem.heapUsed / (1024 * 1024)),
      },
    })}`;

    // Reset interval state.
    this.counters.clear();
    this.commandCounts.clear();
    this.cmdLatency.clear();
    this.wireByEncoding.clear();
    this.pushTotalMs.reset();
    this.pushPaintMs.reset();
    this.pushAssembleMs.reset();
    this.pushWriteMs.reset();
    this.pushRows.reset();
    this.pushHtmlBytes.reset();
    this.tokenizeMs.reset();
    this.seedGenerateMs.reset();
    this.sessionLinesThisInterval = 0;

    this.emit(line);
    return line;
  }

  // -- internals ------------------------------------------------------------

  private take(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  private usage(sid: string): SessionUsage | undefined {
    let u = this.sessionRecords.get(sid);
    if (u === undefined) {
      if (this.sessionRecords.size >= MAX_SESSION_RECORDS) return undefined;
      u = {
        createdAt: this.now(),
        commands: new Map(),
        pushEmit: 0,
        pushSkip: 0,
        bytesIn: 0,
        bytesOut: 0,
        streams: 0,
      };
      this.sessionRecords.set(sid, u);
    }
    return u;
  }

  private flushWire(st: TrackedStream): void {
    const curIn = st.writer.bytesIn ?? st.lastIn;
    const curOut = st.writer.bytesOut ?? st.lastOut;
    const dIn = curIn - st.lastIn;
    const dOut = curOut - st.lastOut;
    st.lastIn = curIn;
    st.lastOut = curOut;
    if (dIn === 0 && dOut === 0) return;
    let w = this.wireByEncoding.get(st.encoding);
    if (w === undefined) {
      w = { in: 0, out: 0 };
      this.wireByEncoding.set(st.encoding, w);
    }
    w.in += dIn;
    w.out += dOut;
    const u = this.sessionRecords.get(st.sid);
    if (u !== undefined) {
      u.bytesIn += dIn;
      u.bytesOut += dOut;
    }
  }
}

export function metricsFromEnv(
  opts: Pick<MetricsOptions, "emit" | "gauges"> = {},
  env: Record<string, string | undefined> = process.env,
): Metrics {
  const resolved = resolveMetricsEnv(env);
  return new Metrics({ ...resolved, ...opts });
}
