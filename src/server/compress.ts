// Long-lived SSE writers with content-encoding negotiation.
//
// brotli (node:zlib) is the goal — its accumulating dictionary makes repeated
// projection payloads compress dramatically over the life of a connection.
// gzip (also node:zlib) is the fallback when the client doesn't advertise br;
// identity is the last-resort passthrough. zstd is available but never
// negotiated ahead of br — see ENCODING_RANK for why that ordering matters.
//
// Each event is encoded as a single SSE record (`event:` + one or more
// `data:` lines + blank line) and **flushed immediately** so the browser
// paints promptly. That per-event flush is the whole ballgame for a
// long-lived stream, so brotli and gzip deliberately share one
// implementation — see `buildZlibWriter`.
//
// This used to be two separate functions, and the gzip one wrapped Web
// `CompressionStream("gzip")`, which exposes no flush API at all. Events sat
// inside the encoder until it happened to emit a deflate block. Safari over
// plain HTTP doesn't advertise `br`, so it always landed there and lost
// roughly half its morphs — a jump would appear to do nothing until a later
// jump pushed the buffer over a block boundary and flushed both at once.
// See bean largediff-f518. Keep the two paths unified so they can't drift
// apart like that again.

import {
  type BrotliCompress,
  constants,
  createBrotliCompress,
  createGzip,
  createZstdCompress,
  type Gzip,
  type ZstdCompress,
} from "node:zlib";

export type Encoding = "br" | "gzip" | "zstd" | "identity";

// Debug/ops escape hatch: cap the encodings this server is willing to use,
// regardless of what the client advertises. `LARGEDIFF_MAX_ENCODING=gzip`
// makes a br-capable browser fall back to gzip; `=identity` disables
// compression entirely.
//
// Exists because encoding is otherwise impossible to vary from the outside:
// `Accept-Encoding` is a forbidden header name, so no amount of client-side
// code can change what the browser offers. Isolating an encoding-dependent
// bug in a deployed environment needs a server-side knob.
//
// The rank doubles as the preference order, and zstd deliberately sits BELOW
// br. Chrome advertises `zstd` in every `Accept-Encoding`, so ranking it above
// br would silently move the whole application off brotli the moment zstd
// became selectable — a real behaviour change smuggled in behind a lab option.
// br stays the negotiated default; zstd is reachable by asking for it, which
// is what the lab's `enc=zstd` does and what `LARGEDIFF_MAX_ENCODING=zstd`
// does for a whole process.
const ENCODING_RANK: Record<Encoding, number> = { identity: 0, gzip: 1, zstd: 2, br: 3 };

function encodingCeiling(): Encoding {
  const raw = process.env.LARGEDIFF_MAX_ENCODING;
  if (raw === "identity" || raw === "gzip" || raw === "zstd" || raw === "br") return raw;
  return "br";
}

export function pickEncoding(acceptEncoding: string | null | undefined): Encoding {
  const ceiling = ENCODING_RANK[encodingCeiling()];
  if (!acceptEncoding) return "identity";
  const tokens = acceptEncoding
    .toLowerCase()
    .split(",")
    .map((part) => {
      const [name, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const qValue = q ? Number(q.slice(2)) : 1;
      return { name: (name ?? "").trim(), q: Number.isFinite(qValue) ? qValue : 0 };
    })
    .filter((t) => t.q > 0 && t.name.length > 0);
  const has = (name: string) => tokens.some((t) => t.name === name);
  if (has("br") && ceiling >= ENCODING_RANK.br) return "br";
  if (has("zstd") && ceiling >= ENCODING_RANK.zstd) return "zstd";
  if (has("gzip") && ceiling >= ENCODING_RANK.gzip) return "gzip";
  return "identity";
}

// Encode a Datastar/SSE event with optional multi-line data payload. Each
// "\n" inside `data` becomes its own `data:` line so HTML fragments and
// JSON blobs survive intact. The trailing blank line terminates the record.
export function formatSseComment(text: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(`: ${text}\n\n`);
  const out = new Uint8Array(new ArrayBuffer(enc.byteLength));
  out.set(enc);
  return out;
}

export function formatSseEvent(eventType: string, data: string): Uint8Array<ArrayBuffer> {
  const lines: string[] = [`event: ${eventType}`];
  for (const piece of data.split("\n")) lines.push(`data: ${piece}`);
  lines.push("", "");
  const enc = new TextEncoder().encode(lines.join("\n"));
  // Wrap in a fresh ArrayBuffer so the typed-array is `Uint8Array<ArrayBuffer>`
  // (Bun's stream APIs reject the ArrayBufferLike-narrowed form).
  const out = new Uint8Array(new ArrayBuffer(enc.byteLength));
  out.set(enc);
  return out;
}

// Deliberately self-contained: no import from the host application, so this
// file and the lab can be lifted into a standalone repro repo and still
// type-check. `send` and `close` were inherited from the app's SessionWriter;
// declaring them here keeps SseWriter structurally assignable to it while
// removing the dependency.
export interface SseWriter {
  send(event: string, data: string): void;
  close(): void;
  // Write several SSE events as ONE encoder flush.
  //
  // SSE permits any number of `event:` records per write, and the variable
  // that governs the WebKit stranding is writes, not events. So a caller
  // with two unrelated things to say can say both without producing the
  // two-writes shape — no semantic merging required. See largediff-pkrf.
  sendBatch(events: ReadonlyArray<{ event: string; data: string }>): void;
  // Write an SSE comment (`: …`) through the same encoder and flush.
  //
  // Comments are ignored by every SSE consumer, which makes them the one
  // payload that can be appended purely to move bytes. Safari's streaming
  // decompressor retains a trailing fragment until further compressed input
  // arrives; a comment after each real event means the fragment it holds is
  // the comment rather than the event. See bean largediff-pkrf.
  sendComment(text: string): void;
  readonly encoding: Encoding;
  // Accumulated raw bytes passed to `send()` since the writer attached.
  // Compared to `bytesOut` this is the "what we'd have sent without
  // compression" number — useful to surface the savings in the UI.
  readonly bytesIn: number;
  // Accumulated bytes enqueued onto the underlying controller — i.e.
  // what actually crossed the wire post-encoder. For identity writers
  // this equals `bytesIn`; for brotli/gzip it's typically much smaller
  // because the encoder's dictionary memoises prior pushes.
  readonly bytesOut: number;
}

interface BuildArgs {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoding: Encoding;
}

// Shared driver for both compressing encodings. `flushMode` is the zlib
// flush constant to issue after every SSE record — BROTLI_OPERATION_FLUSH for
// brotli, Z_SYNC_FLUSH for gzip, ZSTD_e_flush for zstd. Each emits a
// synchronisable boundary so the bytes actually leave the encoder instead of
// waiting for a full block.
function buildZlibWriter(
  { controller, encoding }: BuildArgs,
  z: BrotliCompress | Gzip | ZstdCompress,
  flushMode: number,
): SseWriter {
  const br = z;
  let enqueueErrored = false;
  let bytesIn = 0;
  let bytesOut = 0;
  br.on("data", (chunk: Buffer) => {
    bytesOut += chunk.byteLength;
    if (enqueueErrored) return;
    try {
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      controller.enqueue(copy);
    } catch {
      enqueueErrored = true;
    }
  });
  br.on("end", () => {
    try {
      controller.close();
    } catch {
      // already closed by the consumer
    }
  });
  br.on("error", () => {
    try {
      controller.error(new Error(`${encoding} encoder error`));
    } catch {
      // already torn down
    }
  });
  let closed = false;
  return {
    encoding,
    get bytesIn() {
      return bytesIn;
    },
    get bytesOut() {
      return bytesOut;
    },
    send(eventType, data) {
      if (closed) return;
      const bytes = formatSseEvent(eventType, data);
      bytesIn += bytes.byteLength;
      br.write(bytes);
      br.flush(flushMode, () => {});
    },
    sendComment(text) {
      if (closed) return;
      const bytes = formatSseComment(text);
      bytesIn += bytes.byteLength;
      br.write(bytes);
      br.flush(flushMode, () => {});
    },
    sendBatch(events) {
      if (closed || events.length === 0) return;
      for (const e of events) {
        const bytes = formatSseEvent(e.event, e.data);
        bytesIn += bytes.byteLength;
        br.write(bytes);
      }
      // One flush for the whole batch — that is the entire point.
      br.flush(flushMode, () => {});
    },
    close() {
      if (closed) return;
      closed = true;
      br.end();
    },
  };
}

function buildIdentityWriter({ controller, encoding }: BuildArgs): SseWriter {
  let closed = false;
  let bytes = 0;
  return {
    encoding,
    get bytesIn() {
      return bytes;
    },
    get bytesOut() {
      return bytes;
    },
    sendComment(text) {
      if (closed) return;
      try {
        const out = formatSseComment(text);
        bytes += out.byteLength;
        controller.enqueue(out);
      } catch {
        closed = true;
      }
    },
    sendBatch(events) {
      if (closed) return;
      try {
        for (const e of events) {
          const out = formatSseEvent(e.event, e.data);
          bytes += out.byteLength;
          controller.enqueue(out);
        }
      } catch {
        closed = true;
      }
    },
    send(eventType, data) {
      if (closed) return;
      try {
        const out = formatSseEvent(eventType, data);
        bytes += out.byteLength;
        controller.enqueue(out);
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  };
}

export function wrapStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
  acceptEncoding: string | null | undefined,
): SseWriter {
  const encoding = pickEncoding(acceptEncoding);
  if (encoding === "br") {
    return buildZlibWriter(
      { controller, encoding },
      createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 5,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_LGWIN]: 22,
        },
      }),
      constants.BROTLI_OPERATION_FLUSH,
    );
  }
  if (encoding === "zstd") {
    // ZSTD_e_flush is zstd's sync-flush equivalent: it ends the current block
    // and emits everything buffered, so the record is decodable by a streaming
    // consumer without ending the frame. Verified by decoding mid-stream in
    // compress.test.ts rather than by counting bytes — see the note there.
    return buildZlibWriter({ controller, encoding }, createZstdCompress(), constants.ZSTD_e_flush);
  }
  if (encoding === "gzip") {
    return buildZlibWriter({ controller, encoding }, createGzip(), constants.Z_SYNC_FLUSH);
  }
  return buildIdentityWriter({ controller, encoding });
}
