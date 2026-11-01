/**
 * Synthesised sound effects.
 *
 * Danmaku is loud by nature: hundreds of bullets a second, a shot tick every
 * few frames. Every cue therefore has a minimum gap between plays and the
 * mixer keeps at most MAX_VOICES cues alive at once.
 */
const MAX_VOICES = 24;

const CUES = {
  shot: { gap: 0.07, play: (s, t) => s.noise(t, { type: 'highpass', f0: 5200, f1: 3000, dur: 0.035, vol: 0.09 }) },
  enemyShot: { gap: 0.075, play: (s, t) =>
    s.tone(t, { type: 'square', f0: 1150, f1: 380, dur: 0.07, vol: 0.05, lowpass: 3000 }) },
  enemyShot2: { gap: 0.11, play: (s, t) =>
    s.tone(t, { type: 'triangle', f0: 620, f1: 180, dur: 0.12, vol: 0.13 }) },
  laserWarn: { gap: 0.25, play: (s, t) =>
    s.tone(t, { type: 'sine', f0: 300, f1: 900, dur: 0.4, vol: 0.12 }) },
  laser: { gap: 0.2, play: (s, t) => Math.max(
    s.noise(t, { type: 'bandpass', f0: 1800, f1: 600, q: 2, dur: 0.5, vol: 0.18 }),
    s.tone(t, { type: 'sawtooth', f0: 220, f1: 110, dur: 0.45, vol: 0.06, lowpass: 1200 })) },
  hit: { gap: 0.05, play: (s, t) => s.noise(t, { type: 'bandpass', f0: 2600, f1: 1800, q: 1.5, dur: 0.03, vol: 0.06 }) },
  hitLow: { gap: 0.1, play: (s, t) => s.noise(t, { type: 'bandpass', f0: 900, f1: 600, q: 1.5, dur: 0.05, vol: 0.12 }) },
  graze: { gap: 0.04, play: (s, t) => s.noise(t, { type: 'highpass', f0: 7000, f1: 9000, dur: 0.05, vol: 0.1 }) },
  kill: { gap: 0.05, play: (s, t) => Math.max(
    s.noise(t, { type: 'lowpass', f0: 3200, f1: 400, dur: 0.22, vol: 0.22 }),
    s.tone(t, { type: 'square', f0: 520, f1: 90, dur: 0.15, vol: 0.06, lowpass: 2000 })) },
  bigKill: { gap: 0.1, play: (s, t) => Math.max(
    s.noise(t, { type: 'lowpass', f0: 2400, f1: 120, dur: 0.9, vol: 0.5 }),
    s.tone(t, { type: 'sine', f0: 140, f1: 35, dur: 0.8, vol: 0.5 })) },
  bossDie: { gap: 0.5, play: (s, t) => Math.max(
    s.noise(t, { type: 'lowpass', f0: 3000, f1: 80, dur: 2.2, vol: 0.7 }),
    s.tone(t, { type: 'sine', f0: 160, f1: 28, dur: 1.8, vol: 0.6 }),
    s.tone(t + 0.05, { type: 'triangle', f0: 880, f1: 1760, dur: 0.9, vol: 0.12 })) },
  playerDie: { gap: 0.3, play: (s, t) => Math.max(
    s.tone(t, { type: 'square', f0: 1400, f1: 140, dur: 0.55, vol: 0.12, lowpass: 3200 }),
    s.tone(t + 0.02, { type: 'square', f0: 1050, f1: 105, dur: 0.6, vol: 0.08, lowpass: 2400 }),
    s.noise(t, { type: 'lowpass', f0: 4000, f1: 300, dur: 0.7, vol: 0.3 })) },
  bomb: { gap: 0.3, play: (s, t) => Math.max(
    s.noise(t, { type: 'bandpass', f0: 300, f1: 2400, q: 0.9, dur: 0.6, vol: 0.35, attack: 0.08 }),
    s.tone(t, { type: 'sine', f0: 90, f1: 40, dur: 1.4, vol: 0.5 }),
    s.chime(t + 0.05, [784, 988, 1175, 1568], 0.06, 0.09)) },
  power: { gap: 0.04, play: (s, t) => s.tone(t, { type: 'triangle', f0: 1600, f1: 2100, dur: 0.05, vol: 0.07 }) },
  item: { gap: 0.035, play: (s, t) => s.tone(t, { type: 'sine', f0: 2400, f1: 2600, dur: 0.04, vol: 0.06 }) },
  powerMax: { gap: 0.5, play: (s, t) => s.chime(t, [523, 659, 784, 1047, 1319], 0.05, 0.14) },
  extend: { gap: 0.5, play: (s, t) => s.chime(t, [784, 1047, 1319, 1568, 2093], 0.07, 0.18) },
  bombGet: { gap: 0.5, play: (s, t) => s.chime(t, [659, 880, 1319], 0.07, 0.15) },
  piece: { gap: 0.2, play: (s, t) => s.chime(t, [1175, 1568], 0.06, 0.12) },
  cardDeclare: { gap: 0.5, play: (s, t) => Math.max(
    s.noise(t, { type: 'bandpass', f0: 4000, f1: 800, q: 1.2, dur: 0.7, vol: 0.2 }),
    s.tone(t, { type: 'sawtooth', f0: 110, f1: 220, dur: 0.8, vol: 0.12, lowpass: 1600 }),
    s.chime(t + 0.04, [1319, 1760, 2637], 0.04, 0.1)) },
  cardBonus: { gap: 0.5, play: (s, t) => s.chime(t, [523, 784, 1047, 1319, 1568, 2093], 0.06, 0.16) },
  cardFail: { gap: 0.5, play: (s, t) => s.tone(t, { type: 'triangle', f0: 440, f1: 220, dur: 0.4, vol: 0.12 }) },
  cancel: { gap: 0.15, play: (s, t) => s.noise(t, { type: 'highpass', f0: 3000, f1: 8000, dur: 0.35, vol: 0.12, attack: 0.02 }) },
  tick: { gap: 0.2, play: (s, t) => s.tone(t, { type: 'square', f0: 1760, f1: 1760, dur: 0.05, vol: 0.06, lowpass: 3000 }) },
  tickLow: { gap: 0.2, play: (s, t) => s.tone(t, { type: 'square', f0: 2350, f1: 2350, dur: 0.06, vol: 0.09, lowpass: 3600 }) },
  charge: { gap: 0.4, play: (s, t) => s.tone(t, { type: 'sawtooth', f0: 120, f1: 960, dur: 0.6, vol: 0.06, lowpass: 2400 }) },
  boom: { gap: 0.12, play: (s, t) => Math.max(
    s.noise(t, { type: 'lowpass', f0: 1600, f1: 120, dur: 0.6, vol: 0.4 }),
    s.tone(t, { type: 'sine', f0: 120, f1: 40, dur: 0.5, vol: 0.4 })) },
  select: { gap: 0.03, play: (s, t) => s.tone(t, { type: 'square', f0: 1320, f1: 1320, dur: 0.045, vol: 0.05, lowpass: 3000 }) },
  ok: { gap: 0.05, play: (s, t) => s.chime(t, [988, 1319], 0.035, 0.08) },
  back: { gap: 0.05, play: (s, t) => s.tone(t, { type: 'triangle', f0: 700, f1: 420, dur: 0.1, vol: 0.12 }) },
  pause: { gap: 0.1, play: (s, t) => s.chime(t, [1319, 988], 0.05, 0.08) },
  talk: { gap: 0.06, play: (s, t) => s.tone(t, { type: 'sine', f0: 900, f1: 880, dur: 0.03, vol: 0.03 }) },
};

export class Sfx {
  constructor(audio) {
    this.audio = audio;
    this.last = {};
    this.voices = [];
  }

  play(name) {
    const a = this.audio;
    if (!a.ready) return;
    const cue = CUES[name];
    if (!cue) return;
    const t = a.now;
    if (t - (this.last[name] ?? -1) < cue.gap) return;
    this.voices = this.voices.filter((v) => v > t);
    if (this.voices.length >= MAX_VOICES) return;
    this.last[name] = t;
    const end = cue.play(this, t + 0.005);
    this.voices.push(end || t + 0.2);
  }

  // ------------------------------------------------------------ builders --
  tone(t, o) {
    const c = this.audio.ctx;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const atk = o.attack || 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.audio.sfx);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    return t + o.dur;
  }

  noise(t, o) {
    const c = this.audio.ctx;
    const src = c.createBufferSource();
    src.buffer = this.audio.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.Q.value = o.q || 0.7;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.dur);
    const g = c.createGain();
    const atk = o.attack || 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.audio.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.02);
    return t + o.dur;
  }

  chime(t, freqs, step, vol) {
    let end = t;
    freqs.forEach((f, i) => {
      end = Math.max(end, this.tone(t + i * step, { type: 'triangle', f0: f, f1: f, dur: 0.35, vol }));
    });
    return end;
  }
}
