/**
 * Stage backgrounds and the named-card backdrop.
 *
 * Each stage is a ground plane seen in perspective (drawn as horizontal
 * strips of a repeating procedural texture, Mode 7 style), a sky above the
 * horizon, billboards standing on the plane (lantern poles, cedars, moon
 * flowers ...) and screen-space particles. The camera glides forward and
 * sways a little. "Low" background detail skips billboards and particles.
 */
import { TAU, rgba, mix } from '../core/util.js';
import { PF } from '../core/view.js';

const FW = PF.w;
const FH = PF.h;

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

/** Deterministic pseudo random for texture painting. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------- textures --
const TEX = {
  street(g, w, h) {
    const r = prng(11);
    g.fillStyle = '#2a1c2a';
    g.fillRect(0, 0, w, h);
    // stone path in the middle third
    for (let y = 0; y < h; y += 16) {
      const off = (y / 16) % 2 ? 0 : 12;
      for (let x = w * 0.3 - 24 + off; x < w * 0.7; x += 24) {
        const v = 52 + r() * 22;
        g.fillStyle = `rgb(${v},${v - 6},${v + 10})`;
        g.fillRect(x + 1, y + 1, 22, 14);
      }
    }
    // wooden stalls on both sides
    for (const side of [0, 1]) {
      const x0 = side ? w * 0.72 : 0;
      for (let y = 0; y < h; y += 8) {
        g.fillStyle = (y / 8) % 2 ? '#4a2418' : '#3e1d14';
        g.fillRect(x0, y, w * 0.28, 8);
      }
      g.fillStyle = '#7a2a20';
      for (let y = 0; y < h; y += 64) g.fillRect(x0, y, w * 0.28, 22);
    }
    // warm light pools
    for (let i = 0; i < 6; i++) {
      const x = i % 2 ? w * 0.34 : w * 0.66;
      const y = (i * h) / 6 + 20;
      const gr = g.createRadialGradient(x, y, 0, x, y, 40);
      gr.addColorStop(0, 'rgba(255,170,80,0.45)');
      gr.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = gr;
      g.fillRect(x - 40, y - 40, 80, 80);
    }
  },
  lake(g, w, h) {
    const r = prng(23);
    g.fillStyle = '#0b2430';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,200,220,0.18)';
    g.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      const x = r() * w;
      const y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 10, y - 2, x + 20 + r() * 20, y);
      g.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const x = r() * w;
      const y = r() * h;
      const rr = 10 + r() * 10;
      g.fillStyle = '#1f5a3a';
      g.beginPath();
      g.arc(x, y, rr, 0.3, TAU - 0.1);
      g.lineTo(x, y);
      g.fill();
      if (r() < 0.6) {
        g.fillStyle = '#ffd0e4';
        for (let k = 0; k < 6; k++) {
          const a = (k * TAU) / 6;
          g.beginPath();
          g.ellipse(x + Math.cos(a) * 3, y + Math.sin(a) * 2, 3.5, 1.6, a, 0, TAU);
          g.fill();
        }
        g.fillStyle = '#ffe680';
        g.beginPath();
        g.arc(x, y, 1.6, 0, TAU);
        g.fill();
      }
    }
  },
  meadow(g, w, h) {
    const r = prng(37);
    g.fillStyle = '#16261a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const x = r() * w;
      const y = r() * h;
      g.strokeStyle = `rgba(${40 + r() * 40},${80 + r() * 60},${40 + r() * 30},0.8)`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y - 4 - r() * 4);
      g.stroke();
    }
    for (let i = 0; i < 60; i++) {
      const x = r() * w;
      const y = r() * h;
      g.fillStyle = r() < 0.8 ? '#ffe45a' : '#fff6b0';
      for (let k = 0; k < 4; k++) {
        const a = (k * TAU) / 4 + 0.4;
        g.beginPath();
        g.arc(x + Math.cos(a) * 2, y + Math.sin(a) * 2, 1.9, 0, TAU);
        g.fill();
      }
    }
  },
  steps(g, w, h) {
    const r = prng(41);
    g.fillStyle = '#141018';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = '#4a4450';
      g.fillRect(w * 0.28, y, w * 0.44, 22);
      g.fillStyle = '#6a6474';
      g.fillRect(w * 0.28, y, w * 0.44, 3);
      g.fillStyle = '#26202c';
      g.fillRect(w * 0.28, y + 22, w * 0.44, 10);
      for (let k = 0; k < 8; k++) {
        g.fillStyle = `rgba(60,110,60,${0.3 + r() * 0.4})`;
        g.fillRect(w * 0.28 + r() * w * 0.44, y + r() * 22, 4 + r() * 10, 2 + r() * 3);
      }
    }
    for (let i = 0; i < 300; i++) {
      const side = r() < 0.5 ? r() * w * 0.27 : w * 0.73 + r() * w * 0.27;
      g.fillStyle = `rgba(${30 + r() * 20},${50 + r() * 40},${30 + r() * 20},0.9)`;
      g.fillRect(side, r() * h, 3, 3);
    }
  },
  clouds(g, w, h) {
    const r = prng(53);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#1a2448');
    gr.addColorStop(1, '#1a2448');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = r() * w;
      const y = r() * h;
      const rr = 14 + r() * 30;
      for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
        const cg = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rr);
        cg.addColorStop(0, `rgba(${170 + r() * 40},${180 + r() * 40},230,0.35)`);
        cg.addColorStop(1, 'rgba(160,170,230,0)');
        g.fillStyle = cg;
        g.fillRect(x + ox - rr, y + oy - rr, rr * 2, rr * 2);
      }
    }
  },
  garden(g, w, h) {
    const r = prng(67);
    g.fillStyle = '#0e1c18';
    g.fillRect(0, 0, w, h);
    // stepping stones up the middle
    for (let y = 6; y < h; y += 26) {
      g.fillStyle = 'rgba(200,214,210,0.22)';
      g.beginPath();
      g.ellipse(w / 2 + ((y / 26) % 2 ? 6 : -6), y, 13, 7, 0, 0, TAU);
      g.fill();
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${30 + r() * 30},${70 + r() * 50},${50 + r() * 30},0.8)`;
      g.fillRect(r() * w, r() * h, 2, 4);
    }
    for (let i = 0; i < 45; i++) {
      const x = r() * w;
      const y = r() * h;
      if (x > w * 0.4 && x < w * 0.6) continue;
      // muted blue-grey rather than white, so ground blossoms never pass for petal bullets
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5;
        g.fillStyle = 'rgba(150,160,206,0.55)';
        g.beginPath();
        g.ellipse(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 3.6, 1.8, a, 0, TAU);
        g.fill();
      }
      g.fillStyle = 'rgba(200,206,150,0.5)';
      g.beginPath();
      g.arc(x, y, 1.5, 0, TAU);
      g.fill();
    }
  },
};

// -------------------------------------------------------------- configs --
const CONFIGS = {
  street: { tex: 'street', horizon: 120, camH: 40, T: 1.6, speed: 1.4, sky: ['#05051a', '#1a0f38', '#5a2440'], fog: '#3a1838', fogLen: 150, props: 'lanterns', particles: 'embers', fireworks: true },
  lake: { tex: 'lake', horizon: 112, camH: 34, T: 1.4, speed: 1.1, sky: ['#030818', '#0a1a3a', '#1c4058'], fog: '#18384a', fogLen: 170, props: 'floatLanterns', particles: 'mist', moon: { x: 280, y: 60, r: 26, reflect: true } },
  meadow: { tex: 'meadow', horizon: 132, camH: 30, T: 1.8, speed: 1.6, sky: ['#0a0620', '#2a1848', '#7a4a5a'], fog: '#3a2a3a', fogLen: 160, props: 'grass', particles: 'moths' },
  steps: { tex: 'steps', horizon: 96, camH: 44, T: 1.5, speed: 1.2, sky: ['#05030c', '#120a20', '#24183a'], fog: '#22163a', fogLen: 190, props: 'cedars', particles: 'threads' },
  clouds: { tex: 'clouds', horizon: 170, camH: 60, T: 1.2, speed: 2.4, sky: ['#02030e', '#0a1438', '#30487a'], fog: '#3a4c80', fogLen: 120, props: null, particles: 'stars', armillary: true },
  garden: { tex: 'garden', horizon: 124, camH: 36, T: 1.6, speed: 0.9, sky: ['#0a0c22', '#2a3058', '#8a8ab0'], fog: '#6a6a90', fogLen: 160, props: 'moonflowers', particles: 'petals', moon: { x: 192, y: 64, r: 58 } },
};

export function makeBackground(key, G) {
  return new StageBackground(CONFIGS[key] || CONFIGS.street, G);
}

class StageBackground {
  constructor(cfg, G) {
    this.cfg = cfg;
    this.G = G;
    this.tex = canvas(256, 256, TEX[cfg.tex]);
    this.pattern = null;
    this.scroll = 0;
    this.t = 0;
    this.camX = 0;
    this.parts = [];
    this.fireworks = [];
    const r = prng(cfg.horizon * 7);
    this.stars = [];
    for (let i = 0; i < 70; i++) this.stars.push({ x: r() * FW, y: r() * cfg.horizon, s: 0.4 + r() * 1.2, p: r() * TAU });
    this.props = [];
    if (cfg.props) {
      for (let i = 0; i < 14; i++) {
        const side = i % 2 ? 1 : -1;
        this.props.push({ x: side * (cfg.props === 'grass' ? 30 + r() * 80 : cfg.props === 'moonflowers' ? 40 + r() * 70 : cfg.props === 'floatLanterns' ? (r() - 0.5) * 160 : 62 + r() * 8), z: 20 + i * 22, v: r() });
      }
    }
  }

  get detail() {
    return this.G.app.save.settings.bgDetail !== 'low';
  }

  update() {
    const c = this.cfg;
    this.t++;
    this.scroll += c.speed * (this.G.boss ? 0.5 : 1);
    this.camX = Math.sin(this.t * 0.004) * 18;
    if (!this.detail) return;
    // particles
    const P = this.parts;
    switch (c.particles) {
      case 'embers':
        if (this.t % 16 === 0) P.push({ x: Math.random() * FW, y: FH + 10, vx: (Math.random() - 0.5) * 0.3, vy: -0.5 - Math.random() * 0.6, s: 1.5 + Math.random() * 2, life: 700, c: Math.random() < 0.5 ? '#ffb050' : '#ff6a3a' });
        break;
      case 'mist':
        if (this.t % 40 === 0) P.push({ x: -80, y: c.horizon + Math.random() * 220, vx: 0.3 + Math.random() * 0.3, vy: 0, s: 80 + Math.random() * 80, life: 1400, c: '#9fd0e0', mist: true });
        break;
      case 'moths':
        if (this.t % 18 === 0) P.push({ x: Math.random() * FW, y: FH + 10, vx: (Math.random() - 0.5) * 1.5, vy: -0.8 - Math.random(), s: 1.8, life: 700, c: '#ffe08a', wob: Math.random() * TAU });
        break;
      case 'threads':
        if (this.t % 30 === 0) P.push({ x: Math.random() * FW, y: -60, vx: 0, vy: 0.5 + Math.random() * 0.4, s: 40 + Math.random() * 60, life: 1200, c: '#e0d8ff', thread: true });
        break;
      case 'stars':
        if (this.t % 9 === 0) P.push({ x: Math.random() * FW, y: -10, vx: -0.6, vy: 3 + Math.random() * 2, s: 10 + Math.random() * 14, life: 300, c: '#e8f0ff', streak: true });
        break;
      case 'petals':
        if (this.t % 7 === 0) P.push({ x: Math.random() * FW * 1.4, y: -10, vx: -0.6 - Math.random() * 0.6, vy: 0.7 + Math.random() * 0.6, s: 3 + Math.random() * 3, life: 900, c: '#f6f8ff', rot: Math.random() * TAU, petal: true });
        break;
      default:
        break;
    }
    for (const p of P) {
      p.life--;
      p.x += p.vx + (p.wob !== undefined ? Math.sin(this.t * 0.05 + p.wob) * 0.8 : 0);
      p.y += p.vy;
      if (p.rot !== undefined) p.rot += 0.03;
    }
    this.parts = P.filter((p) => p.life > 0 && p.y > -120 && p.y < FH + 40 && p.x < FW + 200);
    if (c.fireworks && this.t % 150 === 0) {
      this.fireworks.push({ x: 40 + Math.random() * (FW - 80), y: 20 + Math.random() * (c.horizon - 40), t: 0, c: ['#ff6a6a', '#ffd06a', '#6ad0ff', '#ff8ad8'][Math.floor(Math.random() * 4)] });
    }
    for (const f of this.fireworks) f.t++;
    this.fireworks = this.fireworks.filter((f) => f.t < 90);
  }

  render(ctx, px) {
    const c = this.cfg;
    const ox = PF.x;
    const oy = PF.y;
    ctx.setTransform(px, 0, 0, px, ox * px, oy * px);
    // sky
    const sg = ctx.createLinearGradient(0, 0, 0, c.horizon + 4);
    sg.addColorStop(0, c.sky[0]);
    sg.addColorStop(0.6, c.sky[1]);
    sg.addColorStop(1, c.sky[2]);
    ctx.fillStyle = sg;
    ctx.fillRect(-10, -10, FW + 20, c.horizon + 14);
    for (const s of this.stars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 0.03 + s.p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    if (c.moon) this.drawMoon(ctx, c.moon);
    if (c.armillary) this.drawArmillary(ctx);
    for (const f of this.fireworks) {
      const k = f.t / 90;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.c;
      for (let i = 0; i < 24; i++) {
        const a = (i * TAU) / 24;
        const rr = 6 + 40 * Math.sqrt(k);
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr + k * k * 10, 1.4, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ground plane
    if (!this.pattern) this.pattern = ctx.createPattern(this.tex, 'repeat');
    ctx.fillStyle = this.pattern;
    const hz = c.horizon;
    const T = c.T;
    const uc = 128 + this.camX * T;
    let y = hz + 1;
    while (y < FH) {
      const dy = y - hz;
      const step = Math.max(1, Math.min(4, dy / 30));
      const z0 = (c.camH * 160) / dy;
      const z1 = (c.camH * 160) / (dy + step);
      const v0 = (z0 + this.scroll) * T;
      const v1 = (z1 + this.scroll) * T;
      const dv = Math.max(0.01, v0 - v1);
      const sx = dy / c.camH / T;
      const ys = step / dv;
      // flipped y: the strip's top row samples v0 (far), its bottom row v1 (near)
      ctx.setTransform(px * sx, 0, 0, -px * ys, px * (ox + FW / 2 - uc * sx), px * (oy + y + v0 * ys));
      ctx.fillRect(uc - FW / 2 / sx, v1, FW / sx, dv);
      y += step;
    }
    ctx.setTransform(px, 0, 0, px, ox * px, oy * px);
    if (c.moon && c.moon.reflect) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const yy = hz + 6 + i * i * 1.6;
        const w = 10 + i * 2 + Math.sin(this.t * 0.07 + i) * 4;
        ctx.fillStyle = `rgba(220,240,255,${0.25 - i * 0.012})`;
        ctx.fillRect(c.moon.x - w / 2 + Math.sin(this.t * 0.05 + i * 1.3) * 3, yy, w, 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // fog toward the horizon
    const fg = ctx.createLinearGradient(0, hz - 2, 0, hz + c.fogLen);
    fg.addColorStop(0, c.fog);
    fg.addColorStop(1, rgba(c.fog, 0));
    ctx.fillStyle = fg;
    ctx.fillRect(-10, hz - 2, FW + 20, c.fogLen + 2);

    if (this.detail) {
      this.drawProps(ctx, px);
      this.drawParticles(ctx);
    }
    // a soft vignette keeps bullets readable at the edges
    const vg = ctx.createRadialGradient(FW / 2, FH / 2, FH * 0.35, FW / 2, FH / 2, FH * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,10,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, FW, FH);
  }

  drawMoon(ctx, m) {
    const g = ctx.createRadialGradient(m.x, m.y, m.r * 0.6, m.x, m.y, m.r * 2.6);
    g.addColorStop(0, 'rgba(255,250,230,0.5)');
    g.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(m.x - m.r * 3, m.y - m.r * 3, m.r * 6, m.r * 6);
    ctx.fillStyle = '#fbf6e4';
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,190,170,0.35)';
    for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.35, 0.12], [0.3, -0.35, 0.1]]) {
      ctx.beginPath();
      ctx.arc(m.x + dx * m.r, m.y + dy * m.r, rr * m.r, 0, TAU);
      ctx.fill();
    }
  }

  drawArmillary(ctx) {
    const cx = FW / 2;
    const cy = 70;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#e8c068';
    ctx.lineWidth = 1.4;
    const tilt = [0.3, 1.2, 2.1];
    tilt.forEach((tl, i) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 130 - i * 18, (130 - i * 18) * Math.abs(Math.sin(this.t * 0.001 + tl)) * 0.5 + 6, tl, 0, TAU);
      ctx.stroke();
    });
    ctx.restore();
  }

  drawProps(ctx, px) {
    const c = this.cfg;
    if (!c.props) return;
    const art = this.G.art;
    const hz = c.horizon;
    const range = 14 * 22;
    const list = this.props
      .map((p) => {
        let z = (p.z - this.scroll) % range;
        if (z < 0) z += range;
        return { p, z: z + 8 };
      })
      .sort((a, b) => b.z - a.z);
    for (const { p, z } of list) {
      const dy = (c.camH * 160) / z;
      const y = hz + dy;
      if (y > FH + 80) continue;
      const s = dy / c.camH;
      const x = FW / 2 + (p.x - this.camX) * s;
      const fade = Math.min(1, (y - hz) / 60);
      ctx.globalAlpha = fade;
      const spr = propSprite(art, c.props, p.v);
      const w = spr.w * s * 0.35;
      const h = spr.h * s * 0.35;
      ctx.setTransform(px, 0, 0, px, (PF.x + x) * px, (PF.y + y) * px);
      if (c.props === 'floatLanterns') ctx.translate(0, Math.sin(this.t * 0.05 + p.v * 10) * s);
      ctx.drawImage(spr.img, -w / 2, -h, w, h);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(px, 0, 0, px, PF.x * px, PF.y * px);
  }

  drawParticles(ctx) {
    for (const p of this.parts) {
      if (p.mist) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s);
        g.addColorStop(0, 'rgba(160,210,225,0.12)');
        g.addColorStop(1, 'rgba(160,210,225,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
      } else if (p.thread) {
        ctx.strokeStyle = 'rgba(230,220,255,0.25)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - p.s);
        ctx.lineTo(p.x + Math.sin(this.t * 0.02 + p.x) * 3, p.y);
        ctx.stroke();
      } else if (p.petal) {
        // stage 6 rains white and pink petal bullets, so background petals are
        // a dim periwinkle, out of focus, with no core and no edge
        const spr = petalSprite(this.G.art);
        const k = p.s / 6;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(spr.img, (-spr.w / 2) * k, (-spr.h / 2) * k, spr.w * k, spr.h * k);
        ctx.restore();
      } else if (p.streak) {
        ctx.strokeStyle = 'rgba(220,235,255,0.22)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * p.s * 0.3, p.y - p.vy * p.s * 0.3);
        ctx.stroke();
      } else {
        // soft blobs with no bright core, so they never read as bullets
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 2.4);
        gl.addColorStop(0, rgba(p.c, 0.32));
        gl.addColorStop(1, rgba(p.c, 0));
        ctx.fillStyle = gl;
        ctx.fillRect(p.x - p.s * 2.4, p.y - p.s * 2.4, p.s * 4.8, p.s * 4.8);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
}

/** A soft background petal (6 units long at k = 1): the colour fades out to its edge. */
function petalSprite(art) {
  return art.sprite('bg:petal', 20, 10, (g) => {
    g.scale(1, 0.42);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 9);
    gr.addColorStop(0, 'rgba(140,148,214,0.42)');
    gr.addColorStop(0.6, 'rgba(126,134,204,0.22)');
    gr.addColorStop(1, 'rgba(110,118,196,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, 9, 0, TAU);
    g.fill();
  });
}

function propSprite(art, kind, v) {
  const variant = Math.floor(v * 3);
  switch (kind) {
    case 'lanterns':
      return art.sprite('bg:lantern', 60, 200, (g) => {
        g.fillStyle = '#2a1410';
        g.fillRect(-2.5, -100, 5, 200);
        g.fillRect(-26, -96, 52, 4);
        for (const [x, y] of [[-18, -78], [0, -84], [18, -78]]) {
          const gr = g.createRadialGradient(x, y, 2, x, y, 22);
          gr.addColorStop(0, 'rgba(255,170,80,0.55)');
          gr.addColorStop(1, 'rgba(255,120,40,0)');
          g.fillStyle = gr;
          g.fillRect(x - 22, y - 22, 44, 44);
          g.fillStyle = '#e8402a';
          g.beginPath();
          g.ellipse(x, y, 7, 9, 0, 0, TAU);
          g.fill();
          g.fillStyle = '#ffd88a';
          g.beginPath();
          g.ellipse(x, y + 1, 4, 6, 0, 0, TAU);
          g.fill();
        }
      });
    case 'floatLanterns':
      return art.sprite('bg:float', 40, 40, (g) => {
        const gr = g.createRadialGradient(0, -8, 2, 0, -8, 20);
        gr.addColorStop(0, 'rgba(255,200,120,0.6)');
        gr.addColorStop(1, 'rgba(255,160,80,0)');
        g.fillStyle = gr;
        g.fillRect(-20, -28, 40, 40);
        g.fillStyle = '#3a2418';
        g.fillRect(-9, 6, 18, 4);
        g.fillStyle = '#fff0c8';
        g.fillRect(-7, -12, 14, 18);
        g.fillStyle = '#ff9a5a';
        g.fillRect(-7, -12, 14, 3);
      });
    case 'grass':
      return art.sprite('bg:grass' + variant, 40, 70, (g) => {
        g.strokeStyle = '#2f5a2a';
        g.lineWidth = 2;
        for (let i = 0; i < 7; i++) {
          g.beginPath();
          g.moveTo((i - 3) * 2, 35);
          g.quadraticCurveTo((i - 3) * 4, 0, (i - 3) * 6 + variant * 2, -30 + (i % 3) * 6);
          g.stroke();
        }
        g.fillStyle = '#ffe45a';
        for (const [x, y] of [[-8, -22], [10, -28], [2, -12]]) {
          for (let k = 0; k < 4; k++) {
            const a = (k * TAU) / 4;
            g.beginPath();
            g.arc(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 2.4, 0, TAU);
            g.fill();
          }
        }
      });
    case 'cedars':
      return art.sprite('bg:cedar' + variant, 60, 300, (g) => {
        g.fillStyle = '#1e1410';
        g.beginPath();
        g.moveTo(-9, 150);
        g.lineTo(-6, -150);
        g.lineTo(6, -150);
        g.lineTo(9, 150);
        g.fill();
        g.fillStyle = '#2a1c16';
        g.fillRect(-2, -150, 3, 300);
        if (variant !== 1) {
          g.strokeStyle = 'rgba(235,230,255,0.45)';
          g.lineWidth = 0.7;
          const cx = 20;
          const cy = -40 + variant * 30;
          for (let rr = 4; rr < 22; rr += 5) {
            g.beginPath();
            g.arc(cx, cy, rr, 0, TAU);
            g.stroke();
          }
          for (let k = 0; k < 8; k++) {
            const a = (k * TAU) / 8;
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24);
            g.stroke();
          }
        }
      });
    case 'moonflowers':
      return art.sprite('bg:moonflower' + variant, 60, 90, (g) => {
        g.strokeStyle = '#2a5a3a';
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(0, 45);
        g.quadraticCurveTo(-6, 0, 2, -24);
        g.stroke();
        g.fillStyle = '#2f6a40';
        g.beginPath();
        g.ellipse(-8, 10, 9, 3.5, 0.5, 0, TAU);
        g.ellipse(7, 20, 9, 3.5, -0.5, 0, TAU);
        g.fill();
        const gr = g.createRadialGradient(2, -28, 2, 2, -28, 26);
        gr.addColorStop(0, 'rgba(255,255,255,0.5)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(-24, -54, 52, 52);
        for (let k = 0; k < 12; k++) {
          const a = (k * TAU) / 12;
          g.fillStyle = k % 2 ? '#ffffff' : '#eef6ff';
          g.beginPath();
          g.ellipse(2 + Math.cos(a) * 9, -28 + Math.sin(a) * 9, 9, 2.6, a, 0, TAU);
          g.fill();
        }
        g.fillStyle = '#f0f4b0';
        g.beginPath();
        g.arc(2, -28, 3, 0, TAU);
        g.fill();
      });
    default:
      return art.glow('#ffffff', 8);
  }
}

/** Backdrop while a named card is up: the boss's colours and a turning bloom. */
export class CardBackground {
  constructor(G, cast, style = 'bloom') {
    this.G = G;
    this.cast = cast;
    this.style = style;
    this.t = 0;
  }

  update() {
    this.t++;
  }

  render(ctx, px, k) {
    const c = this.cast;
    ctx.setTransform(px, 0, 0, px, PF.x * px, PF.y * px);
    ctx.globalAlpha = k * 0.88;
    const bg = ctx.createRadialGradient(FW / 2, FH * 0.3, 20, FW / 2, FH * 0.4, FH * 0.8);
    bg.addColorStop(0, mix(c.color, '#120820', 0.6));
    bg.addColorStop(1, '#05030c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);
    ctx.globalAlpha = k;
    ctx.save();
    ctx.translate(FW / 2, FH * 0.36);
    // concentric rings
    ctx.strokeStyle = rgba(c.color, 0.18);
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const rr = ((i * 40 + this.t * 0.6) % 360) + 10;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, TAU);
      ctx.stroke();
    }
    // big bloom
    const petals = this.style === 'stars' ? 5 : this.style === 'web' ? 8 : 12;
    ctx.rotate(this.t * 0.004);
    ctx.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 2; layer++) {
      ctx.rotate(layer * (Math.PI / petals));
      for (let i = 0; i < petals; i++) {
        const a = (i * TAU) / petals;
        ctx.fillStyle = rgba(layer ? c.accent : c.color, 0.07 + layer * 0.03);
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 90, Math.sin(a) * 90, 100 - layer * 30, 22 - layer * 6, a, 0, TAU);
        ctx.fill();
      }
    }
    if (this.style === 'web') {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      for (let rr = 30; rr < 300; rr += 30) {
        ctx.beginPath();
        for (let i = 0; i <= 8; i++) {
          const a = (i * TAU) / 8;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.stroke();
      }
    }
    if (this.style === 'stars') {
      ctx.fillStyle = 'rgba(255,240,200,0.5)';
      for (let i = 0; i < 40; i++) {
        const a = i * 2.4;
        const rr = (i * 37) % 260;
        ctx.fillRect(Math.cos(a) * rr, Math.sin(a) * rr, 1.5, 1.5);
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    // drifting petals
    ctx.fillStyle = rgba(c.accent, 0.25);
    for (let i = 0; i < 16; i++) {
      const x = (i * 97 + this.t * (0.3 + (i % 3) * 0.2)) % (FW + 40) - 20;
      const y = (i * 61 + this.t * (0.6 + (i % 4) * 0.15)) % (FH + 40) - 20;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.t * 0.02 + i);
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 2.4, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
