import { describe, expect, test } from "bun:test";
import {
  brotliDecompressSync,
  createBrotliDecompress,
  createGunzip,
  createZstdDecompress,
  gunzipSync,
  zstdDecompressSync,
} from "node:zlib";
import { formatSseEvent, pickEncoding, wrapStream } from "./compress.ts";

describe("pickEncoding", () => {
  test("prefers br over gzip", () => {
    expect(pickEncoding("br, gzip, deflate")).toBe("br");
  });

  test("falls back to gzip when br absent", () => {
    expect(pickEncoding("gzip, deflate")).toBe("gzip");
  });

  test("selects zstd when asked for it explicitly", () => {
    expect(pickEncoding("zstd")).toBe("zstd");
  });

  test("prefers zstd over gzip when br is absent", () => {
    expect(pickEncoding("gzip, zstd")).toBe("zstd");
  });

  // The load-bearing one. Chrome sends exactly this, so if zstd ever outranked
  // br every Chrome client would silently leave brotli behind.
  test("br still wins over zstd — real Chrome Accept-Encoding", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
  });

  test("identity when nothing recognized", () => {
    expect(pickEncoding("deflate")).toBe("identity");
    expect(pickEncoding(null)).toBe("identity");
    expect(pickEncoding(undefined)).toBe("identity");
    expect(pickEncoding("")).toBe("identity");
  });

  test("respects q=0 to remove an encoding", () => {
    expect(pickEncoding("br;q=0, gzip")).toBe("gzip");
  });

  test("handles whitespace and case", () => {
    expect(pickEncoding("  BR ; q=0.9 , gzip ")).toBe("br");
  });
});

describe("wrapStream encoding negotiation", () => {
  test("picks br when advertised", () => {
    new ReadableStream<Uint8Array>({
      start(controller) {
        const writer = wrapStream(controller, "br, gzip");
        expect(writer.encoding).toBe("br");
        controller.close();
      },
    });
  });
  test("falls back to gzip when br is absent", () => {
    new ReadableStream<Uint8Array>({
      start(controller) {
        const writer = wrapStream(controller, "gzip");
        expect(writer.encoding).toBe("gzip");
        controller.close();
      },
    });
  });
  test("identity when nothing acceptable", () => {
    new ReadableStream<Uint8Array>({
      start(controller) {
        const writer = wrapStream(controller, null);
        expect(writer.encoding).toBe("identity");
        controller.close();
      },
    });
  });
});

describe("formatSseEvent", () => {
  test("single-line data emits one data: field", () => {
    const bytes = formatSseEvent("foo", "bar");
    expect(new TextDecoder().decode(bytes)).toBe("event: foo\ndata: bar\n\n");
  });

  test("multi-line data emits one data: field per line", () => {
    const bytes = formatSseEvent("patch", "a\nb\nc");
    expect(new TextDecoder().decode(bytes)).toBe("event: patch\ndata: a\ndata: b\ndata: c\n\n");
  });
});

async function collectBody(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

describe("wrapStream identity", () => {
  test("passes SSE bytes through unchanged", async () => {
    let writer!: ReturnType<typeof wrapStream>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = wrapStream(controller, null);
      },
    });
    writer.send("largediff-ack", '{"sid":"abc","at":1}');
    writer.close();
    const bytes = await collectBody(stream);
    expect(writer.encoding).toBe("identity");
    expect(new TextDecoder().decode(bytes)).toBe(
      'event: largediff-ack\ndata: {"sid":"abc","at":1}\n\n',
    );
  });
});

describe("wrapStream brotli", () => {
  test("round-trips through BrotliDecompress", async () => {
    let writer!: ReturnType<typeof wrapStream>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = wrapStream(controller, "br");
      },
    });
    writer.send("largediff-ack", "first");
    writer.send("largediff-ack", "second");
    writer.close();
    const bytes = await collectBody(stream);
    expect(writer.encoding).toBe("br");
    const decoded = brotliDecompressSync(bytes).toString("utf8");
    expect(decoded).toBe(
      "event: largediff-ack\ndata: first\n\nevent: largediff-ack\ndata: second\n\n",
    );
  });

  test("emits bytes before close (per-event flush)", async () => {
    let writer!: ReturnType<typeof wrapStream>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = wrapStream(controller, "br");
      },
    });
    const reader = stream.getReader();
    writer.send("largediff-ack", "hello");
    await new Promise((r) => setTimeout(r, 10));
    const { value } = await reader.read();
    expect(value).toBeDefined();
    expect(value?.byteLength ?? 0).toBeGreaterThan(0);
    writer.close();
  });
});

describe("wrapStream gzip", () => {
  test("round-trips through gunzip", async () => {
    let writer!: ReturnType<typeof wrapStream>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = wrapStream(controller, "gzip");
      },
    });
    writer.send("largediff-ack", "hello gzip");
    writer.close();
    const bytes = await collectBody(stream);
    expect(writer.encoding).toBe("gzip");
    const decoded = gunzipSync(bytes).toString("utf8");
    expect(decoded).toBe("event: largediff-ack\ndata: hello gzip\n\n");
  });
});

describe("wrapStream zstd", () => {
  test("round-trips through zstd decompress", async () => {
    let writer!: ReturnType<typeof wrapStream>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = wrapStream(controller, "zstd");
      },
    });
    writer.send("largediff-ack", "hello zstd");
    writer.close();
    const bytes = await collectBody(stream);
    expect(writer.encoding).toBe("zstd");
    const decoded = zstdDecompressSync(bytes).toString("utf8");
    expect(decoded).toBe("event: largediff-ack\ndata: hello zstd\n\n");
  });
});

describe("per-event flush", () => {
  // Regression guard for largediff-f518. The gzip fallback used to wrap Web
  // `CompressionStream("gzip")`, which has no flush API: a single small SSE
  // record left the payload sitting inside the encoder until some later
  // write happened to complete a deflate block. On a long-lived projection
  // stream that means morphs silently never arrive — Safari (which doesn't
  // advertise `br` over plain HTTP) lost roughly half of them.
  //
  // Asserting "some bytes were emitted" is NOT sufficient: CompressionStream
  // does emit the 10-byte gzip header immediately, so a byteLength check
  // passes against the bug. The payload is the thing that gets withheld, so
  // the assertion has to be that the record is *decodable* mid-stream —
  // which is exactly what a sync-flush boundary guarantees and what a
  // block-buffering encoder cannot provide.
  for (const [accept, expected] of [
    ["br", "br"],
    ["gzip", "gzip"],
    ["zstd", "zstd"],
  ] as const) {
    test(`${expected} makes one event decodable before close`, async () => {
      let writer!: ReturnType<typeof wrapStream>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          writer = wrapStream(controller, accept);
        },
      });
      const reader = stream.getReader();
      expect(writer.encoding).toBe(expected);

      const dec =
        expected === "br"
          ? createBrotliDecompress()
          : expected === "zstd"
            ? createZstdDecompress()
            : createGunzip();
      let seen = "";
      dec.on("data", (c: Buffer) => {
        seen += c.toString("utf8");
      });

      writer.send("datastar-patch-elements", "elements: <div id='marker'>flushed</div>");

      // Pump whatever the encoder has released — deliberately WITHOUT
      // calling writer.close(), which would flush trivially and hide the bug.
      const deadline = Date.now() + 2000;
      while (!seen.includes("flushed") && Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read().then((r) => r.value),
          new Promise<undefined>((r) => setTimeout(() => r(undefined), 250)),
        ]);
        if (chunk !== undefined) {
          dec.write(Buffer.from(chunk));
          await new Promise((r) => setTimeout(r, 10));
        }
      }

      expect(seen).toContain("event: datastar-patch-elements");
      expect(seen).toContain("flushed");
      writer.close();
    });
  }
});
