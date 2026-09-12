// Server-rendered file tree — virtualized.
//
// The full file list is conceptually 500 rows × 32px = 16 000 px tall.
// We only emit the rows whose pixel range intersects the visible
// `.file-list` viewport (plus a generous overscan), absolutely
// positioned at their per-row tops inside a `.file-rows` host that
// claims the full 16 000 px so the browser's scrollbar geometry stays
// correct.
//
// State flow:
//   - On the diff scrolling into a new active file, the projection
//     overrides `sidebarScrollTop` to land the active row near the top
//     and pushes a `sidebarJumpToPx` so the client scrolls the
//     `.file-list` to match. The next render uses the new value.
//   - When the user scrolls the `.file-list` independently, the client
//     POSTs `/sidebar` with the new scrollTop. The server treats that
//     as the new authoritative value until the diff scrolls again.
//   - `sidebarScrollTop` is NOT persisted across sessions — every
//     reload derives a fresh one from the current active file so the
//     sidebar always lands on the file the diff is showing.

import type { DiffFileSummary, FileId } from "../store/diff.ts";
import { type JsxNode, renderToString, StaticHtml } from "./jsx-runtime.ts";

export const SIDEBAR_ROW_HEIGHT_PX = 32;

// Overscan above / below the visible window so a typical wheel/trackpad
// scroll stays inside already-mounted rows until the next push lands.
export const SIDEBAR_OVERSCAN_PX = 800;

export interface SidebarWindowResult {
  start: number;
  end: number;
  html: string;
}

export function renderSidebarShell(
  files: ReadonlyArray<DiffFileSummary>,
  initialRowsHtml: string,
): string {
  const totalHeight = files.length * SIDEBAR_ROW_HEIGHT_PX;
  return renderToString(
    <>
      <header class="file-tree-header">
        <span class="count">{files.length} files</span>
      </header>
      <div class="file-list">
        <div class="file-rows" style={`height:${totalHeight}px;position:relative;`}>
          <StaticHtml html={initialRowsHtml} />
        </div>
      </div>
    </>,
  );
}

export function renderSidebarWindow(
  files: ReadonlyArray<DiffFileSummary>,
  scrollTop: number,
  height: number,
  activeFileId: string,
): SidebarWindowResult {
  if (files.length === 0) return { start: 0, end: -1, html: "" };
  const rh = SIDEBAR_ROW_HEIGHT_PX;
  const top = Math.max(0, scrollTop - SIDEBAR_OVERSCAN_PX);
  const bot = scrollTop + Math.max(0, height) + SIDEBAR_OVERSCAN_PX;
  const start = Math.max(0, Math.floor(top / rh));
  const end = Math.min(files.length - 1, Math.ceil(bot / rh));
  const parts: string[] = [];
  for (let i = start; i <= end; i++) {
    const f = files[i];
    if (f === undefined) continue;
    parts.push(renderToString(<FileRow file={f} top={i * rh} active={f.id === activeFileId} />));
  }
  // Joined with "\n" only so the projection's newline split lands each
  // row on its own `elements` SSE data line — a raw newline can't appear
  // inside one data line, and per-row lines keep a captured stream
  // readable when debugging a push. Not load-bearing: the SSE consumer
  // rejoins data lines with "\n", and files.ts ships whole sections as a
  // single data line (~79 KB measured) in every supported browser.
  return { start, end, html: parts.join("\n") };
}

// One file row: navigation lives in a `data-on:click` POST, not an href —
// the `href="#"` is a keyboard-focus affordance only.
function FileRow(props: { file: DiffFileSummary; top: number; active: boolean }): JsxNode {
  const { file: f, top, active } = props;
  return (
    <a
      id={`file-row-${f.id}`}
      class={active ? "file-row active" : "file-row"}
      // biome-ignore lint/a11y/useValidAnchor: focus affordance
      href="#"
      data-file-id={f.id}
      style={`top:${top}px`}
      data-on:click__prevent={`$_drawerOpen = false; @post('/sessions/' + $_sid + '/files/${f.id}/jump')`}
    >
      <span class="path" title={f.path}>
        {f.path}
      </span>
      <span class="meta">
        <span class="lang">{f.language}</span>
        <span class="adds">+{f.additions}</span>
        <span class="dels">-{f.deletions}</span>
      </span>
    </a>
  );
}

export function renderSidebarRow(f: DiffFileSummary, top: number, active: boolean): string {
  return renderToString(<FileRow file={f} top={top} active={active} />);
}

export function sidebarSliceFileIds(
  files: ReadonlyArray<DiffFileSummary>,
  scrollTop: number,
  height: number,
): FileId[] {
  if (files.length === 0) return [];
  const rh = SIDEBAR_ROW_HEIGHT_PX;
  const top = Math.max(0, scrollTop - SIDEBAR_OVERSCAN_PX);
  const bot = scrollTop + Math.max(0, height) + SIDEBAR_OVERSCAN_PX;
  const start = Math.max(0, Math.floor(top / rh));
  const end = Math.min(files.length - 1, Math.ceil(bot / rh));
  const out: FileId[] = [];
  for (let i = start; i <= end; i++) {
    const f = files[i];
    if (f !== undefined) out.push(f.id);
  }
  return out;
}
