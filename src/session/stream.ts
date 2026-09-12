// Per-session SSE attachment.
//
// Returns a ReadableStream-backed Response whose body is fed by an encoder
// (brotli / gzip / identity, chosen by Accept-Encoding) wired into the
// WriterRegistry. The writer stays attached for the life of the stream;
// `request.signal.aborted` is the canonical disconnect signal — when the
// client closes the tab Bun fires it and we detach + close the encoder.

import { type SseWriter, wrapStream } from "../server/compress.ts";
import type { Metrics } from "../server/metrics.ts";
import type { SessionStore } from "../store/sessions.ts";
import type { WriterRegistry } from "./projection.ts";
import type { SessionId } from "./types.ts";

export interface AttachStreamOptions {
  sid: SessionId;
  request: Request;
  sessions: SessionStore;
  writers: WriterRegistry;
  // Called once after the writer is attached. The /sessions/:sid/stream
  // handler uses this hook to push the initial projection so the first
  // paint doesn't wait on a client round-trip.
  onAttached?: (writer: SseWriter) => void;
  // Optional attach/detach + wire-byte accounting. `streamDetached` is
  // idempotent inside the registry, which matters here: cancel and abort
  // can both fire for the same stream.
  metrics?: Metrics;
}

// Stream lifecycle logging, opt-in via LARGEDIFF_STREAM_LOG=1.
//
// A session's projection pushes go nowhere while no writer is attached —
// `pushProjection` early-returns — so a stream that silently drops and
// reconnects loses every command issued in the gap outright, rather than
// deferring it. That failure mode is invisible from the client (the POST
// still returns 204 and the DOM simply never changes) and invisible in the
// app's own output unless attach/detach is recorded — flip the flag on
// when investigating lost pushes. Quiet by default: on a public box every
// crawler hit is a connection, and per-connection stdout is noise an
// attacker can generate at line rate.
function logStream(event: string, sid: string, extra = ""): void {
  if (process.env.LARGEDIFF_STREAM_LOG !== "1") return;
  console.log(`[stream] ${event} sid=${sid} t=${Date.now()}${extra}`);
}

export function attachStream(opts: AttachStreamOptions): Response | null {
  const { sid, request, sessions, writers, onAttached, metrics } = opts;
  if (sessions.get(sid) === undefined) return null;

  let writer: SseWriter | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = wrapStream(controller, request.headers.get("accept-encoding"));
      writers.attach(sid, writer);
      metrics?.streamAttached(sid, writer);
      logStream("attach", sid, ` enc=${writer.encoding}`);
      // Defer the initial push so `start()` returns cleanly before any
      // bytes are written. Bun's HTTP layer treats synchronous enqueues
      // inside `start()` as the end of a one-shot response and the
      // entire stream stops streaming.
      queueMicrotask(() => {
        if (writer !== undefined) onAttached?.(writer);
      });
    },
    cancel() {
      logStream("cancel", sid);
      if (writer !== undefined) metrics?.streamDetached(writer);
      writers.detach(sid, writer);
    },
  });

  request.signal.addEventListener(
    "abort",
    () => {
      logStream("abort", sid);
      if (writer !== undefined) metrics?.streamDetached(writer);
      writers.detach(sid, writer);
    },
    { once: true },
  );

  const headers: Record<string, string> = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  };
  // Encoding is decided synchronously inside `start()` above; by the time
  // we reach this Response construction it's safe to inspect.
  if (writer && writer.encoding !== "identity") {
    headers["content-encoding"] = writer.encoding;
  }

  return new Response(body, { headers });
}
