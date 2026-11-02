/**
 * Optional art, generated outside the game (prompts in README.md), each
 * optional:
 *   assets/title.png       an opaque painting shown behind every menu
 *   assets/logo.png        the 夜の花 logo, ideally on transparency
 *   assets/roll.png        an opaque dawn painting behind the credits roll
 *   assets/ending<n>.png   an opaque painting behind the pages of ending n (1-4)
 * Missing files simply leave the drawn backdrop, the text logo and (for the
 * credits and endings) the title painting in place.
 */
import { loadImage, trimToContent } from './charart.js';

export class TitleArt {
  constructor() {
    this.bg = null;
    this.logo = null;
    this.credits = null;
    this.endings = {};
  }

  async load(base = 'assets/') {
    const stamp = '?v=' + Date.now();
    const [bg, logo, credits, ...endings] = await Promise.all([
      loadImage(base + 'title.png' + stamp).catch(() => null),
      loadImage(base + 'logo.png' + stamp).catch(() => null),
      loadImage(base + 'roll.png' + stamp).catch(() => null),
      ...[1, 2, 3, 4].map((n) => loadImage(base + `ending${n}.png` + stamp).catch(() => null)),
    ]);
    this.bg = bg;
    this.credits = credits;
    endings.forEach((img, i) => {
      if (img) this.endings[i + 1] = img;
    });
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
