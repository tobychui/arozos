/*
    3D Modeler - drawing as a PNG image

    Draws one sheet of drawing primitives (drawing/layout.js) on a canvas at
    the sheet's resolution (dpi), white paper and black lines, and stores
    that resolution in the file (a pHYs chunk), so an image editor or a
    printer takes it at its true size.
*/

import { LAYERS } from '../drawing/layout.js';
import { fontSize } from '../drawing/font.js';
import { pixelSize } from '../drawing/sheet.js';
import { FONT_FAMILY } from './drawsvg.js';

// Browsers refuse canvases much larger than this
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 120 * 1000 * 1000;

let crcTable = null;

function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// The PNG with a pHYs chunk (pixels per metre) after its header
export function withResolution(png, dpi) {
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(4 + 4 + 9 + 4);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
    view.setUint32(8, ppm);
    view.setUint32(12, ppm);
    chunk[16] = 1; // the unit is the metre
    view.setUint32(17, crc32(chunk.subarray(4, 17)));
    // The header chunk: 8 byte signature, then length 13 + type + data + crc
    const at = 8 + 4 + 4 + 13 + 4;
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, at), 0);
    out.set(chunk, at);
    out.set(png.subarray(at), at + chunk.length);
    return out;
}

// Is a sheet small enough to draw at its resolution? null or the reason
export function sizeProblem(sheet) {
    const px = pixelSize(sheet);
    if (px[0] > MAX_SIDE || px[1] > MAX_SIDE || px[0] * px[1] > MAX_PIXELS) {
        return 'At ' + sheet.dpi + ' dpi the image would be ' + px[0] + ' x ' + px[1] + ' pixels, more than a browser can draw. Lower the resolution in Sheet Setup.';
    }
    return null;
}

function draw(ctx, groups, H) {
    const P = function (p) {
        return [p[0], H - p[1]];
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    const stroke = function (layer) {
        const st = LAYERS[layer] || LAYERS.thin;
        ctx.lineWidth = st.width;
        ctx.setLineDash(st.dash || []);
        ctx.stroke();
    };
    groups.forEach(function (g) {
        g.items.forEach(function (it) {
            ctx.beginPath();
            if (it.t === 'line') {
                ctx.moveTo.apply(ctx, P(it.a));
                ctx.lineTo.apply(ctx, P(it.b));
                stroke(it.layer);
            } else if (it.t === 'poly' || it.t === 'fill') {
                it.pts.forEach(function (p, i) {
                    const q = P(p);
                    if (i) {
                        ctx.lineTo(q[0], q[1]);
                    } else {
                        ctx.moveTo(q[0], q[1]);
                    }
                });
                if (it.closed || it.t === 'fill') {
                    ctx.closePath();
                }
                if (it.t === 'fill') {
                    ctx.fill();
                } else {
                    stroke(it.layer);
                }
            } else if (it.t === 'circle') {
                const c = P(it.c);
                ctx.arc(c[0], c[1], it.r, 0, 2 * Math.PI);
                if (it.filled) {
                    ctx.fill();
                } else {
                    stroke(it.layer);
                }
            } else if (it.t === 'arc') {
                // y is flipped: counter-clockwise on paper is anticlockwise here
                const c = P(it.c);
                ctx.arc(c[0], c[1], it.r, -it.a0, -(it.a0 + it.sweep), true);
                stroke(it.layer);
            } else if (it.t === 'text') {
                const p = P(it.p);
                ctx.save();
                ctx.translate(p[0], p[1]);
                ctx.rotate(-(it.rot || 0) * Math.PI / 180);
                ctx.font = fontSize(it.h) + 'px ' + FONT_FAMILY;
                ctx.textAlign = it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(it.text, 0, 0);
                ctx.restore();
            }
        });
    });
}

// Resolves to the PNG file as a Uint8Array
export function toPNG(groups, sheet) {
    const problem = sizeProblem(sheet);
    if (problem) {
        return Promise.reject(new Error(problem));
    }
    const px = pixelSize(sheet);
    const canvas = document.createElement('canvas');
    canvas.width = px[0];
    canvas.height = px[1];
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px[0], px[1]);
    ctx.scale(px[0] / sheet.width, px[1] / sheet.height);
    draw(ctx, groups, sheet.height);
    return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
            if (!blob) {
                reject(new Error('The image could not be made'));
                return;
            }
            blob.arrayBuffer().then(function (buffer) {
                resolve(withResolution(new Uint8Array(buffer), sheet.dpi));
            }, reject);
        }, 'image/png');
    });
}
