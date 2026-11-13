/*
    3D Modeler - drawing as PDF

    A small PDF writer for one sheet of drawing primitives (drawing/
    layout.js): vector lines, arcs (as Bezier curves), filled arrow heads
    and text, at the sheet's true size, so it prints 1:1.

    The page is drawn in millimetres: the content stream starts by scaling
    PDF points (1/72 in) to mm, so primitives go in unchanged (y up in both).

    Text uses Helvetica, one of the fonts every PDF reader carries, so no
    font file is put in the PDF. It can only write the Latin-1 letters of
    the WinAnsi encoding; a text with other letters (Chinese, Japanese, ...)
    is handed to opts.rasterize, which returns it drawn as a 1-bit image
    (the browser draws it with its own fonts), placed where the text goes.
    Without rasterize such letters become "?".
*/

import { LAYERS } from '../drawing/layout.js';
import { fontSize, textWidth } from '../drawing/font.js';

const PT = 72 / 25.4;   // points per mm

function f(v) {
    const r = Math.round(v * 1000) / 1000;
    return String(r === 0 ? 0 : r);
}

function winAnsi(text) {
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (!((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255))) {
            return false;
        }
    }
    return true;
}

// A PDF string literal of Latin-1 text
function pdfString(text) {
    let out = '(';
    for (const ch of text) {
        let cp = ch.codePointAt(0);
        if (cp > 255) {
            cp = 63; // ?
        }
        if (ch === '(' || ch === ')' || ch === '\\') {
            out += '\\' + ch;
        } else if (cp < 32 || cp > 126) {
            out += '\\' + cp.toString(8).padStart(3, '0');
        } else {
            out += ch;
        }
    }
    return out + ')';
}

// Bezier segments of an arc, at most a quarter turn each
function arcPath(c, r, a0, sweep, move) {
    const parts = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
    const step = sweep / parts;
    const k = 4 / 3 * Math.tan(step / 4);
    let out = '';
    for (let i = 0; i < parts; i++) {
        const t1 = a0 + i * step;
        const t2 = t1 + step;
        const p0 = [c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1)];
        const p3 = [c[0] + r * Math.cos(t2), c[1] + r * Math.sin(t2)];
        const p1 = [p0[0] - k * r * Math.sin(t1), p0[1] + k * r * Math.cos(t1)];
        const p2 = [p3[0] + k * r * Math.sin(t2), p3[1] - k * r * Math.cos(t2)];
        if (i === 0 && move) {
            out += f(p0[0]) + ' ' + f(p0[1]) + ' m\n';
        }
        out += [p1, p2, p3].map(function (p) {
            return f(p[0]) + ' ' + f(p[1]);
        }).join(' ') + ' c\n';
    }
    return out;
}

function latin1(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        out[i] = text.charCodeAt(i) & 255;
    }
    return out;
}

/*
    groups: layout.build() output; sheet: the drawing's sheet
    opts.title: document title; opts.rasterize(text, h): see the header
    Returns the PDF file as a Uint8Array.
*/
export function toPDF(groups, sheet, opts) {
    const options = opts || {};
    const W = sheet.width;
    const H = sheet.height;
    const images = [];
    let cs = 'q\n' + f(PT) + ' 0 0 ' + f(PT) + ' 0 0 cm\n1 J 1 j 0 G 0 g\n';
    let lastLayer = null;
    const setLayer = function (layer) {
        if (layer === lastLayer) {
            return;
        }
        lastLayer = layer;
        const st = LAYERS[layer] || LAYERS.thin;
        cs += f(st.width) + ' w [' + (st.dash || []).map(f).join(' ') + '] 0 d\n';
    };
    const P = function (p) {
        return f(p[0]) + ' ' + f(p[1]);
    };
    groups.forEach(function (g) {
        g.items.forEach(function (it) {
            if (it.t === 'line') {
                setLayer(it.layer);
                cs += P(it.a) + ' m ' + P(it.b) + ' l S\n';
            } else if (it.t === 'poly') {
                setLayer(it.layer);
                cs += it.pts.map(function (p, i) {
                    return P(p) + (i ? ' l' : ' m');
                }).join('\n') + (it.closed ? ' h S\n' : ' S\n');
            } else if (it.t === 'fill') {
                cs += it.pts.map(function (p, i) {
                    return P(p) + (i ? ' l' : ' m');
                }).join(' ') + ' h f\n';
            } else if (it.t === 'circle') {
                if (!it.filled) {
                    setLayer(it.layer);
                }
                cs += arcPath(it.c, it.r, 0, 2 * Math.PI, true) + (it.filled ? 'h f\n' : 'h S\n');
            } else if (it.t === 'arc') {
                setLayer(it.layer);
                cs += arcPath(it.c, it.r, it.a0, Math.min(it.sweep, 2 * Math.PI), true) + 'S\n';
            } else if (it.t === 'text') {
                const r = (it.rot || 0) * Math.PI / 180;
                const cos = Math.cos(r);
                const sin = Math.sin(r);
                const raster = !winAnsi(it.text) && options.rasterize ? options.rasterize(it.text, it.h) : null;
                const w = raster ? raster.mmWidth : textWidth(it.text, it.h);
                const shift = it.anchor === 'middle' ? -w / 2 : it.anchor === 'end' ? -w : 0;
                const x = it.p[0] + cos * shift;
                const y = it.p[1] + sin * shift;
                if (raster) {
                    // The image's bottom left corner sits below the baseline
                    const bx = x + sin * raster.mmBelow;
                    const by = y - cos * raster.mmBelow;
                    const name = '/Im' + (images.length + 1);
                    images.push(raster);
                    cs += 'q ' + [raster.mmWidth * cos, raster.mmWidth * sin, -raster.mmHeight * sin, raster.mmHeight * cos, bx, by].map(f).join(' ') + ' cm ' + name + ' Do Q\n';
                } else {
                    cs += 'BT /F1 ' + f(fontSize(it.h)) + ' Tf ' + [cos, sin, -sin, cos, x, y].map(f).join(' ') + ' Tm ' + pdfString(it.text) + ' Tj ET\n';
                }
            }
        });
    });
    cs += 'Q\n';

    // Objects: 1 catalog, 2 pages, 3 page, 4 font, 5 content, 6 info, 7.. images
    const chunks = [];
    const offsets = [];
    let size = 0;
    const put = function (data) {
        const bytes = typeof data === 'string' ? latin1(data) : data;
        chunks.push(bytes);
        size += bytes.length;
    };
    const object = function (num, body, stream) {
        offsets[num] = size;
        put(num + ' 0 obj\n' + body);
        if (stream) {
            put('\nstream\n');
            put(stream);
            put('\nendstream');
        }
        put('\nendobj\n');
    };
    const count = 6 + images.length;
    put('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    const xobjects = images.map(function (img, i) {
        return '/Im' + (i + 1) + ' ' + (7 + i) + ' 0 R';
    }).join(' ');
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(W * PT) + ' ' + f(H * PT) + '] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >>' +
        (images.length ? ' /XObject << ' + xobjects + ' >>' : '') + ' >> >>');
    object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const content = latin1(cs);
    object(5, '<< /Length ' + content.length + ' >>', content);
    const title = String(options.title || 'Drawing').replace(/[^\x20-\x7e]/g, '?');
    const now = new Date();
    const stamp = 'D:' + now.getUTCFullYear() + String(now.getUTCMonth() + 1).padStart(2, '0') + String(now.getUTCDate()).padStart(2, '0') +
        String(now.getUTCHours()).padStart(2, '0') + String(now.getUTCMinutes()).padStart(2, '0') + String(now.getUTCSeconds()).padStart(2, '0') + 'Z';
    object(6, '<< /Title ' + pdfString(title) + ' /Producer (ArozOS 3D Modeler) /CreationDate (' + stamp + ') >>');
    images.forEach(function (img, i) {
        object(7 + i, '<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
            ' /ImageMask true /BitsPerComponent 1 /Decode [1 0] /Length ' + img.bits.length + ' >>', img.bits);
    });
    const xref = size;
    let table = 'xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= count; i++) {
        table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    put(table + 'trailer\n<< /Size ' + (count + 1) + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(size);
    let at = 0;
    chunks.forEach(function (c) {
        out.set(c, at);
        at += c.length;
    });
    return out;
}

/*
    Draw a text with the browser's fonts into a 1-bit image for toPDF:
    { width, height, bits, mmWidth, mmHeight, mmBelow }. dpmm: dots per mm.
*/
export function rasterizeText(text, h, family, dpmm) {
    const dots = dpmm || 24;    // about 600 dpi
    const size = fontSize(h);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = Math.round(size * dots) + 'px ' + family;
    ctx.font = font;
    const m = ctx.measureText(text);
    const ascent = Math.ceil(m.actualBoundingBoxAscent || size * dots * 0.8) + 2;
    const descent = Math.ceil(m.actualBoundingBoxDescent || size * dots * 0.2) + 2;
    const width = Math.max(1, Math.ceil(m.width) + 2);
    const height = ascent + descent;
    canvas.width = width;
    canvas.height = height;
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, 1, ascent);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const rowBytes = Math.ceil(width / 8);
    const bits = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (pixels[(y * width + x) * 4] < 128) {
                bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }
    }
    return { width: width, height: height, bits: bits, mmWidth: width / dots, mmHeight: height / dots, mmBelow: descent / dots };
}
