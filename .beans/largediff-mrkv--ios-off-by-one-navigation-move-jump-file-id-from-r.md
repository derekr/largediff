---
# largediff-mrkv
title: 'iOS off-by-one navigation: move /jump file id from request body signal to URL path'
status: completed
type: bug
priority: high
created_at: 2026-05-12T03:37:13Z
updated_at: 2026-05-12T03:37:13Z
parent: largediff-oyhu
---

## Symptom

iOS-only: after the first sidebar tap, every subsequent tap navigates to the *previously* tapped file, not the one the user actually tapped. The first tap works; the second tap shows the first tap's file; the third tap shows the second tap's file; and so on. Not reproducible in Chrome desktop, Chrome mobile emulation, or with simulated touch events — confirmed iOS WebKit behavior.

## Diagnosis

The sidebar click handler set a Datastar signal and POSTed in one expression:

```
data-on:click__prevent="$selectedFileId = '${id}'; $_drawerOpen = false; @post('/sessions/' + $_sid + '/jump')"
```

The /jump server handler read `selectedFileId` from the POST body. The body was serialized from current signals. On iOS WebKit, Datastar appears to snapshot signal reads *before* the inline assignment commits — so the body carries the *previous* value of `$selectedFileId`. Server navigates to the previous file. Click N consistently shows file N-1.

## Fix

Carry the file id in the URL path, not the request body. New route `POST /sessions/:sid/files/:fid/jump`. Sidebar HTML bakes the file id into the URL at render time:

```
data-on:click__prevent="$_drawerOpen = false; @post('/sessions/' + $_sid + '/files/${id}/jump')"
```

The id is a string literal in the rendered handler — no signal lookup, no race. The legacy body-based /sessions/:sid/jump route is retained for API compatibility; both routes share a `doJump(session, fid)` helper.

## Verification

Sequential taps across f3, f10, f25, f5 on the live deployment via Chrome DevTools MCP: every sticky bar path matches the tapped file's path. Deployed; URL inspection confirms the rendered click handlers point at the new path-based route.
