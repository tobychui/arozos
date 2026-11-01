/**
 * Particles and screen effects: sparks, petals, expanding rings, bursts,
 * floating text, screen flash and shake. Purely visual, so it uses
 * Math.random and may drop particles under load.
 */
import { TAU, rgba } from '../core/util.js';
import { PF } from '../core/view.js';

const MAX = 1400;

export class FX {
  constructor(G) {
    this.G = G;
    this.list = [];
    this.flashA = 0;
    this.flashColor = '#ffffff';
    this.shakeT = 0;
    this.shakeMag = 0;
  }

  add(p) {
    if (this.list.length >= MAX) return;
    p.t = 0;
    p.vx = p.vx || 0;
    p.vy = p.vy || 0;
    p.drag = p.drag ?? 0.94;
    p.rot = p.rot || 0;
    p.vr = p.vr || 0;
    this.list.push(p);
  }

  spark(x, y, color, n = 4, speed = 2.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.4 + Math.random());
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 18 + Math.random() * 14, size: 6 + Math.random() * 6, color });
    }
  }

  burst(x, y, color, size = 60, life = 24) {
    this.add({ kind: 'burst', x, y, life, size, color, drag: 1 });
  }

  ring(x, y, color, r1 = 60, life = 24, width = 3) {
    this.add({ kind: 'ring', x, y, life, size: r1, color, width, drag: 1 });
  }

  petals(x, y, color, n = 6, speed = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random());
      this.add({
        kind: 'petal', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.5,
        life: 40 + Math.random() * 30, size: 5 + Math.random() * 4, color,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3, drag: 0.97, fall: 0.03,
      });
    }
  }

  text(x, y, str, color = '#ffffff', size = 9, life = 40) {
    this.add({ kind: 'text', x, y, vy: -0.6, life, size, color, str, drag: 0.98 });
  }

  explode(x, y, color, big = false) {
    this.burst(x, y, color, big ? 140 : 48, big ? 40 : 20);
    this.ring(x, y, color, big ? 160 : 50, big ? 40 : 20, big ? 5 : 2.5);
    this.spark(x, y, color, big ? 40 : 10, big ? 6 : 3);
    this.petals(x, y, color, big ? 24 : 4, big ? 4 : 2);
  }

  flash(color = '#ffffff', a = 0.8) {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, a);
  }

  shake(mag = 4, t = 20) {
    if (!this.G.app.save.settings.shake) return;
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, t);
  }

  get offset() {
    if (this.shakeT <= 0) return [0, 0];
    const m = this.shakeMag * (this.shakeT / 20);
    return [(Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2];
  }

  update() {
    for (const p of this.list) {
      p.t++;
      p.vx *= p.drag;
      p.vy *= p.drag;
      if (p.fall) p.vy += p.fall;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
    }
    if (this.list.length) this.list = this.list.filter((p) => p.t < p.life);
    this.flashA *= 0.9;
    if (this.flashA < 0.01) this.flashA = 0;
    if (this.shakeT > 0) this.shakeT--;
  }

  /** layer 'under' = drawn below bullets (bursts), 'over' = above. */
  render(ctx, art, px, layer) {
    for (const p of this.list) {
      const k = p.t / p.life;
      const under = p.kind === 'burst' || p.kind === 'ring';
      if ((layer === 'under') !== under) continue;
      ctx.setTransform(px, 0, 0, px, (PF.x + p.x) * px, (PF.y + p.y) * px);
      switch (p.kind) {
        case 'spark': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - k;
          const spr = art.glow(p.color, 16);
          const s = p.size * (1 - k * 0.5);
          ctx.drawImage(spr.img, -s / 2, -s / 2, s, s);
          break;
        }
        case 'burst': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - k) * 0.9;
          const spr = art.glow(p.color, 64);
          const s = p.size * (0.4 + k * 0.8);
          ctx.drawImage(spr.img, -s / 2, -s / 2, s, s);
          break;
        }
        case 'ring':
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width * (1 - k) + 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * (0.15 + k * 0.85), 0, TAU);
          ctx.stroke();
          break;
        case 'petal':
          ctx.globalAlpha = 1 - k * k;
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = rgba('#ffffff', 0.6);
          ctx.beginPath();
          ctx.ellipse(p.size * 0.2, 0, p.size * 0.45, p.size * 0.15, 0, 0, TAU);
          ctx.fill();
          break;
        case 'text':
          ctx.globalAlpha = 1 - k * k;
          ctx.font = `bold ${p.size}px "Segoe UI", sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#000000';
          ctx.fillText(p.str, 0.8, 0.8);
          ctx.fillStyle = p.color;
          ctx.fillText(p.str, 0, 0);
          break;
        default:
          break;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
