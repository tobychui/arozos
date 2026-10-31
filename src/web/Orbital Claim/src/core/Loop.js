/**
 * Fixed-timestep game loop with interpolated rendering.
 *
 * The simulation always advances in identical STEP-sized slices, so behaviour
 * is reproducible regardless of display refresh rate or frame hitches. Render
 * receives an alpha in [0,1) describing how far between the last two sim ticks
 * we are, so motion stays smooth on 144 Hz displays without the physics caring.
 */
export class Loop {
  /**
   * @param {(dt:number)=>void} update  called with a constant dt, in seconds
   * @param {(alpha:number)=>void} render
   * @param {number} hz simulation rate
   */
  constructor(update, render, hz = 60) {
    this.update = update;
    this.render = render;
    this.step = 1 / hz;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.paused = false;
    this.speed = 1;
    this.frame = 0;
    this.fps = 0;
    this._fpsTime = 0;
    this._fpsFrames = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  setPaused(p) {
    this.paused = p;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  _tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);

    let elapsed = (now - this.last) / 1000;
    this.last = now;

    // A tab that was backgrounded can hand us a huge delta; clamping stops the
    // accumulator from triggering a death-spiral of catch-up ticks.
    if (elapsed > 0.25) elapsed = 0.25;

    if (!this.paused) {
      this.accumulator += elapsed * this.speed;
      let guard = 0;
      while (this.accumulator >= this.step && guard < 8) {
        this.update(this.step);
        this.accumulator -= this.step;
        this.frame++;
        guard++;
      }
    }

    this.render(this.paused ? 0 : this.accumulator / this.step);

    this._fpsFrames++;
    this._fpsTime += elapsed;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsTime);
      this._fpsFrames = 0;
      this._fpsTime = 0;
    }
  }
}
