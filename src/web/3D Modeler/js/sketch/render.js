/*
    3D Modeler - sketch overlay drawing

    Draws the open sketch as SVG on top of the 3D view: curves, points,
    constraint glyphs, dimensions and the rubber band of the active tool.
    SVG keeps lines one pixel sharp at any zoom and gives real text.

    draw() rebuilds the whole overlay from the sketch each time and returns
    the screen positions of everything it drew, which the sketcher uses for
    hit testing:
        { points: [{ id, x, y }], curves: [{ id, pts: [[x, y], ...] }],
          dims: [{ id, x, y, w, h }], badges: [{ id, x, y, w, h }] }
*/

import * as M from './model.js';
import { sample, midpoint, dist, intersect } from './geom.js';
import { toWorld } from '../kernel/profile.js';

const BADGE_ICONS = {
    horizontal: 'horizontal', vertical: 'vertical', parallel: 'parallel', perpendicular: 'perpendicular',
    collinear: 'collinear',
    tangent: 'tangent', equal: 'equal', fix: 'fix', midpoint: 'midpoint', symmetric: 'mirror'
};
const BADGE = 15;
const GRID_PIXELS = 18;
const GRID_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

// The sketch grid, so sizes can be judged before they are typed. The plane
// faces the camera while sketching, so screen = O + u * U + v * V is close
// enough to find which lines are on screen. Every fifth line is stronger.
function gridLines(view, to, out) {
    const width = view.width || 0;
    const height = view.height || 0;
    if (!width || !height || view.grid === false) {
        return;
    }
    const o = to([0, 0]);
    const ux = to([1, 0]);
    const vy = to([0, 1]);
    const U = [ux[0] - o[0], ux[1] - o[1]];
    const V = [vy[0] - o[0], vy[1] - o[1]];
    const det = U[0] * V[1] - U[1] * V[0];
    const perMm = Math.hypot(U[0], U[1]);
    if (Math.abs(det) < 1e-9 || !(perMm > 0)) {
        return; // seen edge-on
    }
    const step = GRID_STEPS.filter(function (s) {
        return s * perMm >= GRID_PIXELS;
    })[0];
    if (!step) {
        return;
    }
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    [[0, 0], [width, 0], [0, height], [width, height]].forEach(function (p) {
        const x = p[0] - o[0];
        const y = p[1] - o[1];
        const u = (x * V[1] - y * V[0]) / det;
        const v = (U[0] * y - U[1] * x) / det;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
    });
    const minor = [];
    const major = [];
    const line = function (a, b) {
        const p = to(a);
        const q = to(b);
        return 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + 'L' + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    };
    for (let i = Math.ceil(u0 / step); i <= Math.floor(u1 / step) && i - Math.ceil(u0 / step) < 400; i++) {
        (i % 5 === 0 ? major : minor).push(line([i * step, v0], [i * step, v1]));
    }
    for (let j = Math.ceil(v0 / step); j <= Math.floor(v1 / step) && j - Math.ceil(v0 / step) < 400; j++) {
        (j % 5 === 0 ? major : minor).push(line([u0, j * step], [u1, j * step]));
    }
    out.push('<path class="sk-grid" d="' + minor.join('') + '"/><path class="sk-grid sk-grid-major" d="' + major.join('') + '"/>');
}

export function formatLength(value) {
    return String(+Math.abs(value).toFixed(3));
}

export function formatAngle(radians) {
    return +(Math.abs(radians) * 180 / Math.PI).toFixed(2) + '°';
}

// The text a dimension shows
export function dimensionLabel(d) {
    let text;
    if (d.type === 'angle' || d.type === 'axisangle') {
        text = formatAngle(d.value);
    } else {
        text = (d.type === 'radius' ? 'R' : d.type === 'diameter' ? 'Ø' : '') + formatLength(d.value);
    }
    // A driven (reference) dimension is shown in brackets, as in Inventor
    return d.driven ? '(' + text + ')' : text;
}

function f(n) {
    return n.toFixed(1);
}

function path(pts) {
    return 'M' + pts.map(function (p) {
        return f(p[0]) + ' ' + f(p[1]);
    }).join('L');
}

// view: { sk, frame, project(world) -> [x, y], hover, selected: Set, dof,
//         fixed: Set of geometry ids that cannot move any more,
//         bad: Set of constraint ids, preview: { curves, dims, snap } | null }
export function draw(svg, view) {
    const sk = view.sk;
    const to = function (p) {
        return view.project(toWorld(view.frame, p[0], p[1]));
    };
    const cache = { points: [], curves: [], dims: [], badges: [] };
    const out = [];
    const state = function (id) {
        return view.selected.has(id) ? ' sk-sel' : view.hover === id ? ' sk-hot' : '';
    };

    /* ---- grid: lines every 1, 2 or 5 units at least GRID_PIXELS apart ---- */
    gridLines(view, to, out);

    // Plane axes through the origin
    out.push('<path class="sk-axis" d="' + path([to([-2000, 0]), to([2000, 0])]) + path([to([0, -2000]), to([0, 2000])]) + '"/>');

    /* ---- curves ---- */
    const resolved = M.curves(sk);
    const byId = {};
    resolved.forEach(function (c) {
        byId[c.id] = c;
        const pts = sample(c).map(to);
        cache.curves.push({ id: c.id, pts: pts });
        const cls = 'sk-curve' + (c.construction ? ' sk-construction' : c.ref ? ' sk-ref' : view.fixed.has(c.id) ? ' sk-fixed' : '') + state(c.id);
        out.push('<path class="' + cls + '" d="' + path(pts) + '"/>');
    });

    /* ---- dimensions ---- */
    const label = function (d, at, preview) {
        const text = dimensionLabel(d);
        const w = text.length * 6.6 + 8;
        const p = to(at);
        if (!preview) {
            cache.dims.push({ id: d.id, x: p[0] - w / 2, y: p[1] - 8, w: w, h: 16 });
        }
        const cls = 'sk-dimtext' + (preview ? '' : state(d.id)) + (view.bad.has(d.id) ? ' sk-bad' : '');
        return '<rect class="sk-dimbox" x="' + f(p[0] - w / 2) + '" y="' + f(p[1] - 8) + '" width="' + f(w) + '" height="16" rx="3"/>' +
            '<text class="' + cls + '" x="' + f(p[0]) + '" y="' + f(p[1]) + '">' + text + '</text>';
    };
    // An arrow head at screen point `tip` pointing away from `from`
    const arrow = function (tip, from) {
        const dx = tip[0] - from[0];
        const dy = tip[1] - from[1];
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        return 'M' + f(tip[0]) + ' ' + f(tip[1]) + 'L' + f(tip[0] - ux * 8 + uy * 3) + ' ' + f(tip[1] - uy * 8 - ux * 3) +
            'L' + f(tip[0] - ux * 8 - uy * 3) + ' ' + f(tip[1] - uy * 8 + ux * 3) + 'Z';
    };
    // Dimension between two points, measured along `axis` ("x", "y" or the line through them)
    const linear = function (d, a, b, axis, preview) {
        const pos = d.pos || [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let a2;
        let b2;
        if (axis === 'x') {
            a2 = [a[0], pos[1]];
            b2 = [b[0], pos[1]];
        } else if (axis === 'y') {
            a2 = [pos[0], a[1]];
            b2 = [pos[0], b[1]];
        } else {
            const len = dist(a, b) || 1;
            const nx = -(b[1] - a[1]) / len;
            const ny = (b[0] - a[0]) / len;
            const off = (pos[0] - a[0]) * nx + (pos[1] - a[1]) * ny;
            a2 = [a[0] + nx * off, a[1] + ny * off];
            b2 = [b[0] + nx * off, b[1] + ny * off];
        }
        const sa = to(a2);
        const sb = to(b2);
        return '<path class="sk-dim" d="' + path([to(a), sa]) + path([to(b), sb]) + path([sa, sb]) + path([sa, to(pos)]) + '"/>' +
            '<path class="sk-dimarrow" d="' + arrow(sa, sb) + arrow(sb, sa) + '"/>' + label(d, pos, preview);
    };
    const dimension = function (d, preview) {
        if (d.type === 'distance' || d.type === 'hdistance' || d.type === 'vdistance') {
            const a = M.point(sk, d.a);
            const b = M.point(sk, d.b);
            return a && b ? linear(d, a, b, d.type === 'hdistance' ? 'x' : d.type === 'vdistance' ? 'y' : '', preview) : '';
        }
        if (d.type === 'pldistance') {
            const p = M.point(sk, d.p);
            const line = byId[d.line];
            if (!p || !line) {
                return '';
            }
            const dx = line.b[0] - line.a[0];
            const dy = line.b[1] - line.a[1];
            const t = ((p[0] - line.a[0]) * dx + (p[1] - line.a[1]) * dy) / (dx * dx + dy * dy || 1);
            return linear(d, [line.a[0] + dx * t, line.a[1] + dy * t], p, '', preview);
        }
        if (d.type === 'radius' || d.type === 'diameter') {
            const c = byId[d.curve];
            if (!c) {
                return '';
            }
            const pos = d.pos || [c.c[0] + c.r * 1.4, c.c[1] + c.r * 1.4];
            const len = dist(pos, c.c) || 1;
            const ux = (pos[0] - c.c[0]) / len;
            const uy = (pos[1] - c.c[1]) / len;
            const near = to([c.c[0] + ux * c.r, c.c[1] + uy * c.r]);
            const far = to([c.c[0] - ux * c.r, c.c[1] - uy * c.r]);
            const sp = to(pos);
            if (d.type === 'radius') {
                return '<path class="sk-dim" d="' + path([to(c.c), near]) + path([near, sp]) + '"/>' +
                    '<path class="sk-dimarrow" d="' + arrow(near, to(c.c)) + '"/>' + label(d, pos, preview);
            }
            return '<path class="sk-dim" d="' + path([far, near]) + path([near, sp]) + '"/>' +
                '<path class="sk-dimarrow" d="' + arrow(near, far) + arrow(far, near) + '"/>' + label(d, pos, preview);
        }
        if (d.type === 'axisangle') {
            // From the sketch X axis (a dashed reference from the start) to
            // the direction of the line, round the start point
            const a = M.point(sk, d.a);
            const b = M.point(sk, d.b);
            if (!a || !b) {
                return '';
            }
            const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const pos = d.pos || [a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4];
            const r = dist(pos, a) || 1;
            const pts = [];
            for (let i = 0; i <= 24; i++) {
                const t = angle * i / 24;
                pts.push(to([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]));
            }
            return '<path class="sk-dim sk-dimref" d="' + path([to(a), to([a[0] + r * 1.15, a[1]])]) + '"/>' +
                '<path class="sk-dim" d="' + path(pts) + '"/><path class="sk-dimarrow" d="' +
                arrow(pts[24], pts[23]) + '"/>' + label(d, pos, preview);
        }
        if (d.type === 'angle') {
            const l1 = byId[d.l1];
            const l2 = byId[d.l2];
            if (!l1 || !l2) {
                return '';
            }
            const corner = intersect(l1, l2, true).concat(intersect(l2, l1, true))[0];
            const pos = d.pos || midpoint(l1);
            if (!corner) {
                return label(d, pos, preview);
            }
            // Each line as a ray from the corner towards its far end
            const ray = function (line) {
                const far = dist(corner, line.a) > dist(corner, line.b) ? line.a : line.b;
                return Math.atan2(far[1] - corner[1], far[0] - corner[0]);
            };
            const r = dist(pos, corner) || 1;
            const a1 = ray(l1);
            let sweep = ray(l2) - a1;
            while (sweep > Math.PI) {
                sweep -= Math.PI * 2;
            }
            while (sweep < -Math.PI) {
                sweep += Math.PI * 2;
            }
            const pts = [];
            for (let i = 0; i <= 24; i++) {
                const t = a1 + sweep * i / 24;
                pts.push(to([corner[0] + r * Math.cos(t), corner[1] + r * Math.sin(t)]));
            }
            return '<path class="sk-dim" d="' + path(pts) + '"/><path class="sk-dimarrow" d="' +
                arrow(pts[0], pts[1]) + arrow(pts[24], pts[23]) + '"/>' + label(d, pos, preview);
        }
        return '';
    };

    /* ---- constraint glyphs ---- */
    const stacked = {};
    const badge = function (c, anchor) {
        if (view.glyphs === false) {
            return; // hidden with F9
        }
        const p = to(anchor);
        const key = Math.round(p[0] / 4) + ',' + Math.round(p[1] / 4);
        const n = stacked[key] = (stacked[key] || 0) + 1;
        const x = p[0] + 8 + (n - 1) * (BADGE + 2);
        const y = p[1] - BADGE - 6;
        cache.badges.push({ id: c.id, x: x, y: y, w: BADGE, h: BADGE });
        out.push('<g class="sk-badge' + state(c.id) + (view.bad.has(c.id) ? ' sk-bad' : '') + '">' +
            '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + BADGE + '" height="' + BADGE + '" rx="3"/>' +
            '<use href="#ic-' + BADGE_ICONS[c.type] + '" x="' + f(x + 2) + '" y="' + f(y + 2) + '" width="' + (BADGE - 4) + '" height="' + (BADGE - 4) + '"/></g>');
    };
    const joints = [];
    sk.constraints.forEach(function (c) {
        if (M.isDimension(c)) {
            out.push(dimension(c, false));
            return;
        }
        if (c.type === 'coincident' || c.type === 'pointon') {
            const p = M.point(sk, c.type === 'coincident' ? c.a : c.p);
            if (p) {
                joints.push({ c: c, p: p });
            }
            return;
        }
        // One glyph on every curve the constraint touches, else at its first point
        const anchors = M.refs(c).map(function (id) {
            return byId[id] ? midpoint(byId[id]) : null;
        }).filter(Boolean);
        if (!anchors.length) {
            const p = M.point(sk, M.refs(c)[0]);
            if (p) {
                anchors.push(p);
            }
        }
        anchors.forEach(function (anchor) {
            badge(c, anchor);
        });
    });

    /* ---- points ---- */
    const origin = to([0, 0]);
    cache.points.push({ id: M.ORIGIN, x: origin[0], y: origin[1] });
    out.push('<circle class="sk-origin' + state(M.ORIGIN) + '" cx="' + f(origin[0]) + '" cy="' + f(origin[1]) + '" r="' + (state(M.ORIGIN) ? 5.5 : 4) + '"/>');
    sk.geometry.forEach(function (g) {
        if (g.type !== 'point') {
            return;
        }
        const p = to([g.x, g.y]);
        cache.points.push({ id: g.id, x: p[0], y: p[1] });
        out.push('<circle class="sk-point' + (g.ref ? ' sk-ref' : view.fixed.has(g.id) ? ' sk-fixed' : '') + state(g.id) + '" cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="' + (state(g.id) ? 5 : 3) + '"/>');
    });
    // A coincidence shows as a small dot on the point; it is picked like a glyph
    joints.forEach(function (j) {
        if (view.glyphs === false) {
            return;
        }
        const p = to(j.p);
        cache.badges.push({ id: j.c.id, x: p[0] - 5, y: p[1] - 5, w: 10, h: 10 });
        out.push('<circle class="sk-joint' + state(j.c.id) + (view.bad.has(j.c.id) ? ' sk-bad' : '') + '" cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="2.2"/>');
    });

    /* ---- tool preview ---- */
    const preview = view.preview;
    if (preview) {
        (preview.curves || []).forEach(function (c) {
            out.push('<path class="sk-preview' + (c.construction ? ' sk-preview-construction' : '') + '" d="' + path(sample(c).map(to)) + '"/>');
        });
        (preview.dims || []).forEach(function (d) {
            out.push('<g class="sk-previewdim">' + dimension(d, true) + '</g>');
        });
        const s = preview.snap;
        if (s && (s.point || s.curve || s.mid || s.h || s.v)) {
            const p = to(s.pt);
            if (s.point) {
                out.push('<circle class="sk-snap" cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="6"/>');
            } else if (s.mid) {
                out.push('<path class="sk-snap" d="M' + f(p[0]) + ' ' + f(p[1] - 7) + 'l6 11h-12z"/>');
            } else if (s.curve) {
                out.push('<path class="sk-snap" d="M' + f(p[0] - 5) + ' ' + f(p[1] - 5) + 'l10 10m0 -10l-10 10"/>');
            } else {
                out.push('<use class="sk-snapicon" href="#ic-' + (s.h ? 'horizontal' : 'vertical') + '" x="' + f(p[0] + 10) + '" y="' + f(p[1] + 8) + '" width="14" height="14"/>');
            }
        }
    }

    svg.innerHTML = out.join('');
    return cache;
}
