---
# largediff-79xh
title: Safari requires two clicks on sidebar links because <a> elements have no href
status: completed
type: bug
priority: high
created_at: 2026-05-12T04:18:59Z
updated_at: 2026-05-12T04:18:59Z
parent: largediff-oyhu
---

## Symptom

On Safari (both desktop and iOS), clicking a file row in the sidebar required two clicks — the first click did nothing visible, the second click performed the navigation. Chromium and Firefox treated the first click as the real interaction.

## Root cause

The sidebar file rows were rendered as `<a class="file-row" data-on:click__prevent="...">` with no `href` attribute. Safari treats an `<a>` without an href as a non-interactive element on the first click — it fires a focus/select pass instead. The real click event only fires on the second interaction. Chromium and Firefox don't have this behavior.

## Fix

Add `href="#"` to each sidebar file row. The `data-on:click__prevent` directive cancels the # fragment navigation that the href would otherwise trigger, so behavior is unchanged in every browser other than Safari — but Safari now treats the anchor as a proper interactive element and delivers the click on the first interaction.

## Verification

Deployed; rendered HTML inspected via curl confirms every `.file-row` carries `href="#"`. Existing sidebar tests still pass (they assert the click handler string, which didn't change).
