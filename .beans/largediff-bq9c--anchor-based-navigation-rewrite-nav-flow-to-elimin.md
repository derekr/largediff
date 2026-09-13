---
# largediff-bq9c
title: 'Anchor-based navigation: rewrite nav flow to eliminate Safari drift'
status: completed
type: feature
priority: high
created_at: 2026-05-12T04:49:21Z
updated_at: 2026-05-12T05:03:19Z
parent: largediff-oyhu
---

Subagent audit confirmed: drift comes from two paths computing 'active file' (click-driven /jump and scroll-driven /view) fighting over session.view.scrollTop. Wall-clock suppress windows (__suppressScrollPost 300ms) are unreliable on Safari because programmatic scrollIntoView emits scroll events outside the window.

Replace the scrollTo-signal + suppress-flag dance with anchor-based scroll: server emits [data-anchor] on the target file's first row inside the window morph, client MutationObserver scrollIntoView's it. The DOM is the source of truth for landing position; no pixels cross the wire.

Server-side guard against stale /view: ignore /view POSTs within 200ms of the latest /jump.

## Wire and state shape

- session.view = { scrollTop, height, lastJumpAt }. Drop selectedFileId.
- Signals on body: _sid, _drawerOpen, scrollTop, height, chrome, activeFile{Id,Path,Lang,Adds,Dels}. Drop scrollTo, selectedFileId, nextFilePixelTop.
- Active file is derived from scrollTop on every push.
- /jump: POST /sessions/:sid/files/:fid → set scrollTop, lastJumpAt; push with isJump=true → server includes data-anchor on the target file's first row.
- /view: applyView; if (now - lastJumpAt < 200ms && |body.scrollTop - server.scrollTop| > 50px) ignore. Else write scrollTop.
- pushProjection sequence: window morph (with anchor on jump), signals patch (activeFile*, no scrollTo), highlights script.
- Drop body-level data-effect for scrollTo and window.__suppressScrollPost.
- Drop sticky-bar push animation (per agreement) — sticky bar content still updates via activeFile* signals.

## Todo

- [ ] Update src/session/types.ts: drop selectedFileId, add lastJumpAt
- [ ] Update src/session/commands.ts: drop applyJump; applyView guards stale /view writes
- [ ] Update src/server.ts: drop body-based /jump route; URL route stops writing selectedFileId; sets lastJumpAt
- [ ] Update src/session/projection.ts: derive active from scrollTop; drop scrollTo from signals; add anchor support; isJump extras
- [ ] Update src/render/window.ts: accept anchorFileId param, emit data-anchor
- [ ] Update src/render/sidebar.ts: drop , simplify click handler
- [ ] Update src/render/shell.ts: drop scrollTo signal + body data-effect; drop sticky bar push markup
- [ ] Update src/client/highlights.ts: drop setupStickyPush; add setupAnchorScroll (MutationObserver on #ds-window)
- [ ] Update src/client/styles.css: drop sticky-push @keyframes and animation-* rules
- [ ] Update tests for new shape
- [ ] bun run check + bun test pass
- [ ] Deploy + verify on real Safari
