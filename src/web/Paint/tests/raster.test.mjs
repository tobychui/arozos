/*
    Flood fill, BMP encoding, line rasterising, colour helpers and
    rectangle helpers (js/raster.js).
    Run with: node tests/run.mjs raster
*/
import {
    floodFill, encodeBMP, bresenham, hasTransparency, invertPixels, grayscalePixels,
    parseHex, toHex, anchorOffset, normRect, unionRect, clipRect, pointInPolygon
} from '../js/raster.js';

let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};

// w x h image filled with one colour
function image(w, h, rgba) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        d.set(rgba, i * 4);
    }
    return d;
}
function px(d, w, x, y) {
    return Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
}
function set(d, w, x, y, rgba) {
    d.set(rgba, (y * w + x) * 4);
}

const WHITE = [255, 255, 255, 255], BLACK = [0, 0, 0, 255], RED = [255, 0, 0, 255], CLEAR = [0, 0, 0, 0];

/* ---------- flood fill ---------- */
{
    // A 10 x 10 white image split by a black vertical wall at x = 5
    const w = 10, h = 10;
    const d = image(w, h, WHITE);
    for (let y = 0; y < h; y++) {
        set(d, w, 5, y, BLACK);
    }
    const r = floodFill(d, w, h, 1, 1, RED, 0);
    a(r && r.x === 0 && r.y === 0 && r.w === 5 && r.h === 10, 'fill stops at the wall', r);
    a(px(d, w, 4, 9).join() === RED.join(), 'left side filled');
    a(px(d, w, 5, 3).join() === BLACK.join(), 'wall untouched');
    a(px(d, w, 6, 3).join() === WHITE.join(), 'right side untouched');
}
{
    // Tolerance: a near-white pixel joins only when the tolerance allows it
    const cases = [
        { tol: 0, filled: false },
        { tol: 4, filled: false },
        { tol: 5, filled: true },
        { tol: 60, filled: true }
    ];
    for (const c of cases) {
        const d = image(3, 1, WHITE);
        set(d, 3, 1, 0, [250, 250, 250, 255]);
        floodFill(d, 3, 1, 0, 0, RED, c.tol);
        a((px(d, 3, 1, 0).join() === RED.join()) === c.filled, 'tolerance ' + c.tol, px(d, 3, 1, 0));
        // pixel 2 is only reachable through pixel 1
        a((px(d, 3, 2, 0).join() === RED.join()) === c.filled, 'reach through tolerance ' + c.tol);
    }
}
{
    // Same colour with no tolerance: nothing to do
    const d = image(4, 4, RED);
    a(floodFill(d, 4, 4, 2, 2, RED, 0) === null, 'filling with the same colour is a no-op');
    a(floodFill(d, 4, 4, -1, 2, WHITE, 0) === null, 'outside the image');
    a(floodFill(d, 4, 4, 4, 0, WHITE, 0) === null, 'x = width is outside');
}
{
    // Fully transparent pixels match each other whatever their RGB
    const d = image(3, 1, CLEAR);
    set(d, 3, 1, 0, [10, 200, 30, 0]);
    floodFill(d, 3, 1, 0, 0, RED, 0);
    a(px(d, 3, 2, 0).join() === RED.join(), 'transparent pixels with other RGB are filled');
}
{
    // A snake-shaped corridor needs the scanline to go back up and down
    const w = 7, h = 5;
    const d = image(w, h, BLACK);
    const open = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [3, 2], [4, 2], [4, 1], [4, 0], [5, 0], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [0, 4]];
    open.forEach((p) => set(d, w, p[0], p[1], WHITE));
    const r = floodFill(d, w, h, 0, 0, RED, 0);
    let filled = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (px(d, w, x, y).join() === RED.join()) {
                filled++;
            }
        }
    }
    a(filled === open.length - 1, 'whole corridor filled, the island at (0,4) is not', filled);
    a(px(d, w, 0, 4).join() === WHITE.join(), 'unconnected pixel stays');
    a(r.w === 7 && r.h === 5, 'bounding box of the corridor', r);
}

/* ---------- BMP ---------- */
{
    // 3 x 2: rows are bottom-up, BGR, padded to 4 bytes
    const d = new Uint8ClampedArray([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
        0, 0, 0, 0, 10, 20, 30, 255, 255, 255, 255, 255
    ]);
    const b = encodeBMP(d, 3, 2, [255, 255, 255]);
    const dv = new DataView(b.buffer);
    a(b[0] === 0x42 && b[1] === 0x4d, 'BM signature');
    a(dv.getUint32(2, true) === b.length, 'file size field', dv.getUint32(2, true));
    a(b.length === 54 + 12 * 2, 'row padding (9 bytes -> 12)', b.length);
    a(dv.getInt32(18, true) === 3 && dv.getInt32(22, true) === 2, 'dimensions');
    a(dv.getUint16(28, true) === 24, '24 bits per pixel');
    // first stored row is the bottom row: transparent pixel -> background white
    a(b[54] === 255 && b[55] === 255 && b[56] === 255, 'transparent pixel blended onto background');
    a(b[57] === 30 && b[58] === 20 && b[59] === 10, 'pixel stored as BGR', [b[57], b[58], b[59]]);
    // top row stored second: red first
    a(b[66] === 0 && b[67] === 0 && b[68] === 255, 'top-left red', [b[66], b[67], b[68]]);
}

/* ---------- Bresenham ---------- */
{
    const cases = [
        { from: [0, 0], to: [3, 0], want: '0,0 1,0 2,0 3,0' },
        { from: [0, 0], to: [0, -2], want: '0,0 0,-1 0,-2' },
        { from: [0, 0], to: [2, 2], want: '0,0 1,1 2,2' },
        { from: [1.7, 1.2], to: [1.9, 1.9], want: '1,1' }
    ];
    for (const c of cases) {
        const pts = [];
        bresenham(c.from[0], c.from[1], c.to[0], c.to[1], (x, y) => pts.push(x + ',' + y));
        a(pts.join(' ') === c.want, 'bresenham ' + c.from + ' -> ' + c.to, pts.join(' '));
    }
    const pts = [];
    bresenham(0, 0, 10, 3, (x, y) => pts.push([x, y]));
    a(pts.length === 11, 'one pixel per column on a shallow line', pts.length);
}

/* ---------- filters ---------- */
{
    const d = new Uint8ClampedArray([10, 20, 30, 40]);
    invertPixels(d);
    a(Array.from(d).join() === '245,235,225,40', 'invert keeps alpha', Array.from(d));
    const g = new Uint8ClampedArray([255, 0, 0, 255]);
    grayscalePixels(g);
    a(g[0] === g[1] && g[1] === g[2] && g[0] === 54, 'luma of red', Array.from(g));
    a(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 254])) === true, 'alpha 254 is transparent');
    a(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255])) === false, 'opaque image');
}

/* ---------- colours ---------- */
{
    const cases = [
        ['#ff0000', [255, 0, 0, 255]],
        ['00ff7f', [0, 255, 127, 255]],
        ['#abc', [170, 187, 204, 255]],
        ['#12345', null],
        ['red', null]
    ];
    for (const [hex, want] of cases) {
        a(JSON.stringify(parseHex(hex)) === JSON.stringify(want), 'parseHex ' + hex, parseHex(hex));
    }
    a(toHex(255, 0, 127.6) === '#ff0080', 'toHex rounds', toHex(255, 0, 127.6));
    a(toHex(-5, 300, 16) === '#00ff10', 'toHex clamps', toHex(-5, 300, 16));
}

/* ---------- canvas size anchors ---------- */
{
    const cases = [
        ['tl', 0, 0], ['t', 50, 0], ['tr', 100, 0],
        ['l', 0, 25], ['c', 50, 25], ['r', 100, 25],
        ['bl', 0, 50], ['b', 50, 50], ['br', 100, 50]
    ];
    for (const [anchor, x, y] of cases) {
        const o = anchorOffset(anchor, 100, 50, 200, 100);
        a(o.x === x && o.y === y, 'anchor ' + anchor, o);
    }
    const shrink = anchorOffset('br', 100, 100, 40, 60);
    a(shrink.x === -60 && shrink.y === -40, 'anchor when shrinking', shrink);
}

/* ---------- rectangles and polygons ---------- */
{
    const r = normRect(10, 20, 4, 2);
    a(r.x === 4 && r.y === 2 && r.w === 6 && r.h === 18, 'normRect flips', r);
    const u = unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: -1, w: 1, h: 1 });
    a(u.x === 0 && u.y === -1 && u.w === 6 && u.h === 3, 'unionRect', u);
    a(unionRect(null, r) === r, 'unionRect with null');
    const c = clipRect({ x: -2.5, y: 3.2, w: 10, h: 100 }, 5, 50);
    a(c.x === 0 && c.y === 3 && c.w === 5 && c.h === 47, 'clipRect rounds outwards and clips', c);
    a(clipRect({ x: 10, y: 10, w: 5, h: 5 }, 5, 5) === null, 'clipRect outside is null');
    const tri = [[0, 0], [10, 0], [0, 10]];
    a(pointInPolygon(2, 2, tri) === true, 'inside triangle');
    a(pointInPolygon(8, 8, tri) === false, 'outside triangle');
}

console.log(failed ? failed + ' checks failed' : 'raster: all checks passed');
process.exitCode = failed ? 1 : 0;
