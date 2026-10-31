/*
    Blocky - audio.js

    All sounds are synthesised with the Web Audio API from filtered noise
    and simple oscillators, so the game ships no audio files.
*/

const MATERIAL = {
    stone: { type: "bandpass", freq: 2200, q: 1.1, dur: 0.11, gain: 0.55 },
    wood: { type: "bandpass", freq: 850, q: 2.5, dur: 0.12, gain: 0.7, thump: 170 },
    gravel: { type: "lowpass", freq: 1300, q: 0.7, dur: 0.15, gain: 0.7, crunch: true },
    grass: { type: "highpass", freq: 1800, q: 0.6, dur: 0.12, gain: 0.35 },
    sand: { type: "highpass", freq: 2800, q: 0.5, dur: 0.16, gain: 0.32 },
    glass: { type: "bandpass", freq: 3200, q: 4, dur: 0.1, gain: 0.45, ping: true },
    metal: { type: "bandpass", freq: 2600, q: 7, dur: 0.14, gain: 0.45, ping: true },
    cloth: { type: "lowpass", freq: 900, q: 0.7, dur: 0.12, gain: 0.4 },
    water: { type: "lowpass", freq: 900, q: 0.7, dur: 0.25, gain: 0.4 }
};

export class Sound {
    constructor() {
        this.ctx = null;
        this.volume = 0.8;
        this.animalVolume = 0.8;
        this.rainGain = null;
    }

    //Must be called from a user gesture before anything plays
    ensure() {
        if (this.ctx) {
            if (this.ctx.state === "suspended") {
                this.ctx.resume();
            }
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
            return;
        }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        //Animal noises have their own volume setting
        this.animalBus = this.ctx.createGain();
        this.animalBus.gain.value = this.animalVolume;
        this.animalBus.connect(this.master);
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) {
            d[i] = Math.random() * 2 - 1;
        }
        //Brown noise for thunder
        this.brown = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const b = this.brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            b[i] = last * 3.5;
        }
        this.startRain();
    }

    setVolume(v) {
        this.volume = v;
        if (this.master) {
            this.master.gain.value = v;
        }
    }

    setAnimalVolume(v) {
        this.animalVolume = v;
        if (this.animalBus) {
            this.animalBus.gain.value = v;
        }
    }

    //A voiced call: an oscillator gliding through pitches, shaped by a formant
    //filter, with optional vibrato. Routed to the animal bus.
    voice(opts) {
        const ctx = this.ctx;
        const t = ctx.currentTime + (opts.delay || 0);
        const o = ctx.createOscillator();
        o.type = opts.wave || "sawtooth";
        const pts = opts.pitch;
        o.frequency.setValueAtTime(pts[0], t);
        for (let i = 1; i < pts.length; i++) {
            o.frequency.linearRampToValueAtTime(pts[i], t + opts.dur * i / (pts.length - 1));
        }
        if (opts.vibrato) {
            const lfo = ctx.createOscillator(), depth = ctx.createGain();
            lfo.frequency.value = opts.vibrato[0];
            depth.gain.value = opts.vibrato[1];
            lfo.connect(depth).connect(o.frequency);
            lfo.start(t);
            lfo.stop(t + opts.dur + 0.1);
        }
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = opts.formant || 800;
        f.Q.value = opts.q || 1.5;
        const g = ctx.createGain();
        const peak = opts.gain;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack || 0.05));
        g.gain.setValueAtTime(peak, t + opts.dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
        o.connect(f).connect(g).connect(this.animalBus);
        o.start(t);
        o.stop(t + opts.dur + 0.05);
    }

    //kind: idle, hurt, death, angry; distance fades the sound out by 26 blocks
    animal(type, kind, distance = 0) {
        if (!this.ctx || !this.animalBus) {
            return;
        }
        const near = Math.max(0, 1 - distance / 26);
        if (near <= 0) {
            return;
        }
        const r = 0.92 + Math.random() * 0.16;
        const up = kind === "hurt" ? 1.35 : kind === "death" ? 0.8 : 1;
        const g = (v) => v * near;
        if (type === "cow") {
            this.voice({ pitch: [150 * r * up, 120 * r * up, 100 * r * up], dur: kind === "idle" ? 1.0 : 0.4, formant: 420, q: 2, gain: g(0.5), vibrato: [5, 3] });
        } else if (type === "sheep") {
            this.voice({ pitch: [330 * r * up, 310 * r * up], dur: kind === "idle" ? 0.7 : 0.35, formant: 1000, q: 2.5, gain: g(0.35), vibrato: [8, 22] });
        } else if (type === "chicken") {
            const n = kind === "idle" ? 3 : 1;
            for (let i = 0; i < n; i++) {
                this.voice({ pitch: [1050 * r * up, 820 * r * up], dur: 0.07, wave: "square", formant: 1600, q: 2, gain: g(0.18), attack: 0.01, delay: i * 0.13 });
            }
        } else if (type === "wolf") {
            if (kind === "idle") {
                this.voice({ pitch: [420 * r, 640 * r, 600 * r, 460 * r], dur: 1.8, wave: "triangle", formant: 700, q: 1, gain: g(0.3), vibrato: [5, 8], attack: 0.3 });
            } else if (kind === "angry") {
                this.voice({ pitch: [95, 85], dur: 0.7, formant: 300, q: 1, gain: g(0.45), vibrato: [30, 12] });
            } else {
                this.voice({ pitch: [900 * up, 620 * up], dur: 0.18, wave: "triangle", formant: 1100, gain: g(0.35), attack: 0.01 });
            }
        } else if (type === "bear") {
            const len = kind === "angry" || kind === "death" ? 1.1 : 0.6;
            this.voice({ pitch: [120 * r * up, 90 * r * up, 70 * r * up], dur: len, formant: 380, q: 0.8, gain: g(0.6), vibrato: [24, 10], attack: 0.08 });
            this.noiseBurst("lowpass", 500, 0.6, len, g(0.25));
        }
    }

    noiseBurst(filterType, freq, q, dur, gain, when = 0, buffer = null) {
        const ctx = this.ctx;
        const t = ctx.currentTime + when;
        const src = ctx.createBufferSource();
        src.buffer = buffer || this.noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = filterType;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(this.master);
        src.start(t, Math.random() * 1.5);
        src.stop(t + dur + 0.05);
        return f;
    }

    tone(freq, dur, gain, type = "sine", when = 0, endFreq = null) {
        const ctx = this.ctx;
        const t = ctx.currentTime + when;
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (endFreq) {
            o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    //kind: dig, break, place, step
    block(kind, material) {
        if (!this.ctx) {
            return;
        }
        const m = MATERIAL[material] || MATERIAL.stone;
        const pitch = 0.85 + Math.random() * 0.3;
        let gain = m.gain, dur = m.dur;
        if (kind === "step") {
            gain *= 0.32;
            dur *= 0.8;
        } else if (kind === "dig") {
            gain *= 0.45;
            dur *= 0.7;
        } else if (kind === "break") {
            gain *= 1.1;
            dur *= 1.6;
        }
        this.noiseBurst(m.type, m.freq * pitch, m.q, dur, gain);
        if (m.crunch && kind !== "step") {
            this.noiseBurst("bandpass", 600 * pitch, 2, dur * 0.6, gain * 0.6, 0.04);
        }
        if (m.thump) {
            this.tone(m.thump * pitch, dur, gain * 0.5, "sine");
        }
        if (m.ping && kind === "break") {
            for (let i = 0; i < 4; i++) {
                this.tone(2000 + Math.random() * 2500, 0.18, 0.08, "sine", i * 0.03);
            }
        }
    }

    play(name, opts = {}) {
        if (!this.ctx) {
            return;
        }
        switch (name) {
            case "pop":
                this.tone(700 + Math.random() * 400, 0.07, 0.12, "sine", 0, 1300 + Math.random() * 300);
                break;
            case "click":
                this.tone(1100, 0.03, 0.1, "square");
                break;
            case "hurt":
                this.tone(240, 0.18, 0.35, "triangle", 0, 110);
                this.noiseBurst("lowpass", 500, 0.7, 0.12, 0.4);
                break;
            case "eat":
                this.noiseBurst("bandpass", 1300 + Math.random() * 600, 1.5, 0.08, 0.45);
                this.noiseBurst("bandpass", 900, 1.2, 0.06, 0.3, 0.05);
                break;
            case "burp":
                this.tone(160, 0.22, 0.3, "sawtooth", 0, 90);
                break;
            case "splash": {
                const f = this.noiseBurst("lowpass", 2400, 0.6, 0.45, 0.5);
                f.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.4);
                break;
            }
            case "paddle": {
                const f = this.noiseBurst("lowpass", 1300, 0.7, 0.3, 0.16);
                f.frequency.exponentialRampToValueAtTime(260, this.ctx.currentTime + 0.28);
                break;
            }
            case "toolBreak":
                this.tone(900, 0.2, 0.2, "square", 0, 300);
                this.noiseBurst("highpass", 3000, 0.5, 0.2, 0.3);
                break;
            case "thunder": {
                const dist = opts.distance || 0;
                const near = Math.max(0.15, 1 - dist / 80);
                const delay = Math.min(3, dist / 40);
                if (dist < 24) {
                    this.noiseBurst("highpass", 1500, 0.4, 0.25, 0.6 * near, delay);
                }
                const len = 3 + Math.random() * 2;
                const f = this.noiseBurst("lowpass", 260 + near * 300, 0.5, len, 1.2 * near, delay, this.brown);
                f.frequency.exponentialRampToValueAtTime(90, this.ctx.currentTime + delay + len);
                this.noiseBurst("lowpass", 160, 0.5, len * 0.8, 0.9 * near, delay + 0.4 + Math.random() * 0.5, this.brown);
                break;
            }
            case "piston":
                this.noiseBurst("lowpass", opts.out ? 900 : 600, 0.8, 0.14, 0.45);
                this.tone(opts.out ? 220 : 150, 0.1, 0.25, "triangle");
                break;
            case "bow":
                this.tone(320, 0.18, 0.25, "triangle", 0, 140);
                this.noiseBurst("bandpass", 1800, 2, 0.08, 0.2);
                break;
            case "hit":
                this.noiseBurst("lowpass", 900, 0.8, 0.09, 0.5);
                this.tone(140, 0.08, 0.3, "sine");
                break;
            case "fizz":
                this.noiseBurst("highpass", 4000, 0.5, 0.3, 0.2);
                break;
            default:
                break;
        }
    }

    startRain() {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 500;
        this.rainLp = ctx.createBiquadFilter();
        this.rainLp.type = "lowpass";
        this.rainLp.frequency.value = 6000;
        this.rainGain = ctx.createGain();
        this.rainGain.gain.value = 0;
        src.connect(hp).connect(this.rainLp).connect(this.rainGain).connect(this.master);
        src.start();
    }

    //level 0-1, muffled when the player is under a roof
    setRain(level, muffled) {
        if (!this.rainGain) {
            return;
        }
        const t = this.ctx.currentTime;
        this.rainGain.gain.setTargetAtTime(level * 0.22, t, 0.4);
        this.rainLp.frequency.setTargetAtTime(muffled ? 900 : 6000, t, 0.4);
    }
}
