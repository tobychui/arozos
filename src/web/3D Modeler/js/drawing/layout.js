/*
    3D Modeler - drawing layout

    Turns a drawing document and the projected edges of its views into a
    list of plain primitives on the sheet. The screen (editor.js) and every
    export (SVG, PDF, DXF, PNG in js/io/) draw these same primitives, so
    what is printed is what was seen.

    Sheet coordinates: millimetres, x right and y up from the bottom left
    corner of the paper. A primitive is one of
        { t: "line", a, b }
        { t: "poly", pts: [[x, y], ...], closed }
        { t: "circle", c, r }
        { t: "arc", c, r, a0, sweep }         radians, counter-clockwise
        { t: "fill", pts }                    a filled polygon (arrow heads)
        { t: "text", p, text, h, rot, anchor } p: start of the baseline (or
              its middle / end for anchor "middle" / "end"), h: capital
              height (mm), rot: degrees counter-clockwise
    each with a `layer` (LAYERS: line weight and dash pattern).

    build() returns groups [{ owner, items }]; owner is "sheet", "view:<id>"
    or "ann:<id>", so the editor can light up and pick whole things.

    Annotation types (points in the view's own coordinates, model mm):
        linear    p1, p2, orient ("h" | "v" | "a"), at
        radius    c, r, at
        diameter  c, r, at
        hole      c, r, count, at          a leader note "4x <diameter>"
        angle     l1: [p, q], l2: [p, q], at
        note      p (what it points at), at (the text), text, end ("arrow" | "dot" | "none")
        text      at (sheet mm, no view), text
        center    c, r                     a centre mark
    `at` is where the text (and for a linear dimension the dimension line)
    was put. Every annotation may carry fmt (format.js).
*/

import { textWidth } from './font.js';
import { formatLength, formatAngle, formatHole, heightOf } from './format.js';
import { scaleText, projectedFrame, presetById } from './sheet.js';
import { lineIntersection } from './geometry2d.js';

// Line weights (mm) and dash patterns (mm on paper), after ISO 128
export const LAYERS = {
    border: { width: 0.7 },
    title: { width: 0.35 },
    thin: { width: 0.18 },
    visible: { width: 0.5 },
    tangent: { width: 0.18 },
    hidden: { width: 0.25, dash: [3, 1.5] },
    center: { width: 0.18, dash: [8, 1.5, 1.5, 1.5] },
    dim: { width: 0.25 },
    text: { width: 0.25 }
};

const GAP = 1;          // between an object and its extension line
const OVER = 2;         // an extension line runs past the dimension line
const LIFT = 1;         // text sits this far above its line

/* ================= views ================= */
// The frame a view looks along: its own, or worked out from its parent's
export function frameOf(data, view) {
    if (!view.parent) {
        return { dir: view.dir, xdir: view.xdir };
    }
    const parent = data.views.filter(function (v) {
        return v.id === view.parent;
    })[0];
    if (!parent) {
        return { dir: [0, -1, 0], xdir: [1, 0, 0] };
    }
    return projectedFrame(frameOf(data, parent), view.rel, data.sheet.projection);
}

// Paper mm per model mm of a view
export function scaleOf(data, view) {
    if (view.scale > 0) {
        return view.scale;
    }
    const parent = view.parent && data.views.filter(function (v) {
        return v.id === view.parent;
    })[0];
    return parent ? scaleOf(data, parent) : data.sheet.scale || 1;
}

// A view's own coordinates to the sheet, and back
export function toSheet(view, scale, p) {
    return [view.x + scale * p[0], view.y + scale * p[1]];
}

export function toLocal(view, scale, q) {
    return [(q[0] - view.x) / scale, (q[1] - view.y) / scale];
}

/* ================= small helpers ================= */
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
}

function add(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
}

function mul(a, k) {
    return [a[0] * k, a[1] * k];
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
}

function len(a) {
    return Math.hypot(a[0], a[1]);
}

function unit(a) {
    const l = len(a);
    return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0];
}

function angleOf(a) {
    return Math.atan2(a[1], a[0]);
}

function wrap(a) {
    const t = a % (2 * Math.PI);
    return t < 0 ? t + 2 * Math.PI : t;
}

function line(items, a, b, layer) {
    items.push({ t: 'line', a: a, b: b, layer: layer || 'dim' });
}

function text(items, p, str, h, rot, anchor, layer) {
    items.push({ t: 'text', p: p, text: str, h: h, rot: rot || 0, anchor: anchor || 'start', layer: layer || 'text' });
}

// A filled arrow head with its tip at `tip`, pointing along `dir`
function arrow(items, tip, dir, size) {
    const base = sub(tip, mul(dir, size));
    const side = mul([-dir[1], dir[0]], size * 0.18);
    items.push({ t: 'fill', pts: [tip, add(base, side), sub(base, side)], layer: 'dim' });
}

function dotMark(items, p, size) {
    items.push({ t: 'circle', c: p, r: size * 0.18, layer: 'dim', filled: true });
}

// The reading direction of a line (text never reads upside down)
function readable(u) {
    const a = Math.atan2(u[1], u[0]) * 180 / Math.PI;
    return a > 90.001 || a <= -89.999 ? [-u[0], -u[1]] : u;
}

/* ================= sheet frame and title block ================= */
function frameItems(sheet, style) {
    const items = [];
    const W = sheet.width;
    const H = sheet.height;
    const m = Math.max(0, Math.min(sheet.margin || 0, Math.min(W, H) / 4));
    if (sheet.border) {
        items.push({ t: 'poly', pts: [[m, m], [W - m, m], [W - m, H - m], [m, H - m]], closed: true, layer: 'border' });
    }
    if (sheet.titleBlock) {
        titleBlock(items, sheet, style, W - m, m, Math.min(180, W - 2 * m));
    }
    return items;
}

// The projection symbol of ISO 128 in a box: a truncated cone seen from
// the side and from its end. First angle: the end view on the left;
// third angle: on the right, the cone pointing at it.
function projectionSymbol(items, x, y, w, h, third) {
    const cy = y + h / 2;
    const R = Math.min(h * 0.32, w * 0.12);
    const r = R * 0.5;
    const len = R * 2.4;
    const gap = R * 1.2;
    const total = 2 * R + gap + len;
    const x0 = x + (w - total) / 2;
    let circleX;
    let wideX;
    let narrowX;
    if (third) {
        wideX = x0;
        narrowX = x0 + len;
        circleX = narrowX + gap + R;
    } else {
        circleX = x0 + R;
        wideX = x0 + 2 * R + gap;
        narrowX = wideX + len;
    }
    items.push({ t: 'circle', c: [circleX, cy], r: R, layer: 'title' });
    items.push({ t: 'circle', c: [circleX, cy], r: r, layer: 'title' });
    items.push({ t: 'poly', pts: [[wideX, cy - R], [narrowX, cy - r], [narrowX, cy + r], [wideX, cy + R]], closed: true, layer: 'title' });
    line(items, [Math.min(wideX, circleX - R) - 1, cy], [Math.max(narrowX, circleX + R) + 1, cy], 'center');
    line(items, [circleX, cy - R - 1], [circleX, cy + R + 1], 'center');
}

// A block of labelled cells at the bottom right corner (ISO 7200 style)
function titleBlock(items, sheet, style, right, bottom, width) {
    const f = sheet.fields || {};
    const preset = presetById(sheet.preset);
    const size = preset && preset.w ? preset.label.split(' ')[0] : (+sheet.width.toFixed(1)) + ' x ' + (+sheet.height.toFixed(1));
    const k = width / 180;
    const rows = [
        { h: 12, cells: [[110, 'Title', f.title, 5], [70, 'Company', f.company, 3.5]] },
        { h: 9, cells: [[60, 'Drawing No.', f.number, 3.5], [50, 'Material', f.material, 2.5], [20, 'Rev', f.revision, 3.5], [50, 'Date', f.date, 2.5]] },
        { h: 9, cells: [[40, 'Drawn by', f.author, 2.5], [40, 'Checked by', f.checked, 2.5], [25, 'Scale', scaleText(sheet.scale), 3.5], [25, 'Size', size, 3.5], [20, 'Units', style.units, 2.5], [30, 'Projection', null, 0]] }
    ];
    const total = rows.reduce(function (s, r) {
        return s + r.h;
    }, 0);
    const left = right - width;
    items.push({ t: 'poly', pts: [[left, bottom], [right, bottom], [right, bottom + total], [left, bottom + total]], closed: true, layer: 'title' });
    let top = bottom + total;
    rows.forEach(function (row, ri) {
        const y0 = top - row.h;
        if (ri < rows.length - 1) {
            line(items, [left, y0], [right, y0], 'title');
        }
        let x = left;
        row.cells.forEach(function (cell, ci) {
            const w = cell[0] * k;
            if (ci > 0) {
                line(items, [x, y0], [x, top], 'title');
            }
            text(items, [x + 1.2, top - 2.6], cell[1], 1.6, 0, 'start', 'thin');
            if (cell[1] === 'Projection') {
                projectionSymbol(items, x, y0, w, row.h - 2.2, sheet.projection === 'third');
            } else if (cell[2]) {
                let value = String(cell[2]);
                let h = Math.min(cell[3], (row.h - 3.6) * 0.8);
                // Long values get smaller rather than run out of the cell
                const room = w - 2.4;
                if (textWidth(value, h) > room) {
                    h = Math.max(1.4, h * room / textWidth(value, h));
                }
                text(items, [x + 1.2, y0 + 1.6], value, h, 0, 'start', 'text');
            }
            x += w;
        });
        top = y0;
    });
}

/* ================= views ================= */
function edgeLayer(e) {
    return !e.visible ? 'hidden' : e.kind === 'smooth' ? 'tangent' : 'visible';
}

function edgeItems(items, view, s, edges) {
    edges.forEach(function (e) {
        const layer = edgeLayer(e);
        if (e.type === 'line') {
            line(items, toSheet(view, s, e.a), toSheet(view, s, e.b), layer);
        } else if (e.type === 'circle' && e.closed) {
            items.push({ t: 'circle', c: toSheet(view, s, e.c), r: e.r * s, layer: layer });
        } else if (e.type === 'circle') {
            items.push({ t: 'arc', c: toSheet(view, s, e.c), r: e.r * s, a0: e.a0, sweep: e.sweep, layer: layer });
        } else {
            const pts = [];
            for (let i = 0; i < e.pts.length; i += 2) {
                pts.push(toSheet(view, s, [e.pts[i], e.pts[i + 1]]));
            }
            items.push({ t: 'poly', pts: pts, layer: layer });
        }
    });
}

function centerMark(items, c, R) {
    const ext = R + 2;
    line(items, [c[0] - ext, c[1]], [c[0] + ext, c[1]], 'center');
    line(items, [c[0], c[1] - ext], [c[0], c[1] + ext], 'center');
}

// Centre marks on every visible full circle of a view, once per circle
function viewCenters(items, view, s, edges) {
    const seen = {};
    edges.forEach(function (e) {
        if (e.type !== 'circle' || !e.closed || !e.visible || e.r * s < 1) {
            return;
        }
        const k = Math.round(e.c[0] * 1e3) + ',' + Math.round(e.c[1] * 1e3);
        if (seen[k] && seen[k] >= e.r) {
            return;
        }
        seen[k] = e.r;
    });
    Object.keys(seen).forEach(function (k) {
        const xy = k.split(',').map(function (v) {
            return +v / 1e3;
        });
        centerMark(items, toSheet(view, s, xy), seen[k] * s);
    });
}

// The sheet box of a view: [xmin, ymin, xmax, ymax], from its edges or an
// estimate while they are not there yet
export function viewBox(view, s, local) {
    if (!local) {
        return null;
    }
    const a = toSheet(view, s, [local[0], local[1]]);
    const b = toSheet(view, s, [local[2], local[3]]);
    return [a[0], a[1], b[0], b[1]];
}

function viewLabel(items, view, s, box, sheet) {
    if (!view.label || !box) {
        return;
    }
    const cx = (box[0] + box[2]) / 2;
    text(items, [cx, box[1] - 8], view.name, 5, 0, 'middle', 'text');
    if (Math.abs(s - (sheet.scale || 1)) > 1e-9 || !view.parent) {
        text(items, [cx, box[1] - 13], 'SCALE ' + scaleText(s), 3.5, 0, 'middle', 'text');
    }
}

/* ================= annotations ================= */
// A text block of one or more lines; returns its width
function textLines(items, p, str, h, anchor, below) {
    const lines = String(str).split('\n');
    let width = 0;
    lines.forEach(function (ln, i) {
        width = Math.max(width, textWidth(ln, h));
        const k = below ? i : i - (lines.length - 1);
        text(items, [p[0], p[1] - k * h * 1.6], ln, h, 0, anchor, 'text');
    });
    return width;
}

// A leader to a text with a shoulder: from `from` to `at`, then level
function leaderText(items, from, at, str, h) {
    const lines = String(str).split('\n');
    const w = Math.max.apply(null, lines.map(function (ln) {
        return textWidth(ln, h);
    }));
    const side = at[0] >= from[0] ? 1 : -1;
    line(items, from, at);
    line(items, at, [at[0] + side * (w + 2), at[1]]);
    textLines(items, [at[0] + side * 1, at[1] + LIFT], str, h, side > 0 ? 'start' : 'end', false);
}

function linear(items, a, view, s, style) {
    const P1 = toSheet(view, s, a.p1);
    const P2 = toSheet(view, s, a.p2);
    const A = toSheet(view, s, a.at);
    const L = style.arrowSize || 3;
    const h = heightOf(a.fmt, style);
    let u;
    let D1;
    let D2;
    let value;
    if (a.orient === 'h') {
        u = [1, 0];
        D1 = [P1[0], A[1]];
        D2 = [P2[0], A[1]];
        value = Math.abs(a.p2[0] - a.p1[0]);
    } else if (a.orient === 'v') {
        u = [0, 1];
        D1 = [A[0], P1[1]];
        D2 = [A[0], P2[1]];
        value = Math.abs(a.p2[1] - a.p1[1]);
    } else {
        u = unit(sub(P2, P1));
        const n = [-u[1], u[0]];
        const off = dot(sub(A, P1), n);
        D1 = add(P1, mul(n, off));
        D2 = add(P2, mul(n, off));
        value = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]);
    }
    [[P1, D1], [P2, D2]].forEach(function (pair) {
        const e = sub(pair[1], pair[0]);
        const l = len(e);
        if (l > GAP) {
            const d = mul(e, 1 / l);
            line(items, add(pair[0], mul(d, GAP)), add(pair[1], mul(d, OVER)));
        }
    });
    const str = formatLength(value, 'linear', a.fmt, style);
    const w = textWidth(str, h);
    const t1 = dot(D1, u);
    const t2 = dot(D2, u);
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    const origin = t1 <= t2 ? D1 : D2;
    const at = function (t) {
        return add(origin, mul(u, t - lo));
    };
    const tText = dot(A, u);
    const inside = hi - lo >= 2 * L + 1;
    let from = inside ? lo : lo - L - 2;
    let to = inside ? hi : hi + L + 2;
    from = Math.min(from, tText - w / 2 - 1);
    to = Math.max(to, tText + w / 2 + 1);
    line(items, at(from), at(to));
    arrow(items, at(lo), inside ? mul(u, -1) : u, L);
    arrow(items, at(hi), inside ? u : mul(u, -1), L);
    const r = readable(u);
    const up = [-r[1], r[0]];
    text(items, add(at(tText), mul(up, LIFT)), str, h, Math.atan2(r[1], r[0]) * 180 / Math.PI, 'middle', 'text');
    return value;
}

function circular(items, a, view, s, style) {
    const C = toSheet(view, s, a.c);
    const R = a.r * s;
    const A = toSheet(view, s, a.at);
    const L = style.arrowSize || 3;
    const h = heightOf(a.fmt, style);
    const d = sub(A, C);
    const dist = len(d);
    const u = dist > 1e-9 ? mul(d, 1 / dist) : [1, 0];
    const T1 = add(C, mul(u, R));
    const T2 = sub(C, mul(u, R));
    const str = a.type === 'radius' ? formatLength(a.r, 'radius', a.fmt, style)
        : a.type === 'hole' ? formatHole(2 * a.r, a.count || 1, a.fmt, style)
            : formatLength(2 * a.r, 'diameter', a.fmt, style);
    if (dist > R || a.type === 'hole') {
        if (a.type === 'diameter') {
            line(items, T2, T1);
            arrow(items, T2, mul(u, -1), L);
            arrow(items, T1, u, L);
            leaderText(items, T1, A, str, h);
        } else {
            arrow(items, T1, mul(u, -1), L);
            leaderText(items, T1, A, str, h);
        }
    } else if (a.type === 'radius') {
        line(items, C, T1);
        arrow(items, T1, u, L);
        text(items, add(A, [0, LIFT]), str, h, 0, 'middle', 'text');
    } else {
        line(items, T2, T1);
        arrow(items, T2, mul(u, -1), L);
        arrow(items, T1, u, L);
        text(items, add(A, [0, LIFT]), str, h, 0, 'middle', 'text');
    }
}

// The two rays of an angle dimension and the arc between them, picked so
// the arc passes the side `A` is on: { V, start, sweep } or null
export function angleSpan(l1, l2, A) {
    const V = lineIntersection(l1[0], l1[1], l2[0], l2[1]);
    if (!V) {
        return null;
    }
    const d1 = unit(sub(l1[1], l1[0]));
    const d2 = unit(sub(l2[1], l2[0]));
    const theta = angleOf(sub(A, V));
    let best = null;
    [d1, mul(d1, -1)].forEach(function (r1) {
        [d2, mul(d2, -1)].forEach(function (r2) {
            let start = angleOf(r1);
            let sweep = wrap(angleOf(r2) - start);
            if (sweep > Math.PI) {
                start = angleOf(r2);
                sweep = 2 * Math.PI - sweep;
            }
            if (!best && wrap(theta - start) <= sweep + 1e-9) {
                best = { V: V, start: start, sweep: sweep };
            }
        });
    });
    return best;
}

function angular(items, a, view, s, style) {
    const l1 = [toSheet(view, s, a.l1[0]), toSheet(view, s, a.l1[1])];
    const l2 = [toSheet(view, s, a.l2[0]), toSheet(view, s, a.l2[1])];
    const A = toSheet(view, s, a.at);
    const span = angleSpan(l1, l2, A);
    if (!span) {
        return;
    }
    const L = style.arrowSize || 3;
    const h = heightOf(a.fmt, style);
    const V = span.V;
    const R = Math.max(2, len(sub(A, V)));
    const end = span.start + span.sweep;
    items.push({ t: 'arc', c: V, r: R, a0: span.start, sweep: span.sweep, layer: 'dim' });
    const E0 = add(V, mul([Math.cos(span.start), Math.sin(span.start)], R));
    const E1 = add(V, mul([Math.cos(end), Math.sin(end)], R));
    const inside = R * span.sweep >= 2 * L + 1;
    const t0 = [Math.sin(span.start), -Math.cos(span.start)];
    const t1 = [-Math.sin(end), Math.cos(end)];
    arrow(items, E0, inside ? t0 : mul(t0, -1), L);
    arrow(items, E1, inside ? t1 : mul(t1, -1), L);
    // Extension lines where the arc lies beyond a line's ends
    [[l1, span.start], [l2, end]].forEach(function (pair) {
        const ray = [Math.cos(pair[1]), Math.sin(pair[1])];
        const ta = dot(sub(pair[0][0], V), ray);
        const tb = dot(sub(pair[0][1], V), ray);
        const tmax = Math.max(ta, tb);
        const tmin = Math.min(ta, tb);
        if (R > tmax + GAP) {
            line(items, add(V, mul(ray, Math.max(0, tmax) + GAP)), add(V, mul(ray, R + OVER)));
        } else if (R < tmin - GAP) {
            line(items, add(V, mul(ray, R - OVER)), add(V, mul(ray, tmin - GAP)));
        }
    });
    const mid = span.start + span.sweep / 2;
    const dir = [Math.cos(mid), Math.sin(mid)];
    const p = add(V, mul(dir, R + LIFT + 0.5));
    const anchor = Math.abs(dir[0]) > 0.5 ? (dir[0] > 0 ? 'start' : 'end') : 'middle';
    const drop = dir[1] < -0.3 ? h : Math.abs(dir[1]) <= 0.3 ? h / 2 : 0;
    const degrees = span.sweep * 180 / Math.PI;
    text(items, [p[0], p[1] - drop], formatAngle(degrees, a.fmt, style), h, 0, anchor, 'text');
}

function note(items, a, view, s, style) {
    const P = view ? toSheet(view, s, a.p) : a.p;
    const A = view ? toSheet(view, s, a.at) : a.at;
    const L = style.arrowSize || 3;
    const h = heightOf(a.fmt, style);
    const str = a.text || '';
    leaderText(items, P, A, str, h);
    const d = unit(sub(P, A));
    if (a.end === 'dot') {
        dotMark(items, P, L * 1.6);
    } else if (a.end !== 'none') {
        arrow(items, P, d, L);
    }
}

// The primitives of one annotation (also used for the live preview while
// one is being placed)
export function annotationItems(a, data) {
    const items = [];
    const style = data.style;
    const view = a.view ? data.views.filter(function (v) {
        return v.id === a.view;
    })[0] : null;
    if (a.view && !view) {
        return items;
    }
    const s = view ? scaleOf(data, view) : 1;
    if (a.type === 'linear') {
        linear(items, a, view, s, style);
    } else if (a.type === 'radius' || a.type === 'diameter' || a.type === 'hole') {
        circular(items, a, view, s, style);
    } else if (a.type === 'angle') {
        angular(items, a, view, s, style);
    } else if (a.type === 'note') {
        note(items, a, view, s, style);
    } else if (a.type === 'text') {
        const p = view ? toSheet(view, s, a.at) : a.at;
        textLines(items, p, a.text || '', heightOf(a.fmt, style), 'start', true);
    } else if (a.type === 'center') {
        centerMark(items, toSheet(view, s, a.c), a.r * s);
    }
    return items;
}

/*
    Lay the whole sheet out.
    projections: { viewId: { edges, box } } (geometry2d clean edges)
    opts.estimate(view): a local box for a view whose edges are not there
        yet (the screen draws a placeholder frame; exports leave it out)
    Returns [{ owner, items, box? }]
*/
export function build(data, projections, opts) {
    const options = opts || {};
    const groups = [{ owner: 'sheet', items: frameItems(data.sheet, data.style) }];
    data.views.forEach(function (view) {
        const s = scaleOf(data, view);
        const proj = projections && projections[view.id];
        const items = [];
        let box = null;
        if (proj && proj.edges) {
            edgeItems(items, view, s, proj.edges);
            if (view.centers !== false) {
                viewCenters(items, view, s, proj.edges);
            }
            box = viewBox(view, s, proj.box);
        } else if (options.estimate) {
            box = viewBox(view, s, options.estimate(view));
        }
        viewLabel(items, view, s, box, data.sheet);
        groups.push({ owner: 'view:' + view.id, items: items, box: box, pending: !(proj && proj.edges) });
    });
    data.annotations.forEach(function (a) {
        groups.push({ owner: 'ann:' + a.id, items: annotationItems(a, data) });
    });
    return groups;
}

// The box of a list of primitives (for picking annotations)
export function itemsBox(items) {
    let box = null;
    const grow = function (p, pad) {
        const b = [p[0] - pad, p[1] - pad, p[0] + pad, p[1] + pad];
        box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
    };
    items.forEach(function (it) {
        if (it.t === 'line') {
            grow(it.a, 0);
            grow(it.b, 0);
        } else if (it.t === 'poly' || it.t === 'fill') {
            it.pts.forEach(function (p) {
                grow(p, 0);
            });
        } else if (it.t === 'circle' || it.t === 'arc') {
            grow(it.c, it.r);
        } else if (it.t === 'text') {
            const w = textWidth(it.text, it.h);
            const r = it.rot * Math.PI / 180;
            const shift = it.anchor === 'middle' ? -w / 2 : it.anchor === 'end' ? -w : 0;
            const ux = [Math.cos(r), Math.sin(r)];
            const uy = [-Math.sin(r), Math.cos(r)];
            [[shift, -0.3 * it.h], [shift + w, -0.3 * it.h], [shift, it.h * 1.2], [shift + w, it.h * 1.2]].forEach(function (c) {
                grow([it.p[0] + ux[0] * c[0] + uy[0] * c[1], it.p[1] + ux[1] * c[0] + uy[1] * c[1]], 0);
            });
        }
    });
    return box;
}
