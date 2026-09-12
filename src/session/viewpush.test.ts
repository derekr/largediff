import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, DEFAULT_VIEW, type ReviewSession } from "./types.ts";
import {
  beginCoalesce,
  cancelPendingViewPush,
  dropViewPushState,
  hasTrailingTimer,
  isEchoScroll,
  scheduleViewPush,
} from "./viewpush.ts";

function makeSession(sid: string, scrollTop = 0): ReviewSession {
  return {
    id: sid,
    seed: "demo",
    view: { ...DEFAULT_VIEW, scrollTop },
    settings: { ...DEFAULT_SETTINGS },
    createdAt: 1_000_000,
    lastSeenAt: 1_000_000,
  };
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("scheduleViewPush", () => {
  test("first view in a quiet window pushes on the leading edge, synchronously", () => {
    const session = makeSession("vp-leading");
    const pushed: string[] = [];
    scheduleViewPush(session, (s) => pushed.push(s.id));
    expect(pushed).toEqual(["vp-leading"]);
    expect(hasTrailingTimer("vp-leading")).toBe(false);
    dropViewPushState("vp-leading");
  });

  test("a second view inside 40ms defers to a trailing push", async () => {
    const session = makeSession("vp-trailing");
    const pushed: string[] = [];
    scheduleViewPush(session, (s) => pushed.push(s.id));
    scheduleViewPush(session, (s) => pushed.push(s.id));
    // Leading fired sync; the second is parked on the timer.
    expect(pushed).toEqual(["vp-trailing"]);
    expect(hasTrailingTimer("vp-trailing")).toBe(true);
    await sleep(100);
    expect(pushed).toEqual(["vp-trailing", "vp-trailing"]);
    expect(hasTrailingTimer("vp-trailing")).toBe(false);
    dropViewPushState("vp-trailing");
  });

  test("quiet window after a command suppresses the leading edge", () => {
    const session = makeSession("vp-quiet", 5000);
    const pushed: string[] = [];
    beginCoalesce("vp-quiet");
    scheduleViewPush(session, (s) => pushed.push(s.id));
    expect(pushed).toEqual([]);
    expect(hasTrailingTimer("vp-quiet")).toBe(true);
    dropViewPushState("vp-quiet");
  });

  test("cancelPendingViewPush drops a parked trailing push", async () => {
    const session = makeSession("vp-cancel");
    const pushed: string[] = [];
    scheduleViewPush(session, (s) => pushed.push(s.id));
    scheduleViewPush(session, (s) => pushed.push(s.id));
    expect(hasTrailingTimer("vp-cancel")).toBe(true);
    cancelPendingViewPush("vp-cancel");
    expect(hasTrailingTimer("vp-cancel")).toBe(false);
    await sleep(100);
    expect(pushed).toEqual(["vp-cancel"]);
    dropViewPushState("vp-cancel");
  });
});

describe("isEchoScroll", () => {
  test("a jump's own scroll position inside the window is an echo", () => {
    const session = makeSession("vp-echo", 5000);
    beginCoalesce("vp-echo");
    expect(isEchoScroll(session, { scrollTop: 5002 })).toBe(true);
    expect(isEchoScroll(session, { scrollTop: 6000 })).toBe(false);
    dropViewPushState("vp-echo");
  });

  test("outside the window nothing is an echo, and neither is garbage", () => {
    const session = makeSession("vp-noecho", 5000);
    expect(isEchoScroll(session, { scrollTop: 5000 })).toBe(false);
    expect(isEchoScroll(session, null)).toBe(false);
    expect(isEchoScroll(session, { scrollTop: Number.NaN })).toBe(false);
    expect(isEchoScroll(session, { scrollTop: "5000" })).toBe(false);
    dropViewPushState("vp-noecho");
  });
});
