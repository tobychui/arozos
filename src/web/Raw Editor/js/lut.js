/*
    lut.js — Adobe/IRIDAS .cube LUT parser for the Raw Editor.

    Parses both 1D and 3D .cube LUTs into a flat RGB Float32Array laid out for
    upload into a WebGL2 3D texture (R fastest, then G, then B — the .cube spec
    order). A 1D LUT is expanded into an identity-mapped 3D texture so the WebGL
    pipeline only ever needs a single sampler.
*/

const LUTParser = (function () {

    // Parse .cube text -> { size, data: Float32Array(size^3 * 3), title, domainMin, domainMax }
    function parse(text) {
        const lines = text.split(/\r?\n/);
        let size3d = 0, size1d = 0;
        let domainMin = [0, 0, 0], domainMax = [1, 1, 1];
        let title = "";
        const values = [];

        for (let raw of lines) {
            const line = raw.trim();
            if (!line || line[0] === "#") continue;
            const upper = line.toUpperCase();
            if (upper.startsWith("TITLE")) {
                const m = line.match(/"([^"]*)"/);
                title = m ? m[1] : "";
                continue;
            }
            if (upper.startsWith("LUT_3D_SIZE")) { size3d = parseInt(line.split(/\s+/)[1], 10); continue; }
            if (upper.startsWith("LUT_1D_SIZE")) { size1d = parseInt(line.split(/\s+/)[1], 10); continue; }
            if (upper.startsWith("DOMAIN_MIN")) { const p = line.split(/\s+/); domainMin = [+p[1], +p[2], +p[3]]; continue; }
            if (upper.startsWith("DOMAIN_MAX")) { const p = line.split(/\s+/); domainMax = [+p[1], +p[2], +p[3]]; continue; }
            if (upper.startsWith("LUT_")) continue;

            const parts = line.split(/\s+/).map(Number);
            if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
                values.push(parts[0], parts[1], parts[2]);
            }
        }

        if (size3d > 0) {
            const expected = size3d * size3d * size3d * 3;
            if (values.length < expected) {
                throw new Error("Truncated 3D LUT: expected " + expected + " values, got " + values.length);
            }
            return { size: size3d, data: new Float32Array(values.slice(0, expected)), title: title, domainMin: domainMin, domainMax: domainMax };
        }

        if (size1d > 0) {
            if (values.length < size1d * 3) throw new Error("Truncated 1D LUT");
            return expand1Dto3D(values, size1d, title, domainMin, domainMax);
        }

        throw new Error("Not a valid .cube LUT (missing LUT_3D_SIZE / LUT_1D_SIZE).");
    }

    // Expand a 1D curve LUT into a small 3D texture (per-channel transfer).
    function expand1Dto3D(values, n1d, title, domainMin, domainMax) {
        const size = Math.min(n1d, 33);
        const data = new Float32Array(size * size * size * 3);
        function curve(ch, t) {
            const x = t * (n1d - 1);
            const i0 = Math.floor(x), i1 = Math.min(n1d - 1, i0 + 1);
            const f = x - i0;
            const a = values[i0 * 3 + ch], b = values[i1 * 3 + ch];
            return a + (b - a) * f;
        }
        let p = 0;
        for (let b = 0; b < size; b++) {
            for (let g = 0; g < size; g++) {
                for (let r = 0; r < size; r++) {
                    data[p++] = curve(0, r / (size - 1));
                    data[p++] = curve(1, g / (size - 1));
                    data[p++] = curve(2, b / (size - 1));
                }
            }
        }
        return { size: size, data: data, title: title, domainMin: domainMin, domainMax: domainMax };
    }

    return { parse: parse };
})();
