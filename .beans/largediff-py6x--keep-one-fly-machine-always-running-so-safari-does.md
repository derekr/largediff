---
# largediff-py6x
title: Keep one Fly machine always running so Safari doesn't trip cold-start rate limit
status: completed
type: bug
priority: high
created_at: 2026-05-13T15:27:56Z
updated_at: 2026-05-13T17:19:04Z
---

Safari's GET /stream was failing with "Load failed" while Chrome worked. Investigation showed Fly's edge proxy was rejecting Safari's requests with: '[PM01] machines API returned an error: rate limit exceeded — could not find a good candidate within 1 attempts at load balancing.' The requests never reached our app (no [stream] attach log entries for Safari sessions).

Root cause: fly.toml has auto_stop_machines = 'stop' and min_machines_running = 0. The single shared-cpu-1x VM auto-sleeps when idle. Chrome happened to wake it first and kept it warm via the persistent SSE; Safari opened later, machine was stopped, cold-start tripped the Fly machines API rate limit, Datastar's retry loop kept retrying every ~1s which kept the API rate-limited, so Safari never got through.

Fix: set min_machines_running = 1 so the machine stays warm. /tmp/largediff.db is already wiped on each deploy, so persistence behavior is unchanged.

## Todo
- [x] Set min_machines_running = 1 in fly.toml
- [ ] Deploy
- [x] Verify Safari connects (look for [stream] attach with Safari UA in fly logs)
- [x] Remove diagnostic console.log lines from src/session/stream.ts

## Summary of Changes

Set min_machines_running=1 and auto_stop_machines='off' in fly.toml so the single VM stays warm and incoming requests don't trip Fly's [PM01] machines-API rate limit on cold-start. Confirmed via fly logs that the rate-limit cascade no longer occurs after restart.

(The user-facing 'Load failed' bug had a separate cause — Safari's text/event-stream body buffering — fixed in largediff-1ch9.)
