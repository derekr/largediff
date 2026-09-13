# Deploying largediff

largediff is a single Bun process (`bun src/server.ts`) with no build step.
Any host that can run Bun behind a TLS-terminating proxy works. Two
properties of the app constrain how you deploy it; both are explained below.

## Why HTTPS is not optional here

Browsers only advertise `br` in `Accept-Encoding` over a secure context —
Safari always, Chrome on any origin that isn't localhost. Measured:

| origin | Safari 26.4 / STP 27 | Chrome |
| --- | --- | --- |
| `http://localhost` | `gzip, deflate` | `br, gzip` |
| `http://<LAN IP>` | — | `gzip, deflate` |
| `https://…` | `gzip, deflate, br, zstd` | `br, gzip` |

The restriction dates to brotli's rollout: middleboxes historically stripped
unrecognised `Content-Encoding` and re-gzipped the already-compressed body,
so browsers only offer it where TLS makes the response opaque. See the
[Chromium intent-to-ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/JufzX024oy0/m/LWEC-FJ7AwAJ)
and the [brotli list thread](https://groups.google.com/g/brotli/c/fN6M9A8aRnM).
Note that neither documents WebKit — the Safari row above is measured, not
cited.

Serve this app over plain HTTP and every browser falls back to gzip, which
is both larger on the wire and the path that carried the flush bug in
bean largediff-f518.

## The proxy must actually stream

Whatever terminates TLS has to pass `Accept-Encoding` through unmodified,
preserve the app's own `Content-Encoding` (the SSE stream is compressed by
a warm per-session encoder — a proxy that re-encodes destroys that), and
stream `text/event-stream` rather than buffering it. nginx buffers proxied
responses by default and will break SSE unless buffering is disabled
(`proxy_buffering off`, or honour the `x-accel-buffering: no` header the
app already sends).

## Run one instance

Single instance, deliberately. Sessions are in-memory plus SQLite, and a
session's SSE stream is pinned to the process that created it, so a second
replica behind the same hostname would hand a browser a session on one
instance and its stream on the other. Scale-out would need sticky routing
by session id; nothing else in the app requires it, so don't.

Set `LARGEDIFF_DB_PATH` to a path that survives restarts — the default is
`/tmp/largediff.db`, which is fine for a laptop and wrong for a server. The
other environment variables are documented in the README; none are required.

A minimal systemd service is enough:

```ini
[Service]
ExecStart=/path/to/bun src/server.ts
WorkingDirectory=/path/to/largediff
Environment=LARGEDIFF_DB_PATH=/var/lib/largediff/largediff.db
Restart=always
```

## Measuring a deployment

Every session page exposes `window.__ldMeasure({ jumps: 12 })`, which returns
a JSON report over a fixed file sequence. Compare highlight modes with
`?hl=spans` and `?hl=ranges`, minting a fresh session per run so the topbar
wire chip isn't cumulative. Check `timedOutJumps` first — anything above zero
means the run isn't comparable.
