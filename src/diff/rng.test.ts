import { describe, expect, test } from "bun:test";
import { hashSeed, mulberry32, pickInt, pickWeighted, rngFromSeed } from "./rng.ts";

describe("mulberry32", () => {
  test("same seed produces identical sequence", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });

  test("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const diffs = [];
    for (let i = 0; i < 5; i++) diffs.push(a() !== b());
    expect(diffs.some(Boolean)).toBe(true);
  });

  test("values lie in [0, 1)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hashSeed", () => {
  test("is deterministic", () => {
    expect(hashSeed("demo-200k")).toBe(hashSeed("demo-200k"));
    expect(hashSeed("")).toBe(hashSeed(""));
  });

  test("different inputs hash to different values", () => {
    const a = hashSeed("demo-200k");
    const b = hashSeed("demo-100k");
    expect(a).not.toBe(b);
  });

  test("returns a 32-bit unsigned integer", () => {
    const h = hashSeed("anything");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe("rngFromSeed", () => {
  test("string seed yields a deterministic stream", () => {
    const a = rngFromSeed("hello");
    const b = rngFromSeed("hello");
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe("pickInt", () => {
  test("stays inside [min, max)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = pickInt(rng, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("pickWeighted", () => {
  test("single positive weight always returns its index", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      expect(pickWeighted(rng, [0, 1, 0])).toBe(1);
    }
  });

  test("even weights yield every index over time", () => {
    const rng = mulberry32(1);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pickWeighted(rng, [1, 1, 1, 1]));
    expect(seen.size).toBe(4);
  });
});
