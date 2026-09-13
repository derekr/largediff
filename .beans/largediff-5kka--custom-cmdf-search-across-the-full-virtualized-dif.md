---
# largediff-5kka
title: Custom cmd+f search across the full virtualized diff
status: todo
type: feature
priority: normal
created_at: 2026-05-11T21:24:50Z
updated_at: 2026-05-11T21:24:50Z
parent: largediff-oyhu
---

Native cmd+f only sees rows in the live DOM, and the virtualized window only renders the visible slice — so out-of-window matches are invisible. Build a server-driven full-diff search that hijacks cmd+f, paints matches via the CSS Custom Highlight API, and lets the user step through with Enter / Shift+Enter.

## Why

The whole pitch of largediff is that you can review a 200k-line diff and navigate it like a real PR. Search is part of "navigate it like a real PR" — without it the demo feels broken the moment anyone reaches for cmd+f. GitHub's own Files Changed view hijacks cmd+f for exactly this reason.

## Shape

State lives on the server. Per the Tao: search is a session-scoped query, matches are derived from the diff (shared per seed), highlights stream down on every projection push. The frontend has one new signal (`searchQuery`) and a thin search-bar element — everything else flows through the existing SSE projection.

## Wire format

Matches reuse the existing highlight tuple shape so the client can call the same `CSS.highlights.set(...)` codepath:

```ts
type SearchMatch = [fileId: string, lineIdx: number, startCol: number, endCol: number];
```

Two named highlight sets:
- `ds-search` — every match in the visible window
- `ds-search-current` — the single "active" match (bright outline)

## Backend

- `src/diff/search.ts` — `searchSeed(seed, query, opts)` walks each file's content lines and returns an ordered `SearchMatch[]`. Memoize on `(seed, normalizedQuery, caseSensitive)` in the existing DiffStore. Plain substring (no regex in MVP); case-insensitive by default with a toggle.
- `ReviewSession.search`: `{ query, matchIndex, caseSensitive, totalMatches }`. Empty query = search inactive.
- Commands (CQRS, all 204):
  - `POST /sessions/:sid/search` — body `{ query, caseSensitive? }`. Recompute matches, reset matchIndex to 0, project. Empty query closes search.
  - `POST /sessions/:sid/search/next` — `matchIndex = (matchIndex + 1) mod totalMatches`, scroll to it.
  - `POST /sessions/:sid/search/prev` — backward step, scroll to it.
- Projection additions in `pushProjection`:
  - Signal patch carries `searchTotal`, `searchIndex`, `searchOpen`.
  - For visible-window rows that contain matches, slice the global match list down to the visible line range (mirrors the syntax-highlight slicing already in projection.ts) and emit `ds-search` / `ds-search-current` highlight payloads.
  - "Step to match" reuses the existing `scrollTo` extras to scroll the row carrying the current match to viewport top (plus enough offset that the sticky bar doesn't cover it).

## Frontend

- Search bar in `render/shell.ts`: input + "N of M" + close button. Shown when `$searchOpen` is true. Datastar `data-on:keydown.meta.f.window__prevent` toggles `$searchOpen = true` and focuses the input.
- Input is bound to `$searchQuery` and POSTs `/search` on `__debounce.150ms`.
- Enter → `@post('/search/next')`; Shift+Enter → `@post('/search/prev')`; Esc → close (`@delete('/search')`).
- New `::highlight(ds-search)` and `::highlight(ds-search-current)` rules in styles.css — high-contrast yellow background, the current one gets an outline so it's distinguishable from the rest.

## Performance notes

- A linear substring scan over 200k lines × ~80 chars is well under 200ms single-threaded; no need for a worker in MVP. If we ever hit a wall, the search index is a natural fit for a worker since it's pure compute on diff content.
- Highlight ranges for the visible window already get sliced per push; the search highlights piggy-back on that path so there's no separate fanout.

## Todo

- [ ] `src/diff/search.ts` with `searchSeed` + memoization on the DiffStore
- [ ] Extend `ReviewSession` with the `search` sub-object + reset on settings change
- [ ] `POST /sessions/:sid/search` + next/prev routes wired to projection
- [ ] `pushProjection` emits `searchTotal` / `searchIndex` signals + `ds-search` / `ds-search-current` highlight payloads scoped to the visible window
- [ ] Step-to-match: `scrollTo` extras land the current match below the sticky bar
- [ ] Shell renders a search bar element, bound to `$searchOpen` / `$searchQuery`
- [ ] cmd+f keybind hijacks the browser default and focuses the input
- [ ] Enter / Shift+Enter / Esc bindings POST the right commands
- [ ] `::highlight(ds-search)` + `::highlight(ds-search-current)` styles
- [ ] Verify in Chrome DevTools MCP: cmd+f opens the bar, typing highlights live, next/prev navigates across files, Esc closes, browser cmd+f doesn't trigger

## Out of scope (follow-ups)

- Regex search (the diff generator's content is synthetic so a regex toggle would be demo flair, not core)
- Search scoped to a single file
- Match results sidebar / outline view
- Persisting last query across page reloads
