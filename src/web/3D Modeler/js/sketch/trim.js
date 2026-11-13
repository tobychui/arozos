/*
    3D Modeler - trim and extend

    Trim removes the piece of a curve under the cursor, up to the nearest
    crossings with other curves on either side. Extend lengthens the end of a
    line or arc nearest the cursor until it meets another curve. Both keep the
    new end on the curve it stopped at with a "point on curve" constraint, so
    the sketch stays connected when it is dragged afterwards.

    Pure data on a sketch (see model.js); no DOM.
*/

import * as M from './model.js';
import { intersect, paramOf, dist, TAU, angleOf, ccw } from './geom.js';

const EDGE = 1e-7;

// Crossings of curve `id` with every other curve: [{ t, p, with }] sorted by t
function crossings(sk, target, unbounded) {
    const out = [];
    M.curves(sk).forEach(function (other) {
        if (other.id === target.id) {
            return;
        }
        intersect(target, other, unbounded).forEach(function (p) {
            out.push({ t: paramOf(target, p), p: p, with: other.id });
        });
    });
    return out.sort(function (a, b) {
        return a.t - b.t;
    });
}

// A new point at a crossing, tied to the curve that was crossed
function pinned(sk, hit) {
    const id = M.addPoint(sk, hit.p[0], hit.p[1]);
    M.addConstraint(sk, { type: 'pointon', p: id, curve: hit.with });
    return id;
}

function copyDirection(sk, fromId, toId) {
    sk.constraints.filter(function (c) {
        return (c.type === 'horizontal' || c.type === 'vertical') && c.line === fromId;
    }).forEach(function (c) {
        M.addConstraint(sk, { type: c.type, line: toId });
    });
}

// Drop points that lost their last curve (and the constraints on them)
function sweepOrphans(sk, ids) {
    M.remove(sk, ids.filter(function (id) {
        return id !== M.ORIGIN;
    }));
}

// Trim the curve `id` at the place the user clicked (plane coordinates).
// Returns false when there is nothing to do.
export function trim(sk, id, at) {
    const g = M.find(sk, id);
    const target = M.curve(sk, id);
    if (!g || !target) {
        return false;
    }
    const click = paramOf(target, at);

    if (g.type === 'circle') {
        const hits = crossings(sk, target).filter(function (h, i, all) {
            return i === 0 || Math.abs(h.t - all[i - 1].t) > EDGE;
        });
        if (hits.length < 2) {
            M.remove(sk, [id]);
            return true;
        }
        // The piece under the cursor lies between `before` and `after`
        let after = hits.filter(function (h) {
            return h.t > click;
        })[0] || hits[0];
        let before = hits.filter(function (h) {
            return h.t < click;
        }).pop() || hits[hits.length - 1];
        // What remains runs counter clockwise from `after` round to `before`.
        // The circle becomes an arc in place, so constraints on it stay valid.
        g.type = 'arc';
        g.start = pinned(sk, after);
        g.end = pinned(sk, before);
        delete g.r;
        return true;
    }

    const end = g.type === 'line' ? 1 : target.sweep;
    const hits = crossings(sk, target).filter(function (h) {
        return h.t > EDGE && h.t < end - EDGE;
    });
    const before = hits.filter(function (h) {
        return h.t < click;
    }).pop();
    const after = hits.filter(function (h) {
        return h.t > click;
    })[0];
    const first = g.type === 'line' ? 'p1' : 'start';
    const last = g.type === 'line' ? 'p2' : 'end';
    if (!before && !after) {
        M.remove(sk, [id]);
        return true;
    }
    const loose = [];
    if (before && after) {
        // Cut out the middle: this curve keeps the first part, a new curve takes the rest
        const tail = g[last];
        g[last] = pinned(sk, before);
        const from = pinned(sk, after);
        const made = g.type === 'line' ? M.addLine(sk, from, tail, g.construction) : M.addArc(sk, g.c, from, tail, g.construction);
        if (g.type === 'line') {
            copyDirection(sk, id, made);
        }
    } else if (before) {
        loose.push(g[last]);
        g[last] = pinned(sk, before);
    } else {
        loose.push(g[first]);
        g[first] = pinned(sk, after);
    }
    sweepOrphans(sk, loose);
    return true;
}

// Extend the end of line or arc `id` nearest to `at` to the next curve it
// would meet. Returns false when it meets nothing.
export function extend(sk, id, at) {
    const g = M.find(sk, id);
    const target = M.curve(sk, id);
    if (!g || !target || g.type === 'circle') {
        return false;
    }
    const atEnd = dist(at, target.b) < dist(at, target.a);
    const hits = crossings(sk, target, true);
    let hit = null;
    if (g.type === 'line') {
        hit = atEnd ? hits.filter(function (h) {
            return h.t > 1 + EDGE;
        })[0] : hits.filter(function (h) {
            return h.t < -EDGE;
        }).pop();
    } else {
        // On the full circle, everything past the sweep is "beyond the end"
        // going counter clockwise and "before the start" going clockwise
        const beyond = hits.map(function (h) {
            return { t: ccw(target.a0, angleOf(target.c, h.p)), p: h.p, with: h.with };
        }).filter(function (h) {
            return h.t > target.sweep + EDGE && h.t < TAU - EDGE;
        }).sort(function (a, b) {
            return a.t - b.t;
        });
        hit = atEnd ? beyond[0] : beyond.pop();
    }
    if (!hit) {
        return false;
    }
    const field = g.type === 'line' ? (atEnd ? 'p2' : 'p1') : (atEnd ? 'end' : 'start');
    const old = g[field];
    g[field] = pinned(sk, hit);
    sweepOrphans(sk, [old]);
    return true;
}
