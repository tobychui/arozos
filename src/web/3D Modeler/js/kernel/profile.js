/*
    3D Modeler - sketch planes

    The coordinate system of the plane a sketch is drawn on, and the step from
    plane coordinates to the model. Pure maths, shared by the kernel worker,
    the sketcher and the viewport code.

    (Finding the closed regions of a sketch used to live here; the kernel does
    that now, see sketchRegions in occt.js.)
*/

// The coordinate system of a plane reference:
//   { ref: "origin:xy" | "origin:xz" | "origin:yz" }
//   { ref: "face", frame, face? }  a planar face: `frame` as it was when
//                                  picked, `face` ({ normal, point }: its
//                                  outward normal and the point clicked on
//                                  it) to find it again after an edit
//   { ref: "plane", id }           a work plane feature; needs `features`,
//                                  the feature list to look it up in
// Returns { o, x, y, n } with x cross y = n, or null when the reference
// cannot be resolved (unknown, or its work plane is gone or suppressed).
// Where the rebuild found each face plane (followFace in occt.js): plane
// reference object -> frame. Filled by the rebuild in the worker and by
// the app from the rebuild result; a plane not in it keeps its own frame.
let resolvedFaces = new WeakMap();

export function resolveFace(plane, frame) {
    if (plane && frame) {
        resolvedFaces.set(plane, frame);
    }
}

export function planeFrame(plane, features, depth) {
    const ref = plane && plane.ref;
    if (ref === 'plane') {
        const feature = (features || []).filter(function (f) {
            return f.id === plane.id && f.type === 'plane';
        })[0];
        return feature && !feature.suppressed ? workPlaneFrame(feature, features, depth) : null;
    }
    if (ref === 'face' && plane.frame) {
        // Where the face is now, if the rebuild found it; else where it was
        // when picked (an old document, or the face is gone)
        return resolvedFaces.get(plane) || plane.frame;
    }
    if (ref === 'origin:xy') {
        return { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
    }
    if (ref === 'origin:xz') {
        return { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] };
    }
    if (ref === 'origin:yz') {
        return { o: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0] };
    }
    return null;
}

// The coordinate system of a work plane feature. The first kind,
// { base, offset } with no `def`: its base plane moved along the normal.
// The others carry `def` (PROPOSAL.md 14.13):
//   { kind: "midplane", a, b }        halfway between two parallel planes
//   { kind: "angle", base, axis, angle }  through an axis lying in a plane,
//                                     turned `angle` degrees out of it
//   { kind: "points", a, b, c }       through three points
//   { kind: "tangent", face, line, radius, base, side }  parallel to a plane,
//                                     touching a round face on the side of
//                                     the point `side` (picked)
//   { kind: "normal", axis, point }   square to an axis, through a point
// Planes are plane references, axes and points the references of
// axisLine() and pointAt(). The feature itself is left out of every
// lookup, so it can never be its own ancestor.
export function workPlaneFrame(feature, features, depth) {
    const level = (depth || 0) + 1;
    if (level > MAX_DEPTH) {
        return null;
    }
    const rest = (features || []).filter(function (f) {
        return f.id !== feature.id;
    });
    const def = feature.def;
    if (!def || def.kind === 'offset') {
        const base = planeFrame(feature.base, rest, level);
        if (!base) {
            return null;
        }
        const d = Number(feature.offset) || 0;
        return {
            o: [base.o[0] + base.n[0] * d, base.o[1] + base.n[1] * d, base.o[2] + base.n[2] * d],
            x: base.x, y: base.y, n: base.n
        };
    }
    if (def.kind === 'midplane') {
        const a = planeFrame(def.a, rest, level);
        const b = planeFrame(def.b, rest, level);
        if (!a || !b || Math.abs(Math.abs(dot(a.n, b.n)) - 1) > 1e-6) {
            return null; // not parallel
        }
        const half = dot(sub(b.o, a.o), a.n) / 2;
        return { o: add(a.o, a.n, half), x: a.x, y: a.y, n: a.n };
    }
    if (def.kind === 'angle') {
        const base = planeFrame(def.base, rest, level);
        const line = axisLine(def.axis, rest, level);
        if (!base || !line || Math.abs(dot(line.d, base.n)) > 1e-6 || Math.abs(dot(sub(line.o, base.o), base.n)) > 1e-6) {
            return null; // the axis must lie in the plane
        }
        const t = (Number(def.angle) || 0) * Math.PI / 180;
        // The plane's normal turned about the axis
        const side = cross(line.d, base.n);
        const n = norm(add(scale(base.n, Math.cos(t)), side, Math.sin(t)));
        return { o: line.o.slice(), x: line.d.slice(), y: cross(n, line.d), n: n };
    }
    if (def.kind === 'points') {
        const a = pointAt(def.a, rest, level);
        const b = pointAt(def.b, rest, level);
        const c = pointAt(def.c, rest, level);
        if (!a || !b || !c) {
            return null;
        }
        const n = cross(sub(b, a), sub(c, a));
        if (len(n) < 1e-9 || len(sub(b, a)) < 1e-9) {
            return null; // in a line
        }
        const nn = norm(n);
        const x = norm(sub(b, a));
        return { o: a.slice(), x: x, y: cross(nn, x), n: nn };
    }
    if (def.kind === 'tangent') {
        const base = planeFrame(def.base, rest, level);
        const cyl = resolvedWork.get(feature) || (def.line ? Object.assign({ r: Number(def.radius) }, def.line) : null);
        if (!base || !cyl || !(cyl.r > 0) || Math.abs(dot(cyl.d, base.n)) > 1e-6) {
            return null; // the round face's axis must run along the plane
        }
        const towards = Array.isArray(def.side) ? dot(sub(def.side, cyl.o), base.n) : 1;
        const touch = add(cyl.o, base.n, towards < 0 ? -cyl.r : cyl.r);
        return { o: touch, x: base.x, y: base.y, n: base.n };
    }
    if (def.kind === 'normal') {
        const line = axisLine(def.axis, rest, level);
        const p = pointAt(def.point, rest, level);
        return line && p ? frameFromNormal(p, line.d) : null;
    }
    return null;
}

/* ================= work axes and work points ================= */
// Where the rebuild found the edge or round face a work feature was put on
// (kernel edgeLine / cylinderLine): feature object -> { o, d } (and r for a
// round face). Filled in the worker during the replay and in the app from
// the rebuild result; a feature not in it keeps the line it was made with.
let resolvedWork = new WeakMap();

export function resolveWork(feature, value) {
    if (feature && value) {
        resolvedWork.set(feature, value);
    }
}

const MAX_DEPTH = 32;   // work features referring to work features: no loops
const ORIGIN_AXES = { 'origin:x': [1, 0, 0], 'origin:y': [0, 1, 0], 'origin:z': [0, 0, 1] };

function lookup(id, type, features) {
    return (features || []).filter(function (f) {
        return f.id === id && f.type === type;
    })[0];
}

// An axis reference -> { o, d } (d of length 1), or null
//   { ref: "origin:x" | "origin:y" | "origin:z" }
//   { ref: "axis", id }        a work axis feature
//   { ref: "line", line }      a line taken as it is (an edge being picked)
export function axisLine(ref, features, depth) {
    if (!ref) {
        return null;
    }
    if (ORIGIN_AXES[ref.ref]) {
        return { o: [0, 0, 0], d: ORIGIN_AXES[ref.ref].slice() };
    }
    if (ref.ref === 'axis') {
        const f = lookup(ref.id, 'axis', features);
        return f && !f.suppressed ? workAxisLine(f, features, depth) : null;
    }
    if (ref.ref === 'line' && ref.line && isVec(ref.line.o) && isVec(ref.line.d) && len(ref.line.d) > 1e-9) {
        return { o: ref.line.o.slice(), d: norm(ref.line.d) };
    }
    return null;
}

// A point reference -> [x, y, z], or null
//   { ref: "origin" }          the centre point
//   { ref: "point", id }       a work point feature
//   { ref: "vertex", at }      a corner of the model, where it was picked
export function pointAt(ref, features, depth) {
    if (!ref) {
        return null;
    }
    if (ref.ref === 'origin') {
        return [0, 0, 0];
    }
    if (ref.ref === 'vertex' && isVec(ref.at)) {
        return ref.at.slice();
    }
    if (ref.ref === 'point') {
        const f = lookup(ref.id, 'point', features);
        return f && !f.suppressed ? workPoint(f, features, depth) : null;
    }
    return null;
}

// A work axis feature { def }:
//   { kind: "edge", edge, line }        along a straight edge of the model
//   { kind: "cylinder", face, line }    the axis of a round face
//   { kind: "planes", a, b }            where two planes meet
//   { kind: "points", a, b }            through two points
export function workAxisLine(feature, features, depth) {
    const level = (depth || 0) + 1;
    const def = feature.def || {};
    if (level > MAX_DEPTH) {
        return null;
    }
    const rest = (features || []).filter(function (f) {
        return f.id !== feature.id;
    });
    if (def.kind === 'edge' || def.kind === 'cylinder') {
        const found = resolvedWork.get(feature) || def.line;
        return found && isVec(found.o) && isVec(found.d) ? { o: found.o.slice(), d: norm(found.d) } : null;
    }
    if (def.kind === 'planes') {
        const a = planeFrame(def.a, rest, level);
        const b = planeFrame(def.b, rest, level);
        return a && b ? planesLine(a, b) : null;
    }
    if (def.kind === 'points') {
        const a = pointAt(def.a, rest, level);
        const b = pointAt(def.b, rest, level);
        return a && b && len(sub(b, a)) > 1e-9 ? { o: a, d: norm(sub(b, a)) } : null;
    }
    return null;
}

// A work point feature { def }:
//   { kind: "coords", at }              typed coordinates
//   { kind: "vertex", at }              a corner of the model
//   { kind: "axisplane", axis, plane }  where an axis meets a plane
export function workPoint(feature, features, depth) {
    const level = (depth || 0) + 1;
    const def = feature.def || {};
    if (level > MAX_DEPTH) {
        return null;
    }
    const rest = (features || []).filter(function (f) {
        return f.id !== feature.id;
    });
    if ((def.kind === 'coords' || def.kind === 'vertex') && isVec(def.at)) {
        return def.at.slice();
    }
    if (def.kind === 'axisplane') {
        const line = axisLine(def.axis, rest, level);
        const plane = planeFrame(def.plane, rest, level);
        return line && plane ? linePlane(line, plane) : null;
    }
    return null;
}

/* ---- small vector helpers ---- */
function isVec(v) {
    return Array.isArray(v) && v.length === 3 && v.every(function (c) {
        return typeof c === 'number' && isFinite(c);
    });
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b, k) {
    return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

function scale(a, k) {
    return [a[0] * k, a[1] * k, a[2] * k];
}

function len(a) {
    return Math.hypot(a[0], a[1], a[2]);
}

function norm(a) {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
}

// A plane through o square to n, its X along whichever world axis lies
// most across n
export function frameFromNormal(o, normal) {
    const n = norm(normal);
    const hint = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const y = norm(sub(hint, scale(n, dot(hint, n))));
    const x = cross(y, n);
    return { o: o.slice(), x: x, y: y, n: n };
}

// Where two planes meet: { o, d }, or null when they are parallel
export function planesLine(a, b) {
    const d = cross(a.n, b.n);
    if (len(d) < 1e-9) {
        return null;
    }
    const c = dot(a.n, b.n);
    const h1 = dot(a.n, a.o);
    const h2 = dot(b.n, b.o);
    const k = 1 - c * c;
    const o = add(scale(a.n, (h1 - h2 * c) / k), b.n, (h2 - h1 * c) / k);
    return { o: o, d: norm(d) };
}

// Where a line meets a plane, or null when it runs along it
export function linePlane(line, plane) {
    const along = dot(line.d, plane.n);
    if (Math.abs(along) < 1e-9) {
        return null;
    }
    return add(line.o, line.d, dot(sub(plane.o, line.o), plane.n) / along);
}

// A sketch as the kernel wants it: a plane that refers to a work plane is
// replaced by that plane's coordinate system (the kernel functions only know
// origin planes and explicit frames).
export function withResolvedPlane(sketch, features) {
    if (sketch && sketch.plane && sketch.plane.ref === 'face') {
        const moved = resolvedFaces.get(sketch.plane);
        return moved ? Object.assign({}, sketch, { plane: { ref: 'face', frame: moved } }) : sketch;
    }
    if (!sketch || !sketch.plane || sketch.plane.ref !== 'plane') {
        return sketch;
    }
    const frame = planeFrame(sketch.plane, features);
    return Object.assign({}, sketch, { plane: frame ? { ref: 'face', frame: frame } : { ref: 'missing' } });
}

export function toWorld(frame, u, v) {
    return [
        frame.o[0] + frame.x[0] * u + frame.y[0] * v,
        frame.o[1] + frame.x[1] * u + frame.y[1] * v,
        frame.o[2] + frame.x[2] * u + frame.y[2] * v
    ];
}

// Plane coordinates [u, v] of a model point, and how far it is off the plane
export function toPlane(frame, p) {
    const d = [p[0] - frame.o[0], p[1] - frame.o[1], p[2] - frame.o[2]];
    return {
        u: d[0] * frame.x[0] + d[1] * frame.x[1] + d[2] * frame.x[2],
        v: d[0] * frame.y[0] + d[1] * frame.y[1] + d[2] * frame.y[2],
        off: d[0] * frame.n[0] + d[1] * frame.n[1] + d[2] * frame.n[2]
    };
}
