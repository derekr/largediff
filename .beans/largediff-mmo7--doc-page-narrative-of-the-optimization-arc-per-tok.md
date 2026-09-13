---
# largediff-mmo7
title: 'Doc page: narrative of the optimization arc + per-token spans, file-windowed sections, sidebar virtualization'
status: completed
type: task
priority: normal
created_at: 2026-05-12T21:21:03Z
updated_at: 2026-05-12T21:23:43Z
parent: largediff-oyhu
---

Update /doc to reflect the current architecture and tell the journey: per-row → file-windowed, CSS Custom Highlight API → per-token spans (Safari paint stall research), sidebar virtualization. Keep the original narrative as historical context inside each affected section.

- [x] Hero stats updated (LCP 16ms→57ms, 76 rows→5.3k nodes, etc.)
- [x] 'The window' reframed to file-windowed sections with a historical aside
- [x] 'The DOM' section replaced with 'The Safari stall' — research + per-token spans
- [x] New 'The arc' section: 5 corrections in order
- [x] 'By the numbers' refreshed with current measurements
- [x] 'Lessons' renamed to smaller-grain + new lessons (Safari SSE encoding, no inline scripts in morphs)
- [x] Verified /doc renders cleanly in Chrome; no console errors; all 5 cards in The arc section display correctly with their index chips and inline code.

Refs largediff-j615, largediff-d9xa, largediff-ta4r, largediff-r9wv, largediff-1tmh.

## Summary

src/render/doc.ts updated. Hero stats refreshed (LCP, DOM, etc.). 'The window' section reframed for file-windowed sections with a historical aside about per-row windowing. 'The DOM stays simple' (CSS Custom Highlight API) replaced with 'The Safari stall' telling the research findings + per-token-spans pivot. New 'The arc' section with 5 ordered corrections (sections-not-rows, scrollend, jumpToPx, Safari stall, sidebar virtualization). 'By the numbers' updated with current measurements. Existing 'Lessons' renamed to smaller-grain with 2 new entries (Safari SSE encoding, no inline scripts in morphs).
