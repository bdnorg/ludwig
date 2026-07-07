/** Unbiased random int in [0, n) using rejection sampling over crypto RNG. */
export function randInt(n: number): number {
  if (n <= 0) throw new Error('randInt: n must be positive');
  const limit = Math.floor(0xffffffff / n) * n;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % n;
}

/** Fisher–Yates over a copy. */
export function shuffled<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
