/**
 * Pre-rendered sprites for bullets, player shots and items.
 *
 * Every sprite is drawn once with canvas paths at the current device scale
 * (view.px) and cached; the cache is dropped when the scale changes. Bullet
 * art follows one rule for readability: a white core inside a saturated rim
 * with a thin dark edge, so every colour reads on every background.
 * Oriented shapes are drawn pointing along +x (angle 0).
 */
import { TAU, rgba, mix } from '../core/util.js';

export const COLORS = {
  red: '#ff2f48',
  orange: '#ff8a1a',
  yellow: '#ffd52a',
  green: '#3ae070',
  cyan: '#26e2ea',
  blue: '#3f6dff',
  purple: '#a253ff',
  pink: '#ff55c8',
  white: '#dfe3ff',
  gray: '#9090aa',
};
export const COLOR_LIST = Object.keys(COLORS);

/** w/h: drawn size in logical px, r: hit radius, layer: 0 drawn first. */
export const BTYPES = {
  pellet: { w: 9, h: 9, r: 2.4, layer: 2 },
  ball: { w: 15, h: 15, r: 4.4, layer: 1 },
  orb: { w: 32, h: 32, r: 9.5, layer: 0 },
  bubble: { w: 48, h: 48, r: 15.5, layer: 0 },
  rice: { w: 15, h: 8, r: 2.5, layer: 2, orient: true },
  kunai: { w: 17, h: 10, r: 2.6, layer: 2, orient: true },
  drop: { w: 17, h: 11, r: 3.2, layer: 2, orient: true },
  ember: { w: 20, h: 13, r: 3.4, layer: 1, orient: true },
  petal: { w: 17, h: 10, r: 2.8, layer: 2, orient: true },
  star: { w: 19, h: 19, r: 4.4, layer: 1, spin: 0.09 },
  flower: { w: 21, h: 21, r: 4.8, layer: 1, spin: 0.05 },
  moth: { w: 21, h: 19, r: 4.2, layer: 1, orient: true },
  ring: { w: 17, h: 17, r: 4.4, layer: 1 },
  shard: { w: 17, h: 8, r: 2.4, layer: 2, orient: true },
  lantern: { w: 26, h: 32, r: 8.5, layer: 0 },
};

const PAD = 3;

export class Art {
  constructor(view) {
    this.view = view;
    this.cache = new Map();
    view.onScale(() => this.cache.clear());
  }

  get px() {
    return this.view.px;
  }

  /** Make (or fetch) a cached sprite: draw(ctx) in logical units centred at 0,0. */
  sprite(key, w, h, draw) {
    let s = this.cache.get(key);
    if (s) return s;
    const px = this.px;
    const cw = w + PAD * 2;
    const ch = h + PAD * 2;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(cw * px));
    c.height = Math.max(1, Math.ceil(ch * px));
    const g = c.getContext('2d');
    g.setTransform(px, 0, 0, px, (cw * px) / 2, (ch * px) / 2);
    draw(g);
    s = { img: c, w: cw, h: ch };
    this.cache.set(key, s);
    return s;
  }

  bullet(type, color) {
    const def = BTYPES[type];
    const hex = COLORS[color] || color;
    return this.sprite('b:' + type + ':' + hex, def.w, def.h, (g) => drawBullet(g, type, hex, def));
  }

  /** A soft additive glow disc (spawn flares, effects). */
  glow(hex, size = 32) {
    return this.sprite('g:' + hex + ':' + size, size, size, (g) => {
      const r = size / 2;
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, rgba('#ffffff', 0.9));
      gr.addColorStop(0.25, rgba(hex, 0.7));
      gr.addColorStop(1, rgba(hex, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
    });
  }

  shot(kind) {
    switch (kind) {
      case 'flame':
        return this.sprite('s:flame', 8, 22, (g) => {
          const gr = g.createLinearGradient(0, -11, 0, 11);
          gr.addColorStop(0, '#fff6c8');
          gr.addColorStop(0.35, '#ffa040');
          gr.addColorStop(1, 'rgba(255,60,20,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.moveTo(0, -11);
          g.quadraticCurveTo(4, -4, 2.5, 11);
          g.lineTo(-2.5, 11);
          g.quadraticCurveTo(-4, -4, 0, -11);
          g.fill();
        });
      case 'ember':
        return this.sprite('s:ember', 12, 12, (g) => {
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, 6);
          gr.addColorStop(0, '#ffffff');
          gr.addColorStop(0.3, '#ffb060');
          gr.addColorStop(1, 'rgba(255,40,40,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(0, 0, 6, 0, TAU);
          g.fill();
        });
      case 'needle':
        return this.sprite('s:needle', 4, 26, (g) => {
          const gr = g.createLinearGradient(0, -13, 0, 13);
          gr.addColorStop(0, '#ffffff');
          gr.addColorStop(0.4, '#9ff4ff');
          gr.addColorStop(1, 'rgba(60,160,255,0)');
          g.fillStyle = gr;
          g.fillRect(-1.6, -13, 3.2, 26);
        });
      case 'wave':
        return this.sprite('s:wave', 10, 16, (g) => {
          g.strokeStyle = 'rgba(170,240,255,0.95)';
          g.lineWidth = 2;
          g.beginPath();
          g.arc(0, 4, 5, Math.PI * 1.1, Math.PI * 1.9);
          g.stroke();
          g.strokeStyle = 'rgba(80,170,255,0.6)';
          g.beginPath();
          g.arc(0, 8, 5, Math.PI * 1.15, Math.PI * 1.85);
          g.stroke();
        });
      default:
        return this.glow('#ffffff', 10);
    }
  }

  item(kind) {
    const sz = ITEM_SIZE[kind] || 14;
    return this.sprite('i:' + kind, sz, sz, (g) => drawItem(g, kind, sz));
  }
}

export const ITEM_SIZE = { power: 13, bigPower: 19, point: 13, cancel: 9, life: 18, bomb: 18, full: 19 };

// -------------------------------------------------------------- bullets --
function roundBullet(g, r, hex, glow = 1.55) {
  const gr = g.createRadialGradient(0, 0, r * 0.6, 0, 0, r * glow);
  gr.addColorStop(0, rgba(hex, 0.55));
  gr.addColorStop(1, rgba(hex, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r * glow, 0, TAU);
  g.fill();
  g.fillStyle = hex;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(10,0,30,0.55)';
  g.lineWidth = Math.max(0.6, r * 0.14);
  g.stroke();
  const c = g.createRadialGradient(-r * 0.12, -r * 0.12, 0, 0, 0, r * 0.82);
  c.addColorStop(0, '#ffffff');
  c.addColorStop(0.55, '#ffffff');
  c.addColorStop(1, rgba('#ffffff', 0));
  g.fillStyle = c;
  g.beginPath();
  g.arc(0, 0, r * 0.82, 0, TAU);
  g.fill();
}

function outlined(g, path, hex, coreScale, lw = 0.8) {
  g.save();
  g.shadowColor = rgba(hex, 0.8);
  g.shadowBlur = 3 * g.getTransform().a;
  path(g, 1);
  g.fillStyle = hex;
  g.fill();
  g.restore();
  path(g, 1);
  g.strokeStyle = 'rgba(10,0,30,0.6)';
  g.lineWidth = lw;
  g.stroke();
  path(g, coreScale);
  g.fillStyle = '#ffffff';
  g.fill();
}

function drawBullet(g, type, hex, def) {
  const light = mix(hex, '#ffffff', 0.45);
  switch (type) {
    case 'pellet':
      roundBullet(g, 3.4, hex);
      break;
    case 'ball':
      roundBullet(g, 5.8, hex);
      break;
    case 'orb':
      roundBullet(g, 12, hex, 1.35);
      break;
    case 'bubble': {
      const r = 19;
      const gr = g.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.25);
      gr.addColorStop(0, rgba(hex, 0.25));
      gr.addColorStop(0.75, rgba(hex, 0.75));
      gr.addColorStop(1, rgba(hex, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, r * 1.25, 0, TAU);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(0, 0, r * 0.82, 0, TAU);
      g.stroke();
      g.fillStyle = rgba('#ffffff', 0.85);
      g.beginPath();
      g.ellipse(-r * 0.35, -r * 0.38, r * 0.22, r * 0.14, -0.7, 0, TAU);
      g.fill();
      break;
    }
    case 'rice':
      outlined(g, (c, s) => {
        c.beginPath();
        c.ellipse(0, 0, 6.5 * s, 3.3 * s, 0, 0, TAU);
      }, hex, 0.55);
      break;
    case 'kunai':
      outlined(g, (c, s) => {
        c.beginPath();
        c.moveTo(7.5 * s, 0);
        c.lineTo(-1 * s, 4 * s);
        c.lineTo(-7 * s, 1.6 * s);
        c.lineTo(-7 * s, -1.6 * s);
        c.lineTo(-1 * s, -4 * s);
        c.closePath();
      }, hex, 0.5);
      break;
    case 'drop':
      outlined(g, (c, s) => {
        c.beginPath();
        c.arc(2.5 * s, 0, 4.3 * s, -Math.PI / 2, Math.PI / 2);
        c.quadraticCurveTo(-3 * s, 3 * s, -7.5 * s, 0);
        c.quadraticCurveTo(-3 * s, -3 * s, 2.5 * s, -4.3 * s);
        c.closePath();
      }, hex, 0.5);
      break;
    case 'ember': {
      g.save();
      g.shadowColor = hex;
      g.shadowBlur = 10 * 0.3 * g.getTransform().a;
      const gr = g.createLinearGradient(8, 0, -10, 0);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.3, light);
      gr.addColorStop(0.6, hex);
      gr.addColorStop(1, rgba(hex, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(3.5, 0, 4.6, -Math.PI / 2, Math.PI / 2);
      g.bezierCurveTo(-2, 5, -6, 2, -10, 0);
      g.bezierCurveTo(-6, -2, -2, -5, 3.5, -4.6);
      g.fill();
      g.restore();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(3.8, 0, 2.4, 0, TAU);
      g.fill();
      break;
    }
    case 'petal':
      outlined(g, (c, s) => {
        c.beginPath();
        c.moveTo(7.5 * s, 0);
        c.quadraticCurveTo(0, 4.6 * s, -7.5 * s, 0);
        c.quadraticCurveTo(0, -4.6 * s, 7.5 * s, 0);
        c.closePath();
      }, hex, 0.45);
      break;
    case 'star':
      outlined(g, (c, s) => {
        c.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = (i % 2 ? 3.4 : 8) * s;
          c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        c.closePath();
      }, hex, 0.5);
      break;
    case 'flower': {
      g.save();
      g.shadowColor = rgba(hex, 0.8);
      g.shadowBlur = 8 * 0.3 * g.getTransform().a;
      for (let i = 0; i < 5; i++) {
        const a = (i * TAU) / 5 - Math.PI / 2;
        g.fillStyle = hex;
        g.beginPath();
        g.ellipse(Math.cos(a) * 5, Math.sin(a) * 5, 4.4, 3, a, 0, TAU);
        g.fill();
      }
      g.restore();
      g.strokeStyle = 'rgba(10,0,30,0.5)';
      g.lineWidth = 0.7;
      for (let i = 0; i < 5; i++) {
        const a = (i * TAU) / 5 - Math.PI / 2;
        g.beginPath();
        g.ellipse(Math.cos(a) * 5, Math.sin(a) * 5, 4.4, 3, a, 0, TAU);
        g.stroke();
        g.fillStyle = rgba('#ffffff', 0.85);
        g.beginPath();
        g.ellipse(Math.cos(a) * 5.4, Math.sin(a) * 5.4, 2, 1.2, a, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(0, 0, 3, 0, TAU);
      g.fill();
      g.fillStyle = light;
      g.beginPath();
      g.arc(0, 0, 1.4, 0, TAU);
      g.fill();
      break;
    }
    case 'moth': {
      g.save();
      g.shadowColor = rgba(hex, 0.8);
      g.shadowBlur = 8 * 0.3 * g.getTransform().a;
      g.fillStyle = hex;
      for (const sy of [-1, 1]) {
        g.beginPath();
        g.moveTo(2, 0);
        g.quadraticCurveTo(6, sy * 9, -2, sy * 8.5);
        g.quadraticCurveTo(-3, sy * 3, 0, 0);
        g.fill();
        g.beginPath();
        g.moveTo(-1, 0);
        g.quadraticCurveTo(-9, sy * 7, -8, sy * 2);
        g.closePath();
        g.fill();
      }
      g.restore();
      g.fillStyle = '#ffffff';
      for (const sy of [-1, 1]) {
        g.beginPath();
        g.ellipse(0.5, sy * 4.5, 1.8, 1.4, 0, 0, TAU);
        g.fill();
      }
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-6, 0);
      g.stroke();
      break;
    }
    case 'ring': {
      g.save();
      g.shadowColor = hex;
      g.shadowBlur = 8 * 0.3 * g.getTransform().a;
      g.strokeStyle = hex;
      g.lineWidth = 3.4;
      g.beginPath();
      g.arc(0, 0, 6, 0, TAU);
      g.stroke();
      g.restore();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(0, 0, 6, 0, TAU);
      g.stroke();
      break;
    }
    case 'shard':
      outlined(g, (c, s) => {
        c.beginPath();
        c.moveTo(8 * s, 0);
        c.lineTo(0, 3.2 * s);
        c.lineTo(-8 * s, 0);
        c.lineTo(0, -3.2 * s);
        c.closePath();
      }, hex, 0.45);
      break;
    case 'lantern': {
      const gr = g.createRadialGradient(0, 0, 4, 0, 0, 17);
      gr.addColorStop(0, rgba(hex, 0.6));
      gr.addColorStop(1, rgba(hex, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, 17, 0, TAU);
      g.fill();
      g.fillStyle = hex;
      g.beginPath();
      g.ellipse(0, 0, 10, 12, 0, 0, TAU);
      g.fill();
      const core = g.createRadialGradient(0, 1, 0, 0, 1, 9);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.5, rgba('#fff8d0', 0.9));
      core.addColorStop(1, rgba('#ffffff', 0));
      g.fillStyle = core;
      g.beginPath();
      g.ellipse(0, 1, 8, 10, 0, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(60,10,0,0.55)';
      g.lineWidth = 0.8;
      for (const yy of [-7, -3.5, 0, 3.5, 7]) {
        const hw = 10 * Math.sqrt(1 - (yy / 12) ** 2);
        g.beginPath();
        g.moveTo(-hw, yy);
        g.quadraticCurveTo(0, yy + 1.5, hw, yy);
        g.stroke();
      }
      g.fillStyle = '#2a1410';
      g.fillRect(-5, -14, 10, 3.2);
      g.fillRect(-5, 10.8, 10, 3.2);
      break;
    }
    default:
      roundBullet(g, def.w / 2.6, hex);
  }
}

// ---------------------------------------------------------------- items --
function drawItem(g, kind, sz) {
  const h = sz / 2;
  const box = (fill, edge, label, fs) => {
    g.fillStyle = edge;
    g.beginPath();
    g.roundRect(-h, -h, sz, sz, sz * 0.22);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(-h + 1.2, -h + 1.2, sz - 2.4, sz - 2.4, sz * 0.18);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `bold ${fs}px "Segoe UI", "Yu Gothic", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 0, 0.6);
  };
  switch (kind) {
    case 'power':
      box('#e8243c', '#ffd0d6', 'P', 9);
      break;
    case 'bigPower':
      box('#e8243c', '#ffe0e4', 'P', 14);
      break;
    case 'point':
      box('#2c58e8', '#d0dcff', '点', 9);
      break;
    case 'full':
      box('#d9a400', '#fff4c0', 'F', 14);
      break;
    case 'cancel': {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, h);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.5, '#ffe6f4');
      gr.addColorStop(1, 'rgba(255,170,220,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, -h);
      g.quadraticCurveTo(h, 0, 0, h);
      g.quadraticCurveTo(-h, 0, 0, -h);
      g.fill();
      break;
    }
    case 'life':
      flowerIcon(g, h, '#ff6fb4', '#ffe4f2');
      break;
    case 'bomb': {
      g.save();
      g.shadowColor = '#40ff90';
      g.shadowBlur = 6 * 0.3 * g.getTransform().a;
      g.fillStyle = '#2fcf6a';
      g.beginPath();
      g.moveTo(0, -h);
      g.quadraticCurveTo(h, -h * 0.2, 0, h);
      g.quadraticCurveTo(-h, -h * 0.2, 0, -h);
      g.fill();
      g.restore();
      g.strokeStyle = '#eafff0';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, -h * 0.75);
      g.lineTo(0, h * 0.8);
      g.stroke();
      break;
    }
    default:
      break;
  }
}

/** Five petal blossom (life icons, items). */
export function flowerIcon(g, r, hex, inner) {
  g.save();
  g.shadowColor = hex;
  g.shadowBlur = 5 * 0.3 * g.getTransform().a;
  g.fillStyle = hex;
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5 - Math.PI / 2;
    g.beginPath();
    g.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.48, r * 0.34, a, 0, TAU);
    g.fill();
  }
  g.restore();
  g.fillStyle = inner;
  g.beginPath();
  g.arc(0, 0, r * 0.28, 0, TAU);
  g.fill();
}
