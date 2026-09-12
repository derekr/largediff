// View-push throttle: turns a scroll fling's POST storm into a steady
// cadence of projection pushes on the SSE stream.
//
// A pure debounce was wrong: during a continuous fling the timer kept
// getting reset and no push fired until the user stopped, leaving the
// rendered window stale and the viewport blank past overscan. Throttle
// keeps the first /view's push immediate (no lag on a small scroll),
// rate-limits subsequent pushes to one per `VIEW_THROTTLE_MS`, and
// schedules a trailing push so the final state isn't lost when the user
// halts.
//
// Moved out of server.ts so the entry stays pure routes: everything here
// reads like the windowing pattern it implements — slice on scroll,
// coalesce the chatter, push on a cadence.
import type { Metrics } from "../server/metrics.ts";
import type { ReviewSession, SessionId } from "./types.ts";

export const VIEW_THROTTLE_MS = 40;

// Quiet window after a command-driven push, during which /view pushes are
// forced onto the trailing edge instead of firing immediately.
//
// A jump moves the scroller, and that scroll fires /view, which produces a
// SECOND projection push a few tens of milliseconds after the jump's own.
// The client is left in the same place either way — the jump already
// rendered the window it asked for — but the two writes land back-to-back
// on the SSE stream, and that is exactly the shape that makes Safari's
// decompressor withhold a fragment until the next write arrives. Measured:
// two writes per trigger tail to a full inter-write interval, one write per
// trigger stays under 14ms. See largediff-pkrf.
//
// 250ms comfortably covers the echo scroll (instant scrollTo, so the events
// land within ~100ms) without making a real scroll after a jump feel lagged.
export const PUSH_COALESCE_MS = 250;
const coalesceUntil = new Map<SessionId, number>();

// A jump's own scrollTo lands the scroller on the pixel the jump already
// set, so the /view it fires reports a position the server chose and
// carries no information. Merging it into a trailing push was not enough —
// merged or not, it is still a SECOND write on the stream, which is the
// shape that trips Safari's decompressor. So inside the quiet window a
// /view that has not actually moved is dropped outright.
//
// The tolerance is sub-row on purpose: a genuine fling during the window
// moves far more than this and still gets through.
export const ECHO_TOLERANCE_PX = 4;

export function isEchoScroll(session: ReviewSession, body: unknown): boolean {
  if ((coalesceUntil.get(session.id) ?? 0) <= Date.now()) return false;
  if (body === null || typeof body !== "object") return false;
  const reported = (body as { scrollTop?: unknown }).scrollTop;
  if (typeof reported !== "number" || !Number.isFinite(reported)) return false;
  return Math.abs(reported - session.view.scrollTop) <= ECHO_TOLERANCE_PX;
}

// Called after any command-driven push. Everything /view produces for the
// next PUSH_COALESCE_MS is merged into a single trailing push.
export function beginCoalesce(sid: SessionId): void {
  coalesceUntil.set(sid, Date.now() + PUSH_COALESCE_MS);
}

interface ViewPushState {
  lastPushAt: number;
  trailingTimer?: ReturnType<typeof setTimeout>;
}
const viewPushState = new Map<SessionId, ViewPushState>();

export function scheduleViewPush(
  session: ReviewSession,
  push: (session: ReviewSession) => void,
  metrics?: Metrics,
): void {
  const now = Date.now();
  const state = viewPushState.get(session.id) ?? { lastPushAt: 0 };
  const since = now - state.lastPushAt;
  // Inside the quiet window after a command push, never take the leading
  // edge — coalesce into the trailing push so the command and its echo
  // scroll produce one write rather than two.
  const quiet = (coalesceUntil.get(session.id) ?? 0) > now;
  if (!quiet && since >= VIEW_THROTTLE_MS) {
    // Outside the window — push immediately, reset counter.
    metrics?.count("view_leading");
    state.lastPushAt = now;
    if (state.trailingTimer !== undefined) {
      clearTimeout(state.trailingTimer);
      state.trailingTimer = undefined;
    }
    viewPushState.set(session.id, state);
    push(session);
    return;
  }
  // Inside the window — schedule (or refresh) the trailing-edge push so
  // the latest state lands after the throttle elapses. deferred vs
  // trailing_fired is the coalescing ratio: many deferred collapsing into
  // few fired means the throttle is absorbing a chatty client, not that
  // the server is slow.
  metrics?.count("view_deferred");
  if (state.trailingTimer !== undefined) clearTimeout(state.trailingTimer);
  const delay = quiet
    ? Math.max(VIEW_THROTTLE_MS, (coalesceUntil.get(session.id) ?? now) - now)
    : VIEW_THROTTLE_MS - since;
  state.trailingTimer = setTimeout(() => {
    const s = viewPushState.get(session.id);
    if (s !== undefined) {
      s.trailingTimer = undefined;
      s.lastPushAt = Date.now();
    }
    metrics?.count("view_trailing_fired");
    push(session);
  }, delay);
  viewPushState.set(session.id, state);
}

export function cancelPendingViewPush(sid: SessionId): void {
  const state = viewPushState.get(sid);
  if (state?.trailingTimer !== undefined) {
    clearTimeout(state.trailingTimer);
    state.trailingTimer = undefined;
    viewPushState.set(sid, state);
  }
}

// Drop everything this module holds for a session that has left the store.
// Called by the store's onEvict hook (sweep + DELETE route) via server.ts.
export function dropViewPushState(sid: SessionId): void {
  cancelPendingViewPush(sid);
  viewPushState.delete(sid);
  coalesceUntil.delete(sid);
}

// Test hook: whether a trailing-edge push is currently scheduled.
export function hasTrailingTimer(sid: SessionId): boolean {
  return viewPushState.get(sid)?.trailingTimer !== undefined;
}
