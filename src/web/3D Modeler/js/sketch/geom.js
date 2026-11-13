/*
    3D Modeler - 2D sketch geometry

    Pure maths on sketch curves in plane coordinates: sampling for drawing,
    distances for picking, intersections for trim and extend. No DOM and no
    kernel, so it runs under Node.

    A resolved curve is one of
        { id, type: "line",   a: [x, y], b: [x, y] }
        { id, type: "circle", c: [x, y], r }
        { id, type: "arc",    c, r, a, b, a0, sweep }   counter clockwise from
                                                         angle a0 over `sweep`
*/

export const TAU = Math.PI * 2;
const EPS = 1e-9;

export function dist(p, q) {
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

export function angleOf(c, p) {
    return Math.atan2(p[1] - c[1], p[0] - c[0]);
}

// Angle `t` measured counter clockwise from `from`, in [0, 2 pi)
export function ccw(from, t) {
    let d = (t - from) % TAU;
    if (d < 0) {
        d += TAU;
    }
    return d;
}

export function arcFrom(id, c, a, b) {
    const a0 = angleOf(c, a);
    let sweep = ccw(a0, angleOf(c, b));
    if (sweep < 1e-9) {
        sweep = TAU; // start and end coincide: a full turn
    }
    return { id: id, type: 'arc', c: c, r: dist(c, a), a: a, b: b, a0: a0, sweep: sweep };
}

// Is the direction from the centre to p inside the arc?
export function onArc(arc, p, slack) {
    const d = ccw(arc.a0, angleOf(arc.c, p));
    const s = slack || 0;
    return d <= arc.sweep + s || d >= TAU - s;
}

// Points along a curve, both ends included (a circle repeats its first point)
export function sample(curve, step) {
    if (curve.type === 'line') {
        return [curve.a, curve.b];
    }
    const a0 = curve.type === 'arc' ? curve.a0 : 0;
    const sweep = curve.type === 'arc' ? curve.sweep : TAU;
    const n = Math.max(2, Math.ceil(sweep / (step || Math.PI / 36)));
    const out = [];
    for (let i = 0; i <= n; i++) {
        const t = a0 + sweep * i / n;
        out.push([curve.c[0] + curve.r * Math.cos(t), curve.c[1] + curve.r * Math.sin(t)]);
    }
    return out;
}

// The point of a curve nearest to p
export function nearest(curve, p) {
    if (curve.type === 'line') {
        const dx = curve.b[0] - curve.a[0];
        const dy = curve.b[1] - curve.a[1];
        const len2 = dx * dx + dy * dy;
        let t = len2 < EPS ? 0 : ((p[0] - curve.a[0]) * dx + (p[1] - curve.a[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return [curve.a[0] + dx * t, curve.a[1] + dy * t];
    }
    const d = dist(curve.c, p);
    const on = d < EPS ? [curve.c[0] + curve.r, curve.c[1]]
        : [curve.c[0] + (p[0] - curve.c[0]) * curve.r / d, curve.c[1] + (p[1] - curve.c[1]) * curve.r / d];
    if (curve.type === 'circle' || onArc(curve, on)) {
        return on;
    }
    return dist(p, curve.a) < dist(p, curve.b) ? curve.a : curve.b;
}

export function midpoint(curve) {
    if (curve.type === 'line') {
        return [(curve.a[0] + curve.b[0]) / 2, (curve.a[1] + curve.b[1]) / 2];
    }
    const t = curve.type === 'arc' ? curve.a0 + curve.sweep / 2 : Math.PI / 4;
    return [curve.c[0] + curve.r * Math.cos(t), curve.c[1] + curve.r * Math.sin(t)];
}

// Where a point sits along a curve: 0..1 on a line, the counter clockwise
// angle from the start on an arc, the absolute angle on a circle
export function paramOf(curve, p) {
    if (curve.type === 'line') {
        const dx = curve.b[0] - curve.a[0];
        const dy = curve.b[1] - curve.a[1];
        return ((p[0] - curve.a[0]) * dx + (p[1] - curve.a[1]) * dy) / (dx * dx + dy * dy || 1);
    }
    return curve.type === 'arc' ? ccw(curve.a0, angleOf(curve.c, p)) : ccw(0, angleOf(curve.c, p));
}

function lineCircle(a, b, c, r) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const fx = a[0] - c[0];
    const fy = a[1] - c[1];
    const qa = dx * dx + dy * dy;
    if (qa < EPS) {
        return [];
    }
    const qb = 2 * (fx * dx + fy * dy);
    const qc = fx * fx + fy * fy - r * r;
    let disc = qb * qb - 4 * qa * qc;
    if (disc < -1e-9 * qa * r * r) {
        return [];
    }
    disc = Math.sqrt(Math.max(disc, 0));
    const ts = disc < 1e-9 ? [-qb / (2 * qa)] : [(-qb - disc) / (2 * qa), (-qb + disc) / (2 * qa)];
    return ts.map(function (t) {
        return { t: t, p: [a[0] + dx * t, a[1] + dy * t] };
    });
}

// Intersection points of two curves. With `unbounded` the first curve is
// treated as its full line or full circle (used by extend).
export function intersect(c1, c2, unbounded) {
    const slack = 1e-7;
    const within1 = function (hit, t) {
        if (unbounded) {
            return true;
        }
        if (c1.type === 'line') {
            return t >= -slack && t <= 1 + slack;
        }
        return c1.type === 'circle' || onArc(c1, hit, slack);
    };
    const within2 = function (hit) {
        if (c2.type === 'line') {
            const t = paramOf(c2, hit);
            return t >= -slack && t <= 1 + slack;
        }
        return c2.type === 'circle' || onArc(c2, hit, slack);
    };
    let hits = [];
    if (c1.type === 'line' && c2.type === 'line') {
        const d1 = [c1.b[0] - c1.a[0], c1.b[1] - c1.a[1]];
        const d2 = [c2.b[0] - c2.a[0], c2.b[1] - c2.a[1]];
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) > EPS) {
            const t = ((c2.a[0] - c1.a[0]) * d2[1] - (c2.a[1] - c1.a[1]) * d2[0]) / den;
            hits = [{ t: t, p: [c1.a[0] + d1[0] * t, c1.a[1] + d1[1] * t] }];
        }
    } else if (c1.type === 'line') {
        hits = lineCircle(c1.a, c1.b, c2.c, c2.r);
    } else if (c2.type === 'line') {
        hits = lineCircle(c2.a, c2.b, c1.c, c1.r).map(function (h) {
            return { t: 0, p: h.p };
        });
    } else {
        const d = dist(c1.c, c2.c);
        if (d > EPS && d <= c1.r + c2.r + slack && d >= Math.abs(c1.r - c2.r) - slack) {
            const along = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
            const h = Math.sqrt(Math.max(c1.r * c1.r - along * along, 0));
            const ux = (c2.c[0] - c1.c[0]) / d;
            const uy = (c2.c[1] - c1.c[1]) / d;
            const mx = c1.c[0] + ux * along;
            const my = c1.c[1] + uy * along;
            hits = [{ t: 0, p: [mx - uy * h, my + ux * h] }];
            if (h > 1e-7) {
                hits.push({ t: 0, p: [mx + uy * h, my - ux * h] });
            }
        }
    }
    return hits.filter(function (h) {
        return within1(h.p, h.t) && within2(h.p);
    }).map(function (h) {
        return h.p;
    });
}

/* ================= construction helpers of the sketch tools ================= */

// The circle through three points: { c, r }, or null when they lie in line
export function circleThrough(a, b, p) {
    const d = 2 * (a[0] * (b[1] - p[1]) + b[0] * (p[1] - a[1]) + p[0] * (a[1] - b[1]));
    const scale = Math.max(dist(a, b) * dist(b, p), EPS);
    if (Math.abs(d) < 1e-9 * scale) {
        return null;
    }
    const a2 = a[0] * a[0] + a[1] * a[1];
    const b2 = b[0] * b[0] + b[1] * b[1];
    const p2 = p[0] * p[0] + p[1] * p[1];
    const c = [(a2 * (b[1] - p[1]) + b2 * (p[1] - a[1]) + p2 * (a[1] - b[1])) / d,
        (a2 * (p[0] - b[0]) + b2 * (a[0] - p[0]) + p2 * (b[0] - a[0])) / d];
    return { c: c, r: dist(c, a) };
}

// The arc from a to b that passes through p: { c, r, forward }, forward
// when it runs counter clockwise from a to b (arcs are stored that way, so
// otherwise it is stored from b to a). Null when the three are in line.
export function arcThrough(a, b, p) {
    const circle = circleThrough(a, b, p);
    if (!circle) {
        return null;
    }
    const from = angleOf(circle.c, a);
    return { c: circle.c, r: circle.r, forward: ccw(from, angleOf(circle.c, p)) < ccw(from, angleOf(circle.c, b)) };
}

// The arc that leaves point p heading along the unit vector t and ends at
// e: { c, r, forward } (forward: counter clockwise from p to e), or null
// when e lies straight ahead or behind (that would be a line)
export function tangentArc(p, t, e) {
    const n = [-t[1], t[0]]; // left of the heading
    const dx = e[0] - p[0];
    const dy = e[1] - p[1];
    const d2 = dx * dx + dy * dy;
    const side = dx * n[0] + dy * n[1];
    if (d2 < EPS * EPS || Math.abs(side) < 1e-6 * Math.sqrt(d2)) {
        return null;
    }
    const s = d2 / (2 * side); // signed distance from p to the centre, along n
    return { c: [p[0] + n[0] * s, p[1] + n[1] * s], r: Math.abs(s), forward: s > 0 };
}

// Round (kind "fillet") or bevel ("chamfer") the corner p between a line
// running from p towards a and one running towards b. size is the radius,
// or the distance cut back along each line. Returns { t1, t2 } (the new
// ends of the two lines) and for a fillet { c, forward } (forward: the arc
// runs counter clockwise from t1 to t2), or { error }.
export function cornerCut(p, a, b, size, kind) {
    const la = dist(p, a);
    const lb = dist(p, b);
    if (la < EPS || lb < EPS) {
        return { error: 'One of the lines has no length' };
    }
    const d1 = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
    const d2 = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const angle = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
    if (angle < 1e-6 || angle > Math.PI - 1e-6) {
        return { error: 'The two lines run in line: there is no corner here' };
    }
    const back = kind === 'fillet' ? size / Math.tan(angle / 2) : size;
    if (back >= la - 1e-9 || back >= lb - 1e-9) {
        return { error: 'The ' + (kind === 'fillet' ? 'radius' : 'distance') + ' is too large for these lines: it needs ' + (+back.toFixed(3)) + ' mm of each line' };
    }
    const out = { t1: [p[0] + d1[0] * back, p[1] + d1[1] * back], t2: [p[0] + d2[0] * back, p[1] + d2[1] * back] };
    if (kind === 'fillet') {
        const bx = d1[0] + d2[0];
        const by = d1[1] + d2[1];
        const bl = Math.hypot(bx, by);
        const reach = size / Math.sin(angle / 2);
        out.c = [p[0] + bx / bl * reach, p[1] + by / bl * reach];
        out.forward = (out.t1[0] - out.c[0]) * (out.t2[1] - out.c[1]) - (out.t1[1] - out.c[1]) * (out.t2[0] - out.c[0]) > 0;
    }
    return out;
}
