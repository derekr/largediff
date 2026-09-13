import { describe, expect, test } from "bun:test";
import { brotliDecompressSync } from "node:zlib";
import { createDiffEngine } from "../diff/generator.ts";
import { InMemorySessionStore } from "../store/sessions.ts";
import { pushProjection, WriterRegistry } from "./projection.ts";
import { attachStream } from "./stream.ts";

function makeRequest(headers: Record<string, string> = {}): { req: Request; abort: () => void } {
  const controller = new AbortController();
  const req = new Request("http://localhost/stream", {
    headers,
    signal: controller.signal,
  });
  return { req, abort: () => controller.abort() };
}

describe("attachStream", () => {
  test("returns null for unknown sid", () => {
    const sessions = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const writers = new WriterRegistry();
    const { req } = makeRequest();
    const res = attachStream({ sid: "never-created", request: req, sessions, writers });
    expect(res).toBeNull();
    sessions.stop();
  });

  test("registers writer and emits Content-Encoding: br when accepted", () => {
    const sessions = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const writers = new WriterRegistry();
    const session = sessions.create("demo");
    const { req } = makeRequest({ "accept-encoding": "br" });

    const res = attachStream({ sid: session.id, request: req, sessions, writers });
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("text/event-stream");
    expect(res?.headers.get("cache-control")).toBe("no-cache");
    expect(res?.headers.get("x-accel-buffering")).toBe("no");
    expect(res?.headers.get("content-encoding")).toBe("br");
    expect(writers.has(session.id)).toBe(true);

    sessions.stop();
  });

  test("identity encoding emits no Content-Encoding header", () => {
    const sessions = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const writers = new WriterRegistry();
    const session = sessions.create("demo");
    const { req } = makeRequest();
    const res = attachStream({ sid: session.id, request: req, sessions, writers });
    expect(res?.headers.get("content-encoding")).toBeNull();
    sessions.stop();
  });

  test("end-to-end push through brotli decodes to the expected SSE bytes", async () => {
    const sessions = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const writers = new WriterRegistry();
    const session = sessions.create("demo");
    const { req } = makeRequest({ "accept-encoding": "br" });

    const res = attachStream({ sid: session.id, request: req, sessions, writers });
    expect(res).not.toBeNull();

    pushProjection(session, { writers, engine: createDiffEngine({ defaultLines: 400 }) });
    writers.detach(session.id);

    const buf = new Uint8Array(await (res as Response).arrayBuffer());
    const decoded = brotliDecompressSync(buf).toString("utf8");
    expect(decoded).toContain("event: datastar-patch-elements");
    expect(decoded).toContain("data: selector #app");
    expect(decoded).toContain("data: mode inner");
    expect(decoded).toContain("data: elements ");

    sessions.stop();
  });

  test("aborting the request detaches the writer", () => {
    const sessions = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const writers = new WriterRegistry();
    const session = sessions.create("demo");
    const { req, abort } = makeRequest({ "accept-encoding": "br" });

    attachStream({ sid: session.id, request: req, sessions, writers });
    expect(writers.has(session.id)).toBe(true);
    abort();
    expect(writers.has(session.id)).toBe(false);

    sessions.stop();
  });
});
