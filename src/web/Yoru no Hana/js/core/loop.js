/**
 * Fixed 60 Hz simulation with one render per animation frame.
 *
 * Danmaku is tuned per frame, so the game always advances in whole 1/60 s
 * steps. On a 60 Hz display each animation frame is snapped to exactly one
 * step (rAF jitter would otherwise produce the odd double step and visible
 * stutter); faster displays accumulate, and a stall slows the game down
 * instead of jumping ahead.
 */
const STEP = 1000 / 60;

export class Loop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.fps = 60;
    this._fpsT = 0;
    this._fpsN = 0;
    this._raf = (t) => this._frame(t);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._raf);
  }

  _frame(now) {
    if (!this.running) return;
    let dt = now - this.last;
    this.last = now;
    if (dt > 250) dt = STEP; // tab came back from the background
    for (let k = 1; k <= 4; k++) {
      if (Math.abs(dt - k * STEP) < 1.5) {
        dt = k * STEP;
        break;
      }
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP - 0.01 && n < 3) {
      this.update();
      this.acc -= STEP;
      n++;
    }
    if (n === 3) this.acc = 0;
    this.render();

    this._fpsN++;
    this._fpsT += dt;
    if (this._fpsT >= 1000) {
      this.fps = (this._fpsN * 1000) / this._fpsT;
      this._fpsN = 0;
      this._fpsT = 0;
    }
    requestAnimationFrame(this._raf);
  }

  /** Advance n steps synchronously (tests and hidden tabs). */
  pump(n = 1) {
    for (let i = 0; i < n; i++) this.update();
    this.render();
  }
}
