/*
    3D Modeler - assembly geometry

    Small 3D helpers for assemblies, with no DOM and no three.js, so they also
    run under Node:

    - Placement matrices: plain arrays of 16 numbers in the column-major
      order three.js uses (Matrix4.elements). A component's matrix is a
      rotation times a uniform scale plus a translation; nothing here makes a
      shear or a non-uniform scale, which would turn circles into ellipses.
    - Entities: what a picked face or edge stands for in a constraint (a
      plane, an axis, a circle, a line), taken from the face and edge records
      of kernel/occt.js describe().
    - transformInfo: a face or edge record moved into the assembly, for the
      status bar, Measure and the constraint tools.
*/

/* ================= vectors ================= */
export function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a) {
    return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
    const l = length(a);
    return l > 1e-15 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

// The part of `v` square to the unit direction `d`
export function perpendicular(v, d) {
    return sub(v, scale(d, dot(v, d)));
}

/* ================= matrices ================= */
export function identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function isMatrix(m) {
    return Array.isArray(m) && m.length === 16 && m.every(function (v) {
        return typeof v === 'number' && isFinite(v);
    });
}

// a * b (b is applied first)
export function multiply(a, b) {
    const out = new Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
    }
    return out;
}

export function applyPoint(m, p) {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
}

// A direction carried along (rotation only), as a unit vector
export function applyDir(m, d) {
    return normalize([
        m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
        m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
        m[2] * d[0] + m[6] * d[1] + m[10] * d[2]
    ]);
}

// The uniform scale of a placement matrix
export function scaleOf(m) {
    return Math.hypot(m[0], m[1], m[2]);
}

export function translationOf(m) {
    return [m[12], m[13], m[14]];
}

// The rotation of a placement as a 3 x 3 row-major array
export function rotationOf(m) {
    const s = scaleOf(m) || 1;
    return [m[0] / s, m[4] / s, m[8] / s, m[1] / s, m[5] / s, m[9] / s, m[2] / s, m[6] / s, m[10] / s];
}

// Inverse of a rotation + uniform scale + translation
export function invert(m) {
    const s = scaleOf(m) || 1;
    const k = 1 / (s * s);
    // The inverse of s R is R^T / s = (s R)^T / s^2
    const out = [
        m[0] * k, m[4] * k, m[8] * k, 0,
        m[1] * k, m[5] * k, m[9] * k, 0,
        m[2] * k, m[6] * k, m[10] * k, 0,
        0, 0, 0, 1
    ];
    const t = applyPoint(out, [m[12], m[13], m[14]]);
    out[12] = -t[0];
    out[13] = -t[1];
    out[14] = -t[2];
    return out;
}

export function translation(v) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
}

export function scaling(s, about) {
    const c = about || [0, 0, 0];
    return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, c[0] * (1 - s), c[1] * (1 - s), c[2] * (1 - s), 1];
}

// Turn by `angle` radians about the unit axis `axis` through `about` (the
// origin when left out)
export function rotation(axis, angle, about) {
    const a = normalize(axis);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const x = a[0];
    const y = a[1];
    const z = a[2];
    const m = [
        t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
        t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
        t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
        0, 0, 0, 1
    ];
    if (about) {
        const moved = applyPoint(m, about);
        m[12] = about[0] - moved[0];
        m[13] = about[1] - moved[1];
        m[14] = about[2] - moved[2];
    }
    return m;
}

// The rotation of a rotation vector (axis times angle), about `about`
export function rotationVector(w, about) {
    const angle = length(w);
    if (angle < 1e-15) {
        return identity();
    }
    return rotation(w, angle, about);
}

// Rotations in degrees about X, then Y, then Z of the part's own axes
// (three.js order "XYZ": R = Rx Ry Rz), a uniform scale and a position
export function compose(position, degrees, s) {
    const r = Math.PI / 180;
    const rx = rotation([1, 0, 0], degrees[0] * r);
    const ry = rotation([0, 1, 0], degrees[1] * r);
    const rz = rotation([0, 0, 1], degrees[2] * r);
    const m = multiply(multiply(rx, ry), rz);
    for (let i = 0; i < 3; i++) {
        m[i] *= s;
        m[4 + i] *= s;
        m[8 + i] *= s;
    }
    m[12] = position[0];
    m[13] = position[1];
    m[14] = position[2];
    return m;
}

// The opposite of compose: { position, degrees: [x, y, z], scale }
export function decompose(m) {
    const s = scaleOf(m) || 1;
    // Row-major rotation entries, as three.js Euler.setFromRotationMatrix reads them
    const m11 = m[0] / s;
    const m12 = m[4] / s;
    const m13 = m[8] / s;
    const m22 = m[5] / s;
    const m23 = m[9] / s;
    const m32 = m[6] / s;
    const m33 = m[10] / s;
    const y = Math.asin(Math.max(-1, Math.min(1, m13)));
    let x;
    let z;
    if (Math.abs(m13) < 0.9999999) {
        x = Math.atan2(-m23, m33);
        z = Math.atan2(-m12, m11);
    } else {
        x = Math.atan2(m32, m22);
        z = 0;
    }
    const d = 180 / Math.PI;
    const clean = function (v) {
        const r = Math.round(v * 1e6) / 1e6;
        return r === 0 ? 0 : r; // no "-0"
    };
    return {
        position: [clean(m[12]), clean(m[13]), clean(m[14])],
        degrees: [clean(x * d), clean(y * d), clean(z * d)],
        scale: clean(s)
    };
}

// The matrix with its rotation made exactly orthonormal again (it drifts
// a little after many small turns), keeping its scale and position
export function tidy(m) {
    const s = scaleOf(m) || 1;
    const x = normalize([m[0], m[1], m[2]]);
    let y = [m[4], m[5], m[6]];
    y = normalize(sub(y, scale(x, dot(y, x))));
    const z = cross(x, y);
    return [x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, m[12], m[13], m[14], 1];
}

/* ================= picked faces and edges ================= */
// The planar face a circular edge closes, used to give the circle a side:
// an Insert puts the two circles' faces against each other. Returns its
// outward normal, or null.
function faceNormalOfEdge(desc, edgeIndex, axis) {
    if (!desc || !desc.faces) {
        return null;
    }
    let best = null;
    desc.faces.forEach(function (face) {
        if (face.type === 'plane' && face.normal && face.edges && face.edges.indexOf(edgeIndex) >= 0 &&
            Math.abs(dot(face.normal, axis)) > 0.999 && !best) {
            best = face.normal.slice();
        }
    });
    return best;
}

// The entity a picked face or edge stands for in a constraint, in the
// coordinates of its part, or null when it cannot be used:
//   { kind: "plane", o, n }          a flat face (o: its centre, n: outward)
//   { kind: "cylinder", o, d, r }    a round face: its axis and radius
//   { kind: "circle", o, d, r }      a round edge: centre, axis, radius; d
//                                    points out of the flat face it closes
//   { kind: "line", o, d }           a straight edge
// `item` is a face or edge record of describe() with kind and index added;
// `desc` is the description of the body it belongs to.
export function entityOf(item, desc) {
    if (!item) {
        return null;
    }
    if (item.kind === 'face') {
        if (item.type === 'plane' && item.normal) {
            return { kind: 'plane', o: (item.centre || item.origin).slice(), n: normalize(item.normal) };
        }
        if (item.type === 'cylinder' && item.axis) {
            // The axis point nearest the face's centre, so it sits beside the face
            const d = normalize(item.axis.d);
            const c = item.centre || item.axis.o;
            const o = add(item.axis.o, scale(d, dot(sub(c, item.axis.o), d)));
            return { kind: 'cylinder', o: o, d: d, r: item.radius };
        }
        return null;
    }
    const curve = item.curve;
    if (!curve) {
        return null;
    }
    if (curve.type === 'line') {
        return { kind: 'line', o: curve.a.slice(), d: normalize(sub(curve.b, curve.a)) };
    }
    if (curve.type === 'circle') {
        const axis = normalize(curve.n);
        const side = faceNormalOfEdge(desc, item.index, axis);
        return { kind: 'circle', o: curve.c.slice(), d: side || axis, r: curve.r };
    }
    return null;
}

// Find a constraint entity again on a part that may have changed: the face
// or edge of the same kind whose geometry is nearest to what the entity
// remembers (same direction first, then position and radius), preferring
// the one with the same index. entity: { kind, o, n | d, r, pick: { type,
// body, index } }; desc: the description of that body now. Returns
// { entity, index } or null when nothing of that kind is left.
export function matchEntity(entity, desc) {
    const pick = entity && entity.pick;
    if (!pick || !desc) {
        return null;
    }
    const list = pick.type === 'face' ? desc.faces : desc.edges;
    const was = entity.n || entity.d;
    let best = null;
    let bestScore = Infinity;
    (list || []).forEach(function (info, i) {
        const ent = entityOf(Object.assign({ kind: pick.type, index: i }, info), desc);
        if (!ent || ent.kind !== entity.kind) {
            return;
        }
        const dir = ent.n || ent.d;
        // A plane must face the same way; an axis may run either way
        const along = entity.kind === 'plane' ? dot(dir, was) : Math.abs(dot(dir, was));
        let score = (1 - along) * 1000 + length(sub(ent.o, entity.o));
        if (ent.r !== undefined && entity.r !== undefined) {
            score += Math.abs(ent.r - entity.r) * 2;
        }
        if (i === pick.index) {
            score *= 0.5;
        }
        if (score < bestScore) {
            bestScore = score;
            best = { entity: ent, index: i };
        }
    });
    return best;
}

// An entity moved into the assembly by a placement matrix
export function entityToWorld(e, m) {
    const out = { kind: e.kind, o: applyPoint(m, e.o) };
    if (e.n) {
        out.n = applyDir(m, e.n);
    }
    if (e.d) {
        out.d = applyDir(m, e.d);
    }
    if (e.r !== undefined) {
        out.r = e.r * scaleOf(m);
    }
    return out;
}

// What the entities of the assembly origin are: its planes and axes and
// the centre point, all fixed. key: "xy", "xz", "yz", "x", "y", "z", "o"
export function originEntity(key) {
    const planes = { xy: [0, 0, 1], xz: [0, -1, 0], yz: [1, 0, 0] };
    const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    if (planes[key]) {
        return { kind: 'plane', o: [0, 0, 0], n: planes[key] };
    }
    if (axes[key]) {
        return { kind: 'line', o: [0, 0, 0], d: axes[key] };
    }
    return key === 'o' ? { kind: 'point', o: [0, 0, 0] } : null;
}

// A face or edge record of describe() moved by a placement matrix, so
// positions, directions and sizes read in assembly coordinates
export function transformInfo(info, m) {
    if (!info || !m) {
        return info;
    }
    const s = scaleOf(m);
    const out = Object.assign({}, info);
    const point = function (p) {
        return p ? applyPoint(m, p) : p;
    };
    if (info.centre) {
        out.centre = point(info.centre);
    }
    if (info.origin) {
        out.origin = point(info.origin);
    }
    if (info.normal) {
        out.normal = applyDir(m, info.normal);
    }
    if (info.axis) {
        out.axis = { o: point(info.axis.o), d: applyDir(m, info.axis.d) };
    }
    if (info.radius !== undefined) {
        out.radius = info.radius * s;
    }
    if (info.area !== undefined) {
        out.area = info.area * s * s;
    }
    if (info.length !== undefined) {
        out.length = info.length * s;
    }
    if (info.mid) {
        out.mid = point(info.mid);
    }
    if (info.curve) {
        const c = info.curve;
        out.curve = c.type === 'line' ? { type: 'line', a: point(c.a), b: point(c.b) }
            : c.type === 'circle' ? { type: 'circle', c: point(c.c), r: c.r * s, n: applyDir(m, c.n), a: point(c.a), b: point(c.b), closed: c.closed }
                : c;
    }
    return out;
}

// The corners of a box [min, max] moved by a matrix, as a new box
export function transformBox(box, m) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
        const p = applyPoint(m, [box[i & 1][0], box[(i >> 1) & 1][1], box[(i >> 2) & 1][2]]);
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], p[k]);
            max[k] = Math.max(max[k], p[k]);
        }
    }
    return [min, max];
}

// The bounding box [min, max] of a list of described bodies (their mesh
// vertices), or null when there is nothing
export function boundsOf(bodies) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let any = false;
    (bodies || []).forEach(function (body) {
        const p = body.positions;
        for (let i = 0; i + 2 < p.length; i += 3) {
            any = true;
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], p[i + k]);
                max[k] = Math.max(max[k], p[i + k]);
            }
        }
    });
    return any ? [min, max] : null;
}
