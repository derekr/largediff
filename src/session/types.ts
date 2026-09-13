// ReviewSession is the user's current view onto a diff. Tiny per session
// (bytes); the diff itself lives in the seed-keyed cache in the diff engine,
// shared by every session on that seed. Refined by the
// review-session-and-CQRS-routes epic (largediff-u4me) as command routes land.

import type { Seed } from "../store/diff.ts";

export type SessionId = string;

export type DiffMode = "unified" | "split";
export type Theme = "auto" | "light" | "dark";
export type Chrome = "github" | "bleed";
// How syntax tokens reach the browser.
//   "spans"  — each token is a `<span class="kw">…</span>` in the morph payload.
//   "ranges" — rows carry plain text plus a compact `data-tk` offset list;
//              the client builds Ranges and feeds `CSS.highlights`.
// "spans" is the production default (see the CSS Custom Highlight API note
// in CLAUDE.md). "ranges" is kept as a runtime-selectable mode so the
// Safari paint cost stays reproducible instead of being folklore —
// `?hl=ranges` on a session URL, or POST /settings {"highlight":"ranges"}.
export type HighlightMode = "spans" | "ranges";

export interface ViewState {
  scrollTop: number;
  height: number;
  // Server-driven sidebar virtualization mirrors the diff window:
  // client posts scrollTop/clientHeight of `.file-list` to /sidebar,
  // server slices the file list and morphs `.file-rows` with the
  // visible window of rows. Same skip-when-unchanged plumbing applies
  // — fingerprint is `start-end | activeFileId`.
  sidebarScrollTop: number;
  sidebarHeight: number;
  // Monotonic nav-epoch. Each /jump increments it. The current value rides
  // on every projection's signal patch and the client echoes it back in
  // every /view body. `applyView` drops any /view whose echoed epoch is
  // behind the server's — those are stale POSTs from the scroll event a
  // previous jump's scrollIntoView fired, which would otherwise overwrite
  // session.scrollTop with the pre-jump value. Race-free by construction.
  navEpoch: number;
  // The file id a /jump is asking the client to scroll to. Set by /jump
  // and consumed by the next pushProjection that actually reaches a
  // writer. If a click arrives before the SSE stream has attached, the
  // first pushProjection returns silently (no writer), this stays set, and
  // the writer-attach `onAttached` push picks it up. Eliminates the "two
  // clicks needed" race when the user clicks before the stream finishes
  // connecting — visible on slow networks like the Fly deployment.
  pendingAnchorFileId?: string;
  // Pixel position the client should scrollTo after the next push. Used
  // by the SSE stream-attach handler to restore the session's persisted
  // `scrollTop` on page reload: the initial page HTML hard-codes the
  // signal to 0 (the scroller is at the top), so without this the
  // restored sections would mount way down the page while the viewport
  // stayed at the origin → blank. Set on attach, consumed by the next
  // pushProjection that emits a `jumpToPx` signal carrying it.
  pendingInitialScrollTop?: number;
  // Same idea for the sidebar's `.file-list` — set by
  // /sidebar/recenter so the client scrolls the list to bring the
  // active file's row into a comfortable upper-third position. Server
  // computes the target pixel; client just does the scroll.
  pendingSidebarJumpToPx?: number;
  // Fingerprint of the last emitted fat morph. If a subsequent push
  // produces the same fingerprint AND no imperative is in flight, the
  // emit is skipped — the wire payload would be byte-identical and the
  // morph is a no-op. Cleared on stream re-attach so the reconnected
  // client gets a full re-emit (its DOM may have drifted; safer to
  // re-emit than to rely on a stale match).
  lastFingerprint?: string;
  // Last `activeFileId` we computed (file at scrollTop). Auto-recenter
  // only fires when this CHANGES — otherwise an idle /sidebar POST
  // would constantly drag the sidebar back to the active file every
  // time the user tries to scroll the file list independently.
  //
  // This was dead state for a while: it was assigned every render but
  // never read, and the recenter gated on `lastScrollTop` instead —
  // i.e. "did the diff move at all", which every throttled scroll tick
  // satisfies. The result was that simply *reading* the diff yanked the
  // sidebar back (see largediff-2ht5). It is now genuinely read.
  lastActiveFileId?: string;
  // True once the user has scrolled the file list themselves, cleared by
  // any explicit navigation (/jump, /top). Gates auto-recenter alongside
  // `lastActiveFileId`, giving one flat invariant:
  //
  //   the sidebar follows NAVIGATION; once you scroll the list by hand
  //   it is yours until you navigate again.
  //
  // Deliberately one explicit bit rather than a heuristic derived from
  // scroll deltas — `applySidebarView` and the projection's recenter were
  // two writers racing for one field, and no amount of delta-guessing
  // makes that arbitration legible.
  sidebarUserScrolled?: boolean;
  // Last `scrollTop` we rendered against. Auto-recenter only fires when
  // this differs from the current scrollTop — i.e. the *diff* scroll
  // moved since the last push. /sidebar POSTs leave scrollTop alone, so
  // they won't trip the recenter and clobber the user's independent
  // sidebar scroll. `undefined` on first render — treated as "needs
  // sync" so a reload of a persisted session with non-zero scrollTop
  // does land the sidebar on the active file.
  lastScrollTop?: number;
  // Monotonic counter bumped on every fat-morph emit that carries an
  // imperative `data-signals` element (jumpToPx / sidebarJumpToPx /
  // navEpoch updates). The morphed element's id includes the counter
  // so Idiomorph treats consecutive emits as distinct nodes; without
  // bumping, Idiomorph would match by id and Datastar's signals
  // binding wouldn't re-fire on the new payload.
  cmdSeq: number;
  // Monotonic count of morphs actually written to the wire, stamped into
  // the payload as `data-push`. Lets a lost morph be named — "the server
  // wrote push 15, the reader never saw it" — rather than inferred from a
  // content diff, and lets the wire and the DOM be compared directly.
  pushSeq: number;
  // Last `navEpoch` we shipped to the client. We only include it in
  // a morphed signals element when it changes — keeps the wire lean
  // and avoids the client thinking every emit is a fresh nav event.
  lastSentNavEpoch?: number;
}

export interface SessionSettings {
  mode: DiffMode;
  ignoreWhitespace: boolean;
  hideDeletions: boolean;
  theme: Theme;
  fontSize: number;
  tabWidth: number;
  chrome: Chrome;
  highlight: HighlightMode;
}

export interface ReviewSession {
  id: SessionId;
  seed: Seed;
  view: ViewState;
  settings: SessionSettings;
  createdAt: number;
  lastSeenAt: number;
}

export const DEFAULT_SETTINGS: SessionSettings = {
  mode: "unified",
  ignoreWhitespace: false,
  hideDeletions: false,
  theme: "auto",
  fontSize: 12,
  tabWidth: 2,
  chrome: "github",
  highlight: "spans",
};

export const DEFAULT_VIEW: ViewState = {
  scrollTop: 0,
  height: 0,
  sidebarScrollTop: 0,
  sidebarHeight: 0,
  navEpoch: 0,
  cmdSeq: 0,
  pushSeq: 0,
};
