/**
 * Background music: a small step sequencer with synthesised instruments.
 *
 * Songs (songs.js) are written as sections of chords plus a hand written
 * melody; bass, arpeggio, pad and drum parts are generated from the chords
 * by named styles. The compiled song is one sorted list of note events in
 * sixteenth-note steps, scheduled a quarter second ahead on the audio clock
 * and looped from the song's `loop` section.
 *
 * Melody notation, one token per eighth note:
 *   a4 c#5 eb5   a note         -   hold the previous note
 *   .            rest           a4/b4  split the slot (two sixteenths)
 *   |            bar line (ignored, for readability)
 */
import { SONGS } from './songs.js';

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const CHORD = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], aug: [0, 4, 8], add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14], 5: [0, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
};

function noteMidi(tok) {
  const m = /^([a-g])([#b]?)(-?\d)$/.exec(tok);
  if (!m) throw new Error('bad note ' + tok);
  let n = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return n + (parseInt(m[3], 10) + 1) * 12;
}

function parseChord(sym) {
  const m = /^([A-G])([#b]?)(maj7|madd9|m7|m6|m|7|sus4|sus2|dim|aug|add9|5|6)?(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m) throw new Error('bad chord ' + sym);
  const root = NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  let bass = root;
  if (m[4]) bass = NOTE[m[4][0].toLowerCase()] + (m[4][1] === '#' ? 1 : m[4][1] === 'b' ? -1 : 0);
  return { root, bass, iv: CHORD[m[3] || ''] };
}

function parseLine(str) {
  const ev = [];
  let pos = 0;
  let last = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const parts = tok.split('/');
    const sub = 2 / parts.length;
    for (const p of parts) {
      if (p === '-') {
        if (last) last.len += sub;
      } else if (p === '.') {
        last = null;
      } else {
        last = { at: pos, len: sub, midi: noteMidi(p) };
        ev.push(last);
      }
      pos += sub;
    }
  }
  return ev;
}

// ------------------------------------------------------------ patterns --
const DRUMS = {
  none: {},
  rock: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    fill: { kick: 'x.......x.......', snare: '....x...x.xxxxxx', hat: 'x.x.x.x.........' } },
  drive: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx',
    fill: { kick: 'x...x...x.......', snare: '....x...xxxxxxxx', hat: 'xxxxxxxx........' } },
  half: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.',
    fill: { kick: 'x.........x.....', snare: '........x...xxxx', hat: 'x.x.x.x.x.x.....' } },
  taiko: { taiko: 'x.....x.x...x...', ka: '..x...x...x.x.x.', shaker: 'x.x.x.x.x.x.x.x.',
    fill: { taiko: 'x.....x.x.x.xxxx', ka: '..x...x.........' } },
  festival: { taiko: 'x..x..x.x.......', ka: '....x.......x.x.', kick: 'x.......x.......', hat: '..x...x...x...x.',
    fill: { taiko: 'x..x..x.x.x.xxxx', ka: '....x...........' } },
  calm: { kick: 'x.........x.....', ka: '....x.......x...', shaker: '..x...x...x...x.' },
  march: { kick: 'x...x...x...x...', snare: '..x.x.x...x.x.xx', hat: 'x.x.x.x.x.x.x.x.',
    fill: { kick: 'x...x...x...x...', snare: 'x.x.x.x.xxxxxxxx' } },
  shuffle: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x..xx..xx..xx..x',
    fill: { kick: 'x.....x...x.....', snare: '....x.....xxxxxx' } },
};

const ARPS = {
  up16: { step: 1, seq: [0, 1, 2, 3, 4, 3, 2, 1] },
  rise16: { step: 1, seq: [0, 1, 2, 3, 4, 5, 6, 7] },
  up8: { step: 2, seq: [0, 1, 2, 3] },
  updown8: { step: 2, seq: [0, 1, 2, 3, 2, 1] },
  koto: { step: 1, mask: 'x..x..x.x..x.x..', seq: [0, 2, 1, 3, 2, 4, 1, 2] },
  sparse: { step: 1, mask: 'x.....x...x.....', seq: [2, 3, 1, 4] },
  stab8: { step: 1, mask: '..x...x...x...x.', chord: true },
  pulse8: { step: 2, chord: true },
};

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.want = null;
    this.current = null;
    this._timer = null;
    this.onSong = null;
  }

  static list() {
    return SONGS;
  }

  play(id, { restart = false } = {}) {
    this.want = id;
    if (!restart && this.current && this.current.id === id) return;
    if (!this.audio.ready) return;
    this._start(id);
  }

  /** Called once audio unlocks: start whatever was asked for meanwhile. */
  resume() {
    if (this.want && (!this.current || this.current.id !== this.want)) this._start(this.want);
  }

  /** Turn the music down while the game is paused. */
  duck(on) {
    this.ducked = on;
    const cur = this.current;
    if (!cur || !this.audio.ctx) return;
    const t = this.audio.now;
    cur.bus.gain.cancelScheduledValues(t);
    cur.bus.gain.setTargetAtTime((cur.song.gain ?? 1) * (on ? 0.25 : 1), t, 0.08);
  }

  stop(fade = 0.6) {
    this.want = null;
    this._halt(fade);
  }

  fadeOut(sec = 2) {
    this._halt(sec);
    this.want = null;
  }

  _halt(fade) {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    const cur = this.current;
    this.current = null;
    if (!cur || !this.audio.ctx) return;
    const t = this.audio.now;
    cur.bus.gain.cancelScheduledValues(t);
    cur.bus.gain.setValueAtTime(cur.bus.gain.value, t);
    cur.bus.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => cur.bus.disconnect(), fade * 1000 + 600);
  }

  _start(id) {
    const song = SONGS.find((s) => s.id === id);
    if (!song) return;
    this._halt(0.5);
    const a = this.audio;
    const c = a.ctx;
    const comp = song._compiled || (song._compiled = compile(song));
    const bus = c.createGain();
    bus.gain.value = (song.gain ?? 1) * (this.ducked ? 0.25 : 1);
    bus.connect(a.music);
    const send = c.createGain();
    send.gain.value = song.reverb ?? 0.25;
    bus.connect(send);
    send.connect(a.reverbIn);
    const st = {
      id,
      song,
      comp,
      bus,
      stepSec: 60 / song.bpm / 4,
      idx: 0,
      cursorStep: 0,
      cursorTime: a.now + 0.12,
    };
    this.current = st;
    this._tick();
    this._timer = setInterval(() => this._tick(), 50);
    if (this.onSong) this.onSong(id);
  }

  _tick() {
    const st = this.current;
    if (!st) return;
    const a = this.audio;
    const ev = st.comp.events;
    const horizon = a.now + (document.hidden ? 1.5 : 0.3);
    let guard = 0;
    while (guard++ < 4000) {
      const e = ev[st.idx];
      if (!e) {
        st.cursorTime += (st.comp.length - st.cursorStep) * st.stepSec;
        st.cursorStep = st.comp.loopStep;
        st.idx = st.comp.loopIdx;
        if (!ev[st.idx]) return;
        continue;
      }
      const t = st.cursorTime + (e.at - st.cursorStep) * st.stepSec;
      if (t > horizon) break;
      if (t > a.now - 0.05) voice(a, st.bus, e.inst, t, e.len * st.stepSec, e.midi, e.vel);
      st.idx++;
    }
  }
}

// -------------------------------------------------------------- compile --
function compile(song) {
  const events = [];
  let base = 0;
  let loopStep = 0;
  song.order.forEach((key, oi) => {
    const sec = song.sections[key];
    if (!sec) throw new Error('missing section ' + key);
    if (oi === song.loop) loopStep = base;
    const bars = sec.chords.trim().split(/[\s|]+/).filter(Boolean);
    const len = bars.length * 16;
    // chords -> spans
    const spans = [];
    bars.forEach((b, bi) => {
      const parts = b.split(',');
      const w = 16 / parts.length;
      parts.forEach((p, pi) => spans.push({ at: bi * 16 + pi * w, len: w, ch: parseChord(p), bar: bi }));
    });
    const push = (inst, at, l, midi, vel = 1) => {
      if (at < len) events.push({ inst, at: base + at, len: Math.min(l, len - at), midi, vel });
    };
    // melody and harmony lines
    const lines = [
      [sec.mel, sec.lead || 'lead', sec.melVel ?? 1],
      [sec.mel2, sec.lead2 || sec.lead || 'lead', sec.mel2Vel ?? 0.6],
      [sec.mel3, sec.lead3 || 'bell', sec.mel3Vel ?? 0.5],
    ];
    for (const [str, inst, vel] of lines) {
      if (!str) continue;
      for (const e of parseLine(str)) push(inst, e.at, e.len, e.midi, vel);
    }
    // accompaniment
    for (const sp of spans) {
      const ch = sp.ch;
      const bassOct = sec.bassOct ?? 36;
      const rootM = bassOct + ((ch.bass + 12) % 12);
      const bassInst = sec.bassInst || 'bass';
      switch (sec.bass) {
        case 'oct8':
          for (let s = 0; s < sp.len; s += 2) push(bassInst, sp.at + s, 1.8, rootM + ((s / 2) % 2 ? 12 : 0), 0.9);
          break;
        case 'root8':
          for (let s = 0; s < sp.len; s += 2) push(bassInst, sp.at + s, 1.8, rootM, s % 4 ? 0.75 : 0.95);
          break;
        case 'pump':
          for (let s = 0; s < sp.len; s++) if ('x.xx.xx.x.xx.xxx'[s] === 'x') push(bassInst, sp.at + s, 0.9, rootM + (s === 7 || s === 15 ? 12 : 0), 0.85);
          break;
        case 'walk': {
          const steps = [0, 7, 12, 7];
          for (let s = 0, k = 0; s < sp.len; s += 4, k++) push(bassInst, sp.at + s, 3.6, rootM + steps[k % 4], 0.9);
          break;
        }
        case 'half':
          for (let s = 0; s < sp.len; s += 8) push(bassInst, sp.at + s, 7.5, rootM, 0.9);
          break;
        case 'long':
          push(bassInst, sp.at, sp.len - 0.2, rootM, 0.9);
          break;
        default:
          break;
      }
      const arp = ARPS[sec.arp];
      if (arp) {
        const arpOct = sec.arpOct ?? 60;
        const tones = [];
        for (let o = 0; tones.length < 8; o += 12) for (const iv of ch.iv) if (iv < 12 || o === 0) tones.push(arpOct + ((ch.root + 12) % 12) + iv + o);
        const inst = sec.arpInst || 'koto';
        const vel = sec.arpVel ?? 0.55;
        let k = 0;
        for (let s = 0; s < sp.len; s += arp.step) {
          const gs = (sp.at + s) % 16;
          if (arp.mask && arp.mask[gs] !== 'x') continue;
          if (arp.chord) {
            for (const iv of ch.iv.slice(0, 3)) push(inst, sp.at + s, arp.step * 0.9, arpOct + ((ch.root + 12) % 12) + iv, vel * 0.7);
          } else {
            push(inst, sp.at + s, arp.step * 0.95, tones[arp.seq[k % arp.seq.length] % tones.length], vel);
          }
          k++;
        }
      }
      if (sec.pad) {
        const padOct = sec.padOct ?? 48;
        for (const iv of ch.iv) push(sec.pad, sp.at, sp.len, padOct + ((ch.root + 12) % 12) + iv, sec.padVel ?? 0.5);
      }
    }
    // drums
    const style = DRUMS[sec.drums || 'none'];
    for (let bar = 0; bar < bars.length; bar++) {
      const pat = bar === bars.length - 1 && style.fill && sec.fill !== false ? { ...style, ...style.fill } : style;
      for (const inst of ['kick', 'snare', 'hat', 'ohat', 'taiko', 'ka', 'shaker']) {
        const p = pat[inst];
        if (!p) continue;
        for (let s = 0; s < 16; s++) if (p[s] === 'x') push(inst, bar * 16 + s, 1, 0, s % 4 === 0 ? 1 : 0.75);
      }
      if (bar === 0 && sec.crash) push('crash', 0, 8, 0, 1);
    }
    base += len;
  });
  events.sort((a, b) => a.at - b.at);
  let loopIdx = events.findIndex((e) => e.at >= loopStep);
  if (loopIdx < 0) loopIdx = 0;
  return { events, length: base, loopStep, loopIdx };
}

// --------------------------------------------------------------- voices --
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function env(g, t, a, peak, d, sus, dur, r) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(peak * sus, t + a, d);
  g.gain.setTargetAtTime(0.0001, t + Math.max(a, dur), r);
}

function osc(c, type, f, t, end, detune = 0) {
  const o = c.createOscillator();
  if (typeof type === 'string') o.type = type;
  else o.setPeriodicWave(type);
  o.frequency.value = f;
  o.detune.value = detune;
  o.start(t);
  o.stop(end);
  return o;
}

function vibrato(c, o, t, end, rate, cents, delay) {
  const l = c.createOscillator();
  const lg = c.createGain();
  l.frequency.value = rate;
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(cents, t + delay + 0.15);
  l.connect(lg);
  lg.connect(o.detune);
  l.start(t);
  l.stop(end);
}

function voice(a, out, inst, t, dur, midi, vel) {
  const c = a.ctx;
  const f = mtof(midi);
  const g = c.createGain();
  g.connect(out);
  switch (inst) {
    case 'lead': {
      const end = t + dur + 0.3;
      const o = osc(c, a.pulse(0.25), f, t, end);
      vibrato(c, o, t, end, 5.6, 14, 0.18);
      const lp = c.createBiquadFilter();
      lp.frequency.value = 3600;
      o.connect(lp);
      lp.connect(g);
      env(g, t, 0.01, 0.15 * vel, 0.12, 0.65, dur, 0.06);
      break;
    }
    case 'brass': {
      const end = t + dur + 0.3;
      const o = osc(c, 'sawtooth', f, t, end);
      const o2 = osc(c, 'sawtooth', f, t, end, 8);
      vibrato(c, o, t, end, 5.2, 10, 0.25);
      const lp = c.createBiquadFilter();
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(3000, t + 0.05);
      lp.frequency.setTargetAtTime(1600, t + 0.05, 0.15);
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      env(g, t, 0.03, 0.09 * vel, 0.2, 0.8, dur, 0.07);
      break;
    }
    case 'flute': {
      const end = t + dur + 0.35;
      const o = osc(c, 'sine', f, t, end);
      const o2 = osc(c, 'triangle', f * 2, t, end);
      vibrato(c, o, t, end, 5, 18, 0.2);
      const g2 = c.createGain();
      g2.gain.value = 0.18;
      o2.connect(g2);
      g2.connect(g);
      o.connect(g);
      env(g, t, 0.05, 0.22 * vel, 0.3, 0.85, dur, 0.09);
      const n = c.createBufferSource();
      n.buffer = a.noise;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 2.2;
      bp.Q.value = 2;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.04 * vel, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      n.start(t, Math.random());
      n.stop(t + 0.15);
      break;
    }
    case 'koto': {
      const end = t + Math.max(dur, 0.6) + 0.4;
      const o = osc(c, 'sawtooth', f, t, end);
      const o2 = osc(c, 'triangle', f, t, end, -4);
      const lp = c.createBiquadFilter();
      lp.frequency.setValueAtTime(4200, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.5);
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, 0.6) + 0.35);
      break;
    }
    case 'piano': {
      const end = t + Math.max(dur, 1) + 0.5;
      const o = osc(c, 'triangle', f, t, end);
      const o2 = osc(c, 'sine', f * 2, t, end);
      const g2 = c.createGain();
      g2.gain.value = 0.3;
      o2.connect(g2);
      g2.connect(g);
      o.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.005);
      g.gain.setTargetAtTime(0.06 * vel, t + 0.005, 0.25);
      g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
      break;
    }
    case 'bell': {
      const end = t + 1.8;
      const o = osc(c, 'sine', f, t, end);
      const o2 = osc(c, 'sine', f * 2.76, t, end);
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.35, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o2.connect(g2);
      g2.connect(g);
      o.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      break;
    }
    case 'pad':
    case 'strings': {
      const end = t + dur + 0.9;
      const bright = inst === 'strings';
      const lp = c.createBiquadFilter();
      lp.frequency.value = bright ? 2600 : 1300;
      for (const d of bright ? [-9, 0, 9] : [-7, 7]) {
        const o = osc(c, 'sawtooth', f, t, end, d);
        if (bright) vibrato(c, o, t, end, 5, 8, 0.3);
        o.connect(lp);
      }
      lp.connect(g);
      env(g, t, bright ? 0.12 : 0.3, (bright ? 0.035 : 0.04) * vel, 0.5, 0.9, dur, bright ? 0.25 : 0.4);
      break;
    }
    case 'organ': {
      const end = t + dur + 0.3;
      [1, 2, 3].forEach((h, i) => {
        const o = osc(c, 'sine', f * h, t, end);
        const hg = c.createGain();
        hg.gain.value = [1, 0.4, 0.2][i];
        o.connect(hg);
        hg.connect(g);
      });
      env(g, t, 0.02, 0.06 * vel, 0.2, 0.9, dur, 0.08);
      break;
    }
    case 'bass': {
      const end = t + dur + 0.2;
      const o = osc(c, a.pulse(0.5), f, t, end);
      const o2 = osc(c, 'triangle', f, t, end);
      const lp = c.createBiquadFilter();
      lp.frequency.setValueAtTime(1100, t);
      lp.frequency.exponentialRampToValueAtTime(420, t + 0.15);
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      env(g, t, 0.006, 0.16 * vel, 0.1, 0.7, dur * 0.95, 0.03);
      break;
    }
    case 'sub': {
      const end = t + dur + 0.2;
      const o = osc(c, 'triangle', f, t, end);
      o.connect(g);
      env(g, t, 0.01, 0.3 * vel, 0.3, 0.8, dur, 0.06);
      break;
    }
    // ---------------------------------------------------------------- drums
    case 'kick': {
      const o = osc(c, 'sine', 150, t, t + 0.4);
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      o.connect(g);
      g.gain.setValueAtTime(0.5 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      break;
    }
    case 'taiko': {
      const o = osc(c, 'sine', 110, t, t + 0.7);
      o.frequency.setValueAtTime(115, t);
      o.frequency.exponentialRampToValueAtTime(58, t + 0.25);
      o.connect(g);
      g.gain.setValueAtTime(0.55 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      noiseHit(a, out, t, 'lowpass', 800, 0.12, 0.18 * vel);
      break;
    }
    case 'snare':
      noiseHit(a, out, t, 'bandpass', 2200, 0.16, 0.22 * vel, 0.8);
      noiseHit(a, out, t, 'highpass', 5000, 0.08, 0.08 * vel);
      {
        const o = osc(c, 'triangle', 200, t, t + 0.12);
        o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
        o.connect(g);
        g.gain.setValueAtTime(0.16 * vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      }
      break;
    case 'hat':
      noiseHit(a, out, t, 'highpass', 8000, 0.04, 0.07 * vel);
      break;
    case 'ohat':
      noiseHit(a, out, t, 'highpass', 7000, 0.22, 0.06 * vel);
      break;
    case 'shaker':
      noiseHit(a, out, t, 'bandpass', 6500, 0.06, 0.05 * vel, 1.2, 0.02);
      break;
    case 'crash':
      noiseHit(a, out, t, 'highpass', 4000, 1.4, 0.1 * vel);
      break;
    case 'ka': {
      const o = osc(c, 'square', 1250, t, t + 0.06);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 3;
      o.connect(bp);
      bp.connect(g);
      g.gain.setValueAtTime(0.12 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      break;
    }
    default:
      g.disconnect();
  }
}

function noiseHit(a, out, t, type, freq, dur, vol, q = 0.7, attack = 0.001) {
  const c = a.ctx;
  const n = c.createBufferSource();
  n.buffer = a.noise;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f);
  f.connect(g);
  g.connect(out);
  n.start(t, Math.random() * 0.8);
  n.stop(t + dur + 0.02);
}
