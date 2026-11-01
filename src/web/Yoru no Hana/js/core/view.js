/**
 * The canvas and its coordinate system.
 *
 * Everything draws in a fixed 640 x 480 logical frame (the playfield is the
 * classic 384 x 448 box inside it). The canvas element is fitted to the
 * window at 4:3 and its backing store follows the device pixel ratio, so
 * `px` (device pixels per logical pixel) is what pre-rendered sprites are
 * drawn at to stay sharp. Listeners hear about `px` changes so caches can
 * rebuild.
 */
export const W = 640;
export const H = 480;
export const PF = { x: 32, y: 16, w: 384, h: 448 };

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.px = 1;
    this.renderScale = 1;
    this._listeners = [];
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onScale(fn) {
    this._listeners.push(fn);
  }

  setRenderScale(s) {
    this.renderScale = s;
    this.resize();
  }

  resize() {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const s = Math.min(vw / W, vh / H);
    const cssW = Math.max(160, Math.floor(W * s));
    const cssH = Math.max(120, Math.floor(H * s));
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    const bw = Math.max(W / 2, Math.round(cssW * dpr));
    const bh = Math.round((bw * H) / W);
    const old = this.px;
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.px = bw / W;
    if (Math.abs(old - this.px) > 0.01) for (const fn of this._listeners) fn(this.px);
  }

  /** Reset the context to the logical frame. */
  base() {
    this.ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
  }

  /** Reset the context to playfield-local coordinates. */
  field() {
    const p = this.px;
    this.ctx.setTransform(p, 0, 0, p, PF.x * p, PF.y * p);
  }

  toLogical(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * W,
      y: ((clientY - r.top) / r.height) * H,
    };
  }
}
