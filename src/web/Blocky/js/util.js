/*
    Blocky - util.js

    Small shared helpers: seeded random numbers, integer hashing, maths and
    base64 / run-length encoding used by the save format.
*/

//Seeded 32 bit PRNG (mulberry32). Returns a function giving [0, 1).
export function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

//Integer hash of (seed, x, z) to an unsigned 32 bit value
export function hash2(seed, x, z) {
    let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

export function hash3(seed, x, y, z) {
    return hash2(hash2(seed, x, z), y, 0x5bd1e995);
}

//Turn whatever the player typed in the seed box into a 32 bit seed
export function seedFromString(text) {
    const s = String(text || "").trim();
    if (s === "") {
        return (Math.random() * 4294967296) | 0;
    }
    if (/^-?\d{1,10}$/.test(s)) {
        return Number(s) | 0;
    }
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return h;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}

//Numeric key for a chunk coordinate pair (Map lookups on numbers are cheap)
export function chunkKey(cx, cz) {
    return (cx + 32768) * 65536 + (cz + 32768);
}

export function keyToChunk(key) {
    return [Math.floor(key / 65536) - 32768, (key % 65536) - 32768];
}

/* ---------- Byte helpers for the save format ---------- */

export function bytesToBase64(bytes) {
    let out = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(out);
}

export function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

//Run-length encode two parallel byte arrays (block id + meta) as
//[run length (1-255), id, meta] triples.
export function rleEncode(a, b) {
    const n = a.length;
    const out = new Uint8Array(n * 3);
    let o = 0;
    let i = 0;
    while (i < n) {
        const va = a[i];
        const vb = b[i];
        let run = 1;
        while (i + run < n && run < 255 && a[i + run] === va && b[i + run] === vb) {
            run++;
        }
        out[o++] = run;
        out[o++] = va;
        out[o++] = vb;
        i += run;
    }
    return out.slice(0, o);
}

export function rleDecode(bytes, a, b) {
    let p = 0;
    for (let i = 0; i + 2 < bytes.length; i += 3) {
        const run = bytes[i];
        const va = bytes[i + 1];
        const vb = bytes[i + 2];
        for (let k = 0; k < run && p < a.length; k++, p++) {
            a[p] = va;
            b[p] = vb;
        }
    }
}

//Deflate / inflate a string when the browser has CompressionStream
export async function deflateString(text) {
    const input = new TextEncoder().encode(text);
    if (typeof CompressionStream === "undefined") {
        return { encoding: "plain", data: bytesToBase64(input) };
    }
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("deflate"));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return { encoding: "deflate", data: bytesToBase64(buf) };
}

export async function inflateString(encoding, b64) {
    const bytes = base64ToBytes(b64);
    if (encoding !== "deflate") {
        return new TextDecoder().decode(bytes);
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return await new Response(stream).text();
}

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[c]);
}
