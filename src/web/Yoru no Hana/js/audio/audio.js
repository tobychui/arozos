/**
 * Web Audio graph shared by sound effects and music.
 *
 *   sfx bus ---\
 *   music bus --+--> master --> compressor --> speakers
 *   reverb -----/      (music and sfx can also send into the reverb)
 *
 * The context is created on the first key press or click (browsers refuse
 * to start audio before a gesture). Nothing is loaded from files: the noise
 * buffer and the reverb impulse are generated here.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.7, sfx: 0.6 };
    this._waves = {};
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return false;
      }
      this._build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  _build() {
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.comp.connect(c.destination);

    this.master = c.createGain();
    this.master.connect(this.comp);
    this.music = c.createGain();
    this.music.connect(this.master);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(2.4, 2.6);
    this.reverbOut = c.createGain();
    this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.music);
    this.reverbIn = c.createGain();
    this.reverbIn.connect(this.reverb);

    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  _impulse(seconds, decay) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const curve = (x) => x * x;
    this.master.gain.setTargetAtTime(curve(this.vol.master), t, 0.03);
    this.music.gain.setTargetAtTime(curve(this.vol.music) * 0.9, t, 0.03);
    this.sfx.gain.setTargetAtTime(curve(this.vol.sfx), t, 0.03);
  }

  /** Pulse wave with the given duty cycle (cached PeriodicWave). */
  pulse(duty) {
    const key = 'p' + duty;
    if (this._waves[key]) return this._waves[key];
    const n = 32;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return (this._waves[key] = this.ctx.createPeriodicWave(re, im));
  }
}
