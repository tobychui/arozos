/**
 * Menu building blocks drawn on the canvas: a vertical list driven by the
 * keyboard, gamepad, mouse or touch, plus text helpers.
 */
import { FONT_DISPLAY, FONT_SERIF, FONT_UI, rgba } from '../core/util.js';

/** o.display: Cinzel (headings, menus); o.serif: Shippori Mincho (prose); else UI sans. */
export function setFont(ctx, o) {
  const family = o.display ? FONT_DISPLAY : o.serif ? FONT_SERIF : FONT_UI;
  ctx.font = `${o.bold ? 'bold ' : ''}${o.italic ? 'italic ' : ''}${o.size || 14}px ${family}`;
}

/**
 * Draw one line of text. With o.maxWidth the size shrinks (to 60% at most)
 * until the line fits, and the canvas squeezes whatever is still left over,
 * so a long name or a wide font never spills out of its box.
 */
export function text(ctx, str, x, y, o = {}) {
  str = String(str);
  setFont(ctx, o);
  if (o.maxWidth) {
    const w = ctx.measureText(str).width;
    if (w > o.maxWidth) {
      const size = o.size || 14;
      setFont(ctx, { ...o, size: Math.max(size * 0.6, Math.floor(((size * o.maxWidth) / w) * 10) / 10) });
    }
  }
  const mw = o.maxWidth || undefined;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'alphabetic';
  if (o.shadow !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(str, x + 1, y + 1, mw);
  }
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = (o.glowSize || 10) * ctx.getTransform().a;
  }
  ctx.fillStyle = o.color || '#ffffff';
  ctx.fillText(str, x, y, mw);
  ctx.shadowBlur = 0;
}

/** Wrap `str` to `width` in the font described by `o` (see setFont). */
export function wrapText(ctx, str, width, o) {
  setFont(ctx, o);
  return wrapLines(ctx, str, width);
}

/**
 * Draw a paragraph wrapped to `width`, at most `maxLines` lines (the size
 * shrinks until it fits). Returns the y below the last line.
 */
export function paragraph(ctx, str, x, y, width, o = {}) {
  let size = o.size || 12;
  const maxLines = o.maxLines || 99;
  let lines = wrapText(ctx, str, width, { ...o, size });
  while (lines.length > maxLines && size > (o.size || 12) * 0.7) {
    size -= 0.5;
    lines = wrapText(ctx, str, width, { ...o, size });
  }
  const lh = o.lineHeight || Math.round(size * 1.4);
  for (const ln of lines) {
    text(ctx, ln, x, y, { ...o, size, maxWidth: width });
    y += lh;
  }
  return y;
}

/** Wrap text to a width (in the context's current font), returning lines. */
export function wrapLines(ctx, str, width) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > width && cur) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    out.push(cur);
  }
  return out;
}

export function panel(ctx, x, y, w, h, color = '#b090ff', alpha = 0.8) {
  ctx.fillStyle = `rgba(10,6,26,${alpha})`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * items: [{label, sub?, disabled?, value?() , left?(), right?(), action?}]
 * update() returns the chosen item, 'cancel', or null.
 */
export class Menu {
  constructor(items, o = {}) {
    this.items = items;
    this.i = o.start || 0;
    this.rects = [];
    this.wrap = o.wrap !== false;
    this.t = 0;
    this.skipDisabled();
  }

  skipDisabled(dir = 1) {
    const n = this.items.length;
    for (let k = 0; k < n && this.items[this.i] && this.items[this.i].disabled; k++) this.i = (this.i + dir + n) % n;
  }

  move(dir, app) {
    const n = this.items.length;
    let j = this.i;
    for (let k = 0; k < n; k++) {
      j += dir;
      if (j < 0) j = this.wrap ? n - 1 : 0;
      if (j >= n) j = this.wrap ? 0 : n - 1;
      if (!this.items[j].disabled) break;
    }
    if (j !== this.i) {
      this.i = j;
      app.sfx.play('select');
    }
  }

  update(app) {
    const inp = app.input;
    this.t++;
    if (inp.repeat('up')) this.move(-1, app);
    if (inp.repeat('down')) this.move(1, app);
    const it = this.items[this.i];
    if (it && it.left && inp.repeat('left')) {
      it.left();
      app.sfx.play('select');
    }
    if (it && it.right && inp.repeat('right')) {
      it.right();
      app.sfx.play('select');
    }
    if (inp.mouse.moved || inp.mouse.clicked) {
      const m = inp.mouse;
      for (let k = 0; k < this.rects.length; k++) {
        const r = this.rects[k];
        if (r && m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h && !this.items[k].disabled) {
          if (k !== this.i) {
            this.i = k;
            if (!m.clicked) app.sfx.play('select');
          }
          if (m.clicked) {
            if (this.items[k].right && !this.items[k].action) {
              const mid = r.x + r.w * 0.62;
              if (m.x > mid) this.items[k].right();
              else this.items[k].left();
              app.sfx.play('select');
              return null;
            }
            app.sfx.play('ok');
            inp.consume();
            return this.items[k];
          }
        }
      }
    }
    if (inp.mouse.wheel) this.move(inp.mouse.wheel > 0 ? 1 : -1, app);
    if (inp.pressed('confirm') && it && !it.disabled && (it.action || !it.right)) {
      app.sfx.play('ok');
      inp.consume();
      return it;
    }
    if (inp.pressed('cancel') || inp.mouse.rightClicked) {
      app.sfx.play('back');
      inp.consume();
      return 'cancel';
    }
    return null;
  }

  /** Draw at x, y (item spacing `gap`); align 'left' or 'center'. */
  render(ctx, x, y, o = {}) {
    const gap = o.gap || 26;
    const size = o.size || 16;
    const width = o.width || 220;
    const align = o.align || 'left';
    this.rects = [];
    this.items.forEach((it, k) => {
      const sel = k === this.i;
      const yy = y + k * gap;
      const rx = align === 'center' ? x - width / 2 : x - 14;
      this.rects[k] = { x: rx, y: yy - size, w: width + 28, h: gap - 2 };
      if (sel) {
        const gr = ctx.createLinearGradient(rx, 0, rx + width + 28, 0);
        gr.addColorStop(0, rgba(o.color || '#c0a0ff', 0));
        gr.addColorStop(0.5, rgba(o.color || '#c0a0ff', 0.32));
        gr.addColorStop(1, rgba(o.color || '#c0a0ff', 0));
        ctx.fillStyle = gr;
        ctx.fillRect(rx, yy - size + 1, width + 28, gap - 4);
      }
      const color = it.disabled ? '#5a5070' : sel ? '#ffffff' : '#bdb0e0';
      const wob = sel ? Math.sin(this.t * 0.15) * 1.5 : 0;
      let room = width - 4;
      if (it.value) {
        const v = String(it.value());
        const vo = { size: size - 2, display: true, color: sel ? '#ffe2a0' : '#a898d0', align: 'right', maxWidth: width * 0.4 };
        setFont(ctx, vo);
        room = width - Math.min(ctx.measureText(v).width, vo.maxWidth) - 14;
        text(ctx, v, x + width, yy, vo);
      }
      text(ctx, it.label, align === 'center' ? x : x + wob, yy, { size, display: true, bold: sel, color, align, maxWidth: room, glow: sel ? o.color || '#c0a0ff' : null });
    });
  }
}
