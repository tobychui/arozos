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

export function planeFrame(plane, features) {
    const ref = plane && plane.ref;
    if (ref === 'plane') {
        const feature = (features || []).filter(function (f) {
            return f.id === plane.id && f.type === 'plane';
        })[0];
        return feature && !feature.suppressed ? workPlaneFrame(feature, features) : null;
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

// The coordinate system of a work plane feature { base, offset }: its base
// plane moved along the normal. The feature itself is left out of the lookup
// for its base, so a plane can never be its own ancestor.
export function workPlaneFrame(feature, features) {
    const base = planeFrame(feature.base, (features || []).filter(function (f) {
        return f.id !== feature.id;
    }));
    if (!base) {
        return null;
    }
    const d = Number(feature.offset) || 0;
    return {
        o: [base.o[0] + base.n[0] * d, base.o[1] + base.n[1] * d, base.o[2] + base.n[2] * d],
        x: base.x, y: base.y, n: base.n
    };
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
