/*
    Audio Studio - effects.js

    Offline audio effect processors. Every effect takes an AudioBuffer and
    returns a NEW AudioBuffer (never mutates the input), so the project's
    undo system keeps working. All DSP is done in the front end; no backend
    round-trip is needed.

    Depends on ASEngine (for the shared AudioContext used to allocate
    output buffers).
*/

var ASEffects = (function () {
    "use strict";

    function ctx() {
        return ASEngine.getContext();
    }

    function newBufferLike(buffer, length) {
        return ctx().createBuffer(buffer.numberOfChannels, Math.max(1, length), buffer.sampleRate);
    }

    //Apply fn(Float32Array in, Float32Array out, sampleRate, channelIndex)
    //to every channel; output buffer has the same length as the input
    function perChannel(buffer, fn) {
        var out = newBufferLike(buffer, buffer.length);
        for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
            fn(buffer.getChannelData(ch), out.getChannelData(ch), buffer.sampleRate, ch);
        }
        return out;
    }

    /* ---------- Simple gain based effects ---------- */

    function fadeIn(buffer) {
        var n = buffer.length;
        return perChannel(buffer, function (src, dst) {
            for (var i = 0; i < n; i++) {
                dst[i] = src[i] * (i / n);
            }
        });
    }

    function fadeOut(buffer) {
        var n = buffer.length;
        return perChannel(buffer, function (src, dst) {
            for (var i = 0; i < n; i++) {
                dst[i] = src[i] * (1 - i / n);
            }
        });
    }

    function invert(buffer) {
        return perChannel(buffer, function (src, dst) {
            for (var i = 0; i < src.length; i++) {
                dst[i] = -src[i];
            }
        });
    }

    function normalize(buffer, params) {
        var targetDb = params.targetDb;
        var peak = 0;
        var ch, i;
        for (ch = 0; ch < buffer.numberOfChannels; ch++) {
            var d = buffer.getChannelData(ch);
            for (i = 0; i < d.length; i++) {
                var v = Math.abs(d[i]);
                if (v > peak) { peak = v; }
            }
        }
        if (peak < 0.000001) {
            return perChannel(buffer, function (src, dst) { dst.set(src); });
        }
        var scale = Math.pow(10, targetDb / 20) / peak;
        return perChannel(buffer, function (src, dst) {
            for (var j = 0; j < src.length; j++) {
                dst[j] = src[j] * scale;
            }
        });
    }

    /* ---------- Echo & echo removal ---------- */

    //Feedback comb filter: out[n] = in[n] + decay * out[n - D]
    function echo(buffer, params) {
        var D = Math.max(1, Math.round(params.delayMs / 1000 * buffer.sampleRate));
        var decay = params.decay;
        return perChannel(buffer, function (src, dst) {
            for (var i = 0; i < src.length; i++) {
                dst[i] = src[i] + (i >= D ? decay * dst[i - D] : 0);
            }
        });
    }

    //Exact inverse of the echo above: out[n] = in[n] - decay * in[n - D].
    //Use the same delay / decay values that were used to add the echo.
    function echoRemoval(buffer, params) {
        var D = Math.max(1, Math.round(params.delayMs / 1000 * buffer.sampleRate));
        var decay = params.decay;
        return perChannel(buffer, function (src, dst) {
            for (var i = 0; i < src.length; i++) {
                dst[i] = src[i] - (i >= D ? decay * src[i - D] : 0);
            }
        });
    }

    /* ---------- Speed (resample; changes duration) ---------- */

    function speed(buffer, params) {
        var factor = params.percent / 100;
        var newLen = Math.max(1, Math.round(buffer.length / factor));
        var out = newBufferLike(buffer, newLen);
        for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
            var src = buffer.getChannelData(ch);
            var dst = out.getChannelData(ch);
            for (var i = 0; i < newLen; i++) {
                var pos = i * factor;
                var i0 = Math.floor(pos);
                var frac = pos - i0;
                var a = src[Math.min(i0, src.length - 1)];
                var b = src[Math.min(i0 + 1, src.length - 1)];
                dst[i] = a + (b - a) * frac;
            }
        }
        return out;
    }

    /* ---------- Phaser ---------- */

    function phaser(buffer, params) {
        var rate = params.rate;         //LFO speed in Hz
        var depth = params.depth;       //0..1 sweep width
        var feedback = params.feedback; //0..0.9
        var STAGES = 4;
        var F_MIN = 220, F_MAX = 2200;
        return perChannel(buffer, function (src, dst, sr) {
            var xPrev = new Float32Array(STAGES);
            var yPrev = new Float32Array(STAGES);
            var fbSample = 0;
            for (var i = 0; i < src.length; i++) {
                var lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * i / sr);
                var f = F_MIN + (F_MAX - F_MIN) * lfo * depth;
                var t = Math.tan(Math.PI * f / sr);
                var a = (t - 1) / (t + 1);
                var x = src[i] + fbSample * feedback;
                for (var s = 0; s < STAGES; s++) {
                    var y = a * x + xPrev[s] - a * yPrev[s];
                    xPrev[s] = x;
                    yPrev[s] = y;
                    x = y;
                }
                fbSample = x;
                dst[i] = 0.5 * (src[i] + x);
            }
        });
    }

    /* ---------- Noise reduction (spectral gating) ---------- */

    //In-place iterative radix-2 FFT
    function fft(re, im, inverse) {
        var n = re.length;
        var i, j, bit, len;
        for (i = 1, j = 0; i < n; i++) {
            for (bit = n >> 1; j & bit; bit >>= 1) {
                j ^= bit;
            }
            j |= bit;
            if (i < j) {
                var tr = re[i]; re[i] = re[j]; re[j] = tr;
                var ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (len = 2; len <= n; len <<= 1) {
            var ang = 2 * Math.PI / len * (inverse ? 1 : -1);
            var wr = Math.cos(ang), wi = Math.sin(ang);
            for (i = 0; i < n; i += len) {
                var curR = 1, curI = 0;
                for (j = 0; j < len / 2; j++) {
                    var aR = re[i + j], aI = im[i + j];
                    var bR = re[i + j + len / 2] * curR - im[i + j + len / 2] * curI;
                    var bI = re[i + j + len / 2] * curI + im[i + j + len / 2] * curR;
                    re[i + j] = aR + bR;
                    im[i + j] = aI + bI;
                    re[i + j + len / 2] = aR - bR;
                    im[i + j + len / 2] = aI - bI;
                    var nR = curR * wr - curI * wi;
                    curI = curR * wi + curI * wr;
                    curR = nR;
                }
            }
        }
        if (inverse) {
            for (i = 0; i < n; i++) {
                re[i] /= n;
                im[i] /= n;
            }
        }
    }

    //Spectral gate: estimate the noise floor per frequency bin from the
    //quietest frames, then attenuate bins that stay near that floor.
    function noiseReduction(buffer, params) {
        var reduceDb = params.reductionDb;   //How hard gated bins are attenuated
        var sensDb = params.sensitivity;     //Threshold above the noise floor
        var N = 2048;
        var HOP = N / 2;
        var BINS = N / 2 + 1;
        var gateGain = Math.pow(10, -reduceDb / 20);
        var sensLin = Math.pow(10, sensDb / 20);

        //sqrt-Hann analysis + synthesis windows (COLA at 50% overlap)
        var win = new Float32Array(N);
        for (var i = 0; i < N; i++) {
            win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
        }

        return perChannel(buffer, function (src, dst) {
            var frameCount = Math.ceil(src.length / HOP) + 1;

            //Pass 1: sample up to 300 frames evenly to estimate the noise floor
            var sampleStep = Math.max(1, Math.floor(frameCount / 300));
            var sampled = [];
            var re = new Float32Array(N);
            var im = new Float32Array(N);
            var f, k, pos;
            for (f = 0; f < frameCount; f += sampleStep) {
                pos = f * HOP;
                var mags = new Float32Array(BINS);
                loadFrame(src, pos, re, im, win);
                fft(re, im, false);
                for (k = 0; k < BINS; k++) {
                    mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
                }
                sampled.push(mags);
            }
            //Noise floor = median of sampled magnitudes per bin (the median is
            //dominated by noise as long as noise is present most of the time)
            var floor = new Float32Array(BINS);
            var column = new Float32Array(sampled.length);
            var idxMed = Math.max(0, Math.floor(sampled.length * 0.5) - 1);
            for (k = 0; k < BINS; k++) {
                for (f = 0; f < sampled.length; f++) {
                    column[f] = sampled[f][k];
                }
                var sorted = Array.prototype.slice.call(column).sort(function (a, b) { return a - b; });
                floor[k] = sorted[idxMed];
            }

            //Pass 2: gate each frame and overlap-add the result.
            //The gate compares a temporally smoothed magnitude to the floor so
            //random frame-to-frame noise flicker cannot hold the gate open.
            var prevGain = new Float32Array(BINS);
            var magSmooth = new Float32Array(BINS);
            var gains = new Float32Array(BINS);
            for (k = 0; k < BINS; k++) { prevGain[k] = 1; }
            for (f = 0; f < frameCount; f++) {
                pos = f * HOP;
                loadFrame(src, pos, re, im, win);
                fft(re, im, false);
                for (k = 0; k < BINS; k++) {
                    var mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
                    magSmooth[k] = 0.6 * magSmooth[k] + 0.4 * mag;
                    var open = magSmooth[k] > floor[k] * sensLin;
                    var target = open ? 1 : gateGain;
                    //Fast attack, slow release: real signal opens the gate
                    //immediately, then it closes gradually (no chopped tails)
                    var g = target >= prevGain[k] ? target : Math.max(target, prevGain[k] * 0.6);
                    gains[k] = g;
                    prevGain[k] = g;
                }
                //Mild smoothing across neighbouring bins
                for (k = 1; k < BINS - 1; k++) {
                    var gs = (gains[k - 1] + gains[k] * 2 + gains[k + 1]) / 4;
                    applyBinGain(re, im, k, N, gs);
                }
                applyBinGain(re, im, 0, N, gains[0]);
                applyBinGain(re, im, BINS - 1, N, gains[BINS - 1]);
                fft(re, im, true);
                for (i = 0; i < N; i++) {
                    var oi = pos + i;
                    if (oi < dst.length) {
                        dst[oi] += re[i] * win[i];
                    }
                }
            }
        });

        function loadFrame(src, pos, re, im, win) {
            for (var i = 0; i < N; i++) {
                var si = pos + i;
                re[i] = si < src.length ? src[si] * win[i] : 0;
                im[i] = 0;
            }
        }

        function applyBinGain(re, im, k, n, g) {
            re[k] *= g;
            im[k] *= g;
            var mirror = n - k;
            if (k > 0 && mirror < n && mirror !== k) {
                re[mirror] *= g;
                im[mirror] *= g;
            }
        }
    }

    /* ---------- Effect registry ---------- */

    var EFFECTS = [
        {
            id: "noisereduction",
            label: "Noise reduction",
            hint: "Estimates the noise floor from the quietest parts and gates it out.",
            lengthChanging: false,
            params: [
                { id: "reductionDb", label: "Reduction", min: 3, max: 36, step: 1, def: 12, unit: "dB" },
                { id: "sensitivity", label: "Sensitivity", min: 0, max: 24, step: 1, def: 6, unit: "dB" }
            ],
            process: noiseReduction
        },
        {
            id: "normalize",
            label: "Normalize",
            hint: "Scales the audio so its loudest peak hits the target level.",
            lengthChanging: false,
            params: [
                { id: "targetDb", label: "Peak", min: -24, max: 0, step: 0.5, def: -1, unit: "dB" }
            ],
            process: normalize
        },
        {
            id: "echo",
            label: "Echo",
            hint: "Adds repeating echoes after the original sound.",
            lengthChanging: false,
            params: [
                { id: "delayMs", label: "Delay", min: 20, max: 2000, step: 10, def: 300, unit: "ms" },
                { id: "decay", label: "Decay", min: 0.05, max: 0.9, step: 0.05, def: 0.4, unit: "" }
            ],
            process: echo
        },
        {
            id: "echoremoval",
            label: "Echo removal",
            hint: "Removes an echo added with the Echo effect. Use the same delay and decay values.",
            lengthChanging: false,
            params: [
                { id: "delayMs", label: "Delay", min: 20, max: 2000, step: 10, def: 300, unit: "ms" },
                { id: "decay", label: "Decay", min: 0.05, max: 0.9, step: 0.05, def: 0.4, unit: "" }
            ],
            process: echoRemoval
        },
        {
            id: "speed",
            label: "Change speed",
            hint: "Speeds up or slows down the audio (pitch changes with it).",
            lengthChanging: true,
            params: [
                { id: "percent", label: "Speed", min: 25, max: 400, step: 5, def: 100, unit: "%" }
            ],
            process: speed
        },
        {
            id: "phaser",
            label: "Phaser",
            hint: "Classic sweeping phaser modulation.",
            lengthChanging: false,
            params: [
                { id: "rate", label: "Rate", min: 0.1, max: 5, step: 0.1, def: 0.5, unit: "Hz" },
                { id: "depth", label: "Depth", min: 0.1, max: 1, step: 0.05, def: 0.7, unit: "" },
                { id: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.05, def: 0.5, unit: "" }
            ],
            process: phaser
        },
        {
            id: "fadein",
            label: "Fade in",
            hint: "Ramps the volume up from silence across the range.",
            lengthChanging: false,
            params: [],
            process: fadeIn
        },
        {
            id: "fadeout",
            label: "Fade out",
            hint: "Ramps the volume down to silence across the range.",
            lengthChanging: false,
            params: [],
            process: fadeOut
        },
        {
            id: "invert",
            label: "Invert",
            hint: "Flips the waveform polarity (useful for phase cancellation).",
            lengthChanging: false,
            params: [],
            process: invert
        }
    ];

    function getEffects() {
        return EFFECTS;
    }

    function getEffect(id) {
        return EFFECTS.find(function (e) { return e.id === id; }) || null;
    }

    //Run an effect over a buffer with a params object; returns a new buffer
    function apply(effectId, buffer, params) {
        var effect = getEffect(effectId);
        if (effect === null) {
            throw new Error("Unknown effect: " + effectId);
        }
        return effect.process(buffer, params || {});
    }

    return {
        getEffects: getEffects,
        getEffect: getEffect,
        apply: apply
    };
})();
