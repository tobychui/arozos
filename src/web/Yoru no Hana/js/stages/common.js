/**
 * Reusable enemy behaviours for the stage scripts.
 */
import { G, d, rand, aim, fan, ring, moveTo, W, H } from '../game/danmaku.js';
import { lerp } from '../core/util.js';

/** Come down to y, run `fire(e)` (a generator) while holding, then leave. */
export function* stopAndFire(e, y, fire, { inFrames = 45, leave = 'up', speed = 2 } = {}) {
  yield* moveTo(e, e.x, y, inFrames, 'out');
  if (fire) yield* fire(e);
  switch (leave) {
    case 'down':
      e.vy = speed;
      break;
    case 'left':
      e.vx = -speed;
      e.vy = -0.3;
      break;
    case 'right':
      e.vx = speed;
      e.vy = -0.3;
      break;
    case 'side':
      e.vx = e.x < W / 2 ? -speed : speed;
      e.vy = -0.4;
      break;
    default:
      e.vy = -speed;
  }
}

/** Fire an aimed fan `times` times every `gap` frames. */
export function aimedBursts(times, gap, n, spread, speed, type, color) {
  return function* (e) {
    for (let i = 0; i < times; i++) {
      fan(e.x, e.y, n, aim(e.x, e.y), spread, speed, type, color);
      yield gap;
    }
  };
}

export function ringBursts(times, gap, n, speed, type, color, spin = 0.1) {
  return function* (e) {
    const a0 = rand(0, Math.PI * 2);
    for (let i = 0; i < times; i++) {
      ring(e.x, e.y, n, a0 + i * spin, speed, type, color);
      yield gap;
    }
  };
}

/** Bullet fn: glide from (sx, sy) to (tx, ty) over `n` frames, then call then(b). */
export function glide(sx, sy, tx, ty, n, then) {
  return (b, g) => {
    if (b.t <= n) {
      const k = 1 - (1 - b.t / n) ** 2;
      b.x = lerp(sx, tx, k);
      b.y = lerp(sy, ty, k);
      b.s = 0;
    } else if (then) then(b, g);
  };
}

/** A standard small enemy drop table, scaled a little by difficulty. */
export function drops(power = 1, point = 1) {
  return { power, point };
}

export function edgeX(i, n, margin = 40) {
  return margin + (i * (W - margin * 2)) / Math.max(1, n - 1);
}

export { G, d, H };
