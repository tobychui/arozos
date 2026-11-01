/**
 * Straight lasers: a thin warning line, then the beam widens, burns for
 * `dur` frames and fades. Only the burning part hurts. A laser can follow an
 * owner (offset ox / oy) and be turned by its `fn(l, G)` each frame.
 */
import { COLORS } from '../gfx/art.js';
import { PF } from '../core/view.js';
import { rgba, mix } from '../core/util.js';

export class LaserSystem {
  constructor(G) {
    this.G = G;
    this.list = [];
  }

  spawn(x, y, a, len, o = {}) {
    const l = {
      x, y, a, len,
      w: o.w ?? 12,
      warn: o.warn ?? 45,
      grow: o.grow ?? 10,
      dur: o.dur ?? 60,
      fade: o.fade ?? 12,
      color: o.color || 'red',
      fn: o.fn || null,
      follow: o.follow || null,
      ox: o.ox || 0,
      oy: o.oy || 0,
      t: 0,
      dead: false,
      grazeT: 0,
      sound: o.sound !== false,
    };
    this.list.push(l);
    if (l.sound) this.G.sfx('laserWarn');
    return l;
  }

  clear() {
    for (const l of this.list) if (!l.dead && l.t < l.warn + l.grow + l.dur) l.t = Math.max(l.t, l.warn + l.grow + l.dur);
  }

  /** Width factor 0..1 at the laser's current age. */
  static k(l) {
    const t = l.t;
    if (t < l.warn) return 0;
    if (t < l.warn + l.grow) return (t - l.warn) / l.grow;
    if (t < l.warn + l.grow + l.dur) return 1;
    return Math.max(0, 1 - (t - l.warn - l.grow - l.dur) / l.fade);
  }

  update() {
    const G = this.G;
    const p = G.player;
    for (const l of this.list) {
      l.t++;
      if (l.follow) {
        if (l.follow.dead) l.t = Math.max(l.t, l.warn + l.grow + l.dur);
        l.x = l.follow.x + l.ox;
        l.y = l.follow.y + l.oy;
      }
      if (l.fn) l.fn(l, G);
      if (l.t === l.warn && l.sound) G.sfx('laser');
      if (l.t > l.warn + l.grow + l.dur + l.fade) {
        l.dead = true;
        continue;
      }
      const k = LaserSystem.k(l);
      if (k < 0.6 || !p.canBeHit()) continue;
      // distance from the player to the beam segment
      const c = Math.cos(l.a);
      const s = Math.sin(l.a);
      const dx = p.x - l.x;
      const dy = p.y - l.y;
      const along = dx * c + dy * s;
      if (along < 0 || along > l.len) continue;
      const perp = Math.abs(-dx * s + dy * c);
      if (perp < l.w * 0.32 * k + p.hitR) p.hit();
      else if (perp < l.w * 0.5 + 16 && ++l.grazeT % 6 === 0) G.graze(p.x, p.y);
    }
    if (this.list.some((l) => l.dead)) this.list = this.list.filter((l) => !l.dead);
  }

  render(ctx, art, px) {
    for (const l of this.list) {
      const hex = COLORS[l.color] || l.color;
      const c = Math.cos(l.a) * px;
      const s = Math.sin(l.a) * px;
      ctx.setTransform(c, s, -s, c, (PF.x + l.x) * px, (PF.y + l.y) * px);
      if (l.t < l.warn) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(l.t * 0.6);
        ctx.fillStyle = hex;
        ctx.fillRect(0, -0.8, l.len, 1.6);
        ctx.globalAlpha = 1;
        continue;
      }
      const k = LaserSystem.k(l);
      const w = l.w * k;
      const spr = laserSprite(art, hex);
      ctx.drawImage(spr.img, 0, -w / 2 - 2, l.len, w + 4);
    }
    ctx.globalAlpha = 1;
  }
}

function laserSprite(art, hex) {
  return art.sprite('laser:' + hex, 64, 16, (g) => {
    const gr = g.createLinearGradient(0, -8, 0, 8);
    gr.addColorStop(0, rgba(hex, 0));
    gr.addColorStop(0.18, rgba(hex, 0.75));
    gr.addColorStop(0.38, mix(hex, '#ffffff', 0.6));
    gr.addColorStop(0.5, '#ffffff');
    gr.addColorStop(0.62, mix(hex, '#ffffff', 0.6));
    gr.addColorStop(0.82, rgba(hex, 0.75));
    gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr;
    g.fillRect(-32, -8, 64, 16);
  });
}
