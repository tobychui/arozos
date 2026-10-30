/*
    Blocky - noise.js

    Seeded 2D / 3D simplex noise (after Stefan Gustavson's public domain
    reference) plus fractal helpers used by the terrain generator.
*/

import { mulberry32 } from "./util.js";

const GRAD3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

export class Noise {
    constructor(seed) {
        const rng = mulberry32(seed);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const t = p[i];
            p[i] = p[j];
            p[j] = t;
        }
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        for (let i = 0; i < 512; i++) {
            this.perm[i] = p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }
    }

    noise2(xin, yin) {
        const perm = this.perm;
        const pm = this.permMod12;
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);
        let i1, j1;
        if (x0 > y0) {
            i1 = 1; j1 = 0;
        } else {
            i1 = 0; j1 = 1;
        }
        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2;
        const y2 = y0 - 1 + 2 * G2;
        const ii = i & 255;
        const jj = j & 255;
        let n0 = 0, n1 = 0, n2 = 0;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 > 0) {
            const g = pm[ii + perm[jj]] * 3;
            t0 *= t0;
            n0 = t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0);
        }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 > 0) {
            const g = pm[ii + i1 + perm[jj + j1]] * 3;
            t1 *= t1;
            n1 = t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1);
        }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 > 0) {
            const g = pm[ii + 1 + perm[jj + 1]] * 3;
            t2 *= t2;
            n2 = t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2);
        }
        return 70 * (n0 + n1 + n2);
    }

    noise3(xin, yin, zin) {
        const perm = this.perm;
        const pm = this.permMod12;
        const s = (xin + yin + zin) * F3;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const k = Math.floor(zin + s);
        const t = (i + j + k) * G3;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);
        const z0 = zin - (k - t);
        let i1, j1, k1, i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0) {
                i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
            } else if (x0 >= z0) {
                i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
            } else {
                i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
            }
        } else {
            if (y0 < z0) {
                i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
            } else if (x0 < z0) {
                i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
            } else {
                i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
            }
        }
        const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
        const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
        const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
        const ii = i & 255, jj = j & 255, kk = k & 255;
        let n = 0;
        let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
        if (t0 > 0) {
            const g = pm[ii + perm[jj + perm[kk]]] * 3;
            t0 *= t0;
            n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
        }
        let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
        if (t1 > 0) {
            const g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
            t1 *= t1;
            n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
        }
        let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
        if (t2 > 0) {
            const g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
            t2 *= t2;
            n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
        }
        let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
        if (t3 > 0) {
            const g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
            t3 *= t3;
            n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
        }
        return 32 * n;
    }

    //Fractal sum normalised to roughly [-1, 1]
    fbm2(x, y, octaves, lacunarity = 2, gain = 0.5) {
        let amp = 1, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < octaves; o++) {
            sum += this.noise2(x * freq, y * freq) * amp;
            norm += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / norm;
    }

    fbm3(x, y, z, octaves, lacunarity = 2, gain = 0.5) {
        let amp = 1, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < octaves; o++) {
            sum += this.noise3(x * freq, y * freq, z * freq) * amp;
            norm += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / norm;
    }
}
