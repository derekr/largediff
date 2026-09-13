// SessionStore: keeps live ReviewSessions keyed by session id.
//
// Two implementations live here. `InMemorySessionStore` is the original
// for tests and ephemeral runs. `SqliteSessionStore` write-throughs to a
// `bun:sqlite` file so a process restart inside the same VM recovers
// sessions. Both honour the same idle-sweep behaviour.

import { Database, type Statement } from "bun:sqlite";
import { MAX_VIEWPORT_PX } from "../session/commands.ts";
import {
  DEFAULT_SETTINGS,
  DEFAULT_VIEW,
  type ReviewSession,
  type SessionId,
  type SessionSettings,
  type ViewState,
} from "../session/types.ts";
import type { Seed } from "./diff.ts";

export interface SessionStore {
  create(seed: Seed): ReviewSession;
  get(sid: SessionId): ReviewSession | undefined;
  delete(sid: SessionId): void;
  // Write the session's current in-memory state to durable storage.
  // The handlers in `server.ts` call this after every command so a
  // process restart inside the same VM doesn't lose the user's scroll
  // position or settings. No-op for the in-memory store.
  persist(sid: SessionId): void;
  // Live session count — the route layer caps creation against this.
  readonly size: number;
}

export interface InMemorySessionStoreOptions {
  ttlMs?: number;
  sweepIntervalMs?: number;
  // Injectable for tests. Defaults to `Date.now`.
  now?: () => number;
  // Injectable for tests. Defaults to `crypto.randomUUID`-derived 12-char id.
  generateId?: () => SessionId;
  // Called whenever a session leaves the store — explicit delete() or an
  // idle sweep. The server hooks this to drop its per-session side tables
  // (coalesce window, view-push throttle timer, SSE writer); without the
  // hook those maps grew one entry per session for the life of the
  // process.
  onEvict?: (sid: SessionId) => void;
  // A pinned session is exempt from the idle sweep and gets its
  // lastSeenAt refreshed instead. The server pins sessions with a live
  // SSE writer attached: a reader who scrolls to a spot and then just
  // reads issues no commands, so nothing else touches lastSeenAt and the
  // sweep would delete the session under the open tab — the next command
  // then 410s on a page that looks perfectly alive.
  isPinned?: (sid: SessionId) => boolean;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function defaultId(): SessionId {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<SessionId, ReviewSession>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly generateId: () => SessionId;
  private readonly onEvict: ((sid: SessionId) => void) | undefined;
  private readonly isPinned: ((sid: SessionId) => boolean) | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: InMemorySessionStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.generateId = opts.generateId ?? defaultId;
    this.onEvict = opts.onEvict;
    this.isPinned = opts.isPinned;

    const sweepInterval = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (sweepInterval > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepInterval);
      // Don't keep the event loop alive purely for the sweeper.
      this.sweepTimer.unref?.();
    }
  }

  create(seed: Seed): ReviewSession {
    const id = this.generateId();
    const now = this.now();
    const session: ReviewSession = {
      id,
      seed,
      view: { ...DEFAULT_VIEW },
      settings: { ...DEFAULT_SETTINGS },
      createdAt: now,
      lastSeenAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(sid: SessionId): ReviewSession | undefined {
    const session = this.sessions.get(sid);
    if (session === undefined) return undefined;
    session.lastSeenAt = this.now();
    return session;
  }

  delete(sid: SessionId): void {
    if (this.sessions.delete(sid)) this.onEvict?.(sid);
  }

  // No-op — in-memory only, nothing to persist.
  persist(_sid: SessionId): void {
    // intentionally empty
  }

  // Evicts sessions whose lastSeenAt is older than the TTL. Called on a timer;
  // exposed for tests and explicit shutdown flows.
  sweep(): number {
    const cutoff = this.now() - this.ttlMs;
    let evicted = 0;
    for (const [id, session] of this.sessions) {
      if (session.lastSeenAt >= cutoff) continue;
      if (this.isPinned?.(id) === true) {
        // Live stream attached — treat as seen, never sweep it away.
        session.lastSeenAt = this.now();
        continue;
      }
      this.sessions.delete(id);
      this.onEvict?.(id);
      evicted++;
    }
    return evicted;
  }

  // Stop the background sweeper; used by tests and graceful shutdown.
  stop(): void {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}

// ---------------------------------------------------------------------------
// SQLite-backed store
// ---------------------------------------------------------------------------

export interface SqliteSessionStoreOptions extends InMemorySessionStoreOptions {
  // Path to the sqlite file. `:memory:` for an ephemeral DB (tests). On
  // Fly we keep it under `/tmp` so each VM gets a fresh DB at boot,
  // matching the `immediate` deploy strategy that already starts fresh.
  path: string;
}

interface SessionRow {
  id: string;
  seed: string;
  view: string;
  settings: string;
  created_at: number;
  last_seen_at: number;
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: Database;
  // Hot cache so `get()` and command handlers don't hit sqlite on every
  // /view POST. On hit, we still bump last_seen_at in the DB.
  private readonly sessions = new Map<SessionId, ReviewSession>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly generateId: () => SessionId;
  private readonly onEvict: ((sid: SessionId) => void) | undefined;
  private readonly isPinned: ((sid: SessionId) => boolean) | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private readonly insertStmt: Statement;
  private readonly updateStmt: Statement;
  private readonly touchStmt: Statement;
  private readonly deleteStmt: Statement;
  private readonly sweepStmt: Statement;
  private readonly selectAllStmt: Statement;

  constructor(opts: SqliteSessionStoreOptions) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.generateId = opts.generateId ?? defaultId;
    this.onEvict = opts.onEvict;
    this.isPinned = opts.isPinned;

    this.db = new Database(opts.path, { create: true });
    // WAL keeps reads from blocking writes; NORMAL synchronous trades a
    // little crash-durability for a big throughput win. We're fine with
    // either since the DB is ephemeral by design.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        seed TEXT NOT NULL,
        view TEXT NOT NULL,
        settings TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
    `);
    // A DB created before the collapse/reviewed feature was removed still
    // carries its `per_file` column, whose NOT NULL constraint would fail
    // every INSERT above. Drop it in place so live sessions in an existing
    // /tmp DB survive the upgrade instead of forcing a wipe.
    const cols = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === "per_file")) {
      this.db.exec("ALTER TABLE sessions DROP COLUMN per_file");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS sessions_last_seen ON sessions(last_seen_at)");

    this.insertStmt = this.db.prepare(
      "INSERT INTO sessions(id, seed, view, settings, created_at, last_seen_at) VALUES(?, ?, ?, ?, ?, ?)",
    );
    this.updateStmt = this.db.prepare(
      "UPDATE sessions SET view = ?, settings = ?, last_seen_at = ? WHERE id = ?",
    );
    this.touchStmt = this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?");
    this.deleteStmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    this.sweepStmt = this.db.prepare("DELETE FROM sessions WHERE last_seen_at < ?");
    this.selectAllStmt = this.db.prepare("SELECT * FROM sessions");

    this.hydrate();

    const sweepInterval = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (sweepInterval > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepInterval);
      this.sweepTimer.unref?.();
    }
  }

  create(seed: Seed): ReviewSession {
    const id = this.generateId();
    const now = this.now();
    const session: ReviewSession = {
      id,
      seed,
      view: { ...DEFAULT_VIEW },
      settings: { ...DEFAULT_SETTINGS },
      createdAt: now,
      lastSeenAt: now,
    };
    this.sessions.set(id, session);
    this.insertStmt.run(
      id,
      seed,
      JSON.stringify(serializeView(session.view)),
      JSON.stringify(session.settings),
      now,
      now,
    );
    return session;
  }

  get(sid: SessionId): ReviewSession | undefined {
    const session = this.sessions.get(sid);
    if (session === undefined) return undefined;
    const now = this.now();
    session.lastSeenAt = now;
    // last_seen_at bumps are cheap and let us prune stale sessions
    // accurately even when no other field is being mutated.
    this.touchStmt.run(now, sid);
    return session;
  }

  delete(sid: SessionId): void {
    const existed = this.sessions.delete(sid);
    this.deleteStmt.run(sid);
    if (existed) this.onEvict?.(sid);
  }

  persist(sid: SessionId): void {
    const session = this.sessions.get(sid);
    if (session === undefined) return;
    this.updateStmt.run(
      JSON.stringify(serializeView(session.view)),
      JSON.stringify(session.settings),
      session.lastSeenAt,
      sid,
    );
  }

  sweep(): number {
    const cutoff = this.now() - this.ttlMs;
    let evicted = 0;
    for (const [id, session] of this.sessions) {
      if (session.lastSeenAt >= cutoff) continue;
      if (this.isPinned?.(id) === true) {
        // Live stream attached — refresh in both cache and DB so the
        // sweepStmt below leaves the row alone.
        const now = this.now();
        session.lastSeenAt = now;
        this.touchStmt.run(now, id);
        continue;
      }
      this.sessions.delete(id);
      this.onEvict?.(id);
      evicted++;
    }
    this.sweepStmt.run(cutoff);
    return evicted;
  }

  stop(): void {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.db.close();
  }

  get size(): number {
    return this.sessions.size;
  }

  // Load every persisted session into the in-memory cache. Called once at
  // construction; per-session writes after that keep both in sync.
  private hydrate(): void {
    const rows = this.selectAllStmt.all() as SessionRow[];
    for (const row of rows) {
      try {
        const session: ReviewSession = {
          id: row.id,
          seed: row.seed,
          view: deserializeView(JSON.parse(row.view) as Record<string, unknown>),
          settings: deserializeSettings(JSON.parse(row.settings) as Record<string, unknown>),
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
        };
        this.sessions.set(row.id, session);
      } catch {
        // A malformed row shouldn't crash startup. Drop it so it isn't
        // returned by `get()`; it'll be swept on the next pass anyway.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Serialization helpers — kept close to the SQLite store. The transient
// fields (`pendingAnchorFileId`, `lastFingerprint`) are deliberately
// dropped on the way to disk so a restart doesn't fire a phantom jump.
// ---------------------------------------------------------------------------

// Sidebar-related fields (`sidebarScrollTop`, `sidebarHeight`) are
// intentionally NOT persisted. On reload, the sidebar derives its
// scroll position from the current active file (via the projection's
// auto-recenter), which avoids the "persisted sidebarScrollTop doesn't
// match the active file's actual location" mismatch.
function serializeView(v: ViewState): Partial<ViewState> {
  return {
    scrollTop: v.scrollTop,
    height: v.height,
    navEpoch: v.navEpoch,
  };
}

function deserializeView(raw: Record<string, unknown>): ViewState {
  return {
    scrollTop: typeof raw.scrollTop === "number" ? Math.max(0, raw.scrollTop) : 0,
    // Re-clamp on the way in: a row written before the height clamp
    // existed could otherwise smuggle a giant viewport past the command
    // validators (the 103MB-per-push hole, see commands.ts).
    height: typeof raw.height === "number" ? Math.max(0, Math.min(MAX_VIEWPORT_PX, raw.height)) : 0,
    sidebarScrollTop: 0,
    sidebarHeight: 0,
    navEpoch: typeof raw.navEpoch === "number" ? raw.navEpoch : 0,
    cmdSeq: 0,
    // Not persisted: pushSeq counts morphs written on THIS connection, so a
    // reloaded session legitimately restarts it from zero.
    pushSeq: 0,
  };
}

function deserializeSettings(raw: Record<string, unknown>): SessionSettings {
  return { ...DEFAULT_SETTINGS, ...(raw as Partial<SessionSettings>) };
}
