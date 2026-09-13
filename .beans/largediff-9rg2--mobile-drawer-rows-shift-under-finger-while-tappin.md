---
# largediff-9rg2
title: Mobile drawer rows shift under finger while tapping due to sidebar auto-follow
status: completed
type: bug
priority: high
created_at: 2026-05-12T03:14:01Z
updated_at: 2026-05-12T03:14:01Z
parent: largediff-oyhu
---

## Symptom

On mobile, tapping a file in the drawer can land on the wrong file. The user reaches for a file they can see in the drawer, but by the time their finger touches down, a different row is in that position and the diff navigates to the wrong file.

## Root cause

The sidebar had a Datastar effect:

```html
data-effect="$activeFileId && document.querySelector('#file-tree .file-row[data-file-id=' + $activeFileId + ']')?.scrollIntoView({block:'nearest'})"
```

This fires every time $activeFileId changes. On desktop that's useful — the sidebar follows the diff. On mobile it's hostile: a /view POST in flight (from a recently-stopped scroll) lands while the drawer is opening or while the user is about to tap, the effect calls scrollIntoView on the file-list, and the rows shift under the user's finger. They tap the row that's at their finger position AFTER the shift.

The user reproduced this on the live site (their issue lit up several rapid bug fixes earlier in this session).

## Fix

Gate the desktop sidebar auto-follow behind `window.matchMedia('(min-width: 769px)').matches` so it ONLY runs on desktop. On mobile, replace it with a one-shot scrollIntoView triggered on drawer open via a MutationObserver on `body`'s class list. The active file row gets scrolled into view exactly once when the drawer opens; from that point on the user's manual scrolling is uncontested.

## Verification

Scrolled the diff to 5 positions in quick succession (triggering many /view POSTs and activeFile changes), opened the drawer, waited 300ms after the drawer settled, sampled the position of a row in the drawer twice — no movement. Tapped the row, the diff navigated to that exact file (sticky path matches the tapped file's path). Tested across taps for files near the start and end of the file list. Deployed to Fly.
