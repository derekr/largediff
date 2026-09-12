import { describe, expect, test } from "bun:test";
import { clientIp, IpRateLimiter, parseBucketSpec } from "./ratelimit.ts";

describe("parseBucketSpec", () => {
  test("valid spec parses", () => {
    expect(parseBucketSpec("60/1", { burst: 1, perSecond: 1 })).toEqual({
      burst: 60,
      perSecond: 1,
    });
    expect(parseBucketSpec("150/60", { burst: 1, perSecond: 1 })).toEqual({
      burst: 150,
      perSecond: 60,
    });
    expect(parseBucketSpec(" 30 / 0.5 ", { burst: 1, perSecond: 1 })).toEqual({
      burst: 30,
      perSecond: 0.5,
    });
  });

  test("missing or malformed falls back", () => {
    const fb = { burst: 7, perSecond: 3 };
    expect(parseBucketSpec(undefined, fb)).toEqual(fb);
    expect(parseBucketSpec("", fb)).toEqual(fb);
    expect(parseBucketSpec("unlimited", fb)).toEqual(fb);
    expect(parseBucketSpec("60", fb)).toEqual(fb);
    expect(parseBucketSpec("60/", fb)).toEqual(fb);
    expect(parseBucketSpec("-5/1", fb)).toEqual(fb);
  });

  test("clamps to sane bounds", () => {
    expect(parseBucketSpec("99999999/99999999", { burst: 1, perSecond: 1 })).toEqual({
      burst: 10_000,
      perSecond: 10_000,
    });
    expect(parseBucketSpec("0/0", { burst: 1, perSecond: 1 })).toEqual({
      burst: 1,
      perSecond: 0.01,
    });
  });
});

describe("clientIp", () => {
  test("leftmost XFF entry wins when trusted", () => {
    expect(clientIp("203.0.113.7, 70.41.3.18", "10.0.0.1", true)).toBe("203.0.113.7");
    expect(clientIp(" 2001:db8::1 ", "10.0.0.1", true)).toBe("2001:db8::1");
  });

  test("untrusted proxy falls back to the peer", () => {
    expect(clientIp("203.0.113.7", "10.0.0.1", false)).toBe("10.0.0.1");
  });

  test("garbage XFF falls back to the peer instead of becoming a key", () => {
    expect(clientIp("not an ip!!!", "10.0.0.1", true)).toBe("10.0.0.1");
    expect(clientIp("a".repeat(101), "10.0.0.1", true)).toBe("10.0.0.1");
    expect(clientIp("", "10.0.0.1", true)).toBe("10.0.0.1");
  });

  test("missing everything degrades to unknown, never throws", () => {
    expect(clientIp(null, null, true)).toBe("unknown");
  });
});

describe("IpRateLimiter", () => {
  function makeLimiter() {
    let t = 1_000_000;
    const limiter = new IpRateLimiter(
      { burst: 3, perSecond: 1 },
      { burst: 5, perSecond: 10 },
      () => t,
    );
    return { limiter, advance: (ms: number) => (t += ms) };
  }

  test("allows the burst, then reports whole seconds to retry", () => {
    const { limiter } = makeLimiter();
    expect(limiter.takeCreate("1.2.3.4")).toBe(0);
    expect(limiter.takeCreate("1.2.3.4")).toBe(0);
    expect(limiter.takeCreate("1.2.3.4")).toBe(0);
    // Empty bucket at 1/s: a full second until the next token.
    expect(limiter.takeCreate("1.2.3.4")).toBe(1);
  });

  test("tokens refill with elapsed time, capped at burst", () => {
    const { limiter, advance } = makeLimiter();
    limiter.takeCreate("1.2.3.4");
    limiter.takeCreate("1.2.3.4");
    limiter.takeCreate("1.2.3.4");
    advance(10_000);
    // Refilled to the burst cap of 3, not 10.
    expect(limiter.takeCreate("1.2.3.4")).toBe(0);
    expect(limiter.takeCreate("1.2.3.4")).toBe(0);
    expect(limiter.takeCreate("1.2.3.4")).toBe(0);
    expect(limiter.takeCreate("1.2.3.4")).toBe(1);
  });

  test("create and command buckets are independent, as are IPs", () => {
    const { limiter } = makeLimiter();
    limiter.takeCreate("1.2.3.4");
    limiter.takeCreate("1.2.3.4");
    limiter.takeCreate("1.2.3.4");
    // Create bucket exhausted, command bucket untouched.
    expect(limiter.takeCommand("1.2.3.4")).toBe(0);
    // Another IP untouched.
    expect(limiter.takeCreate("5.6.7.8")).toBe(0);
  });

  test("clock skew backwards never grants extra tokens", () => {
    const { limiter, advance } = makeLimiter();
    limiter.takeCreate("1.2.3.4");
    advance(-60_000);
    limiter.takeCreate("1.2.3.4");
    limiter.takeCreate("1.2.3.4");
    expect(limiter.takeCreate("1.2.3.4")).toBe(1);
  });

  test("prune drops idle keys", () => {
    const { limiter, advance } = makeLimiter();
    limiter.takeCreate("1.2.3.4");
    expect(limiter.trackedKeys).toBe(1);
    advance(6 * 60 * 1000);
    limiter.prune();
    expect(limiter.trackedKeys).toBe(0);
  });
});
