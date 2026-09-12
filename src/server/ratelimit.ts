// Per-IP token-bucket rate limiting, in-process (the app runs one instance
// by design, so there is nowhere else for the buckets to live).
//
// Two buckets because creation and commands abuse differently: minting
// sessions is how a flood exhausts MAX_LIVE_SESSIONS (each GET / is cheap,
// deadly in aggregate), while hammering one session's command routes burns
// CPU per request (SQLite persist + full render + encode).
//
// NAT caveat: an office or carrier NAT shares one bucket across many users,
// so both budgets default generously — they exist to slow a flood to
// sweep-manageable levels, not to police humans. Tune with
// LARGEDIFF_RATE_LIMIT_CREATE / LARGEDIFF_RATE_LIMIT_COMMANDS as
// "burst/per-second" (e.g. "60/1").

export interface BucketSpec {
  burst: number;
  perSecond: number;
}

export function parseBucketSpec(raw: string | undefined, fallback: BucketSpec): BucketSpec {
  if (raw === undefined || raw === "") return fallback;
  const m = /^(\d+)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (m === null) return fallback;
  const [, burstRaw, perSecondRaw] = m;
  if (burstRaw === undefined || perSecondRaw === undefined) return fallback;
  const burst = Math.min(10_000, Math.max(1, Number.parseInt(burstRaw, 10)));
  const perSecond = Math.min(10_000, Math.max(0.01, Number.parseFloat(perSecondRaw)));
  if (!Number.isFinite(burst) || !Number.isFinite(perSecond)) return fallback;
  return { burst, perSecond };
}

// Which IP counts against the bucket. Bun's requestIP is the TCP peer — the
// TLS-terminating proxy, not the user — so behind a trusted proxy the
// leftmost X-Forwarded-For entry is the client. Trust is on by default
// because this app requires a proxy (see DEPLOY.md); turn it off with
// LARGEDIFF_TRUST_PROXY=0 if the process is ever directly reachable, since
// a direct client can spoof XFF into a fresh bucket per request.
export function clientIp(
  xForwardedFor: string | null,
  peerIp: string | null,
  trustProxy: boolean,
): string {
  if (trustProxy && xForwardedFor !== null) {
    const first = xForwardedFor.split(",")[0]?.trim() ?? "";
    // Bucket-key validation, not authentication: an over-long or oddly
    // shaped value falls back to the peer instead of becoming an
    // attacker-minted map entry.
    if (first.length > 0 && first.length <= 100 && /^[A-Za-z0-9.:_-]+$/.test(first)) {
      return first;
    }
  }
  if (peerIp !== null && peerIp.length > 0 && peerIp.length <= 100) return peerIp;
  return "unknown";
}

interface Bucket {
  tokens: number;
  last: number;
}

// Backstops against an attacker minting map entries with rotating garbage
// keys (spoofed XFF with trust on): idle buckets are pruned on a timer, and
// the map itself is capped with oldest-evict so memory stays bounded no
// matter what arrives.
const MAX_TRACKED_KEYS = 50_000;
const KEY_TTL_MS = 5 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;

export class IpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly createSpec: BucketSpec,
    private readonly commandSpec: BucketSpec,
    now: () => number = Date.now,
  ) {
    this.now = now;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    // Rate limiting is enforcement, never a reason to keep the process alive.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // Returns 0 when the request may proceed, otherwise whole seconds until a
  // token is available (suitable for a `retry-after` header).
  takeCreate(ip: string): number {
    return this.take(`c:${ip}`, this.createSpec);
  }

  takeCommand(ip: string): number {
    return this.take(`m:${ip}`, this.commandSpec);
  }

  get trackedKeys(): number {
    return this.buckets.size;
  }

  prune(): void {
    const cutoff = this.now() - KEY_TTL_MS;
    for (const [key, bucket] of this.buckets) {
      if (bucket.last < cutoff) this.buckets.delete(key);
    }
  }

  private take(key: string, spec: BucketSpec): number {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      if (this.buckets.size >= MAX_TRACKED_KEYS) {
        // Insertion-ordered, so the first key is the oldest entry.
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      bucket = { tokens: spec.burst, last: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = Math.max(0, (now - bucket.last) / 1000);
    bucket.tokens = Math.min(spec.burst, bucket.tokens + elapsed * spec.perSecond);
    bucket.last = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - bucket.tokens) / spec.perSecond));
  }
}
