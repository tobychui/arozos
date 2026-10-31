/**
 * Synthesised sound effects.
 *
 * Every sound is built on the fly from oscillators and one shared noise buffer
 * with the Web Audio API, so the game ships no audio files. Two buses feed the
 * master gain, one per volume slider: `world` (weapons, explosions,
 * construction) and `ui` (buttons, wave alarms, warnings).
 *
 * Combat is noisy by nature — a late wave at 3x fires hundreds of shots a
 * second — so every cue has a minimum gap between plays and the mixer has a
 * voice cap. World sounds also arrive with a gain and pan worked out from where
 * they happened relative to the camera, so a fight off-screen is a distant
 * rumble rather than the loudest thing in the room.
 */

const MAX_VOICES = 32;

/**
 * Cue table. `gap` is the minimum time between two plays of the same cue, in
 * seconds; `play` schedules the nodes and returns the time the cue ends.
 */
const CUES = {
  // -------------------------------------------------------- player fire ---
  bolt: { bus: 'world', gap: 0.05, play: (s, out, t) =>
    s.tone(out, t, { type: 'square', f0: 1500, f1: 520, dur: 0.07, vol: 0.12, lowpass: 3800 }) },
  slug: { bus: 'world', gap: 0.08, play: (s, out, t) => Math.max(
    s.tone(out, t, { type: 'triangle', f0: 380, f1: 80, dur: 0.18, vol: 0.4 }),
    s.noise(out, t, { type: 'lowpass', f0: 2400, f1: 400, dur: 0.09, vol: 0.25 })) },
  missile: { bus: 'world', gap: 0.09, play: (s, out, t) =>
    s.noise(out, t, { type: 'bandpass', f0: 500, f1: 2600, q: 1.4, dur: 0.38, vol: 0.34, attack: 0.04 }) },
  interceptor: { bus: 'world', gap: 0.06, play: (s, out, t) =>
    s.tone(out, t, { type: 'sine', f0: 900, f1: 2100, dur: 0.12, vol: 0.16 }) },

  // --------------------------------------------------------- enemy fire ---
  'enemy-bolt': { bus: 'world', gap: 0.06, play: (s, out, t) =>
    s.tone(out, t, { type: 'sawtooth', f0: 640, f1: 210, dur: 0.1, vol: 0.08, lowpass: 2200 }) },
  'enemy-missile': { bus: 'world', gap: 0.12, play: (s, out, t) =>
    s.noise(out, t, { type: 'bandpass', f0: 1400, f1: 380, q: 1.6, dur: 0.42, vol: 0.3, attack: 0.05 }) },

  // ------------------------------------------------------------ impacts ---
  hit: { bus: 'world', gap: 0.035, play: (s, out, t) =>
    s.noise(out, t, { type: 'bandpass', f0: 2600, f1: 1200, q: 1.2, dur: 0.06, vol: 0.2 }) },
  impact: { bus: 'world', gap: 0.06, play: (s, out, t) => Math.max(
    s.noise(out, t, { type: 'lowpass', f0: 1400, f1: 300, dur: 0.12, vol: 0.32 }),
    s.tone(out, t, { type: 'sine', f0: 160, f1: 70, dur: 0.1, vol: 0.26 })) },
  intercept: { bus: 'world', gap: 0.06, play: (s, out, t) =>
    s.noise(out, t, { type: 'highpass', f0: 3000, f1: 1500, dur: 0.08, vol: 0.22 }) },
  kill: { bus: 'world', gap: 0.05, play: (s, out, t) => Math.max(
    s.noise(out, t, { type: 'lowpass', f0: 2600, f1: 260, dur: 0.45, vol: 0.5 }),
    s.tone(out, t, { type: 'sine', f0: 150, f1: 42, dur: 0.32, vol: 0.45 })) },
  detonate: { bus: 'world', gap: 0.08, play: (s, out, t) => Math.max(
    s.noise(out, t, { type: 'lowpass', f0: 1800, f1: 160, dur: 0.75, vol: 0.7 }),
    s.tone(out, t, { type: 'sine', f0: 110, f1: 32, dur: 0.6, vol: 0.65 })) },
  lost: { bus: 'world', gap: 0.12, play: (s, out, t) => Math.max(
    s.noise(out, t, { type: 'lowpass', f0: 1300, f1: 110, dur: 1.15, vol: 0.8 }),
    s.tone(out, t, { type: 'sine', f0: 80, f1: 28, dur: 0.95, vol: 0.75 }),
    s.tone(out, t + 0.05, { type: 'square', f0: 220, f1: 55, dur: 0.3, vol: 0.08, lowpass: 900 })) },

  // ------------------------------------------------------- construction ---
  built: { bus: 'world', gap: 0.1, play: (s, out, t) => Math.max(
    s.tone(out, t, { type: 'triangle', f0: 660, dur: 0.1, vol: 0.18 }),
    s.tone(out, t + 0.08, { type: 'triangle', f0: 990, dur: 0.14, vol: 0.18 })) },
  upgraded: { bus: 'world', gap: 0.12, play: (s, out, t) =>
    s.arp(out, t, [523, 784, 1046], { type: 'triangle', step: 0.07, dur: 0.16, vol: 0.18 }) },

  // ---------------------------------------------------------- interface ---
  click: { bus: 'ui', gap: 0.03, play: (s, out, t) =>
    s.tone(out, t, { type: 'sine', f0: 1250, f1: 900, dur: 0.035, vol: 0.12 }) },
  place: { bus: 'ui', gap: 0.04, play: (s, out, t) => Math.max(
    s.tone(out, t, { type: 'triangle', f0: 420, f1: 380, dur: 0.06, vol: 0.28 }),
    s.noise(out, t, { type: 'lowpass', f0: 900, dur: 0.05, vol: 0.16 })) },
  confirm: { bus: 'ui', gap: 0.08, play: (s, out, t) =>
    s.arp(out, t, [660, 880], { type: 'sine', step: 0.06, dur: 0.09, vol: 0.16 }) },
  sell: { bus: 'ui', gap: 0.06, play: (s, out, t) =>
    s.arp(out, t, [988, 740, 554], { type: 'square', step: 0.045, dur: 0.06, vol: 0.06, lowpass: 2600 }) },
  error: { bus: 'ui', gap: 0.2, play: (s, out, t) =>
    s.arp(out, t, [185, 185], { type: 'square', step: 0.1, dur: 0.07, vol: 0.09, lowpass: 1200 }) },
  open: { bus: 'ui', gap: 0.1, play: (s, out, t) =>
    s.tone(out, t, { type: 'sine', f0: 620, f1: 380, dur: 0.12, vol: 0.14 }) },
  close: { bus: 'ui', gap: 0.1, play: (s, out, t) =>
    s.tone(out, t, { type: 'sine', f0: 380, f1: 620, dur: 0.12, vol: 0.14 }) },

  // ------------------------------------------------------------- alerts ---
  waveStart: { bus: 'ui', gap: 1, play: (s, out, t) => Math.max(
    s.tone(out, t, { type: 'sawtooth', f0: 330, f1: 520, dur: 0.42, vol: 0.12, lowpass: 1600, attack: 0.06 }),
    s.tone(out, t + 0.48, { type: 'sawtooth', f0: 330, f1: 520, dur: 0.42, vol: 0.12, lowpass: 1600, attack: 0.06 })) },
  waveClear: { bus: 'ui', gap: 1, play: (s, out, t) =>
    s.arp(out, t, [523, 659, 784, 1046], { type: 'triangle', step: 0.09, dur: 0.22, vol: 0.16 }) },
  win: { bus: 'ui', gap: 1, play: (s, out, t) =>
    s.arp(out, t, [523, 659, 784, 1046, 1318], { type: 'triangle', step: 0.11, dur: 0.4, vol: 0.18 }) },
  lose: { bus: 'ui', gap: 1, play: (s, out, t) =>
    s.arp(out, t, [392, 330, 262, 196], { type: 'triangle', step: 0.18, dur: 0.5, vol: 0.18 }) },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, world: 0.7, ui: 0.8 };
    this.muted = false;
    this._last = {};
    this._voices = 0;
    this._hum = null;
  }

  /**
   * Create or wake the audio context. Browsers only allow that from a user
   * gesture, so the Game calls this on every pointer and key press.
   */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;

    // A gentle limiter, so a dozen explosions in one frame do not clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.buses = { world: ctx.createGain(), ui: ctx.createGain() };
    for (const bus of Object.values(this.buses)) bus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._applyVolumes(true);
  }

  /** @param {'master'|'world'|'ui'} which @param {number} v 0..1 */
  setVolume(which, v) {
    this.volumes[which] = v;
    this._applyVolumes();
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyVolumes();
  }

  _applyVolumes(instant = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Squared, because loudness is perceived roughly logarithmically: a linear
    // slider would do all its work in the bottom quarter of its travel.
    const set = (param, v) => {
      if (instant) param.value = v * v;
      else param.setTargetAtTime(v * v, t, 0.02);
    };
    set(this.master.gain, this.muted ? 0 : this.volumes.master);
    set(this.buses.world.gain, this.volumes.world);
    set(this.buses.ui.gain, this.volumes.ui);
  }

  /**
   * @param {string} name cue key
   * @param {number} [gain] 0..1, from the distance to the camera
   * @param {number} [pan] -1 (left) .. 1 (right)
   */
  play(name, gain = 1, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const cue = CUES[name];
    // Too quiet to hear is checked before the gap, so a far-off shot never
    // blocks the same sound happening on screen a moment later.
    if (!cue || gain < 0.03 || this._voices >= MAX_VOICES) return;
    const now = ctx.currentTime;
    if (now - (this._last[name] ?? -Infinity) < cue.gap) return;
    this._last[name] = now;

    const out = ctx.createGain();
    out.gain.value = Math.min(1, gain);
    let tail = out;
    if (pan && ctx.createStereoPanner) {
      tail = ctx.createStereoPanner();
      tail.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(tail);
    }
    tail.connect(this.buses[cue.bus]);

    const end = cue.play(this, out, now + 0.005);
    this._voices++;
    setTimeout(() => {
      this._voices--;
      out.disconnect();
      tail.disconnect();
    }, (end - now + 0.1) * 1000);
  }

  /**
   * Laser hum: one shared drone whose level follows how many beams are cutting
   * on screen, instead of a sound per beam per tick.
   * @param {number} level 0 (silent) .. 1
   */
  setHum(level) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this._hum) {
      if (level <= 0) return;
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      f.Q.value = 3;
      // Two slightly detuned saws beat against each other, which keeps the
      // drone from sounding like a test tone.
      for (const hz of [96, 96.8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz;
        o.connect(f);
        o.start();
      }
      f.connect(g);
      g.connect(this.buses.world);
      this._hum = { g, f, level: 0 };
    }
    if (Math.abs(level - this._hum.level) < 0.01) return;
    this._hum.level = level;
    const t = ctx.currentTime;
    this._hum.g.gain.setTargetAtTime(level * 0.09, t, 0.06);
    this._hum.f.frequency.setTargetAtTime(500 + level * 700, t, 0.1);
  }

  // --------------------------------------------------------------- voices

  /** Attack then exponential decay, the shape every cue is made of. */
  _envelope(t, o) {
    const g = this.ctx.createGain();
    const attack = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    return g;
  }

  /** Oscillator voice with an optional pitch sweep from f0 to f1. */
  tone(out, t, o) {
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    let node = osc;
    if (o.lowpass) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      osc.connect(f);
      node = f;
    }
    const env = this._envelope(t, o);
    node.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    return t + o.dur;
  }

  /** Filtered noise voice with an optional cutoff sweep from f0 to f1. */
  noise(out, t, o) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const env = this._envelope(t, o);
    src.connect(f);
    f.connect(env);
    env.connect(out);
    // A random start in the buffer, so repeated hits do not sound identical.
    const offset = Math.random() * Math.max(0, this.noiseBuf.duration - o.dur - 0.1);
    src.start(t, offset, o.dur + 0.05);
    return t + o.dur;
  }

  /** A short run of notes. */
  arp(out, t, freqs, o) {
    let end = t;
    freqs.forEach((f0, i) => {
      end = this.tone(out, t + i * o.step, { ...o, f0 });
    });
    return end;
  }
}
