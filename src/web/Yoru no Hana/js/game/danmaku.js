/**
 * The scripting vocabulary for stages and boss cards.
 *
 * Scripts are generators (see core/task.js) that call these helpers. They
 * act on the running game, bound once per game with bind(G), so a pattern
 * reads like:
 *
 *   for (let i = 0; i < 20; i++) {
 *     ring(b.x, b.y, d(12, 16, 20, 24), i * 0.2, 2.2, 'ball', 'red');
 *     yield 12;
 *   }
 *
 * d(easy, normal, hard, lunatic) picks a number by difficulty.
 */
import { TAU, ease } from '../core/util.js';
import { PF } from '../core/view.js';

export let G = null;
export const W = PF.w;
export const H = PF.h;
export { TAU };

export function bind(game) {
  G = game;
}

export const d = (e, n, h, l) => [e, n, h, l][G.D];
export const rand = (a, b) => G.rng.range(a, b);
export const randi = (a, b) => G.rng.int(a, b);
export const chance = (p) => G.rng.next() < p;
export const sign = () => G.rng.sign();
export const P = () => G.player;

/** Angle from (x, y) toward the heroine. */
export function aim(x, y) {
  return Math.atan2(G.player.y - y, G.player.x - x);
}

export function sfx(name) {
  G.sfx(name);
}

export function shoot(x, y, a, s, type, color, o) {
  return G.bullets.spawn(x, y, a, s, type, color, o);
}

/** n bullets evenly around a circle starting at angle a0. */
export function ring(x, y, n, a0, s, type, color, o) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(G.bullets.spawn(x, y, a0 + (i * TAU) / n, s, type, color, o));
  if (!o || !o.silent) G.sfx('enemyShot');
  return out;
}

/** n bullets spread over `spread` radians centred on angle a. */
export function fan(x, y, n, a, spread, s, type, color, o) {
  const out = [];
  if (n === 1) out.push(G.bullets.spawn(x, y, a, s, type, color, o));
  else for (let i = 0; i < n; i++) out.push(G.bullets.spawn(x, y, a - spread / 2 + (spread * i) / (n - 1), s, type, color, o));
  if (!o || !o.silent) G.sfx('enemyShot');
  return out;
}

/** n bullets along one angle with speeds from s0 to s1 (a "line"). */
export function line(x, y, n, a, s0, s1, type, color, o) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(G.bullets.spawn(x, y, a, n === 1 ? s0 : s0 + ((s1 - s0) * i) / (n - 1), type, color, o));
  if (!o || !o.silent) G.sfx('enemyShot');
  return out;
}

/**
 * A ring whose speeds follow 1 + amp * cos(petals * angle), so it opens
 * into a flower shape as it expands.
 */
export function flower(x, y, n, petals, a0, s, amp, type, color, o) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * TAU) / n;
    out.push(G.bullets.spawn(x, y, a, s * (1 + amp * Math.cos(petals * (a - a0))), type, color, o));
  }
  if (!o || !o.silent) G.sfx('enemyShot');
  return out;
}

export function laser(x, y, a, len, o) {
  return G.lasers.spawn(x, y, a, len, o);
}

/** Spawn a small enemy with an optional script(e). */
export function spawn(kind, x, y, o, script) {
  return G.spawnEnemy(kind, x, y, o, script);
}

/** Start a side task; tasks started during a card die with the card. */
export function run(gen) {
  return G.tasks.run(gen, G.boss && G.boss.card ? G.boss : null);
}

/** Blocking eased move of an enemy or boss. */
export function* moveTo(e, x, y, frames, how = 'out') {
  const sx = e.x;
  const sy = e.y;
  e.vx = 0;
  e.vy = 0;
  if (e.s !== undefined) e.s = 0;
  for (let i = 1; i <= frames; i++) {
    const k = ease[how](i / frames);
    e.x = sx + (x - sx) * k;
    e.y = sy + (y - sy) * k;
    yield 1;
  }
}

/** Wait until every enemy on screen is gone (or `max` frames). */
export function* waitClear(max = 900) {
  let t = 0;
  while (G.enemies.length && t++ < max) yield 1;
}

export function* fightBoss(def, o) {
  yield* G.bossFight(def, o);
}

/** Bullet behaviour helpers for the fn option. */
export const after = (frames, f) => (b, g) => {
  if (b.t === frames) f(b, g);
};

/** Stop, wait, then aim at the heroine and go again. */
export const stopAim = (stopAt, goAt, speed, acc = 0.05) => (b) => {
  if (b.t === stopAt) {
    b.s = 0;
    b.acc = 0;
  } else if (b.t === goAt) {
    b.a = aim(b.x, b.y);
    b.s = 0;
    b.acc = acc;
    b.sMax = speed;
  }
};

export function onField(x, y, m = 0) {
  return x > -m && x < W + m && y > -m && y < H + m;
}
