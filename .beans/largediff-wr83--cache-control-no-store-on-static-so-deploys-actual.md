---
# largediff-wr83
title: 'Cache-Control: no-store on /static/* so deploys actually reach users'
status: completed
type: bug
priority: high
created_at: 2026-05-12T00:14:27Z
updated_at: 2026-05-12T00:14:27Z
parent: largediff-oyhu
---

The /static/styles.css and /static/highlights.js routes were responding with no Cache-Control header at all. The browser's heuristic cache (Last-Modified-based, falls back to ~10% of resource age) treated these as cacheable indefinitely. Result: after a deploy, returning users continued running the previous version of the bundle until they manually hard-refreshed — which made the mobile drawer animation glitch (largediff-itcg) and the jump-blank bug appear still broken to anyone who'd loaded the site before the fix.

## Fix

Both static routes in src/server.ts now send Cache-Control: no-store. The two bundles are ~5 KB + ~20 KB; the wire cost of re-downloading is trivial against any benefit.

If/when this matters more (e.g., scaling beyond demo traffic), the right answer is fingerprinted asset URLs (/static/styles.<hash>.css) with Cache-Control: public, max-age=31536000, immutable. Out of scope for now.
