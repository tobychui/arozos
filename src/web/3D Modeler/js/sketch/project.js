/*
    3D Modeler - projected geometry

    Brings edges of the model into a sketch as reference geometry: fixed
    curves the sketch can snap, constrain and dimension to, and that count as
    profile boundaries. A sketch started on a face gets the edges of that face
    this way, and the Project Geometry tool adds any other edge or face.

    Reference geometry is ordinary sketch geometry marked ref: true. The
    solver holds it still; it is a copy taken when it was projected and does
    not follow the model yet (that needs the stable references of M4).

    Only straight edges and circular edges seen face-on can be projected;
    anything else (an ellipse, a spline, a circle seen at an angle) is skipped.
*/

import * as M from './model.js';
import { toPlane } from '../kernel/profile.js';

const TOLERANCE = 1e-6;

function same(p, q) {
    return Math.abs(p[0] - q[0]) < TOLERANCE && Math.abs(p[1] - q[1]) < TOLERANCE;
}

// An exact model edge (see describe() in kernel/occt.js) dropped onto a
// sketch plane: { type: "line", a, b }, { type: "circle", c, r },
// { type: "arc", c, a, b } (counter clockwise from a to b), or null.
export function projectCurve(frame, curve) {
    const flat = function (p) {
        const q = toPlane(frame, p);
        return [q.u, q.v];
    };
    if (curve.type === 'line') {
        const a = flat(curve.a);
        const b = flat(curve.b);
        return same(a, b) ? null : { type: 'line', a: a, b: b };
    }
    if (curve.type === 'circle') {
        const facing = curve.n[0] * frame.n[0] + curve.n[1] * frame.n[1] + curve.n[2] * frame.n[2];
        if (Math.abs(facing) < 1 - 1e-9 || curve.r < TOLERANCE) {
            return null;
        }
        const c = flat(curve.c);
        if (curve.closed) {
            return { type: 'circle', c: c, r: curve.r };
        }
        // The edge runs counter clockwise about its own axis; seen from the
        // other side that is clockwise, so the ends swap
        const a = flat(curve.a);
        const b = flat(curve.b);
        return facing > 0 ? { type: 'arc', c: c, a: a, b: b } : { type: 'arc', c: c, a: b, b: a };
    }
    return null;
}

// The reference point at a position, made if it does not exist yet
function refPoint(sk, p) {
    const found = sk.geometry.filter(function (g) {
        return g.type === 'point' && g.ref && same([g.x, g.y], p);
    })[0];
    if (found) {
        return found.id;
    }
    const id = M.addPoint(sk, p[0], p[1]);
    M.find(sk, id).ref = true;
    return id;
}

// Add a model edge to the sketch as reference geometry. Returns false when
// the edge cannot be projected or is already there.
export function addProjected(sk, frame, curve) {
    const made = projectInto(sk, frame, curve);
    return !!(made && made.added);
}

// The reference curve of a model edge in the sketch, projecting it first if
// needed: { id, added }, or null when the edge cannot be projected.
export function projectInto(sk, frame, curve) {
    const flat = curve ? projectCurve(frame, curve) : null;
    if (!flat) {
        return null;
    }
    const existing = sk.geometry.filter(function (g) {
        return g.ref && g.type === flat.type;
    });
    const at = function (id) {
        return M.point(sk, id);
    };
    const twin = existing.filter(function (g) {
        if (flat.type === 'line') {
            return (same(at(g.p1), flat.a) && same(at(g.p2), flat.b)) || (same(at(g.p1), flat.b) && same(at(g.p2), flat.a));
        }
        if (flat.type === 'circle') {
            return same(at(g.c), flat.c) && Math.abs(g.r - flat.r) < TOLERANCE;
        }
        return same(at(g.c), flat.c) && same(at(g.start), flat.a) && same(at(g.end), flat.b);
    })[0];
    if (twin) {
        return { id: twin.id, added: false };
    }
    let id;
    if (flat.type === 'line') {
        id = M.addLine(sk, refPoint(sk, flat.a), refPoint(sk, flat.b));
    } else if (flat.type === 'circle') {
        id = M.addCircle(sk, refPoint(sk, flat.c), flat.r);
    } else {
        id = M.addArc(sk, refPoint(sk, flat.c), refPoint(sk, flat.a), refPoint(sk, flat.b));
    }
    M.find(sk, id).ref = true;
    return { id: id, added: true };
}
