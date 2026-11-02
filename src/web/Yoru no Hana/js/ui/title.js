/**
 * Title screen: the night flower opening under a huge moon while festival
 * lanterns drift up past it. The same backdrop sits behind every menu.
 * With assets/title.png the painting replaces the drawn scene (with a slow
 * drift) and only the lanterns and petals are drawn over it; with
 * assets/logo.png the logo image replaces the text logo.
 */
import { W, H } from '../core/view.js';
import { TAU, rgba, FONT_DISPLAY } from '../core/util.js';
import { Menu, text } from './widgets.js';
import { t } from '../core/i18n.js';

export class Backdrop {
  constructor(art = null) {
    this.art = art;
    this.t = 0;
    this.lanterns = [];
    this.petals = [];
    this.stars = [];
    for (let i = 0; i < 120; i++) this.stars.push({ x: Math.random() * W, y: Math.random() * H * 0.7, s: Math.random() * 1.4 + 0.3, p: Math.random() * TAU });
  }

  update() {
    this.t++;
    if (this.t % 28 === 0) this.lanterns.push({ x: Math.random() * W, y: H + 20, s: 0.5 + Math.random() * 0.8, vx: (Math.random() - 0.5) * 0.2, sw: Math.random() * TAU });
    if (this.t % 9 === 0) this.petals.push({ x: Math.random() * W * 1.3, y: -10, vx: -0.4 - Math.random() * 0.5, vy: 0.5 + Math.random() * 0.6, r: Math.random() * TAU, s: 2 + Math.random() * 3 });
    for (const l of this.lanterns) {
      l.y -= 0.35 * l.s + 0.15;
      l.x += l.vx + Math.sin(this.t * 0.01 + l.sw) * 0.1;
    }
    for (const p of this.petals) {
      p.x += p.vx;
      p.y += p.vy;
      p.r += 0.02;
    }
    this.lanterns = this.lanterns.filter((l) => l.y > -30);
    this.petals = this.petals.filter((p) => p.y < H + 10 && p.x > -20);
  }

  /** `painting` replaces the title painting (the credits roll passes its own). */
  render(ctx, px, dim = 0, painting = null) {
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const img = painting || (this.art && this.art.bg);
    if (img) this.drawPainting(ctx, img);
    else this.drawScene(ctx);
    this.drawDrifters(ctx);
    if (dim) {
      ctx.fillStyle = `rgba(4,2,16,${dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** The painting, covering the frame, drifting slowly so it feels alive. */
  drawPainting(ctx, img) {
    const cover = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const s = cover * (1.05 + Math.sin(this.t * 0.0012) * 0.02);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    const x = (W - dw) / 2 + Math.sin(this.t * 0.0007) * (dw - W) * 0.3;
    const y = (H - dh) / 2 + Math.cos(this.t * 0.0009) * (dh - H) * 0.3;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, dw, dh);
  }

  drawScene(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#04031a');
    sky.addColorStop(0.55, '#1a1040');
    sky.addColorStop(1, '#3a1a48');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const s of this.stars) {
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(this.t * 0.02 + s.p));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // moon
    const mx = 200;
    const my = 170;
    const glow = ctx.createRadialGradient(mx, my, 60, mx, my, 240);
    glow.addColorStop(0, 'rgba(255,248,225,0.35)');
    glow.addColorStop(1, 'rgba(255,248,225,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fbf6e2';
    ctx.beginPath();
    ctx.arc(mx, my, 92, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(205,195,170,0.3)';
    for (const [dx, dy, r] of [[-30, -20, 20], [25, 12, 15], [-6, 34, 11], [34, -34, 9], [-40, 20, 8]]) {
      ctx.beginPath();
      ctx.arc(mx + dx, my + dy, r, 0, TAU);
      ctx.fill();
    }
    // mountain silhouette
    ctx.fillStyle = '#0e0820';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, 380);
    ctx.quadraticCurveTo(120, 330, 200, 300);
    ctx.quadraticCurveTo(260, 280, 330, 330);
    ctx.quadraticCurveTo(470, 400, W, 360);
    ctx.lineTo(W, H);
    ctx.fill();
    // the night flower, opening and closing slowly
    const open = 0.75 + Math.sin(this.t * 0.006) * 0.25;
    ctx.save();
    ctx.translate(200, 318);
    const fg = ctx.createRadialGradient(0, 0, 10, 0, 0, 150);
    fg.addColorStop(0, 'rgba(255,255,255,0.4)');
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(-150, -150, 300, 300);
    ctx.fillStyle = 'rgba(255,150,190,0.65)';
    for (let i = 0; i < 10; i++) {
      const a = (i - 4.5) * 0.3 * open;
      ctx.save();
      ctx.rotate(a + Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, -34, 4, 34, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    for (let layer = 0; layer < 3; layer++) {
      const n = 14 - layer * 3;
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * (0.22 + layer * 0.03) * open * 1.4;
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = layer === 2 ? '#ffffff' : layer === 1 ? '#f4f8ff' : '#e6eef8';
        ctx.beginPath();
        ctx.ellipse(0, -(70 - layer * 16) * open, 9 - layer, (60 - layer * 14) * open + 6, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.fillStyle = '#f6f2b8';
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.12;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 26 * open, Math.sin(a) * 26 * open, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDrifters(ctx) {
    for (const l of this.lanterns) {
      const s = 6 * l.s;
      const g = ctx.createRadialGradient(l.x, l.y, 1, l.x, l.y, s * 3);
      g.addColorStop(0, 'rgba(255,190,110,0.6)');
      g.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(l.x - s * 3, l.y - s * 3, s * 6, s * 6);
      ctx.fillStyle = '#ffdca0';
      ctx.fillRect(l.x - s * 0.6, l.y - s * 0.8, s * 1.2, s * 1.5);
    }
    for (const p of this.petals) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = 'rgba(250,246,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.4, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** The title logo; returns the y where the menu may start. */
export function drawLogo(ctx, x, y, time, art = null) {
  ctx.save();
  ctx.translate(x, y);
  let sub = 50;
  if (art && art.drawLogo(ctx, 0, -18, 300, 128)) {
    sub = 60;
  } else {
    text(ctx, '夜の花', 0, 0, { size: 64, serif: true, bold: true, align: 'center', glow: '#c090ff', glowSize: 18, shadow: false });
    ctx.globalAlpha = 0.85;
    ctx.font = `17px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0e6ff';
    ctx.fillText('Y o r u   n o   H a n a', 0, 30, 300);
  }
  ctx.globalAlpha = 0.6 + Math.sin(time * 0.03) * 0.15;
  ctx.font = `12px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd8a8';
  ctx.fillText(t('The Night That Would Not End'), 0, sub, 300);
  ctx.restore();
  return y + sub + 30;
}

export class TitleScene {
  constructor(app, start = 0) {
    this.app = app;
    this.t = 0;
    this.pressed = !!app.audio.ctx;
    const go = (name, o) => () => app.open(name, o);
    const items = [
      { label: () => t('Start'), action: go('select', { mode: 'story' }) },
      { label: () => t('Practice Start'), action: go('select', { mode: 'practice' }) },
      { label: () => t('Card Practice'), action: go('select', { mode: 'card' }) },
      { label: () => t('Scores'), action: go('scores') },
      { label: () => t('Music Room'), action: go('music') },
      { label: () => t('Characters'), action: go('gallery') },
      { label: () => t('Settings'), action: go('settings') },
      { label: () => t('How to Play'), action: go('howto') },
    ];
    if (app.inDesktop) items.push({ label: () => t('Quit'), action: () => app.quit() });
    this.menu = new Menu(items, { start });
  }

  enter() {
    this.app.playMusic('title');
  }

  update() {
    const app = this.app;
    this.t++;
    app.backdrop.update();
    if (!this.pressed) {
      if (app.input.pressed('confirm') || app.input.mouse.clicked || app.input.pressed('shoot')) {
        this.pressed = true;
        app.sfx.play('ok');
        app.input.consume();
      }
      return;
    }
    const r = this.menu.update(app);
    if (r && r !== 'cancel' && r.action) r.action();
  }

  render(ctx, px) {
    const app = this.app;
    app.backdrop.render(ctx, px, 0);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    // same spacing drawLogo reports: the subtitle sits lower under the logo image
    const menuY = Math.max(176, 96 + (app.titleArt.logo ? 60 : 50) + 30);
    if (app.titleArt.bg && this.pressed) {
      // a soft dark halo behind the menu column keeps it readable over a busy painting
      ctx.save();
      ctx.translate(500, menuY + 120);
      ctx.scale(1, 1.3);
      const halo = ctx.createRadialGradient(0, 0, 30, 0, 0, 190);
      halo.addColorStop(0, `rgba(6,3,20,${0.62 * Math.min(1, this.t / 30)})`);
      halo.addColorStop(1, 'rgba(6,3,20,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-200, -200, 400, 400);
      ctx.restore();
    }
    drawLogo(ctx, 470, 96, this.t, app.titleArt);
    if (!this.pressed) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 0.08);
      text(ctx, t(app.input.usedTouch ? 'Tap to begin' : 'Press Z or Enter'), 470, 330, { size: 16, display: true, align: 'center', color: '#ffe8c0', maxWidth: 300 });
      ctx.globalAlpha = 1;
    } else {
      const mt = Math.min(1, this.t / 30);
      ctx.globalAlpha = mt;
      this.menu.render(ctx, 400, menuY, { gap: Math.min(27, (H - 24 - menuY) / this.menu.items.length), size: 17, width: 200 });
      ctx.globalAlpha = 1;
    }
    text(ctx, 'v1.2', W - 8, H - 8, { size: 10, align: 'right', color: '#6a5a90' });
  }
}
