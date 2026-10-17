// One random source for all humane timing and paths, seedable for tests.

export type Rng = () => number;

/** Small fast seeded generator (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniform(rng: Rng, [lo, hi]: readonly [number, number]): number {
  return lo + (hi - lo) * rng();
}

/** Standard normal draw (Box-Muller). */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function normal(rng: Rng, mean: number, sd: number): number {
  return mean + sd * gaussian(rng);
}

/** A right-skewed draw with the given mean and standard deviation. */
export function lognormal(rng: Rng, mean: number, sd: number): number {
  const sigma2 = Math.log(1 + (sd * sd) / (mean * mean));
  const mu = Math.log(mean) - sigma2 / 2;
  return Math.exp(mu + Math.sqrt(sigma2) * gaussian(rng));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
