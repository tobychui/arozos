/*
    3D Modeler - part appearance

    The look of a part: a colour and a finish (plastic, metal, wood, ...),
    stored in the part document as
        appearance: { color: "#rrggbb", texture: <finish id>, scale: <mm> }
    and shown wherever the part is: the part itself, the components of
    assemblies (with their component colour, the part's finish) and the 3D
    view of the drawing panel. Without one a part has the default grey.

    Finishes with a pattern draw it on a canvas here (no image files to
    ship): a light grey pattern the colour tints, one tile per `scale` mm,
    laid on the model by box projection (viewport.js gives the meshes
    texture coordinates in mm).
*/

export const DEFAULT_COLOR = '#bfc3c9';
export const DEFAULT_SCALE = 20;

// id, label, the material it gives, the colour it suggests, its pattern
export const FINISHES = [
    { id: 'plain', label: 'Plain', roughness: 0.62, metalness: 0.1 },
    { id: 'matte', label: 'Matte plastic', roughness: 0.9, metalness: 0 },
    { id: 'glossy', label: 'Glossy plastic', roughness: 0.22, metalness: 0 },
    { id: 'brushed', label: 'Brushed metal', roughness: 0.38, metalness: 0.55, pattern: 'brushed', color: '#c9cdd3' },
    { id: 'polished', label: 'Polished metal', roughness: 0.14, metalness: 0.65, color: '#d4d7dc' },
    { id: 'cast', label: 'Cast metal', roughness: 0.78, metalness: 0.35, pattern: 'speckle', color: '#9da3ab' },
    { id: 'wood', label: 'Wood', roughness: 0.72, metalness: 0, pattern: 'wood', color: '#c08a52' },
    { id: 'carbon', label: 'Carbon fibre', roughness: 0.32, metalness: 0.15, pattern: 'weave', color: '#3a3d43' },
    { id: 'rubber', label: 'Rubber', roughness: 0.95, metalness: 0, pattern: 'fine', color: '#34373c' },
    { id: 'glass', label: 'Glass', roughness: 0.05, metalness: 0, opacity: 0.35, color: '#bcd7e6' }
];

export function finishById(id) {
    return FINISHES.filter(function (f) {
        return f.id === id;
    })[0] || FINISHES[0];
}

// A clean appearance record, or null for the default look
export function normalizeAppearance(a) {
    if (!a || typeof a !== 'object') {
        return null;
    }
    const color = /^#[0-9a-f]{6}$/i.test(a.color) ? a.color.toLowerCase() : DEFAULT_COLOR;
    const texture = finishById(a.texture).id;
    const scale = typeof a.scale === 'number' && isFinite(a.scale) && a.scale >= 0.5 && a.scale <= 5000 ? a.scale : DEFAULT_SCALE;
    if (color === DEFAULT_COLOR && texture === 'plain' && scale === DEFAULT_SCALE) {
        return null;
    }
    return { color: color, texture: texture, scale: scale };
}

/* ================= patterns ================= */
// A small repeatable random generator, so a pattern is the same every time
function random(seed) {
    let s = seed >>> 0;
    return function () {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function gray(v) {
    const c = Math.max(0, Math.min(255, Math.round(v)));
    return 'rgb(' + c + ',' + c + ',' + c + ')';
}

// Draw a pattern on a square canvas of `size` pixels. Every pattern wraps
// round at its edges, so tiles join without a seam.
export function drawPattern(ctx, size, pattern) {
    const rnd = random(1234567);
    ctx.fillStyle = gray(225);
    ctx.fillRect(0, 0, size, size);
    if (pattern === 'brushed') {
        // Fine streaks along one direction
        for (let i = 0; i < size * 3; i++) {
            const y = rnd() * size;
            const x = rnd() * size;
            const len = size * (0.2 + rnd() * 0.6);
            ctx.strokeStyle = gray(190 + rnd() * 65);
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 0.6 + rnd();
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + len, y);
            ctx.stroke();
            if (x + len > size) {
                ctx.beginPath();
                ctx.moveTo(x - size, y);
                ctx.lineTo(x + len - size, y);
                ctx.stroke();
            }
        }
    } else if (pattern === 'speckle' || pattern === 'fine') {
        const count = pattern === 'fine' ? size * size / 6 : size * size / 14;
        const r = pattern === 'fine' ? 0.7 : 1.3;
        for (let i = 0; i < count; i++) {
            ctx.fillStyle = gray(160 + rnd() * 95);
            ctx.globalAlpha = 0.55;
            ctx.fillRect(rnd() * size, rnd() * size, r + rnd() * r, r + rnd() * r);
        }
    } else if (pattern === 'wood') {
        // Growth rings: bands along the tile, bent by a slow wave
        const img = ctx.getImageData(0, 0, size, size);
        const phase = [rnd() * 6.28, rnd() * 6.28];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const t = (x / size) * 2 * Math.PI;
                const bend = Math.sin((y / size) * 2 * Math.PI + phase[0]) * 2.2 + Math.sin((y / size) * 4 * Math.PI + phase[1]) * 0.8;
                const ring = 0.5 + 0.5 * Math.sin(t * 3 + bend);
                const v = 175 + 80 * Math.pow(ring, 0.8);
                const k = (y * size + x) * 4;
                img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
                img.data[k + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    } else if (pattern === 'weave') {
        // A 2 x 2 twill of tows, each lit across its width
        const n = 8;
        const cell = size / n;
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const across = ((i + j) >> 1) % 2 === 0;
                const grad = across ? ctx.createLinearGradient(0, j * cell, 0, (j + 1) * cell) : ctx.createLinearGradient(i * cell, 0, (i + 1) * cell, 0);
                grad.addColorStop(0, gray(120));
                grad.addColorStop(0.5, gray(240));
                grad.addColorStop(1, gray(120));
                ctx.fillStyle = grad;
                ctx.globalAlpha = 1;
                ctx.fillRect(i * cell, j * cell, cell, cell);
            }
        }
    }
    ctx.globalAlpha = 1;
}
