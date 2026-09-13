---
# largediff-j615
title: 'Performance audit: chrome-devtools tracing of largediff load, jump, and fast scroll'
status: completed
type: task
priority: normal
created_at: 2026-05-12T21:03:06Z
updated_at: 2026-05-12T21:16:25Z
parent: largediff-oyhu
---

Capture three traces and synthesize findings. Focus on long tasks, layout/paint cost, and any unexpected JS work in the hot path.

## Scenarios

- [ ] Cold load (page open → LCP)
- [ ] Sidebar file jump (click → paint)
- [ ] Fast scroll (sustained drag)

## Output

Single short report: per-scenario top costs, anything actionable.

## Summary

Three traces captured: cold load (LCP 65ms, CLS 0.00 — excellent baseline), sidebar jump (87ms cumulative forced reflow + DOMSize warning flagging the 500 sidebar rows), fast scroll (clean — throttle + scrollend + skip-when-unchanged plumbing pays off).

One actionable finding: virtualize the sidebar. Resulted in largediff-d9xa. After that landed: DOM 7814→5254, LCP 65→57ms, HTML payload 141.9→18.3kB. Sidebar no longer the largest DOM cluster.
