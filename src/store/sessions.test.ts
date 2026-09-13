import { describe, expect, test } from "bun:test";
import { InMemorySessionStore, SqliteSessionStore } from "./sessions.ts";

function fixedClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("InMemorySessionStore", () => {
  test("create returns a session with seed and default view/settings", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const s = store.create("seed-x");
    expect(s.id).toMatch(/^[0-9a-f]{12}$/);
    expect(s.seed).toBe("seed-x");
    expect(s.view).toEqual({
      scrollTop: 0,
      height: 0,
      sidebarScrollTop: 0,
      sidebarHeight: 0,
      navEpoch: 0,
      cmdSeq: 0,
      pushSeq: 0,
    });
    expect(s.settings.mode).toBe("unified");
    expect(s.settings.tabWidth).toBe(2);
    expect(s.createdAt).toBe(s.lastSeenAt);
    store.stop();
  });

  test("get returns the stored session and bumps lastSeenAt", () => {
    const clock = fixedClock();
    const store = new InMemorySessionStore({ sweepIntervalMs: 0, now: clock.now });
    const created = store.create("seed");
    clock.advance(5_000);

    const got = store.get(created.id);
    expect(got).toBeDefined();
    expect(got?.id).toBe(created.id);
    expect(got?.lastSeenAt).toBe(clock.now());
    store.stop();
  });

  test("get returns undefined for unknown sid", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    expect(store.get("nope")).toBeUndefined();
    store.stop();
  });

  test("delete removes the session", () => {
    const store = new InMemorySessionStore({ sweepIntervalMs: 0 });
    const s = store.create("seed");
    expect(store.get(s.id)).toBeDefined();
    store.delete(s.id);
    expect(store.get(s.id)).toBeUndefined();
    store.stop();
  });

  test("sweep evicts sessions idle past the TTL", () => {
    const clock = fixedClock();
    const ttlMs = 30 * 60 * 1000;
    const store = new InMemorySessionStore({
      sweepIntervalMs: 0,
      ttlMs,
      now: clock.now,
    });

    const stale = store.create("seed");
    clock.advance(ttlMs + 1);
    const fresh = store.create("seed"); // created at "now" => not stale

    expect(store.size).toBe(2);
    const evicted = store.sweep();
    expect(evicted).toBe(1);
    expect(store.get(stale.id)).toBeUndefined();
    expect(store.get(fresh.id)).toBeDefined();
    store.stop();
  });

  test("get() refreshes lastSeenAt and prevents eviction", () => {
    const clock = fixedClock();
    const ttlMs = 10_000;
    const store = new InMemorySessionStore({
      sweepIntervalMs: 0,
      ttlMs,
      now: clock.now,
    });

    const s = store.create("seed");
    clock.advance(ttlMs - 1);
    store.get(s.id); // touches lastSeenAt
    clock.advance(ttlMs - 1); // still inside ttl from refresh

    expect(store.sweep()).toBe(0);
    expect(store.get(s.id)).toBeDefined();
    store.stop();
  });

  test("uses injected id generator", () => {
    let n = 0;
    const store = new InMemorySessionStore({
      sweepIntervalMs: 0,
      generateId: () => `id-${++n}`,
    });
    const a = store.create("seed");
    const b = store.create("seed");
    expect(a.id).toBe("id-1");
    expect(b.id).toBe("id-2");
    store.stop();
  });
});

describe("SqliteSessionStore", () => {
  function mem(opts: { now?: () => number; generateId?: () => string } = {}): SqliteSessionStore {
    // `:memory:` keeps each test hermetic and skips disk IO.
    return new SqliteSessionStore({ path: ":memory:", sweepIntervalMs: 0, ...opts });
  }

  test("create/get round-trips a session through sqlite", () => {
    const store = mem();
    const s = store.create("seed-x");
    expect(s.id).toMatch(/^[0-9a-f]{12}$/);
    const got = store.get(s.id);
    expect(got?.seed).toBe("seed-x");
    expect(got?.view).toEqual({
      scrollTop: 0,
      height: 0,
      sidebarScrollTop: 0,
      sidebarHeight: 0,
      navEpoch: 0,
      cmdSeq: 0,
      pushSeq: 0,
    });
    store.stop();
  });

  test("persist + restart restores mutated state", () => {
    let counter = 0;
    const generateId = () => `id-${++counter}`;
    // Same path so the second store hydrates the first store's writes.
    const path = `/tmp/largediff-test-${process.pid}-${Date.now()}.db`;
    try {
      const store1 = new SqliteSessionStore({ path, sweepIntervalMs: 0, generateId });
      const s = store1.create("seed-x");
      s.view.scrollTop = 12345;
      s.view.navEpoch = 7;
      s.settings.mode = "split";
      store1.persist(s.id);
      store1.stop();

      const store2 = new SqliteSessionStore({ path, sweepIntervalMs: 0 });
      const got = store2.get(s.id);
      expect(got?.view.scrollTop).toBe(12345);
      expect(got?.view.navEpoch).toBe(7);
      expect(got?.settings.mode).toBe("split");
      store2.stop();
    } finally {
      // Best-effort cleanup of the on-disk test file.
      try {
        require("node:fs").unlinkSync(path);
      } catch {}
    }
  });

  test("transient view fields are not persisted across restarts", () => {
    let counter = 0;
    const generateId = () => `id-${++counter}`;
    const path = `/tmp/largediff-test-${process.pid}-${Date.now()}-transient.db`;
    try {
      const store1 = new SqliteSessionStore({ path, sweepIntervalMs: 0, generateId });
      const s = store1.create("seed-x");
      s.view.pendingAnchorFileId = "fX";
      s.view.lastFingerprint = "fp";
      store1.persist(s.id);
      store1.stop();

      const store2 = new SqliteSessionStore({ path, sweepIntervalMs: 0 });
      const got = store2.get(s.id);
      // A phantom jump on restart would be very bad. Confirm the transient
      // fields don't survive serialization.
      expect(got?.view.pendingAnchorFileId).toBeUndefined();
      expect(got?.view.lastFingerprint).toBeUndefined();
      store2.stop();
    } finally {
      try {
        require("node:fs").unlinkSync(path);
      } catch {}
    }
  });

  test("delete removes from both cache and sqlite", () => {
    const store = mem();
    const s = store.create("seed-x");
    expect(store.get(s.id)).toBeDefined();
    store.delete(s.id);
    expect(store.get(s.id)).toBeUndefined();
    store.stop();
  });

  test("sweep evicts sessions older than ttlMs", () => {
    let t = 1_000_000;
    const now = () => t;
    const store = new SqliteSessionStore({
      path: ":memory:",
      sweepIntervalMs: 0,
      ttlMs: 10,
      now,
    });
    const a = store.create("seed-x");
    t += 100;
    const b = store.create("seed-x");
    expect(store.size).toBe(2);
    const evicted = store.sweep();
    expect(evicted).toBe(1);
    expect(store.get(a.id)).toBeUndefined();
    expect(store.get(b.id)).toBeDefined();
    store.stop();
  });

  test("sweep spares pinned sessions and refreshes their lastSeenAt", () => {
    // The pin models a live SSE stream: an idle reader issues no commands,
    // so without it the sweep deletes the session under the open tab and
    // the next command 410s on a page that looks alive.
    let t = 1_000_000;
    const now = () => t;
    const pinned = new Set<string>();
    const store = new SqliteSessionStore({
      path: ":memory:",
      sweepIntervalMs: 0,
      ttlMs: 10,
      now,
      isPinned: (sid) => pinned.has(sid),
    });
    const a = store.create("seed-x");
    const b = store.create("seed-x");
    pinned.add(a.id);
    t += 100;
    expect(store.sweep()).toBe(1);
    expect(store.get(a.id)).toBeDefined();
    expect(store.get(b.id)).toBeUndefined();
    // The refresh means the next sweep inside a fresh TTL leaves it alone
    // even after unpinning.
    pinned.delete(a.id);
    t += 5;
    expect(store.sweep()).toBe(0);
    store.stop();
  });

  test("onEvict fires for both explicit delete and sweep eviction", () => {
    let t = 1_000_000;
    const now = () => t;
    const evicted: string[] = [];
    const store = new SqliteSessionStore({
      path: ":memory:",
      sweepIntervalMs: 0,
      ttlMs: 10,
      now,
      onEvict: (sid) => evicted.push(sid),
    });
    const a = store.create("seed-x");
    const b = store.create("seed-x");
    store.delete(a.id);
    expect(evicted).toEqual([a.id]);
    t += 100;
    store.sweep();
    expect(evicted).toEqual([a.id, b.id]);
    // Deleting an unknown sid must not fire the hook.
    store.delete("nope");
    expect(evicted.length).toBe(2);
    store.stop();
  });

  test("drops the legacy per_file column so inserts into an old DB work", () => {
    // A DB written before the collapse/reviewed feature was removed has a
    // NOT NULL per_file column; without the in-place migration every
    // create() on such a DB throws a constraint error.
    const path = `/tmp/largediff-test-${process.pid}-${Date.now()}-legacy.db`;
    try {
      const { Database } = require("bun:sqlite");
      const raw = new Database(path, { create: true });
      raw.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          seed TEXT NOT NULL,
          view TEXT NOT NULL,
          settings TEXT NOT NULL,
          per_file TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
      `);
      raw
        .prepare("INSERT INTO sessions VALUES(?, ?, ?, ?, ?, ?, ?)")
        .run("legacy1", "demo", '{"scrollTop":42}', "{}", '{"fX":{"collapsed":true}}', 1, 1);
      raw.close();

      const store = new SqliteSessionStore({ path, sweepIntervalMs: 0 });
      // Legacy row survives (minus the dropped column)...
      expect(store.get("legacy1")?.view.scrollTop).toBe(42);
      // ...and new inserts no longer trip the NOT NULL constraint.
      const fresh = store.create("demo");
      expect(store.get(fresh.id)).toBeDefined();
      store.stop();
    } finally {
      try {
        require("node:fs").unlinkSync(path);
      } catch {}
    }
  });

  test("hydrate clamps a persisted oversized height", () => {
    // A row written before the viewport clamp existed must not smuggle a
    // giant height past the command validators on restart (the
    // 103MB-per-push hole — see commands.ts MAX_VIEWPORT_PX).
    const path = `/tmp/largediff-test-${process.pid}-${Date.now()}-clamp.db`;
    try {
      let counter = 0;
      const store1 = new SqliteSessionStore({
        path,
        sweepIntervalMs: 0,
        generateId: () => `id-${++counter}`,
      });
      const s = store1.create("demo");
      s.view.height = 2_000_000;
      // Bypass the command layer the way an old row would have.
      store1.persist(s.id);
      store1.stop();

      const store2 = new SqliteSessionStore({ path, sweepIntervalMs: 0 });
      const got = store2.get(s.id);
      expect(got?.view.height).toBeLessThanOrEqual(4096);
      store2.stop();
    } finally {
      try {
        require("node:fs").unlinkSync(path);
      } catch {}
    }
  });
});
