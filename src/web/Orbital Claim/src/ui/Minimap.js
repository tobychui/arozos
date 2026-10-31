/**
 * Bottom-right minimap.
 *
 * Shows the whole field at once: rocks, your network, hostiles, and the slice
 * of it you are currently looking at. Its job is answering "where is the attack
 * coming from" without making you pan around to find out, so enemies are drawn
 * last and slightly oversized — legibility matters more than scale fidelity at
 * this size.
 *
 * Click or drag anywhere on it to move the camera there.
 */
export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../world/World.js').World} world
   * @param {import('../core/Camera.js').Camera} camera
   */
  constructor(canvas, world, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.camera = camera;
    this.size = canvas.clientWidth || 160;

    // Everything inside this world radius maps onto the canvas.
    this.range = world.fieldRadius + 420;

    this._resize();
    this._bind();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.size = this.canvas.clientWidth || 160;
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bind() {
    const jump = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const p = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.camera.centerOn(p.x, p.y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this._dragging = true;
      jump(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this._dragging) jump(e);
    });
    this.canvas.addEventListener('pointerup', () => (this._dragging = false));
    this.canvas.addEventListener('pointerleave', () => (this._dragging = false));
  }

  /** World -> minimap pixels. */
  toMap(x, y) {
    const half = this.size / 2;
    const k = half / this.range;
    return { x: half + x * k, y: half + y * k };
  }

  /** Minimap pixels -> world. */
  toWorld(mx, my) {
    const half = this.size / 2;
    const k = this.range / half;
    return { x: (mx - half) * k, y: (my - half) * k };
  }

  render() {
    const ctx = this.ctx;
    const s = this.size;
    const w = this.world;

    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(5,8,14,0.82)';
    ctx.fillRect(0, 0, s, s);

    // Field boundary.
    const edge = this.toMap(0, 0);
    const edgeR = (w.fieldRadius / this.range) * (s / 2);
    ctx.strokeStyle = 'rgba(79,209,224,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(edge.x, edge.y, edgeR, 0, Math.PI * 2);
    ctx.stroke();

    // Asteroids: dim, and dimmer still once worked out.
    for (const a of w.asteroids) {
      const p = this.toMap(a.pos.x, a.pos.y);
      ctx.fillStyle = a.depleted
        ? 'rgba(110,125,140,0.22)'
        : `rgba(126,240,192,${0.2 + 0.35 * a.fraction})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, a.depleted ? 0.8 : 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Power links, so the shape of your network is readable.
    ctx.strokeStyle = 'rgba(79,209,224,0.22)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const st of w.structures) {
      if (!st.alive || !st.gridParent) continue;
      const a = this.toMap(st.pos.x, st.pos.y);
      const b = this.toMap(st.gridParent.pos.x, st.gridParent.pos.y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // Structures.
    for (const st of w.structures) {
      if (!st.alive) continue;
      const p = this.toMap(st.pos.x, st.pos.y);
      // Generators are the landmarks now that there is no central hub.
      const source = !!st.isSource;
      ctx.fillStyle = !st.connected ? '#ff8a5c' : source ? '#eafcff' : '#4fd1e0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, source ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera viewport.
    const v = this.camera.viewRect(0);
    const tl = this.toMap(v.minX, v.minY);
    const br = this.toMap(v.maxX, v.maxY);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    // Hostiles last and oversized: this is the reason the map exists.
    for (const e of w.enemies) {
      if (!e.alive) continue;
      const p = this.toMap(e.pos.x, e.pos.y);
      ctx.fillStyle = '#ff4d5e';
      ctx.beginPath();
      ctx.arc(p.x, p.y, e.key === 'mothership' ? 4 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Off-map hostiles pinned to the rim, so an inbound wave is never invisible.
    const half = s / 2;
    for (const e of w.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x, e.pos.y);
      if (d <= this.range) continue;
      const a = Math.atan2(e.pos.y, e.pos.x);
      const rx = half + Math.cos(a) * (half - 4);
      const ry = half + Math.sin(a) * (half - 4);
      ctx.fillStyle = 'rgba(255,77,94,0.8)';
      ctx.beginPath();
      ctx.arc(rx, ry, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
