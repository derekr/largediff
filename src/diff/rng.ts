// Deterministic seeded RNG. mulberry32 is fine for "looks random" purposes
// like picking snippets and hunk shapes — it's not cryptographically strong,
// but it is fully deterministic and has decent statistical properties.

export type Rng = () => number;

// Returns a function producing uint32 values; lifted to [0,1) by the wrapper.
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit hash of a string → uint32. Used to turn the human-friendly
// seed (e.g. "demo-200k") into mulberry32's numeric state.
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Convenience: build a generator straight from a string seed.
export function rngFromSeed(seed: string): Rng {
  return mulberry32(hashSeed(seed));
}

// [min, max) integer pick.
export function pickInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min));
}

// Weighted index pick. `weights` need not sum to 1; an index is chosen
// proportional to its weight.
export function pickWeighted(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let target = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i] ?? 0;
    if (target < 0) return i;
  }
  return weights.length - 1;
}
