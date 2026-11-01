/**
 * Optional title screen art, both generated outside the game (prompts in
 * README.md) and both optional:
 *   assets/title.png       an opaque painting shown behind every menu
 *   assets/logo.png        the 夜の花 logo, ideally on transparency
 * Missing files simply leave the drawn backdrop and the text logo in place.
 */
import { loadImage, trimToContent } from './charart.js';

export class TitleArt {
  constructor() {
    this.bg = null;
    this.logo = null;
  }

  async load(base = 'assets/') {
    const stamp = '?v=' + Date.now();
    const [bg, logo] = await Promise.all([
      loadImage(base + 'title.png' + stamp).catch(() => null),
      loadImage(base + 'logo.png' + stamp).catch(() => null),
    ]);
    this.bg = bg;
    if (logo) {
      try {
        this.logo = trimToContent(logo);
      } catch (err) {
        console.warn('[Yoru no Hana] title logo could not be read', err);
      }
    }
  }

  /** Draw the logo fitted inside a w x h box centred on (cx, cy). */
  drawLogo(ctx, cx, cy, w, h, alpha = 1) {
    const l = this.logo;
    if (!l) return false;
    const s = Math.min(w / l.width, h / l.height);
    const dw = l.width * s;
    const dh = l.height * s;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(l, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    return true;
  }
}
