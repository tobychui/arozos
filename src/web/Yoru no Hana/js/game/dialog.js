/**
 * In-stage dialogue: portraits on both sides of the playfield (the heroine
 * on the left, everyone else on the right) and a text box that types the
 * line out. Shoot / Enter advances, holding Ctrl skips.
 *
 * Line fields: who, text, and optional flags - music (start the boss theme
 * on this line), title (show the boss's name card).
 */
import { PF } from '../core/view.js';
import { CAST } from '../data/characters.js';
import { rgba, FONT_DISPLAY, FONT_SERIF } from '../core/util.js';
import { typeRate } from '../core/i18n.js';
import { wrapSpans } from '../ui/widgets.js';

export class Dialog {
  constructor(G, lines) {
    this.G = G;
    this.lines = lines;
    this.i = -1;
    this.t = 0;
    this.done = false;
    this.left = G.charId;
    this.right = null;
    this.fadeL = 0;
    this.fadeR = 0;
    this.next();
  }

  get line() {
    return this.lines[this.i];
  }

  next() {
    this.i++;
    this.t = 0;
    if (this.i >= this.lines.length) {
      this.done = true;
      return;
    }
    const l = this.line;
    if (l.who !== this.left) this.right = l.who;
    if (l.music && this.G.boss) {
      this.G.music(this.G.boss.def.music);
      this.G.bossMusicOn = true;
    }
    if (l.title && this.G.boss) this.G.bossTitle = { char: this.G.boss.def.char, t: 0 };
  }

  update(input) {
    if (this.done) return;
    this.t++;
    this.fadeL = Math.min(1, this.fadeL + 0.08);
    if (this.right) this.fadeR = Math.min(1, this.fadeR + 0.08);
    const full = this.t * typeRate(1.4) >= this.line.text.length;
    if (input.held('skip')) {
      if (this.t % 4 === 0) this.next();
      return;
    }
    if (input.pressed('shoot') || input.pressed('confirm') || input.mouse.clicked) {
      if (!full) this.t = 9999;
      else {
        this.G.sfx('talk');
        this.next();
      }
    }
  }

  render(ctx, px) {
    if (this.done) return;
    const G = this.G;
    const l = this.line;
    const speakerLeft = l.who === this.left;
    const ph = 236;
    // portraits
    const drawP = (id, side, active, fade) => {
      if (!id || fade <= 0) return;
      const spr = G.charArt.portrait(id, ph);
      const slide = (1 - fade) * 40;
      const x = side === 'L' ? PF.x - 10 + spr.w / 2 - slide : PF.x + PF.w + 10 - spr.w / 2 + slide;
      const y = PF.y + PF.h - spr.h / 2 - 40 + (active ? 0 : 8);
      ctx.setTransform(px, 0, 0, px, x * px, y * px);
      // the listener is darkened, not faded, so the stage never shows through
      ctx.globalAlpha = fade;
      if (!active) ctx.filter = 'brightness(0.5) saturate(0.8)';
      ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
    };
    if (speakerLeft) {
      drawP(this.right, 'R', false, this.fadeR);
      drawP(this.left, 'L', true, this.fadeL);
    } else {
      drawP(this.left, 'L', false, this.fadeL);
      drawP(this.right, 'R', true, this.fadeR);
    }

    // text box
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const bx = PF.x + 12;
    const by = PF.y + PF.h - 92;
    const bw = PF.w - 24;
    const bh = 80;
    const c = CAST[l.who] || CAST[this.left];
    ctx.fillStyle = 'rgba(8,4,24,0.82)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fill();
    ctx.strokeStyle = rgba(c.color, 0.9);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // name tab
    ctx.font = `bold 11px ${FONT_DISPLAY}`;
    const name = c.name;
    const nw = Math.min(bw - 20, ctx.measureText(name).width + 18);
    const nx = speakerLeft ? bx + 10 : bx + bw - nw - 10;
    ctx.fillStyle = rgba(c.color, 0.95);
    ctx.beginPath();
    ctx.roundRect(nx, by - 9, nw, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, nx + nw / 2, by, nw - 10);
    // text
    const shown = Math.floor(this.t * typeRate(1.4));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `13.5px ${FONT_SERIF}`;
    ctx.fillStyle = '#f4f0ff';
    let y = by + 16;
    for (const [a, e] of wrapSpans(ctx, l.text, bw - 28)) {
      if (shown > a) ctx.fillText(l.text.slice(a, Math.min(e, shown)), bx + 14, y);
      y += 18;
    }
    if (shown >= l.text.length && Math.floor(this.t / 20) % 2 === 0) {
      ctx.fillStyle = rgba(c.color, 1);
      ctx.beginPath();
      ctx.moveTo(bx + bw - 18, by + bh - 14);
      ctx.lineTo(bx + bw - 10, by + bh - 14);
      ctx.lineTo(bx + bw - 14, by + bh - 9);
      ctx.fill();
    }
  }
}
