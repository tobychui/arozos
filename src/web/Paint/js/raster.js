/*
    Pixel helpers that work on plain RGBA arrays (ImageData.data), so the
    tests can run them in Node: flood fill, BMP encoding, line rasterising,
    colour filters and colour conversion.
*/

/*
    Scanline flood fill from (sx, sy) with `fill` = [r, g, b, a].
    A pixel joins the fill when every channel is within `tolerance`
    (0..255) of the start pixel; two fully transparent pixels always match.
    Changes `data` in place and returns the bounding box of the change,
    or null when nothing was filled.
*/
export function floodFill(data, w, h, sx, sy, fill, tolerance) {
    sx = Math.floor(sx);
    sy = Math.floor(sy);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
        return null;
    }
    const tol = Math.max(0, tolerance || 0);
    const s = (sy * w + sx) * 4;
    const tr = data[s], tg = data[s + 1], tb = data[s + 2], ta = data[s + 3];
    if (tol === 0 && tr === fill[0] && tg === fill[1] && tb === fill[2] && ta === fill[3]) {
        return null;
    }
    const visited = new Uint8Array(w * h);
    const match = function (p) {
        if (visited[p]) {
            return false;
        }
        const i = p * 4;
        const a = data[i + 3];
        if (ta === 0 && a === 0) {
            return true;
        }
        return Math.abs(data[i] - tr) <= tol &&
            Math.abs(data[i + 1] - tg) <= tol &&
            Math.abs(data[i + 2] - tb) <= tol &&
            Math.abs(a - ta) <= tol;
    };
    let minX = sx, maxX = sx, minY = sy, maxY = sy;
    const stack = [sx, sy];
    while (stack.length) {
        const y = stack.pop();
        let x = stack.pop();
        let row = y * w;
        if (!match(row + x)) {
            continue;
        }
        while (x > 0 && match(row + x - 1)) {
            x--;
        }
        let above = false, below = false;
        while (x < w && match(row + x)) {
            const p = row + x;
            const i = p * 4;
            data[i] = fill[0];
            data[i + 1] = fill[1];
            data[i + 2] = fill[2];
            data[i + 3] = fill[3];
            visited[p] = 1;
            if (x < minX) { minX = x; }
            if (x > maxX) { maxX = x; }
            if (y < minY) { minY = y; }
            if (y > maxY) { maxY = y; }
            if (y > 0) {
                const m = match(p - w);
                if (m && !above) {
                    stack.push(x, y - 1);
                    above = true;
                } else if (!m) {
                    above = false;
                }
            }
            if (y < h - 1) {
                const m = match(p + w);
                if (m && !below) {
                    stack.push(x, y + 1);
                    below = true;
                } else if (!m) {
                    below = false;
                }
            }
            x++;
        }
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// 24-bit Windows bitmap; transparent pixels are blended onto `bg` [r, g, b]
export function encodeBMP(data, w, h, bg) {
    bg = bg || [255, 255, 255];
    const rowSize = Math.ceil((w * 3) / 4) * 4;
    const size = 54 + rowSize * h;
    const buf = new Uint8Array(size);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x42;
    buf[1] = 0x4d;
    dv.setUint32(2, size, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(30, 0, true);
    dv.setUint32(34, rowSize * h, true);
    dv.setInt32(38, 2835, true);
    dv.setInt32(42, 2835, true);
    for (let y = 0; y < h; y++) {
        const off = 54 + (h - 1 - y) * rowSize;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const a = data[i + 3] / 255;
            const o = off + x * 3;
            buf[o] = Math.round(data[i + 2] * a + bg[2] * (1 - a));
            buf[o + 1] = Math.round(data[i + 1] * a + bg[1] * (1 - a));
            buf[o + 2] = Math.round(data[i] * a + bg[0] * (1 - a));
        }
    }
    return buf;
}

// Calls fn(x, y) for every pixel of the line between two integer points
export function bresenham(x0, y0, x1, y1, fn) {
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    x1 = Math.floor(x1);
    y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        fn(x0, y0);
        if (x0 === x1 && y0 === y1) {
            break;
        }
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y0 += sy;
        }
    }
}

export function hasTransparency(data) {
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
            return true;
        }
    }
    return false;
}

export function invertPixels(data) {
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
    }
}

export function grayscalePixels(data) {
    for (let i = 0; i < data.length; i += 4) {
        const g = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        data[i] = data[i + 1] = data[i + 2] = g;
    }
}

/* ------------------------------------------------------------ colours */

export function parseHex(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) {
        return null;
    }
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function toHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
}

/* ------------------------------------------------------------ geometry */

// Where the old image lands when the canvas is resized around an anchor.
// anchor is "tl", "t", "tr", "l", "c", "r", "bl", "b" or "br".
export function anchorOffset(anchor, oldW, oldH, newW, newH) {
    const a = anchor || 'tl';
    let x = 0, y = 0;
    if (a.indexOf('r') >= 0) {
        x = newW - oldW;
    } else if (a !== 'tl' && a !== 'l' && a !== 'bl') {
        x = Math.round((newW - oldW) / 2);
    }
    if (a.indexOf('b') >= 0) {
        y = newH - oldH;
    } else if (a !== 'tl' && a !== 't' && a !== 'tr') {
        y = Math.round((newH - oldH) / 2);
    }
    return { x: x, y: y };
}

export function normRect(x0, y0, x1, y1) {
    return {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0)
    };
}

export function unionRect(a, b) {
    if (!a) { return b; }
    if (!b) { return a; }
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return {
        x: x,
        y: y,
        w: Math.max(a.x + a.w, b.x + b.w) - x,
        h: Math.max(a.y + a.h, b.y + b.h) - y
    };
}

// Integer rectangle covering r, clipped to 0..w x 0..h (null when empty)
export function clipRect(r, w, h) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(w, Math.ceil(r.x + r.w));
    const y1 = Math.min(h, Math.ceil(r.y + r.h));
    if (x1 <= x0 || y1 <= y0) {
        return null;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Even-odd point in polygon test; pts = [[x, y], ...]
export function pointInPolygon(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}
