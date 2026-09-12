---
# largediff-y3i7
title: JSX render layer over a local runtime (files, shell, sidebar)
status: in-progress
type: feature
priority: normal
created_at: 2026-09-12T18:23:08Z
updated_at: 2026-09-12T18:23:08Z
---

Convert server render layer (files, shell, sidebar) from HTML strings to
JSX over a tiny local runtime. doc.tsx explicitly deferred.

- [x] src/render/jsx-runtime.ts (jsx/jsxs/Fragment/StaticHtml +
  renderToString; text escaped, attributes escape &<>" but keep single
  quotes raw for Datastar expressions, script/style children raw text) —
  wired via tsconfig paths alias for react/jsx-runtime + jsx-dev-runtime
  (zero deps; Bun uses the dev entry unless NODE_ENV=production)
- [x] render/files.tsx: <FileSection>/<FileCardHeader>/<InnerRows>/<Row>,
  <TokenLine> vs plain-text branch, tokenRanges helper
- [x] render/shell.tsx: <AppInner> layout, <CmdElement> one-shot command
  component, <WireChip>, dotted Datastar attrs via spread, trace scripts
  as module constants through <StaticHtml>
- [x] render/sidebar.tsx: <FileRow> (href is a focus affordance —
  biome-ignore on the attribute line; multi-line ignore comments don't
  match)
- [x] Byte-parity verified vs HEAD pre-conversion render on a fixed seed
  (scripts/render-parity.ts): slice + sidebarWindow byte-identical;
  appInner/shell semantically identical after normalizing the two
  intentional differences (attribute quote style: single -> double, and
  inter-attribute/tag whitespace). All 5 shell <script> blocks verbatim.
- [x] shell.test.ts data-signals regexes updated for double quotes
- [x] README pattern map naming the components as the seams

## Summary of Changes
- New: src/render/jsx-runtime.ts + test, scripts/render-parity.ts
- Converted: files.tsx, shell.tsx, sidebar.tsx (renames, imports updated
  in projection/server/tests)
- tsconfig paths alias
