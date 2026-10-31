import { clamp } from './Vec2.js';

/**
 * Pan/zoom camera.
 *
 * Holds the world<->screen transform and nothing else; the renderer asks it for
 * a transform, input asks it to convert pointer coordinates. Zoom is applied
 * about the cursor so the point under the pointer stays put, which is what
 * makes wheel-zoom feel right.
 */
export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.minZoom = 0.35;
    this.maxZoom = 2.5;

    // Smoothed target so panning and zooming ease rather than snap.
    this.targetX = 0;
    this.targetY = 0;
    this.targetZoom = 1;
    this.smoothing = 14;

    this.bounds = null; // {minX,minY,maxX,maxY} in world units
    // Canvas pixels per CSS pixel. The renderer sets it on resize, because the
    // render resolution setting can make it smaller than the device's ratio.
    this.pixelRatio = window.devicePixelRatio || 1;
  }

  get width() {
    return this.canvas.width / this.pixelRatio;
  }

  get height() {
    return this.canvas.height / this.pixelRatio;
  }

  centerOn(x, y) {
    this.x = this.targetX = x;
    this.y = this.targetY = y;
  }

  setBounds(minX, minY, maxX, maxY) {
    this.bounds = { minX, minY, maxX, maxY };
  }

  panBy(dxScreen, dyScreen) {
    this.targetX -= dxScreen / this.targetZoom;
    this.targetY -= dyScreen / this.targetZoom;
  }

  /** Zoom about a screen-space point so the world point under it stays fixed. */
  zoomAt(screenX, screenY, factor) {
    const before = this.toWorld(screenX, screenY);
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    // Apply immediately for the correction maths, then let smoothing catch up.
    const prevZoom = this.zoom;
    this.zoom = this.targetZoom;
    const after = this.toWorld(screenX, screenY);
    this.zoom = prevZoom;
    this.targetX += before.x - after.x;
    this.targetY += before.y - after.y;
  }

  update(dt) {
    const t = 1 - Math.exp(-this.smoothing * dt);
    this.x += (this.targetX - this.x) * t;
    this.y += (this.targetY - this.y) * t;
    this.zoom += (this.targetZoom - this.zoom) * t;

    if (this.bounds) {
      this.targetX = clamp(this.targetX, this.bounds.minX, this.bounds.maxX);
      this.targetY = clamp(this.targetY, this.bounds.minY, this.bounds.maxY);
    }
  }

  toWorld(sx, sy) {
    return {
      x: (sx - this.width / 2) / this.zoom + this.x,
      y: (sy - this.height / 2) / this.zoom + this.y,
    };
  }

  toScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.width / 2,
      y: (wy - this.y) * this.zoom + this.height / 2,
    };
  }

  /** World-space rectangle currently visible, padded for sprite overhang. */
  viewRect(pad = 80) {
    const hw = this.width / 2 / this.zoom;
    const hh = this.height / 2 / this.zoom;
    return {
      minX: this.x - hw - pad,
      minY: this.y - hh - pad,
      maxX: this.x + hw + pad,
      maxY: this.y + hh + pad,
    };
  }

  applyTransform(ctx) {
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}
