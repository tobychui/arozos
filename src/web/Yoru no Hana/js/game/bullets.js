/**
 * Enemy bullets.
 *
 * A bullet moves in polar form (angle a, speed s, acceleration acc, angular
 * velocity w, clamped to sMin..sMax) or, when spawned with vx / vy / gx / gy,
 * in cartesian form with gravity. `fn(b, G)` runs every frame before the
 * move, which is how scripted behaviour (stop, re-aim, split) is written.
 * Bullets are pooled objects; drawing goes layer by layer so big bullets sit
 * under small ones.
 */
import { BTYPES, COLORS } from '../gfx/art.js';
import { PF } from '../core/view.js';

export const GRAZE_R = 15;

export class BulletSystem {
  constructor(G) {
    this.G = G;
    this.list = [];
    this.pool = [];
  }

  get count() {
    return this.list.length;
  }

  spawn(x, y, a, s, type, color, o) {
    const def = BTYPES[type] || BTYPES.ball;
    const b = this.pool.pop() || {};
    b.x = x;
    b.y = y;
    b.a = a;
    b.s = s;
    b.type = type;
    b.color = color;
    b.def = def;
    b.t = 0;
    b.dead = false;
    b.grazed = false;
    b.scale = 1;
    b.alpha = 1;
    b.spinA = 0;
    b.acc = 0;
    b.w = 0;
    b.sMin = 0;
    b.sMax = Infinity;
    b.fn = null;
    b.life = 0;
    b.margin = 32;
    b.noCancel = false;
    b.cart = false;
    b.vx = 0;
    b.vy = 0;
    b.gx = 0;
    b.gy = 0;
    b.vMax = 0;
    b.data = null;
    b.rot = 0;
    b.flash = 8;
    b.hidden = false;
    b.harmless = false;
    if (o) {
      if (o.acc !== undefined) b.acc = o.acc;
      if (o.w !== undefined) b.w = o.w;
      if (o.sMin !== undefined) b.sMin = o.sMin;
      else if (b.acc < 0) b.sMin = 0;
      if (o.sMax !== undefined) b.sMax = o.sMax;
      if (o.fn) b.fn = o.fn;
      if (o.life) b.life = o.life;
      if (o.margin !== undefined) b.margin = o.margin;
      if (o.noCancel) b.noCancel = true;
      if (o.scale) b.scale = o.scale;
      if (o.data !== undefined) b.data = o.data;
      if (o.flash !== undefined) b.flash = o.flash;
      if (o.harmless) b.harmless = true;
      if (o.vx !== undefined || o.vy !== undefined || o.gx || o.gy) {
        b.cart = true;
        b.vx = o.vx !== undefined ? o.vx : Math.cos(a) * s;
        b.vy = o.vy !== undefined ? o.vy : Math.sin(a) * s;
        b.gx = o.gx || 0;
        b.gy = o.gy || 0;
        b.vMax = o.vMax || 0;
      }
    }
    b.r = def.r;
    this.list.push(b);
    return b;
  }

  update() {
    const G = this.G;
    const p = G.player;
    const canHit = p.canBeHit();
    const px = p.x;
    const py = p.y;
    const pr = p.hitR;
    // difficulty bullet speed: every displacement is scaled, so a pattern keeps its shape
    const k = G.diff.bulletSpeed || 1;
    const l = this.list;
    let anyDead = false;
    for (let i = 0; i < l.length; i++) {
      const b = l[i];
      if (b.dead) {
        anyDead = true;
        continue;
      }
      b.t++;
      if (b.fn) {
        b.fn(b, G);
        if (b.dead) {
          anyDead = true;
          continue;
        }
      }
      if (b.cart) {
        b.vx += b.gx;
        b.vy += b.gy;
        if (b.vMax) {
          const v = Math.hypot(b.vx, b.vy);
          if (v > b.vMax) {
            b.vx *= b.vMax / v;
            b.vy *= b.vMax / v;
          }
        }
        b.x += b.vx * k;
        b.y += b.vy * k;
      } else {
        b.s += b.acc;
        if (b.s < b.sMin) b.s = b.sMin;
        else if (b.s > b.sMax) b.s = b.sMax;
        b.a += b.w;
        b.x += Math.cos(b.a) * b.s * k;
        b.y += Math.sin(b.a) * b.s * k;
      }
      if (b.def.spin) b.spinA += b.def.spin;
      const m = b.margin;
      if (b.x < -m || b.x > PF.w + m || b.y < -m || b.y > PF.h + m) {
        b.dead = true;
        anyDead = true;
        continue;
      }
      if (b.life && b.t >= b.life) {
        b.dead = true;
        anyDead = true;
        G.fx.spark(b.x, b.y, COLORS[b.color] || '#fff', 2);
        continue;
      }
      if (b.hidden || b.harmless || b.t < 4) continue;
      const dx = b.x - px;
      const dy = b.y - py;
      const d2 = dx * dx + dy * dy;
      const rr = b.r * b.scale;
      if (canHit && d2 < (rr + pr) * (rr + pr)) {
        p.hit();
        if (rr < 12) {
          b.dead = true;
          anyDead = true;
        }
        continue;
      }
      if (!b.grazed && canHit && d2 < (rr + GRAZE_R) * (rr + GRAZE_R)) {
        b.grazed = true;
        G.graze(b.x, b.y);
      }
    }
    if (anyDead) {
      let j = 0;
      for (let i = 0; i < l.length; i++) {
        const b = l[i];
        if (b.dead) {
          b.fn = null;
          b.data = null;
          if (this.pool.length < 4000) this.pool.push(b);
        } else l[j++] = b;
      }
      l.length = j;
    }
  }

  /**
   * Remove bullets: all, or those within `radius` of (x, y). Cancelled
   * bullets turn into petals worth a little score when `items` is set.
   */
  cancel({ x, y, radius = 0, items = true, force = false } = {}) {
    const G = this.G;
    let n = 0;
    for (const b of this.list) {
      if (b.dead || (b.noCancel && !force)) continue;
      if (radius) {
        const dx = b.x - x;
        const dy = b.y - y;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      b.dead = true;
      n++;
      if (n % 2 === 0) G.fx.spark(b.x, b.y, COLORS[b.color] || '#fff', 1);
      if (items && n <= 600) G.items.spawn('cancel', b.x, b.y, { auto: true });
    }
    return n;
  }

  render(ctx, art, px) {
    const l = this.list;
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < l.length; i++) {
        const b = l[i];
        if (b.dead || b.hidden || b.def.layer !== layer) continue;
        const spr = art.bullet(b.type, b.color);
        let sc = b.scale;
        let alpha = b.alpha;
        if (b.t < b.flash) {
          const k = b.t / b.flash;
          sc *= 1 + (1 - k) * 0.9;
          alpha *= 0.35 + 0.65 * k;
        }
        const w = spr.w * sc;
        const h = spr.h * sc;
        if (alpha !== 1) ctx.globalAlpha = alpha;
        if (b.def.orient || b.def.spin || b.rot) {
          let ang = b.rot;
          if (b.def.orient) ang += b.cart ? Math.atan2(b.vy, b.vx) : b.a;
          if (b.def.spin) ang += b.spinA;
          const c = Math.cos(ang) * px;
          const s = Math.sin(ang) * px;
          ctx.setTransform(c, s, -s, c, (PF.x + b.x) * px, (PF.y + b.y) * px);
          ctx.drawImage(spr.img, -w / 2, -h / 2, w, h);
        } else {
          ctx.setTransform(px, 0, 0, px, (PF.x + b.x) * px, (PF.y + b.y) * px);
          ctx.drawImage(spr.img, -w / 2, -h / 2, w, h);
        }
        if (alpha !== 1) ctx.globalAlpha = 1;
      }
    }
  }
}
