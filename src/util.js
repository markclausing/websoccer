// Kleine helpers + een deterministische PRNG.
// BELANGRIJK voor de latere netcode: gebruik NOOIT Math.random() in de simulatie.
// Alles wat "toevallig" is loopt via state.rng, zodat beide machines hetzelfde resultaat krijgen.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

export function dist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

export function dist2(ax, ay, bx, by) {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

export function norm(x, y) {
  const l = Math.sqrt(x * x + y * y);
  if (l < 1e-6) return { x: 0, y: 0, l: 0 };
  return { x: x / l, y: y / l, l };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// mulberry32: snel, deterministisch, seed past in één integer (makkelijk te syncen).
export function nextRandom(state) {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(state, lo, hi) {
  return lo + nextRandom(state) * (hi - lo);
}
