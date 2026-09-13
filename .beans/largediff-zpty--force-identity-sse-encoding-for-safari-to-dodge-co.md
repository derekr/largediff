---
# largediff-zpty
title: Force identity SSE encoding for Safari to dodge compressed-stream buffering
status: completed
type: bug
priority: high
created_at: 2026-05-11T22:15:15Z
updated_at: 2026-05-11T22:17:26Z
parent: largediff-oyhu
---

Symptom: in Safari, scroll feels far jankier than Chrome/Firefox — some frames take 1–2 seconds to update, then several pushes land in a burst. The pattern of long stalls followed by batched updates is the textbook fingerprint of WebKit's aggressive buffering on compressed streaming responses.

## Diagnosis

The server brotli-encodes each SSE event and flushes the encoder per push via BROTLI_OPERATION_FLUSH (src/server/compress.ts). Chrome and Firefox honor that flush boundary and surface bytes to the SSE parser immediately. Safari's WebKit buffers the decompressed output far more aggressively — it waits until the internal buffer crosses a threshold (or a long idle timeout fires) before emitting events to JS. Per-push payloads of ~1.7 KB compressed don't trip that threshold, so events stack up until the user scrolls enough to flush the buffer or 1-2s passes.

The same buffering happens (less aggressively) with gzip. Only 'identity' is consistently free of this behavior across WebKit versions.

## Fix

Force Content-Encoding: identity for Safari user agents on the SSE response path. Pass req.headers.get('user-agent') down to wrapStream, and have it short-circuit to identity when the UA matches Safari (but not Chromium-on-macOS, which also includes 'Safari' in its UA). Chromium/Firefox continue to get brotli.

Cost: Safari users transfer ~22 KB decoded per push instead of ~1.7 KB. Per-push payloads are already small; the absolute bytes don't matter for the demo workload. Per the perf doc, 30 scrolls = ~700 KB total uncompressed — still trivial.

## Todo

- [x] Add isSafari(ua) helper in src/server/compress.ts
- [x] Add userAgent? parameter to wrapStream; short-circuits to identity when isSafari
- [x] Pass the UA header from src/session/stream.ts
- [x] Tests cover desktop Safari, iOS Safari, Chrome (which embeds 'Safari' in its UA), Edge, and null/empty UA
- [x] bun run check + tests green (18/18)
- [x] Deployed; live probe confirms Safari UA → no content-encoding, Chrome UA → content-encoding: br

## Summary of Changes

- src/server/compress.ts: new isSafari(ua) helper that matches /Safari/ but excludes Chromium/Edge/etc. wrapStream now takes an optional userAgent; when isSafari(ua) is true it returns an identity writer regardless of Accept-Encoding.
- src/session/stream.ts: passes request.headers.get('user-agent') to wrapStream.
- src/server/compress.test.ts: adds isSafari coverage (5 cases) and a wrapStream cross-check (Safari → identity, Chrome → br with the same Accept-Encoding header).

Effect: Safari users now receive uncompressed SSE so WebKit's compressed-stream buffer threshold never holds events back. Per-push wire bytes grow from ~1.7 KB to ~22 KB for Safari only — still trivial for the demo's load. Chrome and Firefox continue to enjoy the warm brotli 13× ratio.
