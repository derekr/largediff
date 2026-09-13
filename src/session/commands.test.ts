import { describe, expect, test } from "bun:test";
import { InMemorySessionStore } from "../store/sessions.ts";
import {
  applySettings,
  applySidebarView,
  applyView,
  applyViewHeight,
  MAX_VIEWPORT_PX,
} from "./commands.ts";

function newSession() {
  const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
  const s = store.create("seed");
  store.stop();
  return s;
}

describe("applyView", () => {
  test("patches scrollTop and height", () => {
    const s = newSession();
    applyView(s, { scrollTop: 1234, height: 800 });
    expect(s.view.scrollTop).toBe(1234);
    expect(s.view.height).toBe(800);
  });

  test("clamps negative values to zero", () => {
    const s = newSession();
    applyView(s, { scrollTop: -10, height: -5 });
    expect(s.view.scrollTop).toBe(0);
    expect(s.view.height).toBe(0);
  });

  test("ignores non-numeric fields", () => {
    const s = newSession();
    s.view.scrollTop = 100;
    s.view.height = 600;
    applyView(s, { scrollTop: "nope", height: null });
    expect(s.view.scrollTop).toBe(100);
    expect(s.view.height).toBe(600);
  });

  test("ignores non-object body", () => {
    const s = newSession();
    s.view.scrollTop = 99;
    applyView(s, null);
    applyView(s, undefined);
    applyView(s, 42);
    expect(s.view.scrollTop).toBe(99);
  });
});

describe("applyView nav-epoch gate", () => {
  test("accepts /view when client echoes the current navEpoch", () => {
    const s = newSession();
    s.view.navEpoch = 3;
    applyView(s, { scrollTop: 5000, height: 800, navEpoch: 3 });
    expect(s.view.scrollTop).toBe(5000);
    expect(s.view.height).toBe(800);
  });

  test("drops /view whose echoed navEpoch is behind", () => {
    const s = newSession();
    s.view.navEpoch = 5;
    s.view.scrollTop = 12345; // jump's authoritative scrollTop
    // Stale /view from before the most recent /jump: client signal still
    // reflects an earlier epoch.
    applyView(s, { scrollTop: 999, height: 800, navEpoch: 4 });
    expect(s.view.scrollTop).toBe(12345);
  });

  test("accepts /view when body omits navEpoch entirely (initial paint)", () => {
    const s = newSession();
    s.view.navEpoch = 0;
    applyView(s, { scrollTop: 200, height: 600 });
    expect(s.view.scrollTop).toBe(200);
  });
});

describe("applySettings", () => {
  test("patches only valid fields, leaves rest intact", () => {
    const s = newSession();
    applySettings(s, { mode: "split", theme: "dark", tabWidth: 4 });
    expect(s.settings.mode).toBe("split");
    expect(s.settings.theme).toBe("dark");
    expect(s.settings.tabWidth).toBe(4);
    // unchanged defaults
    expect(s.settings.ignoreWhitespace).toBe(false);
    expect(s.settings.hideDeletions).toBe(false);
    expect(s.settings.fontSize).toBe(12);
  });

  test("clamps fontSize and tabWidth to safe ranges", () => {
    const s = newSession();
    applySettings(s, { fontSize: 500, tabWidth: 99 });
    expect(s.settings.fontSize).toBe(40);
    expect(s.settings.tabWidth).toBe(8);
    applySettings(s, { fontSize: 1, tabWidth: 0 });
    expect(s.settings.fontSize).toBe(8);
    expect(s.settings.tabWidth).toBe(1);
  });

  test("rejects unknown enum values", () => {
    const s = newSession();
    applySettings(s, { mode: "weird", theme: "purple" });
    expect(s.settings.mode).toBe("unified");
    expect(s.settings.theme).toBe("auto");
  });

  test("accepts boolean toggles", () => {
    const s = newSession();
    applySettings(s, { ignoreWhitespace: true, hideDeletions: true });
    expect(s.settings.ignoreWhitespace).toBe(true);
    expect(s.settings.hideDeletions).toBe(true);
  });

  test("accepts chrome enum and rejects unknown values", () => {
    const s = newSession();
    expect(s.settings.chrome).toBe("github");
    applySettings(s, { chrome: "bleed" });
    expect(s.settings.chrome).toBe("bleed");
    applySettings(s, { chrome: "weird" });
    expect(s.settings.chrome).toBe("bleed");
  });
});

describe("viewport height clamp", () => {
  // Unclamped, a single POST with height=2,000,000 streamed 103MB and
  // burned 0.8s of server CPU. These tests are what keeps the clamp from
  // being "simplified" away.
  test("applyView clamps height to MAX_VIEWPORT_PX", () => {
    const s = newSession();
    applyView(s, { scrollTop: 0, height: 2_000_000 });
    expect(s.view.height).toBe(MAX_VIEWPORT_PX);
  });

  test("applySidebarView clamps sidebarHeight to MAX_VIEWPORT_PX", () => {
    const s = newSession();
    applySidebarView(s, { scrollTop: 0, height: 1e9 });
    expect(s.view.sidebarHeight).toBe(MAX_VIEWPORT_PX);
  });

  test("real viewport heights pass through unclamped", () => {
    const s = newSession();
    applyView(s, { height: 2160 });
    expect(s.view.height).toBe(2160);
  });
});

describe("applyViewHeight", () => {
  test("applies only the height and reports the change", () => {
    const s = newSession();
    s.view.scrollTop = 500;
    expect(applyViewHeight(s, { scrollTop: 900, height: 800 })).toBe(true);
    expect(s.view.height).toBe(800);
    // scrollTop untouched — the echo-drop decision still owns it.
    expect(s.view.scrollTop).toBe(500);
  });

  test("returns false when the height is absent or unchanged", () => {
    const s = newSession();
    s.view.height = 800;
    expect(applyViewHeight(s, { scrollTop: 900 })).toBe(false);
    expect(applyViewHeight(s, { height: 800 })).toBe(false);
  });

  test("clamps and respects the stale-epoch gate", () => {
    const s = newSession();
    s.view.navEpoch = 5;
    expect(applyViewHeight(s, { height: 700, navEpoch: 4 })).toBe(false);
    expect(s.view.height).toBe(0);
    expect(applyViewHeight(s, { height: 9_999_999, navEpoch: 5 })).toBe(true);
    expect(s.view.height).toBe(MAX_VIEWPORT_PX);
  });
});
