/*
    3D Modeler - 2D geometry of drawing views

    The kernel (js/kernel/drawing.js) hands back the projected edges of a
    view as the hidden line remover makes them: lines, circles and
    polylines, often cut into many short pieces where visibility changes or
    where two curves cross in the projection. cleanEdges() joins pieces that
    run on into each other and finds out which polylines are really straight
    lines or circles (a hole drilled through a round boss projects to a
    circle, but the kernel only sees a 3D curve), so dimensions can be put
    on them. The other functions answer "what is under the pointer" and
    "where can a dimension snap to".

    All coordinates here are a view's own: model millimetres in the paper
    plane (x right, y up), before the view's scale and place on the sheet.

    A clean edge is
        { id, visible, kind, type: "line" | "circle" | "curve", pts }
    plus for a line a, b (end points); for a circle or an arc c, r, closed,
    a0 (start angle, radians) and sweep (counter-clockwise, radians).
*/

const JOIN = 1e-4;          // pieces closer than this (mm) meet
const TINY = 1e-4;          // pieces shorter than this are dropped

export function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function polyLength(pts) {
    let length = 0;
    for (let i = 2; i < pts.length; i += 2) {
        length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    }
    return length;
}

function key(x, y) {
    return Math.round(x / JOIN) + ',' + Math.round(y / JOIN);
}

// The circle through three points, or null when they are in a line
export function circleFrom3(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) {
        return null;
    }
    const a2 = a[0] * a[0] + a[1] * a[1];
    const b2 = b[0] * b[0] + b[1] * b[1];
    const c2 = c[0] * c[0] + c[1] * c[1];
    const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
    const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return { c: [x, y], r: Math.hypot(a[0] - x, a[1] - y) };
}

function pointAt(pts, i) {
    return [pts[2 * i], pts[2 * i + 1]];
}

// Straight? Returns the two outermost points of a polyline that lies on one
// line (an edge-on circle runs there and back), or null
function asLine(pts) {
    const n = pts.length / 2;
    const first = pointAt(pts, 0);
    let far = first;
    let best = 0;
    for (let i = 1; i < n; i++) {
        const p = pointAt(pts, i);
        const d = dist(p, first);
        if (d > best) {
            best = d;
            far = p;
        }
    }
    let other = far;
    best = 0;
    for (let i = 0; i < n; i++) {
        const p = pointAt(pts, i);
        const d = dist(p, far);
        if (d > best) {
            best = d;
            other = p;
        }
    }
    const length = dist(far, other);
    if (length < TINY) {
        return null;
    }
    const ux = (other[0] - far[0]) / length;
    const uy = (other[1] - far[1]) / length;
    const tol = 2e-4 + length * 1e-6;
    for (let i = 0; i < n; i++) {
        const p = pointAt(pts, i);
        if (Math.abs((p[0] - far[0]) * uy - (p[1] - far[1]) * ux) > tol) {
            return null;
        }
    }
    // Keep the direction the polyline runs in
    return dist(first, far) <= dist(first, other) ? [far, other] : [other, far];
}

// A circle or an arc? { c, r, closed, a0, sweep } or null. `exact` is the
// kernel's circle when it knows one ({ c, r }).
function asCircle(pts, exact) {
    const n = pts.length / 2;
    if (n < (exact ? 2 : 4)) {
        return null;
    }
    const fit = exact || circleFrom3(pointAt(pts, 0), pointAt(pts, Math.floor(n / 3)), pointAt(pts, Math.floor(2 * n / 3)));
    if (!fit || fit.r > 1e5) {
        return null;
    }
    const tol = Math.max(5e-4, fit.r * 2e-4);
    let sweep = 0;
    let previous = null;
    for (let i = 0; i < n; i++) {
        const p = pointAt(pts, i);
        if (Math.abs(dist(p, fit.c) - fit.r) > tol) {
            return null;
        }
        const angle = Math.atan2(p[1] - fit.c[1], p[0] - fit.c[0]);
        if (previous !== null) {
            let step = angle - previous;
            if (step > Math.PI) {
                step -= 2 * Math.PI;
            } else if (step < -Math.PI) {
                step += 2 * Math.PI;
            }
            sweep += step;
        }
        previous = angle;
    }
    // Joined pieces of a circle may run round it a little more than once
    const closed = Math.abs(sweep) > 2 * Math.PI - 1e-3 || (dist(pointAt(pts, 0), pointAt(pts, n - 1)) < 1e-3 && Math.abs(sweep) > Math.PI);
    const start = pointAt(pts, sweep >= 0 ? 0 : n - 1);
    return {
        c: fit.c, r: fit.r, closed: closed,
        a0: Math.atan2(start[1] - fit.c[1], start[0] - fit.c[0]),
        sweep: closed ? 2 * Math.PI : Math.abs(sweep)
    };
}

// Give a polyline its true type
function classify(edge) {
    const pts = edge.pts;
    if (pts.length === 4) {
        edge.type = 'line';
        edge.a = [pts[0], pts[1]];
        edge.b = [pts[2], pts[3]];
        return edge;
    }
    const line = asLine(pts);
    if (line) {
        edge.type = 'line';
        edge.a = line[0];
        edge.b = line[1];
        edge.pts = [line[0][0], line[0][1], line[1][0], line[1][1]];
        return edge;
    }
    const exact = edge.exact && edge.exact !== 'none' ? edge.exact : null;
    delete edge.exact;
    const circle = asCircle(pts, exact);
    // A short piece of a curve fits many circles: only trust a fit that
    // covers a fair part of one, or the kernel's own circle
    if (circle && (exact || circle.sweep > 0.35)) {
        edge.type = 'circle';
        Object.assign(edge, circle);
        return edge;
    }
    edge.type = 'curve';
    return edge;
}

// The direction a polyline leaves its first point
function startDirection(pts) {
    for (let i = 2; i < pts.length; i += 2) {
        const dx = pts[i] - pts[0];
        const dy = pts[i + 1] - pts[1];
        const len = Math.hypot(dx, dy);
        if (len > 1e-7) {
            return [dx / len, dy / len];
        }
    }
    return [1, 0];
}

function reversed(pts) {
    const r = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) {
        r.push(pts[i], pts[i + 1]);
    }
    return r;
}

// Join curve pieces of the same visibility and kind that run on into each
// other smoothly. Where curves cross or lie on top of each other in the
// projection (a hole through a round boss shows its two ends in the same
// place) several pieces meet at one point; the one that carries on in the
// same direction is taken.
const SMOOTH = Math.cos(25 * Math.PI / 180);

function chain(pieces) {
    const byEnd = {};
    pieces.forEach(function (p, i) {
        const n = p.pts.length;
        [key(p.pts[0], p.pts[1]), key(p.pts[n - 2], p.pts[n - 1])].forEach(function (k) {
            (byEnd[k] = byEnd[k] || []).push(i);
        });
    });
    const used = new Array(pieces.length).fill(false);
    const out = [];
    // Extend a chain at its end with unused pieces
    const grow = function (c) {
        for (;;) {
            const pts = c.pts;
            const n = pts.length;
            const k = key(pts[n - 2], pts[n - 1]);
            const back = startDirection(reversed(pts));
            const ahead = [-back[0], -back[1]];
            let best = -1;
            let bestPts = null;
            let bestScore = SMOOTH;
            (byEnd[k] || []).forEach(function (i) {
                if (used[i]) {
                    return;
                }
                let more = pieces[i].pts;
                if (key(more[0], more[1]) !== k) {
                    more = reversed(more);
                }
                const d = startDirection(more);
                const score = d[0] * ahead[0] + d[1] * ahead[1];
                if (score > bestScore) {
                    bestScore = score;
                    best = i;
                    bestPts = more;
                }
            });
            if (best < 0) {
                return c;
            }
            used[best] = true;
            c.pts = pts.concat(bestPts.slice(2));
            c.exact = sameExact(c.exact, pieces[best].exact);
        }
    };
    pieces.forEach(function (p, i) {
        if (used[i]) {
            return;
        }
        used[i] = true;
        const c = { visible: p.visible, kind: p.kind, type: 'curve', pts: p.pts.slice(), exact: p.exact };
        grow(c);
        c.pts = reversed(c.pts);
        grow(c);
        c.pts = reversed(c.pts);
        out.push(c);
    });
    return out;
}

// The kernel's exact circle of a chain: kept while every piece has the same
function sameExact(a, b) {
    if (!a || !b || a === 'none' || b === 'none') {
        return 'none';
    }
    return dist(a.c, b.c) < 1e-6 && Math.abs(a.r - b.r) < 1e-6 ? a : 'none';
}

// Leave out pieces that lie on a full circle already there: what is left
// over where two curves fall on the same place in the projection. A
// hidden piece under a visible circle goes too.
function dropCovered(edges) {
    const circles = edges.filter(function (e) {
        return e.type === 'circle' && e.closed;
    });
    if (!circles.length) {
        return edges;
    }
    return edges.filter(function (e) {
        return !circles.some(function (c) {
            if (c === e || (!c.visible && e.visible) || (e.type === 'circle' && e.closed && e.visible === c.visible && circles.indexOf(e) < circles.indexOf(c))) {
                return false;
            }
            const tol = Math.max(1e-3, c.r * 1e-3);
            for (let i = 0; i < e.pts.length; i += 2) {
                if (Math.abs(Math.hypot(e.pts[i] - c.c[0], e.pts[i + 1] - c.c[1]) - c.r) > tol) {
                    return false;
                }
            }
            return true;
        });
    });
}

/*
    Clean the raw edges of one view: drop specks, join curve pieces, find
    lines and circles, number them. Lines stay as they come: two lines
    meeting end to end are real corners as often as not.
*/
export function cleanEdges(raw) {
    const lines = [];
    const groups = {};
    (raw || []).forEach(function (e) {
        if (!e || !e.pts || e.pts.length < 4 || polyLength(e.pts) < TINY) {
            return;
        }
        const copy = { visible: !!e.visible, kind: e.kind || 'sharp', type: e.type, pts: Array.from(e.pts) };
        copy.exact = e.type === 'circle' && e.c ? { c: e.c, r: e.r } : 'none';
        if (copy.type === 'line') {
            lines.push(copy);
        } else {
            const g = (copy.visible ? 'v' : 'h') + copy.kind;
            (groups[g] = groups[g] || []).push(copy);
        }
    });
    let out = lines.map(classify);
    Object.keys(groups).forEach(function (g) {
        out = out.concat(chain(groups[g]).map(classify));
    });
    out = dropCovered(out);
    out.forEach(function (e, i) {
        e.id = i;
    });
    return out;
}

export function boundsOf(edges) {
    let box = null;
    edges.forEach(function (e) {
        for (let i = 0; i < e.pts.length; i += 2) {
            const x = e.pts[i];
            const y = e.pts[i + 1];
            if (!box) {
                box = [x, y, x, y];
            } else {
                box[0] = Math.min(box[0], x);
                box[1] = Math.min(box[1], y);
                box[2] = Math.max(box[2], x);
                box[3] = Math.max(box[3], y);
            }
        }
    });
    return box;
}

// The nearest point of segment ab to p: { point, d, t }
export function nearestOnSegment(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const point = [a[0] + t * dx, a[1] + t * dy];
    return { point: point, d: dist(p, point), t: t };
}

// Distance from p to an edge
export function distanceToEdge(p, edge) {
    if (edge.type === 'circle' && edge.closed) {
        return Math.abs(dist(p, edge.c) - edge.r);
    }
    let best = Infinity;
    const pts = edge.pts;
    for (let i = 2; i < pts.length; i += 2) {
        const d = nearestOnSegment(p, [pts[i - 2], pts[i - 1]], [pts[i], pts[i + 1]]).d;
        if (d < best) {
            best = d;
        }
    }
    return best;
}

// The edge nearest to p within `tol`, visible edges first: edge or null
export function edgeAt(edges, p, tol) {
    let best = null;
    let bestD = tol;
    edges.forEach(function (e) {
        const d = distanceToEdge(p, e) + (e.visible ? 0 : tol * 0.5);
        if (d < bestD) {
            bestD = d;
            best = e;
        }
    });
    return best;
}

// The points a dimension can snap to: line ends and middles, circle and arc
// centres, arc and curve ends. [{ p, kind: "end" | "mid" | "center", edge }]
export function snapPoints(edges) {
    const out = [];
    const seen = {};
    const add = function (p, kind, edge) {
        const k = kind + key(p[0], p[1]);
        if (!seen[k]) {
            seen[k] = true;
            out.push({ p: p, kind: kind, edge: edge.id });
        }
    };
    edges.forEach(function (e) {
        const n = e.pts.length;
        if (e.type === 'line') {
            add(e.a, 'end', e);
            add(e.b, 'end', e);
            add([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], 'mid', e);
        } else if (e.type === 'circle') {
            add(e.c, 'center', e);
            if (!e.closed) {
                add([e.pts[0], e.pts[1]], 'end', e);
                add([e.pts[n - 2], e.pts[n - 1]], 'end', e);
            }
        } else {
            add([e.pts[0], e.pts[1]], 'end', e);
            add([e.pts[n - 2], e.pts[n - 1]], 'end', e);
        }
    });
    return out;
}

// The snap point nearest to p within tol, or null
export function snapAt(snaps, p, tol) {
    let best = null;
    let bestD = tol;
    snaps.forEach(function (s) {
        // A centre wins over an end point at the same distance
        const d = dist(p, s.p) - (s.kind === 'center' ? tol * 0.1 : 0);
        if (d < bestD) {
            bestD = d;
            best = s;
        }
    });
    return best;
}

// How many visible full circles of radius r the view has (a hole note
// says "4x" for four equal holes)
export function countCircles(edges, r) {
    const seen = {};
    let n = 0;
    edges.forEach(function (e) {
        if (e.type === 'circle' && e.closed && Math.abs(e.r - r) < Math.max(1e-3, r * 1e-4)) {
            const k = key(e.c[0], e.c[1]);
            if (!seen[k]) {
                seen[k] = true;
                n++;
            }
        }
    });
    return n;
}

// Does the view still have geometry at p (an end, a middle, a centre, or a
// point on an edge)? Used to mark dimensions whose model changed under them.
export function onGeometry(edges, p, tol) {
    return edges.some(function (e) {
        return distanceToEdge(p, e) <= tol || (e.type === 'circle' && dist(p, e.c) <= tol);
    });
}

// Is there a circle with this centre and radius?
export function hasCircle(edges, c, r, tol) {
    return edges.some(function (e) {
        return e.type === 'circle' && dist(e.c, c) <= tol && Math.abs(e.r - r) <= tol;
    });
}

// The intersection of the lines through a1-a2 and b1-b2, or null if parallel
export function lineIntersection(a1, a2, b1, b2) {
    const d1 = [a2[0] - a1[0], a2[1] - a1[1]];
    const d2 = [b2[0] - b1[0], b2[1] - b1[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    const l1 = Math.hypot(d1[0], d1[1]);
    const l2 = Math.hypot(d2[0], d2[1]);
    if (!l1 || !l2 || Math.abs(den) / (l1 * l2) < 1e-9) {
        return null;
    }
    const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / den;
    return [a1[0] + t * d1[0], a1[1] + t * d1[1]];
}
