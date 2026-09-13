// In-place mutators for each CQRS command. Routes parse the JSON body and
// hand it to one of these; everything else (session lookup, push, 204) is
// HTTP-layer scaffolding. Invalid or missing fields are silently ignored so
// partial patches "just work".

import type { Chrome, DiffMode, HighlightMode, ReviewSession, Theme } from "./types.ts";

// Upper bound for any client-reported viewport height. The height drives how
// many rows every subsequent push renders, so an unclamped value is a remote
// DoS: a single anonymous POST with height=2,000,000 measured 103MB streamed
// and 0.8s of server CPU (height=800 is ~810KB). 4096 CSS px covers a 4K
// display in portrait; no real viewport exceeds it.
export const MAX_VIEWPORT_PX = 4096;

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function asMode(v: unknown): DiffMode | undefined {
  return v === "unified" || v === "split" ? v : undefined;
}

function asTheme(v: unknown): Theme | undefined {
  return v === "auto" || v === "light" || v === "dark" ? v : undefined;
}

function asChrome(v: unknown): Chrome | undefined {
  return v === "github" || v === "bleed" ? v : undefined;
}

function asHighlight(v: unknown): HighlightMode | undefined {
  return v === "spans" || v === "ranges" ? v : undefined;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function clampHeight(h: number): number {
  return Math.max(0, Math.min(MAX_VIEWPORT_PX, h));
}

// Stale-epoch gate shared by `applyView` and `applyViewHeight`. See the
// comment in `applyView` for why epoch-stale POSTs are dropped wholesale.
function isStaleEpoch(session: ReviewSession, b: Record<string, unknown>): boolean {
  const clientEpoch = asNumber(b.navEpoch);
  return clientEpoch !== undefined && clientEpoch < session.view.navEpoch;
}

// Apply only the `height` field of a /view body. Split out so the route can
// run it BEFORE the echo-scroll drop: a resize racing a jump produces a
// /view whose scrollTop echoes within tolerance but whose height is genuinely
// new, and dropping the whole POST would leave the window sliced for the old
// viewport. Returns true when the stored height actually changed.
export function applyViewHeight(session: ReviewSession, body: unknown): boolean {
  const b = asObject(body);
  if (b === undefined) return false;
  if (isStaleEpoch(session, b)) return false;
  const height = asNumber(b.height);
  if (height === undefined) return false;
  const clamped = clampHeight(height);
  if (clamped === session.view.height) return false;
  session.view.height = clamped;
  return true;
}

export function applyView(session: ReviewSession, body: unknown): void {
  const b = asObject(body);
  if (b === undefined) return;
  // Epoch gate. The client echoes whichever navEpoch its current signals
  // hold; the server's navEpoch is incremented by each /jump. A /view POST
  // whose echoed epoch is behind the server's was emitted under a stale
  // notion of where the diff was — e.g. the scroll event that fired from
  // an earlier /jump's scrollIntoView, posted *after* a newer /jump
  // updated the authoritative scrollTop. Drop it. No wall-clock, no
  // tolerance band — order is established by counter, not by timing.
  if (isStaleEpoch(session, b)) return;

  const scrollTop = asNumber(b.scrollTop);
  const height = asNumber(b.height);
  if (scrollTop !== undefined) session.view.scrollTop = Math.max(0, scrollTop);
  if (height !== undefined) session.view.height = clampHeight(height);
}

// Back to top: server-driven scroll-to-0. Bumps `navEpoch` so a stale
// /view POST that races in afterwards (the settling scroll event from
// the previous position) loses the epoch check and gets dropped.
// `pendingInitialScrollTop = 0` tells the next push to emit a
// `data-init` that scrolls the client's `#scroller` to 0.
export function applyTop(session: ReviewSession): void {
  session.view.scrollTop = 0;
  session.view.navEpoch += 1;
  session.view.pendingInitialScrollTop = 0;
  // Explicit navigation — the sidebar goes back to following the diff.
  session.view.sidebarUserScrolled = false;
}

// Sidebar scroll telemetry. Same shape as applyView but writes to the
// `sidebarScrollTop` / `sidebarHeight` fields the projection slices the
// file tree by. No epoch gating — sidebar scrolls are user-driven and
// can't race with /jump in the way diff-view scrolls do.
export function applySidebarView(session: ReviewSession, body: unknown): void {
  const b = asObject(body);
  if (b === undefined) return;
  const scrollTop = asNumber(b.scrollTop);
  const height = asNumber(b.height);
  if (scrollTop !== undefined) session.view.sidebarScrollTop = Math.max(0, scrollTop);
  // Same clamp as the diff viewport: sidebarHeight sizes the file-tree
  // slice AND the projection's prewarm loop, so an unbounded value is the
  // same render-amplification hole as an unbounded diff height.
  if (height !== undefined) session.view.sidebarHeight = clampHeight(height);
  // Ownership flips only on an explicit gesture. The client sets `user`
  // on its scroll listeners and leaves it false for the initial
  // measurement, the resize handler, and anything it performed on the
  // server's behalf. Deriving this from "a scrollTop was present" would
  // hand ownership over on page load, before the reader has done
  // anything, and suppress the first auto-recenter. See largediff-2ht5.
  if (asBoolean(b.user) === true) session.view.sidebarUserScrolled = true;
}

export function applySettings(session: ReviewSession, body: unknown): void {
  const b = asObject(body);
  if (b === undefined) return;
  const s = session.settings;
  const mode = asMode(b.mode);
  if (mode !== undefined) s.mode = mode;
  const theme = asTheme(b.theme);
  if (theme !== undefined) s.theme = theme;
  const ignoreWhitespace = asBoolean(b.ignoreWhitespace);
  if (ignoreWhitespace !== undefined) s.ignoreWhitespace = ignoreWhitespace;
  const hideDeletions = asBoolean(b.hideDeletions);
  if (hideDeletions !== undefined) s.hideDeletions = hideDeletions;
  const fontSize = asNumber(b.fontSize);
  if (fontSize !== undefined) s.fontSize = Math.max(8, Math.min(40, Math.round(fontSize)));
  const tabWidth = asNumber(b.tabWidth);
  if (tabWidth !== undefined) s.tabWidth = Math.max(1, Math.min(8, Math.round(tabWidth)));
  const chrome = asChrome(b.chrome);
  if (chrome !== undefined) s.chrome = chrome;
  const highlight = asHighlight(b.highlight);
  if (highlight !== undefined) s.highlight = highlight;
}
