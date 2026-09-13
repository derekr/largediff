import { describe, expect, test } from "bun:test";
import { createDiffEngine } from "../diff/generator.ts";
import { InMemorySessionStore } from "../store/sessions.ts";
import { applySidebarView, applyTop } from "./commands.ts";
import { pushProjection, type SessionWriter, WriterRegistry } from "./projection.ts";
import type { ReviewSession } from "./types.ts";

function recordingWriter(): SessionWriter & {
  events: Array<{ event: string; data: string }>;
  closed: boolean;
} {
  const events: Array<{ event: string; data: string }> = [];
  let closed = false;
  return {
    events,
    get closed() {
      return closed;
    },
    send(event, data) {
      events.push({ event, data });
    },
    close() {
      closed = true;
    },
  };
}

function makeEngine() {
  return createDiffEngine({ defaultLines: 600 });
}

describe("WriterRegistry", () => {
  test("attach + get + has + size", () => {
    const registry = new WriterRegistry();
    const w = recordingWriter();
    expect(registry.has("a")).toBe(false);
    registry.attach("a", w);
    expect(registry.has("a")).toBe(true);
    expect(registry.get("a")).toBe(w);
    expect(registry.size).toBe(1);
  });

  test("detach closes the writer and removes it", () => {
    const registry = new WriterRegistry();
    const w = recordingWriter();
    registry.attach("a", w);
    registry.detach("a");
    expect(registry.has("a")).toBe(false);
    expect(w.closed).toBe(true);
  });

  test("detach of unknown sid is a no-op", () => {
    const registry = new WriterRegistry();
    expect(() => registry.detach("never-attached")).not.toThrow();
  });
});

describe("pushProjection", () => {
  test("is a no-op when no writer is attached", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const session = store.create("seed");
    const registry = new WriterRegistry();
    expect(() =>
      pushProjection(session, { writers: registry, engine: makeEngine() }),
    ).not.toThrow();
    store.stop();
  });

  test("emits a single fat morph onto #app", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const session = store.create("demo");
    const registry = new WriterRegistry();
    const w = recordingWriter();
    registry.attach(session.id, w);

    pushProjection(session, { writers: registry, engine: makeEngine() });
    // One morph event covers the whole app inner (topbar + sidebar +
    // diff). No accompanying signals patch since no imperative is in
    // flight on this first push.
    expect(w.events.length).toBe(1);
    const elements = w.events[0];
    expect(elements?.event).toBe("datastar-patch-elements");
    const lines = elements?.data.split("\n") ?? [];
    expect(lines[0]).toBe("selector #app");
    expect(lines[1]).toBe("mode inner");
    for (let i = 2; i < lines.length; i++) {
      expect(lines[i]?.startsWith("elements ")).toBe(true);
    }
    // Payload should contain both the topbar chrome and the diff/sidebar
    // slices it morphs in.
    expect(elements?.data).toContain('class="topbar"');
    expect(elements?.data).toContain('id="file-tree"');
    expect(elements?.data).toContain('id="ds-window"');
    expect(elements?.data).toMatch(/<span class="(kw|str|cmt|num|fn|typ)">/);
    expect(elements?.data).toMatch(/class="file-row active"/);
    store.stop();
  });

  test("emits jumpToPx in the signal patch when pendingAnchorFileId is set", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const session = store.create("demo");
    const registry = new WriterRegistry();
    const w = recordingWriter();
    registry.attach(session.id, w);

    const engine = makeEngine();
    const fid = engine.meta("demo").files[1]?.id;
    if (fid === undefined) throw new Error("fixture must have >=2 files");
    session.view.scrollTop = 0;
    session.view.pendingAnchorFileId = fid;

    pushProjection(session, { writers: registry, engine });
    // Single fat morph — the imperative scroll rides as a `data-init`
    // attribute on a transient command element baked into the morph
    // payload, not as a separate `datastar-patch-signals` event.
    expect(w.events.length).toBe(1);
    const morph = w.events[0];
    expect(morph?.event).toBe("datastar-patch-elements");
    const expectedPx = engine.layout("demo").pixelTopForFile(1) + 32;
    expect(morph?.data).toContain(`window.__largediffJump?.(${expectedPx})`);
    expect(morph?.data).toMatch(/<div id="cmd-\d+"[^>]*data-init="[^"]+">/);
    expect(session.view.pendingAnchorFileId).toBeUndefined();
    store.stop();
  });

  test("preserves pendingAnchorFileId when no writer is attached (deferred to next push)", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const session = store.create("demo");
    const registry = new WriterRegistry(); // no writer attached
    session.view.pendingAnchorFileId = "f0";

    pushProjection(session, { writers: registry, engine: makeEngine() });
    // Without a writer, the push is a silent no-op and the pending anchor
    // stays parked on the session — the writer-attach push will pick it up.
    expect(session.view.pendingAnchorFileId).toBe("f0");
    store.stop();
  });

  test("only the attached writer receives the morph", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const a = store.create("demo");
    const b = store.create("demo");
    const registry = new WriterRegistry();
    const wa = recordingWriter();
    const wb = recordingWriter();
    registry.attach(a.id, wa);
    registry.attach(b.id, wb);

    pushProjection(a, { writers: registry, engine: makeEngine() });
    expect(wa.events.length).toBe(1);
    expect(wb.events.length).toBe(0);

    store.stop();
  });

  test("falls back to default viewport when session.view.height is 0", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const session = store.create("demo");
    const registry = new WriterRegistry();
    const w = recordingWriter();
    registry.attach(session.id, w);

    pushProjection(session, { writers: registry, engine: makeEngine() });
    const elements = w.events[0];
    expect(elements?.event).toBe("datastar-patch-elements");
    // Default viewport (INITIAL_VIEWPORT_PX) should render at least one
    // section with real row content — not the empty-window placeholder.
    expect(elements?.data).toContain('class="file-section"');
    expect(elements?.data).toMatch(/class="row line (ctx|add|del)"/);
    store.stop();
  });
});

describe("sidebar auto-recenter gating (largediff-2ht5)", () => {
  // Helper: run a projection and report whether the recenter moved the
  // sidebar. `sidebarScrollTop` is the field the two writers used to fight
  // over, so it is the thing worth asserting on.
  function pushAndReadSidebarTop(session: ReviewSession, registry: WriterRegistry): number {
    pushProjection(session, { writers: registry, engine: makeEngine() });
    return session.view.sidebarScrollTop;
  }

  function attached() {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const session = store.create("demo");
    const registry = new WriterRegistry();
    registry.attach(session.id, recordingWriter());
    session.view.height = 900;
    session.view.sidebarHeight = 800;
    return { store, session, registry };
  }

  test("a reading-scroll inside one file leaves the sidebar alone", () => {
    const { store, session, registry } = attached();
    // Settle: first push establishes lastActiveFileId.
    pushAndReadSidebarTop(session, registry);

    // User scrolls the file list far away to look ahead.
    applySidebarView(session, { scrollTop: 4000, height: 800, user: true });
    expect(session.view.sidebarUserScrolled).toBe(true);

    // ...then nudges the diff a little, staying inside the same file.
    const before = session.view.scrollTop;
    session.view.scrollTop = before + 60;
    const after = pushAndReadSidebarTop(session, registry);

    // This is the regression: it used to snap back to the active file.
    expect(after).toBe(4000);
    store.stop();
  });

  test("scrolling the diff across files still leaves a hand-scrolled sidebar alone", () => {
    const { store, session, registry } = attached();
    pushAndReadSidebarTop(session, registry);
    applySidebarView(session, { scrollTop: 4000, height: 800, user: true });

    // Big reading-scroll that lands in a different file entirely.
    session.view.scrollTop = 120_000;
    const after = pushAndReadSidebarTop(session, registry);

    // The user owns the list until they navigate — that's the invariant.
    expect(after).toBe(4000);
    store.stop();
  });

  test("an explicit jump hands the sidebar back and recenters", () => {
    const { store, session, registry } = attached();
    pushAndReadSidebarTop(session, registry);
    applySidebarView(session, { scrollTop: 4000, height: 800, user: true });
    expect(session.view.sidebarUserScrolled).toBe(true);

    // Simulate what doJump does: move the diff and release the sidebar.
    session.view.scrollTop = 120_000;
    session.view.navEpoch += 1;
    session.view.sidebarUserScrolled = false;

    const after = pushAndReadSidebarTop(session, registry);
    expect(after).not.toBe(4000);
    store.stop();
  });

  test("applyTop releases the sidebar", () => {
    const { store, session, registry } = attached();
    pushAndReadSidebarTop(session, registry);
    applySidebarView(session, { scrollTop: 4000, height: 800, user: true });
    applyTop(session);
    expect(session.view.sidebarUserScrolled).toBe(false);
    store.stop();
  });

  test("a non-user sidebar report is telemetry and does not claim ownership", () => {
    const { store, session, registry } = attached();
    pushAndReadSidebarTop(session, registry);
    // The initial measurement and the resize handler both carry a real
    // scrollTop; only the `user` flag separates them from a gesture.
    applySidebarView(session, { scrollTop: 0, height: 640 });
    expect(session.view.sidebarUserScrolled).toBeUndefined();
    expect(session.view.sidebarHeight).toBe(640);
    store.stop();
  });

  test("a server-driven recenter does not hand ownership to the reader", () => {
    const { store, session, registry } = attached();
    pushAndReadSidebarTop(session, registry);

    // Navigate: the server recenters and emits a sidebarJumpToPx.
    session.view.scrollTop = 120_000;
    session.view.sidebarUserScrolled = false;
    pushAndReadSidebarTop(session, registry);

    // The client performs that scroll; its scrollend is suppressed by the
    // server-scroll token, so it arrives as telemetry rather than a gesture.
    applySidebarView(session, {
      scrollTop: session.view.sidebarScrollTop,
      height: 800,
    });
    // Not `toBeUndefined` — the field is explicitly false here. What
    // matters is that the echo did not flip it to true.
    expect(session.view.sidebarUserScrolled).not.toBe(true);

    // Park the list far from the active file WITHOUT claiming ownership,
    // then navigate again. If the echo had been treated as a gesture this
    // recenter would be suppressed and the list would stay put.
    session.view.sidebarScrollTop = 9000;
    session.view.scrollTop = 0;
    const again = pushAndReadSidebarTop(session, registry);
    expect(again).not.toBe(9000);
    store.stop();
  });
});
