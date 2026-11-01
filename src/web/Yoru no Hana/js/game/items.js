/**
 * Items: power (P), big power, full power (F), point (点), cancel petals,
 * life and bomb pieces. Items pop up, then drift down; they fly to the
 * heroine when she is above the collection line, when they spawned as
 * auto-collect (cancelled bullets, card rewards), or when she is close.
 */
import { PF } from '../core/view.js';

export const POC_Y = 112;

export class ItemSystem {
  constructor(G) {
    this.G = G;
    this.list = [];
  }

  spawn(kind, x, y, o = {}) {
    const it = {
      kind,
      x,
      y,
      vx: o.vx ?? (o.spread ? (Math.random() - 0.5) * o.spread : 0),
      vy: o.vy ?? -2.6 - Math.random() * 0.8,
      t: 0,
      auto: !!o.auto,
      full: !!o.full,
      dead: false,
    };
    if (kind === 'cancel') {
      it.vy = -0.6 - Math.random();
      it.vx = (Math.random() - 0.5) * 1.5;
    }
    this.list.push(it);
    return it;
  }

  /** Scatter a bundle of items around a point. */
  drop(x, y, bundle, spread = 40) {
    for (const [kind, n] of Object.entries(bundle)) {
      for (let i = 0; i < n; i++) {
        this.spawn(kind, x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.6, {
          vx: (Math.random() - 0.5) * 1.6,
        });
      }
    }
  }

  collectAll() {
    for (const it of this.list) it.auto = true;
  }

  update() {
    const G = this.G;
    const p = G.player;
    const alive = p.alive;
    const above = alive && p.y < POC_Y;
    if (above) for (const it of this.list) if (!it.auto) it.full = it.auto = true;
    const magnet = p.focus ? 52 : 30;
    for (const it of this.list) {
      it.t++;
      const dx = p.x - it.x;
      const dy = p.y - it.y;
      const d = Math.hypot(dx, dy);
      const homing = alive && (it.auto && (it.kind !== 'cancel' || it.t > 18)) || (alive && d < magnet);
      if (homing) {
        const sp = Math.max(8, 14 - d * 0.02);
        it.x += (dx / (d || 1)) * Math.min(sp, d);
        it.y += (dy / (d || 1)) * Math.min(sp, d);
      } else {
        it.vy = Math.min(it.vy + 0.06, it.kind === 'cancel' ? 1.2 : 2.2);
        it.vx *= 0.96;
        it.x += it.vx;
        it.y += it.vy;
        if (it.kind === 'cancel' && it.t > 18 && !alive) it.vy *= 0.9;
      }
      if (alive && d < 14) {
        it.dead = true;
        G.collect(it);
      } else if (it.y > PF.h + 24) {
        it.dead = true;
      }
    }
    if (this.list.some((i) => i.dead)) this.list = this.list.filter((i) => !i.dead);
  }

  render(ctx, art, px) {
    for (const it of this.list) {
      const spr = art.item(it.kind);
      let y = it.y;
      if (y < -4) {
        // off the top: draw a marker at the edge
        ctx.globalAlpha = 0.6;
        y = 6;
      }
      ctx.setTransform(px, 0, 0, px, (PF.x + it.x) * px, (PF.y + y) * px);
      if (it.kind === 'cancel') ctx.rotate(it.t * 0.15);
      ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
      ctx.globalAlpha = 1;
    }
  }
}
