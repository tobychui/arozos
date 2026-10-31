/**
 * Pointer and keyboard input.
 *
 * Owns raw device state only. It resolves pointer position into world space via
 * the camera, but makes no decisions about what a click means — that belongs to
 * the game, so input stays reusable and testable.
 */
export class Input {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;

    this.screen = { x: 0, y: 0 };
    this.world = { x: 0, y: 0 };
    this.down = false;
    this.dragging = false;
    this.overCanvas = false;

    this.keys = new Set();
    // Keyboard pan speed multiplier, from the gameplay settings.
    this.panSpeed = 1;
    this._dragStart = { x: 0, y: 0 };
    this._lastPan = { x: 0, y: 0 };
    this._listeners = { click: [], rightclick: [], key: [] };

    this._bind();
  }

  on(event, fn) {
    if (this._listeners[event]) this._listeners[event].push(fn);
    return this;
  }

  _emit(event, ...args) {
    for (const fn of this._listeners[event] || []) fn(...args);
  }

  _updatePointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.screen.x = e.clientX - r.left;
    this.screen.y = e.clientY - r.top;
    const w = this.camera.toWorld(this.screen.x, this.screen.y);
    this.world.x = w.x;
    this.world.y = w.y;
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener('pointerenter', () => (this.overCanvas = true));
    c.addEventListener('pointerleave', () => {
      this.overCanvas = false;
      this.down = false;
      this.dragging = false;
    });

    c.addEventListener('pointerdown', (e) => {
      this._updatePointer(e);
      c.setPointerCapture(e.pointerId);
      if (e.button === 0) {
        this.down = true;
        this.dragging = false;
        this._dragStart.x = this.screen.x;
        this._dragStart.y = this.screen.y;
        this._lastPan.x = this.screen.x;
        this._lastPan.y = this.screen.y;
      }
    });

    c.addEventListener('pointermove', (e) => {
      this._updatePointer(e);
      if (!this.down) return;
      const dx = this.screen.x - this._lastPan.x;
      const dy = this.screen.y - this._lastPan.y;
      // Only treat it as a drag once it clears a small threshold, so a slightly
      // shaky click still registers as a click.
      if (!this.dragging) {
        const moved = Math.hypot(this.screen.x - this._dragStart.x,
                                 this.screen.y - this._dragStart.y);
        if (moved > 5) this.dragging = true;
      }
      if (this.dragging) this.camera.panBy(dx, dy);
      this._lastPan.x = this.screen.x;
      this._lastPan.y = this.screen.y;
    });

    c.addEventListener('pointerup', (e) => {
      this._updatePointer(e);
      if (e.button === 0) {
        if (!this.dragging) this._emit('click', { ...this.world }, { ...this.screen });
        this.down = false;
        this.dragging = false;
      }
    });

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._updatePointer(e);
      this._emit('rightclick', { ...this.world });
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._updatePointer(e);
      this.camera.zoomAt(this.screen.x, this.screen.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      this._emit('key', e.key.toLowerCase(), e);
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  isDown(key) {
    return this.keys.has(key);
  }

  /** Edge/WASD panning, applied per frame. */
  applyKeyboardPan(dt) {
    const speed = 620 * this.panSpeed * dt;
    let dx = 0;
    let dy = 0;
    if (this.isDown('a') || this.isDown('arrowleft')) dx += 1;
    if (this.isDown('d') || this.isDown('arrowright')) dx -= 1;
    if (this.isDown('w') || this.isDown('arrowup')) dy += 1;
    if (this.isDown('s') || this.isDown('arrowdown')) dy -= 1;
    if (dx || dy) this.camera.panBy(dx * speed, dy * speed);
  }
}
