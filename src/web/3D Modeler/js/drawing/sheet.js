/*
    3D Modeler - drawing sheets: sizes, units, scales, view directions

    A sheet is measured in millimetres on paper, x to the right and y up from
    its bottom left corner (as in PDF and DXF). Its size comes from a preset
    (ISO A, ANSI, US paper) or is typed in mm, cm, inches or pixels; pixels
    are turned into millimetres with the sheet's resolution (dpi), which is
    also the resolution of a PNG export.

    The drawing scale is paper : model. 1:1 (the default) draws a part at its
    true size; 1:2 at half, 2:1 at double. Views take the sheet's scale
    unless they have one of their own.
*/

// Sizes in mm, long side first; the orientation decides which way round
export const SHEET_PRESETS = [
    { id: 'A0', label: 'A0', w: 1189, h: 841 },
    { id: 'A1', label: 'A1', w: 841, h: 594 },
    { id: 'A2', label: 'A2', w: 594, h: 420 },
    { id: 'A3', label: 'A3', w: 420, h: 297 },
    { id: 'A4', label: 'A4', w: 297, h: 210 },
    { id: 'A5', label: 'A5', w: 210, h: 148 },
    { id: 'ANSI-A', label: 'ANSI A (Letter)', w: 279.4, h: 215.9 },
    { id: 'ANSI-B', label: 'ANSI B (Tabloid)', w: 431.8, h: 279.4 },
    { id: 'ANSI-C', label: 'ANSI C', w: 558.8, h: 431.8 },
    { id: 'ANSI-D', label: 'ANSI D', w: 863.6, h: 558.8 },
    { id: 'ANSI-E', label: 'ANSI E', w: 1117.6, h: 863.6 },
    { id: 'Legal', label: 'US Legal', w: 355.6, h: 215.9 },
    { id: 'custom', label: 'Custom size', w: 0, h: 0 }
];

// Units a sheet size can be typed in: how many of them make a millimetre
// (pixels depend on the resolution, see toMm)
export const SIZE_UNITS = ['mm', 'cm', 'in', 'px'];

// Units dimensions can be shown in
export const LENGTH_UNITS = {
    mm: { perMm: 1, label: 'mm' },
    cm: { perMm: 0.1, label: 'cm' },
    m: { perMm: 0.001, label: 'm' },
    in: { perMm: 1 / 25.4, label: 'in' },
    ft: { perMm: 1 / 304.8, label: 'ft' }
};

export const DPI_PRESETS = [72, 96, 150, 300, 600];

export const SCALE_PRESETS = ['10:1', '5:1', '2:1', '1:1', '1:2', '1:2.5', '1:5', '1:10', '1:20', '1:50', '1:100'];

export function presetById(id) {
    return SHEET_PRESETS.filter(function (p) {
        return p.id === id;
    })[0] || null;
}

export function defaultSheet() {
    return {
        preset: 'A3',
        orientation: 'landscape',
        width: 420,
        height: 297,
        sizeUnit: 'mm',
        dpi: 300,
        scale: 1,
        margin: 10,
        border: true,
        titleBlock: true,
        projection: 'first',
        fields: { title: '', number: '', author: '', checked: '', date: '', company: '', material: '', revision: '' }
    };
}

// The width and height of a preset in an orientation
export function presetSize(id, orientation) {
    const p = presetById(id);
    if (!p || !p.w) {
        return null;
    }
    return orientation === 'portrait' ? [p.h, p.w] : [p.w, p.h];
}

// A length typed in `unit` as millimetres
export function toMm(value, unit, dpi) {
    if (unit === 'cm') {
        return value * 10;
    }
    if (unit === 'in') {
        return value * 25.4;
    }
    if (unit === 'px') {
        return value / (dpi || 300) * 25.4;
    }
    return value;
}

// Millimetres as a length in `unit`
export function fromMm(mm, unit, dpi) {
    if (unit === 'cm') {
        return mm / 10;
    }
    if (unit === 'in') {
        return mm / 25.4;
    }
    if (unit === 'px') {
        return mm / 25.4 * (dpi || 300);
    }
    return mm;
}

// The pixel size of a sheet at its resolution: [width, height]
export function pixelSize(sheet) {
    return [Math.round(sheet.width / 25.4 * sheet.dpi), Math.round(sheet.height / 25.4 * sheet.dpi)];
}

// "1:2" -> 0.5, "2:1" -> 2, "0.5" -> 0.5. null when it is not a scale.
export function parseScale(text) {
    const t = String(text === undefined || text === null ? '' : text).trim().replace(/\s+/g, '');
    let m = /^([0-9]*\.?[0-9]+)[:/]([0-9]*\.?[0-9]+)$/.exec(t);
    let v = null;
    if (m) {
        v = parseFloat(m[1]) / parseFloat(m[2]);
    } else if (/^[0-9]*\.?[0-9]+$/.test(t)) {
        v = parseFloat(t);
    }
    return v && isFinite(v) && v >= 1e-4 && v <= 1e4 ? v : null;
}

function short(v) {
    return String(+v.toFixed(4));
}

// A ratio of small whole numbers within 1e-6 of v ([p, q], q <= 100), or null
function ratio(v) {
    for (let q = 1; q <= 100; q++) {
        const p = Math.round(v * q);
        if (p > 0 && Math.abs(p / q - v) < 1e-6) {
            return [p, q];
        }
    }
    return null;
}

function plain(v) {
    return Math.abs(v - +v.toFixed(2)) < 1e-9;
}

// 0.5 -> "1:2", 2 -> "2:1", 1 -> "1:1", 0.4 -> "1:2.5", 0.75 -> "3:4"
export function scaleText(scale) {
    if (!scale || !isFinite(scale)) {
        return '1:1';
    }
    if (scale >= 1 && plain(scale)) {
        return short(scale) + ':1';
    }
    if (scale < 1 && plain(1 / scale)) {
        return '1:' + short(1 / scale);
    }
    const r = ratio(scale);
    return r ? r[0] + ':' + r[1] : scale >= 1 ? short(scale) + ':1' : '1:' + short(1 / scale);
}

/* ================= view directions ================= */
// A view looks at the model from `dir` (the direction from the model to the
// viewer) with `xdir` running right on the paper; up on the paper is
// dir x xdir. Z is up in the model, and FRONT means standing on -Y, as the
// view cube has it.
export const ORIENTATIONS = {
    front: { label: 'Front', dir: [0, -1, 0], xdir: [1, 0, 0] },
    back: { label: 'Back', dir: [0, 1, 0], xdir: [-1, 0, 0] },
    top: { label: 'Top', dir: [0, 0, 1], xdir: [1, 0, 0] },
    bottom: { label: 'Bottom', dir: [0, 0, -1], xdir: [1, 0, 0] },
    right: { label: 'Right', dir: [1, 0, 0], xdir: [0, 1, 0] },
    left: { label: 'Left', dir: [-1, 0, 0], xdir: [0, -1, 0] },
    isoTR: { label: 'Iso Top Right', corner: [1, -1, 1] },
    isoTL: { label: 'Iso Top Left', corner: [-1, -1, 1] },
    isoBR: { label: 'Iso Bottom Right', corner: [1, -1, -1] },
    isoBL: { label: 'Iso Bottom Left', corner: [-1, -1, -1] }
};

function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]);
    return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
}

export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function tidy(v) {
    return v.map(function (x) {
        const r = Math.round(x * 1e9) / 1e9;
        return r === 0 ? 0 : r;
    });
}

// A view frame looking from `dir` whose paper up is as near `up` as can be
export function frameFrom(dir, up) {
    const n = norm(dir);
    let u = up || [0, 0, 1];
    if (Math.abs(dot(norm(u), n)) > 0.999) {
        u = Math.abs(n[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
    }
    const along = dot(u, n);
    const y = norm([u[0] - n[0] * along, u[1] - n[1] * along, u[2] - n[2] * along]);
    return { dir: tidy(n), xdir: tidy(norm(cross(y, n))) };
}

// The frame of a named orientation
export function orientation(key) {
    const o = ORIENTATIONS[key];
    if (!o) {
        return null;
    }
    if (o.corner) {
        return frameFrom(o.corner, [0, 0, 1]);
    }
    return { dir: o.dir.slice(), xdir: o.xdir.slice() };
}

// Which named orientation a frame is, or null
export function orientationKey(frame) {
    return Object.keys(ORIENTATIONS).filter(function (key) {
        const o = orientation(key);
        return dot(o.dir, frame.dir) > 0.99999 && dot(o.xdir, frame.xdir) > 0.99999;
    })[0] || null;
}

export function upOf(frame) {
    return cross(frame.dir, frame.xdir);
}

// Where a projected view sits around its parent: right, left, top, bottom,
// or a corner (tr, tl, br, bl) for an isometric view
export const PROJECTED = ['right', 'left', 'top', 'bottom', 'tr', 'tl', 'br', 'bl'];

/*
    The frame of a view projected from a parent frame and placed on the
    `rel` side of it. Third angle (ANSI) puts what is seen from the right on
    the right; first angle (ISO) puts it on the left. Corner views are
    isometric and follow the same rule: in third angle the one at the top
    right looks from the top, the right and the front; in first angle the
    one at the bottom right does (it lies between the view from the left
    and the view from the top), so the free corner of either layout gives
    a view from above.
*/
export function projectedFrame(parent, rel, projection) {
    const n = parent.dir;
    const x = parent.xdir;
    const y = upOf(parent);
    const neg = function (v) {
        return [-v[0], -v[1], -v[2]];
    };
    const third = projection === 'third';
    const side = function (towards, flip) {
        // Looking from `towards` (a unit vector of the parent frame)
        return third ? towards : flip(towards);
    };
    let out;
    if (rel === 'right' || rel === 'left') {
        const from = side(rel === 'right' ? x : neg(x), neg);
        out = { dir: from, xdir: cross(y, from) };
    } else if (rel === 'top' || rel === 'bottom') {
        const from = side(rel === 'top' ? y : neg(y), neg);
        // Paper up of the new view points away from the parent's viewer
        // for a view from above, towards it for a view from below
        const up = dot(from, y) > 0 ? neg(n) : n;
        out = { dir: from, xdir: cross(up, from) };
    } else {
        const flip = third ? 1 : -1;
        const sx = (rel === 'tr' || rel === 'br' ? 1 : -1) * flip;
        const sy = (rel === 'tr' || rel === 'tl' ? 1 : -1) * flip;
        const corner = [0, 1, 2].map(function (k) {
            return n[k] + sx * x[k] + sy * y[k];
        });
        return frameFrom(corner, y);
    }
    return { dir: tidy(norm(out.dir)), xdir: tidy(norm(out.xdir)) };
}

// Which side of a parent a point (dx, dy from the parent's middle, on paper)
// asks for: a straight side when it is well within that side's band
export function sideFor(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax < 1e-9 && ay < 1e-9) {
        return null;
    }
    if (ay < ax * 0.5) {
        return dx > 0 ? 'right' : 'left';
    }
    if (ax < ay * 0.5) {
        return dy > 0 ? 'top' : 'bottom';
    }
    return (dy > 0 ? 't' : 'b') + (dx > 0 ? 'r' : 'l');
}

// Project a 3D point onto a view frame: [x, y] on paper (model mm)
export function toPaper(frame, p) {
    const y = upOf(frame);
    return [dot(p, frame.xdir), dot(p, y)];
}

// The paper box [xmin, ymin, xmax, ymax] of a 3D box seen in a frame
export function boxOnPaper(frame, box) {
    let out = null;
    for (let i = 0; i < 8; i++) {
        const p = [box[i & 1 ? 1 : 0][0], box[i & 2 ? 1 : 0][1], box[i & 4 ? 1 : 0][2]];
        const q = toPaper(frame, p);
        out = out ? [Math.min(out[0], q[0]), Math.min(out[1], q[1]), Math.max(out[2], q[0]), Math.max(out[3], q[1])] : [q[0], q[1], q[0], q[1]];
    }
    return out;
}
