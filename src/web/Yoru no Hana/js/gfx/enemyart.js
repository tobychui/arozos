/**
 * Procedural art for the small enemies: hitodama wisps, paper lantern
 * ghosts, origami cranes, moths, flower spirits, hanging spiders, star
 * spirits, kokeshi dolls, paper hitogata, koi and the big lantern ghost.
 * Each kind has a few animation frames, drawn facing the player (down).
 */
import { TAU, rgba, mix } from '../core/util.js';
import { COLORS } from './art.js';

export const ENEMY_KINDS = {
  wisp: { w: 26, h: 30, r: 10, frames: 4, hp: 12 },
  lantern: { w: 30, h: 38, r: 12, frames: 2, hp: 40 },
  crane: { w: 32, h: 26, r: 11, frames: 4, hp: 16 },
  moth: { w: 26, h: 22, r: 9, frames: 4, hp: 10 },
  petal: { w: 28, h: 28, r: 11, frames: 2, hp: 24 },
  spider: { w: 24, h: 24, r: 9, frames: 2, hp: 18 },
  star: { w: 26, h: 26, r: 10, frames: 1, hp: 20 },
  kokeshi: { w: 24, h: 36, r: 11, frames: 1, hp: 60 },
  doll: { w: 26, h: 32, r: 11, frames: 2, hp: 30 },
  koi: { w: 36, h: 22, r: 11, frames: 4, hp: 26, orient: true },
  bigLantern: { w: 52, h: 64, r: 22, frames: 2, hp: 400 },
};

export function drawEnemy(art, kind, color, frame) {
  const k = ENEMY_KINDS[kind];
  const hex = COLORS[color] || color || '#ff6060';
  return art.sprite('e:' + kind + ':' + hex + ':' + frame, k.w, k.h, (g) => DRAW[kind](g, hex, frame, k));
}

function face(g, x, y, s = 1, color = '#2a1020') {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x - 3 * s, y, 1.3 * s, 1.8 * s, 0, 0, TAU);
  g.ellipse(x + 3 * s, y, 1.3 * s, 1.8 * s, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x - 3.3 * s, y - 0.7 * s, 0.5 * s, 0, TAU);
  g.arc(x + 2.7 * s, y - 0.7 * s, 0.5 * s, 0, TAU);
  g.fill();
}

function blur(g, n) {
  g.shadowBlur = n * 0.3 * g.getTransform().a;
}

const DRAW = {
  wisp(g, hex, f) {
    const light = mix(hex, '#ffffff', 0.55);
    const sway = [-2, 0, 2, 0][f];
    g.save();
    g.shadowColor = hex;
    blur(g, 14);
    const gr = g.createLinearGradient(0, -14, 0, 10);
    gr.addColorStop(0, rgba(hex, 0));
    gr.addColorStop(0.5, rgba(hex, 0.85));
    gr.addColorStop(1, hex);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(sway * 1.5, -14);
    g.bezierCurveTo(8 + sway, -6, 10, 2, 7, 7);
    g.arc(0, 4, 8, 0.4, Math.PI - 0.4);
    g.bezierCurveTo(-10, 2, -8 + sway, -6, sway * 1.5, -14);
    g.fill();
    g.restore();
    const core = g.createRadialGradient(0, 4, 0, 0, 4, 7);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.6, light);
    core.addColorStop(1, rgba(light, 0));
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 4, 7, 0, TAU);
    g.fill();
    face(g, 0, 5, 0.9);
  },

  lantern(g, hex, f) {
    g.save();
    g.shadowColor = '#ffb050';
    blur(g, 12);
    g.fillStyle = hex;
    g.beginPath();
    g.ellipse(0, 1, 12, 15, 0, 0, TAU);
    g.fill();
    g.restore();
    const inner = g.createRadialGradient(0, 2, 0, 0, 2, 12);
    inner.addColorStop(0, rgba('#fff6d0', 0.95));
    inner.addColorStop(1, rgba('#fff6d0', 0));
    g.fillStyle = inner;
    g.beginPath();
    g.ellipse(0, 1, 10, 13, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(70,20,0,0.5)';
    g.lineWidth = 0.9;
    for (const yy of [-9, -4.5, 0, 4.5, 9]) {
      const hw = 12 * Math.sqrt(1 - (yy / 15) ** 2);
      g.beginPath();
      g.moveTo(-hw, yy + 1);
      g.quadraticCurveTo(0, yy + 3, hw, yy + 1);
      g.stroke();
    }
    g.fillStyle = '#231010';
    g.fillRect(-6.5, -17, 13, 4);
    g.fillRect(-6.5, 14, 13, 4);
    // one big eye and a tongue
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(0, -3, 4.6, 3.6, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#1a0a10';
    g.beginPath();
    g.arc(0, -2.5, 2.2, 0, TAU);
    g.fill();
    g.fillStyle = '#2a0810';
    g.beginPath();
    g.ellipse(0, 6, 5, 2.6, 0, 0, Math.PI);
    g.fill();
    if (f === 1) {
      g.fillStyle = '#ff5a7a';
      g.beginPath();
      g.ellipse(1.5, 9.5, 2.4, 3.6, 0.2, 0, TAU);
      g.fill();
    }
  },

  crane(g, hex, f) {
    const lift = [0.2, 0.7, 1, 0.55][f];
    const paper = mix(hex, '#ffffff', 0.7);
    g.save();
    g.shadowColor = hex;
    blur(g, 8);
    for (const sx of [-1, 1]) {
      g.fillStyle = sx < 0 ? paper : mix(paper, hex, 0.25);
      g.beginPath();
      g.moveTo(0, -2);
      g.lineTo(sx * 15, -10 * lift + 2);
      g.lineTo(sx * 7, 4);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.fillStyle = mix(paper, hex, 0.45);
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(3.5, 2);
    g.lineTo(0, 11);
    g.lineTo(-3.5, 2);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(hex, 0.9);
    g.lineWidth = 0.8;
    g.stroke();
    g.fillStyle = hex;
    g.beginPath();
    g.moveTo(0, 11);
    g.lineTo(2.2, 7);
    g.lineTo(-2.2, 7);
    g.closePath();
    g.fill();
  },

  moth(g, hex, f) {
    const open = [1, 0.75, 0.45, 0.75][f];
    const dark = mix(hex, '#3a2010', 0.45);
    g.save();
    g.shadowColor = hex;
    blur(g, 8);
    for (const sx of [-1, 1]) {
      g.fillStyle = hex;
      g.beginPath();
      g.moveTo(0, -2);
      g.quadraticCurveTo(sx * 13 * open, -12, sx * 12 * open, 0);
      g.quadraticCurveTo(sx * 6 * open, 2, 0, 1);
      g.fill();
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(0, 1);
      g.quadraticCurveTo(sx * 10 * open, 3, sx * 7 * open, 9);
      g.quadraticCurveTo(sx * 2, 6, 0, 3);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(sx * 6.5 * open, -4, 2, 0, TAU);
      g.fill();
      g.fillStyle = '#2a1408';
      g.beginPath();
      g.arc(sx * 6.5 * open, -4, 1, 0, TAU);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#fff2d8';
    g.beginPath();
    g.ellipse(0, 1, 2.2, 6.5, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#fff2d8';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-1, -5);
    g.quadraticCurveTo(-4, -9, -5, -10);
    g.moveTo(1, -5);
    g.quadraticCurveTo(4, -9, 5, -10);
    g.stroke();
  },

  petal(g, hex, f) {
    const light = mix(hex, '#ffffff', 0.6);
    const spin = f * 0.3;
    g.save();
    g.shadowColor = hex;
    blur(g, 10);
    for (let i = 0; i < 5; i++) {
      const a = (i * TAU) / 5 - Math.PI / 2 + spin;
      g.fillStyle = i % 2 ? hex : mix(hex, '#ffffff', 0.25);
      g.beginPath();
      g.ellipse(Math.cos(a) * 7.5, Math.sin(a) * 7.5, 7, 4.6, a, 0, TAU);
      g.fill();
    }
    g.restore();
    g.fillStyle = light;
    g.beginPath();
    g.arc(0, 0, 6.5, 0, TAU);
    g.fill();
    g.fillStyle = '#fff8e0';
    g.beginPath();
    g.arc(0, 0, 5, 0, TAU);
    g.fill();
    face(g, 0, 0.5, 0.8);
  },

  spider(g, hex, f) {
    const dark = mix(hex, '#100818', 0.6);
    g.strokeStyle = dark;
    g.lineWidth = 1.4;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const y = -4 + i * 2.8;
        const k = f ? (i % 2 ? 1.5 : -1.5) : 0;
        g.beginPath();
        g.moveTo(sx * 3, y * 0.5);
        g.quadraticCurveTo(sx * 9, y - 4 + k, sx * 11, y + 4 + k);
        g.stroke();
      }
    }
    g.save();
    g.shadowColor = hex;
    blur(g, 8);
    g.fillStyle = dark;
    g.beginPath();
    g.ellipse(0, 3, 6, 7, 0, 0, TAU);
    g.fill();
    g.restore();
    g.fillStyle = hex;
    g.beginPath();
    g.ellipse(0, 4, 3.6, 4.4, 0, 0, TAU);
    g.fill();
    g.fillStyle = mix(hex, '#100818', 0.3);
    g.beginPath();
    g.arc(0, -4, 3.6, 0, TAU);
    g.fill();
    g.fillStyle = '#ff4060';
    for (const [x, y] of [[-1.5, -4.5], [1.5, -4.5], [-2.6, -3], [2.6, -3]]) {
      g.beginPath();
      g.arc(x, y, 0.8, 0, TAU);
      g.fill();
    }
  },

  star(g, hex) {
    g.save();
    g.shadowColor = hex;
    blur(g, 14);
    g.fillStyle = hex;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 5.2 : 12;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = mix(hex, '#ffffff', 0.7);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 3.4 : 7.5;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    face(g, 0, 1, 0.75);
  },

  kokeshi(g, hex) {
    g.save();
    g.shadowColor = hex;
    blur(g, 8);
    g.fillStyle = hex;
    g.beginPath();
    g.roundRect(-7, -2, 14, 19, 5);
    g.fill();
    g.restore();
    g.fillStyle = '#fff3dc';
    g.beginPath();
    g.roundRect(-5, 0, 10, 15, 4);
    g.fill();
    g.fillStyle = hex;
    for (const [x, y] of [[0, 4], [-2, 9], [2.5, 11]]) {
      g.beginPath();
      g.arc(x, y, 1.8, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#fff3dc';
    g.beginPath();
    g.arc(0, -9, 8, 0, TAU);
    g.fill();
    g.fillStyle = '#1a1018';
    g.beginPath();
    g.arc(0, -10, 8.2, Math.PI * 1.02, Math.PI * 1.98);
    g.fill();
    g.fillRect(-8, -11, 3, 4);
    g.fillRect(5, -11, 3, 4);
    g.fillStyle = '#ff5a6a';
    g.fillRect(-2.5, -18, 5, 3);
    g.fillStyle = '#1a1018';
    g.fillRect(-4.2, -7.5, 2.4, 0.9);
    g.fillRect(1.8, -7.5, 2.4, 0.9);
    g.fillStyle = '#e83050';
    g.beginPath();
    g.arc(0, -4.5, 0.9, 0, TAU);
    g.fill();
  },

  doll(g, hex, f) {
    const paper = '#f6f1e4';
    g.save();
    g.shadowColor = hex;
    blur(g, 10);
    g.fillStyle = paper;
    g.beginPath();
    g.arc(0, -10, 5, 0, TAU);
    g.moveTo(-3, -5);
    g.lineTo(-12, f ? -3 : 1);
    g.lineTo(-10, 4);
    g.lineTo(-4, 1);
    g.lineTo(-6, 14);
    g.lineTo(-1, 14);
    g.lineTo(0, 6);
    g.lineTo(1, 14);
    g.lineTo(6, 14);
    g.lineTo(4, 1);
    g.lineTo(10, 4);
    g.lineTo(12, f ? -3 : 1);
    g.lineTo(3, -5);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = hex;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, -3);
    g.lineTo(0, 5);
    g.moveTo(-3, 0);
    g.lineTo(3, 0);
    g.stroke();
    g.fillStyle = hex;
    g.font = 'bold 5px serif';
    g.textAlign = 'center';
    g.fillText('星', 0, -8.5);
  },

  koi(g, hex, f) {
    // drawn pointing right; rotated by its velocity at runtime
    const sw = [-3, -1, 3, 1][f];
    g.save();
    g.shadowColor = hex;
    blur(g, 8);
    g.fillStyle = '#fff4ee';
    g.beginPath();
    g.moveTo(14, 0);
    g.bezierCurveTo(10, -7, -4, -7, -10, sw * 0.4);
    g.bezierCurveTo(-4, 7, 10, 7, 14, 0);
    g.fill();
    g.restore();
    g.fillStyle = hex;
    g.beginPath();
    g.ellipse(6, -1.5, 5, 3, 0.2, 0, TAU);
    g.ellipse(-2, 1.5, 4, 2.6, -0.2, 0, TAU);
    g.fill();
    g.fillStyle = rgba(hex, 0.85);
    g.beginPath();
    g.moveTo(-9, sw * 0.4);
    g.lineTo(-17, -6 + sw);
    g.lineTo(-15, sw * 0.5);
    g.lineTo(-17, 6 + sw);
    g.closePath();
    g.fill();
    g.fillStyle = '#1a1020';
    g.beginPath();
    g.arc(10.5, -2, 1, 0, TAU);
    g.fill();
  },

  bigLantern(g, hex, f) {
    g.save();
    g.scale(1.75, 1.7);
    DRAW.lantern(g, hex, f);
    g.restore();
  },
};
