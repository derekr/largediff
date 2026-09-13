---
# largediff-f518
title: SSE gzip fallback never flushes — half of Safari's morphs never arrive
status: completed
type: bug
priority: critical
created_at: 2026-08-25T16:32:24Z
updated_at: 2026-08-25T16:42:15Z
---

On any client that does not advertise `br`, the SSE writer falls back to `buildGzipWriter`, which wraps Web `CompressionStream("gzip")`. `CompressionStream` exposes **no flush API**, so each projection event sits inside the encoder until it happens to emit a deflate block. The brotli path calls `br.flush(constants.BROTLI_OPERATION_FLUSH)` after every event; the gzip path has no equivalent. The file header comment even calls that flush "the key call there" — the fallback never got one.

Safari over plain HTTP does not offer `br` (it only advertises brotli over HTTPS), so Safari always lands on this path.

## Measured impact

Identical 12-jump sequence, same server, same session shape, driven through `window.__ldMeasure()`:

| browser | encoding | jumps with no morph |
|---|---|---|
| Chrome | br | **0 / 12** |
| Safari STP 27 | gzip | **6 / 12** |

Every jump POST returned 204, and on every failed jump the `#ds-window` DOM was byte-identical to the previous sample — the push was accepted and simply never reached the client. The pattern reproduced **exactly** across three consecutive runs, which is what ruled out a Safari timing race: it is a byte threshold, not a delay. Push N sits in the encoder; push N+1 pushes the total over a block boundary and both flush at once, so Idiomorph applies only the final state and jump N appears to do nothing.

User-visible symptom: on Safari roughly half of all sidebar navigations do not update the view until a *subsequent* navigation flushes the buffer.

## Fix

Replace `CompressionStream("gzip")` with `node:zlib` `createGzip()` and flush with `Z_SYNC_FLUSH` per event, mirroring the brotli writer. Better: factor both into one `buildZlibWriter` parameterised by encoder + flush constant so the two paths cannot drift apart again.

## Verify

- [x] gzip writer flushes per event
- [x] brotli and gzip share one implementation
- [x] Safari: 0/12 timed-out jumps on the same sequence
- [x] Chrome unaffected (still 0/12, brotli ratio unchanged)
- [x] compress tests cover per-event flush for both encodings

## Summary of Changes

`buildBrotliWriter` and `buildGzipWriter` collapsed into a single `buildZlibWriter(args, encoder, flushMode)` in `src/server/compress.ts`. brotli passes `BROTLI_OPERATION_FLUSH`, gzip now uses `node:zlib` `createGzip()` with `Z_SYNC_FLUSH`. Web `CompressionStream` is gone from the codebase. One implementation means the flush cannot be present on one path and missing on the other again.

### Result

| | before | after |
|---|---|---|
| Safari STP 27, timed-out jumps | 6 / 12 | **0 / 12** |
| Chrome, timed-out jumps | 0 / 12 | 0 / 12 |

Safari median morph after the fix: 71.5 ms, all 12 arriving.

### Note on the regression test

The first version of the test asserted only that *some* bytes reached the stream for one event. That passes against the bug: `CompressionStream` emits the 10-byte gzip header immediately and withholds only the payload. Verified by reconstructing the old writer in a scratch test — it yields an empty decode (`""`) where the fixed writer decodes the record. The committed test therefore streams the output through `createGunzip`/`createBrotliDecompress` and asserts the SSE record is **decodable mid-stream, before `close()`**, which is precisely the property a sync-flush boundary provides and a block-buffering encoder cannot fake.

## Correction: scope of user impact (measured after the fix)

The original write-up implied every Safari user was losing half their morphs. That overstates it. Measured Safari `Accept-Encoding` directly, with a header-echo server driven through WebDriver:

| context | Accept-Encoding |
|---|---|
| Safari, plain HTTP | `gzip, deflate` |
| Safari, HTTPS (self-signed, acceptInsecureCerts) | `gzip, deflate, br, zstd` |

WebKit gates brotli — and zstd — behind a **secure context**. Chrome advertises `br` on plain-HTTP localhost, so this is a Safari policy, not a localhost artifact.

Consequence depends entirely on whether the deploy target terminates TLS, not on which host it is:

- **Served over HTTPS** — Safari negotiates `br`, takes the brotli path, which always flushed correctly. The dropped morphs never happen; this was a local-dev-only defect.
- **Served over plain HTTP** — Safari lands on gzip and this fix is load-bearing in production.

So the severity of this bug is a property of the deployment scheme. Confirm TLS termination on whatever host largediff ends up on before assuming the first case.

The fix is still correct and still worth having: the gzip path is the documented fallback and it was silently broken, local dev is where the demo gets evaluated, and the two paths had no business diverging. But the severity in production was nil, and the blog post should not claim otherwise.

### Follow-up worth considering

`pickEncoding` does not know about `zstd`, which Safari now offers over HTTPS ahead of nothing in particular. Not a bug — br is preferred and correctly chosen — but zstd is worth benchmarking against brotli for this workload, since the accumulating-dictionary argument that favours br may apply to zstd too.
