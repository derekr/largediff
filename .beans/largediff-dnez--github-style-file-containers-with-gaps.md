---
# largediff-dnez
title: GitHub-style file containers with gaps
status: completed
type: feature
priority: normal
created_at: 2026-05-11T19:20:21Z
updated_at: 2026-05-11T19:27:29Z
parent: largediff-oyhu
---

Polish the diff view to feel more like GitHub's "Files changed" tab: each file lives in its own visual container with rounded corners and a thin border, with a clear vertical gap between consecutive files. Inspiration: GitHub's PR diff UI (linked image in the originating message).

## Scope

- **Per-file container chrome**: rounded corners (~6px), 1px border in `--border`, slight background lift (slightly darker than the diff body in dark mode, slightly lighter in light mode). File-header row gets the top-rounded corners + top border; the file's last row gets the bottom-rounded corners + bottom border; intervening rows get only left/right borders.
- **Vertical gap between files**: ~16px of empty space between the bottom of one file and the top of the next.
- **File-header row redesigned**: tightened spacing, path left, language tag and `+adds -dels` counts right-aligned. Optional caret on the left as a hover target (no behavior yet — `/files/:fid/collapse` already exists for the follow-up).
- **Hunk-header row**: subtle blue/violet band similar to GitHub's `@@ … @@` strip, monospace, muted text colour, no border.
- **Line gutter**: distinct background for the old/new line-number columns so they read as a gutter, not part of the content. Right-aligned numbers, gutter slightly inset from the row's left edge. `+` / `-` markers in the gutter column itself rather than prefixing the text.

## Implementation notes (non-prescriptive)

Rows stay absolutely-positioned inside `#ds-window` — the visual container is faked per-row with conditional border classes. Server-side renderer needs to know which rows are "first in file" (file-header — already known) and "last in file" (compare next row's `fileIndex` from the layout) and emit either `data-last-in-file` or a CSS class so the styling can target border-bottom-radius + bottom border.

The vertical gap is implemented either as (a) extra padding on file-header rows pushing them down via `padding-top` and the `top` style stays where the layout puts them (so the rendered row paints lower than the slot start; visually creates a gap), or (b) by bumping `ROW_HEIGHTS["file-header"]` to include the gap as part of the file-header's allocated height. Option (b) is cleaner because all layout math stays accurate.

Verify with chrome-devtools MCP that scrolling still keeps the DOM bounded and the morph still applies cleanly.

## Acceptance criteria

- At any scroll position, visible files have distinct rounded containers with a gap between them.
- File-header / hunk-header / line rows each have visually distinct chrome matching the GitHub vibe (without being a 1:1 copy).
- `bun run check` and `bun test` clean.
- Live DOM node count remains bounded (no regression in 1qjv).
- Works in both light and dark themes (uses existing `--bg`/`--border`/`--sidebar-bg` tokens).

## Out of scope (potential follow-ups)

- File-header "Viewed" checkbox wired to `/files/:fid/reviewed`.
- File-header collapse caret wired to `/files/:fid/collapse`.
- Per-row comment UI.
- Split / side-by-side view (currently unified only).

## Todo

- [x] Bump `ROW_HEIGHTS["file-header"]` from 40 → 56 (40 header + 16 top gap baked into the slot)
- [x] `src/render/window.ts`: emit `data-last-in-file` on the row preceding a fileIndex change (or last row overall)
- [x] `src/render/window.ts`: nest a `.file-card-header` inside `.row.file-header` so the 16px top gap stays transparent and the header chrome below has its own rounded box
- [x] `src/render/window.ts`: restructure line rows so the `+`/`-` marker is its own gutter column (sibling to line numbers), not a `::before` on the text
- [x] `src/client/styles.css`: per-file container chrome scoped under `body[data-chrome="github"]` (left/right borders on every row, top border + rounded corners on `.file-card-header`, bottom border + rounded corners on `[data-last-in-file]`), GitHub-vibe hunk-header band (subtle blue), distinct gutter background, add/del tint on text column only
- [x] Tests: extended `window.test.ts` with three new cases (nested `.file-card-header`, dedicated marker column, `data-last-in-file` count matches file count)
- [x] Tests: `layout.test.ts` already references `ROW_HEIGHTS` symbolically — auto-adjusted to the new 56px
- [x] Browser verify with chrome-devtools MCP: visual 16px gap between f0 and f1 with rounded corners on both sides; toggle to `bleed` produces continuous look; DOM still ~73 rows at deep scroll positions
- [x] `bun run check` clean


## Update: toggleable rendering modes

Two chrome modes, switchable from the topbar:

- **`github`** (default for the demo) — the per-file container chrome described above.
- **`bleed`** (user's preferred) — current continuous look: no per-file containers, no inter-file gaps.

Server-side state: `SessionSettings.chrome: "github" | "bleed"`, default `"github"`. Persisted via `/sessions/:sid/settings`. Client uses Datastar `$chrome` signal seeded from session settings; body gets `data-attr:data-chrome="$chrome"` so all per-mode CSS scopes under `body[data-chrome="…"]`. The mode-switch buttons in the topbar set the signal locally (instant UI update) and POST to `/settings` to persist.

Implementation: `ROW_HEIGHTS["file-header"]` stays at the bumped 56px for both modes — `bleed` mode just paints the full 56px as solid header chrome instead of treating the top 16px as a transparent gap.

Added todo:

- [x] `SessionSettings.chrome` (default `"github"`), `applySettings` validates the enum (rejects unknown values)
- [x] Topbar two-button toggle (`GitHub` / `Full bleed`); current mode wins `.active` via `data-class:active="$chrome === '…'"`; click sets `$chrome` and POSTs `/settings`
- [x] `body` gets `data-attr:data-chrome="$chrome"` (+ initial attribute baked in server-side); CSS scopes both modes under `body[data-chrome="…"]`

## Summary of Changes

- `src/diff/layout.ts`: `ROW_HEIGHTS["file-header"]` bumped 40 → 56 to reserve a 16px transparent top slice for the inter-file gap in `github` chrome; exported `FILE_HEADER_GAP_PX = 16` as the canonical constant.
- `src/render/window.ts`: file-header row now nests a `.file-card-header` child (caret + path + lang + adds + dels). Line rows expose a dedicated `.marker` column (`+` / `-` / ` `) between line numbers and text instead of a `::before` pseudo-element. Every row that is the last in its file gets `data-last-in-file` (derived by comparing `layout.fileIndices[rowIndex+1]`).
- `src/render/shell.ts`: signals seeded with `chrome: settings.chrome`; body gets `data-attr:data-chrome="$chrome"` so the attribute follows the signal reactively (plus a server-rendered initial value so the first paint is correct). Topbar two-button toggle: each button does `$chrome = '…'; @post('/settings')`. `data-class:active` highlights the current mode.
- `src/session/types.ts` + `src/session/commands.ts`: `Chrome = 'github' | 'bleed'` added to `SessionSettings`, default `'github'`. `applySettings` validates the enum and rejects unknown values.
- `src/client/styles.css`: shared chrome-agnostic rules (gutter, marker, text tinting, hunk-header blue band) plus two mode blocks scoped under `body[data-chrome="github"]` (per-file containers, gaps, rounded corners) and `body[data-chrome="bleed"]` (continuous full-bleed look). Topbar toggle styles added.
- Tests: 4 new cases (3 in `window.test.ts`, 1 in `commands.test.ts`). Total 99 / 11 files, all green.

## Browser-verified

- `github` chrome: visible 16px gap between consecutive files, rounded top corners + file-header chrome, rounded bottom corners + bottom border on each file's last row, left/right borders on intervening rows.
- `bleed` chrome: continuous look, no per-file containers or gaps, header chrome spans the full slot.
- Toggle flips instantly via the signal binding; setting persists via `/settings` so refreshing the page keeps the chosen mode.
- Virtualization unchanged: DOM stays at ~70 rows at any scroll position; the scroll/jump UX from earlier epics still works.
