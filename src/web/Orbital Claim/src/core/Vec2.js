/**
 * Small 2D vector helpers.
 *
 * Deliberately static functions over plain {x, y} objects rather than a class
 * with methods: entities are allocated in the thousands and the simulation runs
 * at a fixed 60 Hz, so avoiding per-frame object churn matters more than
 * fluent syntax.
 */
export const Vec2 = {
  make(x = 0, y = 0) {
    return { x, y };
  },

  set(v, x, y) {
    v.x = x;
    v.y = y;
    return v;
  },

  copy(v) {
    return { x: v.x, y: v.y };
  },

  add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  },

  sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  },

  scale(v, s) {
    return { x: v.x * s, y: v.y * s };
  },

  len(v) {
    return Math.hypot(v.x, v.y);
  },

  /** Squared length — use for comparisons to skip the sqrt. */
  len2(v) {
    return v.x * v.x + v.y * v.y;
  },

  dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  },

  dist2(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
  },

  /** True when a and b are within r of each other. Avoids a sqrt. */
  within(a, b, r) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy <= r * r;
  },

  norm(v) {
    const l = Math.hypot(v.x, v.y);
    return l > 1e-6 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
  },

  angle(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x);
  },

  lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  },
};

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Deterministic PRNG (mulberry32) so a seed always yields the same field. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
