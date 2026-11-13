/*
    3D Modeler - sketch data

    Everything that reads or edits the contents of one sketch, and the
    translation between a sketch and the primitive list of the planegcs
    solver. Pure data, no DOM, so it runs under Node.

    A sketch is { geometry: [...], constraints: [...] } in plane coordinates
    and millimetres (the same two arrays a sketch feature stores):

    geometry
        { id, type: "point", x, y, standalone? }
        { id, type: "line", p1, p2, construction? }
        { id, type: "circle", c, r, construction? }
        { id, type: "arc", c, start, end, construction? }   counter clockwise
    constraints (see REFS for the fields that name geometry)
        coincident, pointon, collinear, horizontal, vertical, parallel,
        perpendicular, tangent, equal, fix, midpoint, symmetric
    dimensions are constraints with a `value` and a text position `pos`
        distance, hdistance, vdistance, pldistance, radius, diameter, angle,
        axisangle (the direction from point a to point b, measured from the
        sketch's X axis: a line drawn at a typed angle keeps it)

    A dimension marked driven: true is a driven (reference) dimension: it is
    not given to the solver, only shows the size, and applySolution keeps its
    value up to date. It is what a dimension becomes when it would
    over-constrain the sketch.

    Geometry marked ref: true is reference geometry projected from the model
    (see project.js): the solver holds it still, everything else may be
    constrained to it.

    The point "$o" is the origin of the sketch plane. It is not stored; it
    always exists, is fixed, and can be referenced like any other point.
*/

import { arcFrom, dist, cornerCut } from './geom.js';

export const ORIGIN = '$o';

// Fields of each constraint type that hold geometry ids
export const REFS = {
    coincident: ['a', 'b'],
    pointon: ['p', 'curve'],
    collinear: ['l1', 'l2'],
    horizontal: ['line', 'a', 'b'],
    vertical: ['line', 'a', 'b'],
    parallel: ['l1', 'l2'],
    perpendicular: ['l1', 'l2'],
    tangent: ['a', 'b'],
    equal: ['a', 'b'],
    fix: ['p'],
    midpoint: ['p', 'line'],
    symmetric: ['a', 'b', 'line'],
    distance: ['a', 'b'],
    hdistance: ['a', 'b'],
    vdistance: ['a', 'b'],
    pldistance: ['p', 'line'],
    radius: ['curve'],
    diameter: ['curve'],
    angle: ['l1', 'l2'],
    axisangle: ['a', 'b']
};

const DIMENSIONS = ['distance', 'hdistance', 'vdistance', 'pldistance', 'radius', 'diameter', 'angle', 'axisangle'];
const POINT_FIELDS = { line: ['p1', 'p2'], circle: ['c'], arc: ['c', 'start', 'end'] };

export function isDimension(constraint) {
    return DIMENSIONS.indexOf(constraint.type) >= 0;
}

export function clone(sk) {
    return JSON.parse(JSON.stringify({ geometry: sk.geometry || [], constraints: sk.constraints || [] }));
}

export function find(sk, id) {
    for (let i = 0; i < sk.geometry.length; i++) {
        if (sk.geometry[i].id === id) {
            return sk.geometry[i];
        }
    }
    return null;
}

// Coordinates of a point, or null
export function point(sk, id) {
    if (id === ORIGIN) {
        return [0, 0];
    }
    const g = find(sk, id);
    return g && g.type === 'point' ? [g.x, g.y] : null;
}

// A line, circle or arc with its coordinates filled in (see geom.js), or null
export function curve(sk, g) {
    if (typeof g === 'string') {
        g = find(sk, g);
    }
    if (!g) {
        return null;
    }
    let out = null;
    if (g.type === 'line') {
        const a = point(sk, g.p1);
        const b = point(sk, g.p2);
        out = a && b ? { id: g.id, type: 'line', a: a, b: b } : null;
    } else if (g.type === 'circle') {
        const c = point(sk, g.c);
        out = c ? { id: g.id, type: 'circle', c: c, r: g.r } : null;
    } else if (g.type === 'arc') {
        const c = point(sk, g.c);
        const a = point(sk, g.start);
        const b = point(sk, g.end);
        out = c && a && b ? arcFrom(g.id, c, a, b) : null;
    }
    if (out && g.construction) {
        out.construction = true;
    }
    if (out && g.ref) {
        out.ref = true;
    }
    return out;
}

export function curves(sk) {
    return sk.geometry.map(function (g) {
        return g.type === 'point' ? null : curve(sk, g);
    }).filter(Boolean);
}

export function refs(constraint) {
    return (REFS[constraint.type] || []).map(function (field) {
        return constraint[field];
    }).filter(function (id) {
        return typeof id === 'string';
    });
}

// The points of a sketch that holes are drilled at: those placed with the
// Point tool (not the ends of lines or centres of circles)
export function holePoints(sketch) {
    return (sketch.geometry || []).filter(function (g) {
        return g.type === 'point' && g.standalone && !g.ref;
    });
}

/* ================= editing ================= */
export function newId(sk, prefix) {
    const used = new Set(sk.geometry.concat(sk.constraints).map(function (e) {
        return e.id;
    }));
    let n = 1;
    while (used.has(prefix + n)) {
        n++;
    }
    return prefix + n;
}

export function addPoint(sk, x, y, standalone) {
    const p = { id: newId(sk, 'p'), type: 'point', x: x, y: y };
    if (standalone) {
        p.standalone = true;
    }
    sk.geometry.push(p);
    return p.id;
}

function addCurve(sk, prefix, fields, construction) {
    const g = Object.assign({ id: newId(sk, prefix) }, fields);
    if (construction) {
        g.construction = true;
    }
    sk.geometry.push(g);
    return g.id;
}

export function addLine(sk, p1, p2, construction) {
    return addCurve(sk, 'l', { type: 'line', p1: p1, p2: p2 }, construction);
}

export function addCircle(sk, c, r, construction) {
    return addCurve(sk, 'k', { type: 'circle', c: c, r: r }, construction);
}

export function addArc(sk, c, start, end, construction) {
    return addCurve(sk, 'a', { type: 'arc', c: c, start: start, end: end }, construction);
}

export function addConstraint(sk, constraint) {
    const c = Object.assign({ id: newId(sk, isDimension(constraint) ? 'd' : 'c') }, constraint);
    sk.constraints.push(c);
    return c.id;
}

function pointUsers(sk, id) {
    return sk.geometry.filter(function (g) {
        return (POINT_FIELDS[g.type] || []).some(function (field) {
            return g[field] === id;
        });
    });
}

// Delete curves, points and constraints by id. A point that still carries a
// curve stays; a point left without a curve goes, unless it was placed with
// the Point tool. Constraints that lose a reference go with it.
export function remove(sk, ids) {
    const gone = new Set(ids);
    const orphans = new Set();
    sk.geometry.forEach(function (g) {
        if (gone.has(g.id) && g.type !== 'point') {
            (POINT_FIELDS[g.type] || []).forEach(function (field) {
                orphans.add(g[field]);
            });
        }
    });
    sk.geometry = sk.geometry.filter(function (g) {
        return g.type === 'point' || !gone.has(g.id);
    });
    const removed = new Set();
    sk.geometry = sk.geometry.filter(function (g) {
        if (g.type !== 'point') {
            return true;
        }
        const asked = gone.has(g.id) || (orphans.has(g.id) && !g.standalone);
        if (asked && !pointUsers(sk, g.id).length) {
            removed.add(g.id);
            return false;
        }
        return true;
    });
    ids.forEach(function (id) {
        removed.add(id);
    });
    sk.constraints = sk.constraints.filter(function (c) {
        return !gone.has(c.id) && !refs(c).some(function (id) {
            return removed.has(id);
        });
    });
}

// Make every reference to point `drop` use point `keep` instead
export function mergePoints(sk, keep, drop) {
    if (keep === drop || drop === ORIGIN) {
        return;
    }
    sk.geometry.forEach(function (g) {
        (POINT_FIELDS[g.type] || []).forEach(function (field) {
            if (g[field] === drop) {
                g[field] = keep;
            }
        });
    });
    sk.constraints.forEach(function (c) {
        (REFS[c.type] || []).forEach(function (field) {
            if (c[field] === drop) {
                c[field] = keep;
            }
        });
    });
    sk.geometry = sk.geometry.filter(function (g) {
        return g.id !== drop;
    });
    // Constraints between a point and itself mean nothing any more
    sk.constraints = sk.constraints.filter(function (c) {
        const r = refs(c);
        return new Set(r).size === r.length;
    });
}

// Mirror curves (ids) across a line of the sketch. Every point the curves
// use gets a mirrored twin held by a symmetric constraint about the line,
// so the copy follows the original; points on the line are shared. A
// circle also gets an equal radius. Returns { ids } of the copies, or
// { error }.
export function mirrorGeometry(sk, ids, lineId) {
    const line = curve(sk, lineId);
    if (!line || line.type !== 'line') {
        return { error: 'The mirror line must be a straight line' };
    }
    const d = [line.b[0] - line.a[0], line.b[1] - line.a[1]];
    const len2 = d[0] * d[0] + d[1] * d[1];
    if (len2 < 1e-18) {
        return { error: 'The mirror line has no length' };
    }
    const twins = {};
    const twin = function (id) {
        if (twins[id]) {
            return twins[id];
        }
        const p = point(sk, id);
        const t = ((p[0] - line.a[0]) * d[0] + (p[1] - line.a[1]) * d[1]) / len2;
        const foot = [line.a[0] + d[0] * t, line.a[1] + d[1] * t];
        if (dist(p, foot) < 1e-9 * Math.max(1, Math.sqrt(len2))) {
            twins[id] = id; // on the mirror line: its own mirror image
        } else {
            twins[id] = addPoint(sk, 2 * foot[0] - p[0], 2 * foot[1] - p[1]);
            addConstraint(sk, { type: 'symmetric', a: id, b: twins[id], line: lineId });
        }
        return twins[id];
    };
    const made = [];
    ids.forEach(function (id) {
        const g = find(sk, id);
        if (!g || g.type === 'point' || g.id === lineId) {
            return;
        }
        if (g.type === 'line') {
            made.push(addLine(sk, twin(g.p1), twin(g.p2), g.construction));
        } else if (g.type === 'circle') {
            const k = addCircle(sk, twin(g.c), g.r, g.construction);
            addConstraint(sk, { type: 'equal', a: g.id, b: k });
            made.push(k);
        } else if (g.type === 'arc') {
            // A mirror image runs the other way round: swap the ends
            made.push(addArc(sk, twin(g.c), twin(g.end), twin(g.start), g.construction));
        }
    });
    return made.length ? { ids: made } : { error: 'Pick lines, circles or arcs to mirror' };
}

// A regular polygon of `sides` sides about centre point id `centre`, with
// a corner at [x, y]: its corners on a construction circle, all sides
// equal. Returns the ids of the lines.
export function addPolygon(sk, centre, corner, sides, construction) {
    const c = point(sk, centre);
    const r = dist(c, corner);
    const start = Math.atan2(corner[1] - c[1], corner[0] - c[0]);
    const circle = addCircle(sk, centre, r, true);
    const corners = [];
    for (let i = 0; i < sides; i++) {
        const t = start + Math.PI * 2 * i / sides;
        corners.push(addPoint(sk, c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)));
    }
    const lines = corners.map(function (p, i) {
        return addLine(sk, p, corners[(i + 1) % sides], construction);
    });
    corners.forEach(function (p) {
        addConstraint(sk, { type: 'pointon', p: p, curve: circle });
    });
    lines.slice(1).forEach(function (l) {
        addConstraint(sk, { type: 'equal', a: lines[0], b: l });
    });
    return lines;
}

// A slot round the centres c1 and c2 (point ids), `r` wide either side:
// two half circles joined by two lines, tangent where they meet, the
// half circles of equal size. Returns { arcs, lines }.
export function addSlot(sk, c1, c2, r, construction) {
    const p1 = point(sk, c1);
    const p2 = point(sk, c2);
    const len = dist(p1, p2) || 1;
    const n = [-(p2[1] - p1[1]) / len * r, (p2[0] - p1[0]) / len * r];
    const a1 = addPoint(sk, p1[0] + n[0], p1[1] + n[1]);
    const b1 = addPoint(sk, p1[0] - n[0], p1[1] - n[1]);
    const a2 = addPoint(sk, p2[0] + n[0], p2[1] + n[1]);
    const b2 = addPoint(sk, p2[0] - n[0], p2[1] - n[1]);
    // Counter clockwise: round the far side of each centre
    const arc1 = addArc(sk, c1, a1, b1, construction);
    const arc2 = addArc(sk, c2, b2, a2, construction);
    const top = addLine(sk, a1, a2, construction);
    const bottom = addLine(sk, b2, b1, construction);
    [[top, arc1], [top, arc2], [bottom, arc1], [bottom, arc2]].forEach(function (pair) {
        addConstraint(sk, { type: 'tangent', a: pair[0], b: pair[1] });
    });
    addConstraint(sk, { type: 'equal', a: arc1, b: arc2 });
    return { arcs: [arc1, arc2], lines: [top, bottom] };
}

// The two lines that meet at point id (ends of exactly two lines), or null
export function cornerLines(sk, id) {
    const lines = sk.geometry.filter(function (g) {
        return g.type === 'line' && (g.p1 === id || g.p2 === id);
    });
    return lines.length === 2 ? [lines[0].id, lines[1].id] : null;
}

// Round (kind "fillet") or bevel ("chamfer") the corner where lines l1 and
// l2 meet at a shared end point. size: the radius, or the distance cut back
// along each line. Each line gets a new end where it now stops, and an arc
// (tangent to both, with a radius dimension, or `equalTo` an earlier arc of
// the same size) or a line joins them. The old corner point stays, held on
// both lines, when anything else hangs on it (a dimension, another curve,
// the origin) and always for a chamfer, whose two distances are measured
// from it. Returns { id } of the new curve, or { error }.
export function roundCorner(sk, l1, l2, size, kind, equalTo) {
    const g1 = find(sk, l1);
    const g2 = find(sk, l2);
    if (!g1 || !g2 || g1.type !== 'line' || g2.type !== 'line' || l1 === l2) {
        return { error: 'Pick two lines' };
    }
    if (g1.ref || g2.ref) {
        return { error: 'Projected geometry belongs to the model and cannot be changed' };
    }
    const shared = [g1.p1, g1.p2].filter(function (id) {
        return id === g2.p1 || id === g2.p2;
    })[0];
    if (!shared) {
        return { error: 'The two lines must meet at an end point' };
    }
    const end1 = g1.p1 === shared ? 'p1' : 'p2';
    const end2 = g2.p1 === shared ? 'p1' : 'p2';
    const corner = point(sk, shared);
    const cut = cornerCut(corner, point(sk, g1[end1 === 'p1' ? 'p2' : 'p1']), point(sk, g2[end2 === 'p1' ? 'p2' : 'p1']), size, kind);
    if (cut.error) {
        return cut;
    }
    const construction = g1.construction && g2.construction;
    const t1 = addPoint(sk, cut.t1[0], cut.t1[1]);
    const t2 = addPoint(sk, cut.t2[0], cut.t2[1]);
    g1[end1] = t1;
    g2[end2] = t2;
    const held = shared === ORIGIN || find(sk, shared).ref || pointUsers(sk, shared).length > 0 ||
        sk.constraints.some(function (c) {
            return refs(c).indexOf(shared) >= 0;
        });
    if (held || kind === 'chamfer') {
        // The corner keeps its place where the two lines would meet
        addConstraint(sk, { type: 'pointon', p: shared, curve: l1 });
        addConstraint(sk, { type: 'pointon', p: shared, curve: l2 });
    } else {
        sk.geometry = sk.geometry.filter(function (g) {
            return g.id !== shared;
        });
    }
    if (kind === 'chamfer') {
        const id = addLine(sk, t1, t2, construction);
        const gap = size * 0.6;
        addConstraint(sk, { type: 'distance', a: shared, b: t1, value: size, pos: [(corner[0] + cut.t1[0]) / 2 + (cut.t1[1] - corner[1]) / size * gap, (corner[1] + cut.t1[1]) / 2 - (cut.t1[0] - corner[0]) / size * gap] });
        if (equalTo) {
            addConstraint(sk, { type: 'equal', a: equalTo, b: id });
        } else {
            addConstraint(sk, { type: 'distance', a: shared, b: t2, value: size, pos: [(corner[0] + cut.t2[0]) / 2 - (cut.t2[1] - corner[1]) / size * gap, (corner[1] + cut.t2[1]) / 2 + (cut.t2[0] - corner[0]) / size * gap] });
        }
        return { id: id };
    }
    const c = addPoint(sk, cut.c[0], cut.c[1]);
    const id = addArc(sk, c, cut.forward ? t1 : t2, cut.forward ? t2 : t1, construction);
    addConstraint(sk, { type: 'tangent', a: l1, b: id });
    addConstraint(sk, { type: 'tangent', a: l2, b: id });
    if (equalTo) {
        addConstraint(sk, { type: 'equal', a: equalTo, b: id });
    } else {
        // The value sits outside the corner, beyond the middle of the arc
        const mx = (cut.t1[0] + cut.t2[0]) / 2 - cut.c[0];
        const my = (cut.t1[1] + cut.t2[1]) / 2 - cut.c[1];
        const ml = Math.hypot(mx, my) || 1;
        addConstraint(sk, { type: 'radius', curve: id, value: size, pos: [cut.c[0] + mx / ml * size * 2.2, cut.c[1] + my / ml * size * 2.2] });
    }
    return { id: id };
}

/* ================= constraints from picked entities ================= */
function kindOf(sk, id) {
    if (id === ORIGIN) {
        return 'point';
    }
    const g = find(sk, id);
    return g ? g.type : null;
}

function isRound(kind) {
    return kind === 'circle' || kind === 'arc';
}

// Build the constraint(s) of `type` for the entities picked so far (ids).
// Returns { add: [constraint, ...] }, { more: "what to pick next" } when
// more entities are needed, or { error: "text" } when the picks cannot take
// this constraint.
export function build(sk, type, ids) {
    const kinds = ids.map(function (id) {
        return kindOf(sk, id);
    });
    const count = function (test) {
        return kinds.filter(test).length;
    };
    const isPoint = function (k) {
        return k === 'point';
    };
    const isLine = function (k) {
        return k === 'line';
    };
    const pick = function (test) {
        return ids.filter(function (id, i) {
            return test(kinds[i]);
        });
    };
    const curveIds = pick(function (k) {
        return k !== 'point';
    });

    if (type === 'horizontal' || type === 'vertical') {
        if (count(isLine) >= 1) {
            return { add: pick(isLine).map(function (id) {
                return { type: type, line: id };
            }) };
        }
        if (count(isPoint) >= 2) {
            return { add: [{ type: type, a: ids[0], b: ids[1] }] };
        }
        return ids.length && !count(isPoint) ? { error: 'Pick a line or two points' } : { more: 'Pick a line, or two points' };
    }
    if (type === 'parallel' || type === 'perpendicular' || type === 'collinear') {
        if (count(isLine) !== ids.length) {
            return { error: 'Pick two lines' };
        }
        return ids.length >= 2 ? { add: [{ type: type, l1: ids[0], l2: ids[1] }] } : { more: 'Pick two lines' };
    }
    if (type === 'tangent') {
        if (count(isPoint)) {
            return { error: 'Pick a line and an arc or circle, or two arcs or circles' };
        }
        if (ids.length < 2) {
            return { more: 'Pick a line and an arc or circle, or two arcs or circles' };
        }
        return count(isRound) ? { add: [{ type: 'tangent', a: ids[0], b: ids[1] }] } : { error: 'Two lines cannot be tangent' };
    }
    if (type === 'equal') {
        if (count(isPoint)) {
            return { error: 'Pick two lines, or two arcs or circles' };
        }
        if (ids.length < 2) {
            return { more: 'Pick two lines, or two arcs or circles' };
        }
        return count(isLine) === 2 || count(isRound) === 2 ? { add: [{ type: 'equal', a: ids[0], b: ids[1] }] }
            : { error: 'A line and an arc cannot be made equal' };
    }
    if (type === 'coincident') {
        if (ids.length < 2) {
            return { more: 'Pick a point (an end, a centre), then a second point or a curve it should lie on' };
        }
        if (count(isPoint) === 2) {
            return { add: [{ type: 'coincident', a: ids[0], b: ids[1] }] };
        }
        if (count(isPoint) === 1) {
            return { add: [{ type: 'pointon', p: pick(isPoint)[0], curve: curveIds[0] }] };
        }
        // Two curves: coincident always needs a point (an end, a centre)
        return { error: count(isLine) === 2 ? 'Coincident needs a point. To put two lines on the same line use Collinear'
            : 'Coincident needs a point: pick an end point or a centre, then a point or a curve' };
    }
    if (type === 'concentric') {
        if (count(isPoint) || count(isLine)) {
            return { error: 'Pick two circles or arcs' };
        }
        if (ids.length < 2) {
            return { more: 'Pick two circles or arcs to share a centre' };
        }
        const c1 = find(sk, ids[0]).c;
        const c2 = find(sk, ids[1]).c;
        return c1 === c2 ? { error: 'These already share a centre' } : { add: [{ type: 'coincident', a: c1, b: c2 }] };
    }
    if (type === 'midpoint') {
        if (ids.length < 2) {
            return { more: 'Pick a point and a line' };
        }
        return count(isPoint) === 1 && count(isLine) === 1 ? { add: [{ type: 'midpoint', p: pick(isPoint)[0], line: pick(isLine)[0] }] }
            : { error: 'Pick a point and a line' };
    }
    if (type === 'symmetric') {
        if (ids.length < 3) {
            return count(isPoint) > 2 || count(isLine) > 1 || count(isRound) ? { error: 'Pick two points and a line' } : { more: 'Pick two points, then the mirror line' };
        }
        return count(isPoint) === 2 && count(isLine) === 1
            ? { add: [{ type: 'symmetric', a: pick(isPoint)[0], b: pick(isPoint)[1], line: pick(isLine)[0] }] }
            : { error: 'Pick two points and a line' };
    }
    if (type === 'fix') {
        if (!ids.length) {
            return { more: 'Pick a point, a line or a circle' };
        }
        const points = [];
        ids.forEach(function (id, i) {
            if (kinds[i] === 'point') {
                points.push(id);
            } else {
                const g = find(sk, id);
                (g.type === 'line' ? ['p1', 'p2'] : ['c']).forEach(function (field) {
                    points.push(g[field]);
                });
            }
        });
        return { add: points.filter(function (id) {
            return id !== ORIGIN;
        }).map(function (id) {
            const p = point(sk, id);
            return { type: 'fix', p: id, x: p[0], y: p[1] };
        }) };
    }
    return { error: 'Unknown constraint' };
}

/* ================= measuring ================= */
function lineAngle(sk, id) {
    const c = curve(sk, id);
    return c ? Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0]) : 0;
}

// Signed distance of a point from a line; positive on the left of p1 -> p2
function pointLine(sk, pid, lid) {
    const p = point(sk, pid);
    const c = curve(sk, lid);
    const dx = c.b[0] - c.a[0];
    const dy = c.b[1] - c.a[1];
    return (dx * (p[1] - c.a[1]) - dy * (p[0] - c.a[0])) / (Math.hypot(dx, dy) || 1);
}

// The value a dimension has in the sketch as it stands. Radians for angles.
export function measure(sk, d) {
    if (d.type === 'distance') {
        return dist(point(sk, d.a), point(sk, d.b));
    }
    if (d.type === 'hdistance') {
        return point(sk, d.b)[0] - point(sk, d.a)[0];
    }
    if (d.type === 'vdistance') {
        return point(sk, d.b)[1] - point(sk, d.a)[1];
    }
    if (d.type === 'pldistance') {
        return Math.abs(pointLine(sk, d.p, d.line));
    }
    if (d.type === 'radius' || d.type === 'diameter') {
        const c = curve(sk, d.curve);
        return c ? c.r * (d.type === 'diameter' ? 2 : 1) : 0;
    }
    if (d.type === 'axisangle') {
        const a = point(sk, d.a);
        const b = point(sk, d.b);
        return Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    if (d.type === 'angle') {
        let a = lineAngle(sk, d.l2) - lineAngle(sk, d.l1);
        while (a > Math.PI) {
            a -= Math.PI * 2;
        }
        while (a <= -Math.PI) {
            a += Math.PI * 2;
        }
        return a;
    }
    return 0;
}

/* ================= solver translation ================= */
// The end point two curves (lines or arcs) share, or null
function sharedEnd(sk, a, b) {
    const ends = function (id) {
        const g = find(sk, id);
        return !g ? [] : g.type === 'line' ? [g.p1, g.p2] : g.type === 'arc' ? [g.start, g.end] : [];
    };
    const other = ends(b);
    return ends(a).filter(function (id) {
        return other.indexOf(id) >= 0;
    })[0] || null;
}

// The direction planegcs gives a curve at point p: a line runs from p1 to
// p2, an arc counter clockwise
function headingOf(sk, id, p) {
    const g = find(sk, id);
    if (g.type === 'line') {
        const a = point(sk, g.p1);
        const b = point(sk, g.p2);
        return [b[0] - a[0], b[1] - a[1]];
    }
    const c = point(sk, g.c);
    const q = point(sk, p);
    return [-(q[1] - c[1]), q[0] - c[0]];
}

// Do two curves run the same way where they meet? Picks 0 or pi for the
// angle of an end to end tangency, so the solver keeps the join as drawn.
function headingsAgree(sk, a, b, p) {
    const u = headingOf(sk, a, p);
    const v = headingOf(sk, b, p);
    return u[0] * v[0] + u[1] * v[1] >= 0;
}

function mapConstraint(sk, c) {
    if (c.driven) {
        return []; // shows a size, does not set it
    }
    const kinds = {};
    refs(c).forEach(function (id) {
        kinds[id] = kindOf(sk, id);
    });
    if (refs(c).some(function (id) {
        return !kinds[id];
    })) {
        return []; // refers to something that no longer exists
    }
    const one = function (fields) {
        return [Object.assign({ id: c.id }, fields)];
    };
    // Order a pair so the line (or circle) comes first, as planegcs names them
    const pair = function (first) {
        return kinds[c.a] === first ? [c.a, c.b] : [c.b, c.a];
    };
    switch (c.type) {
        case 'coincident':
            return one({ type: 'p2p_coincident', p1_id: c.a, p2_id: c.b });
        case 'pointon':
            if (kinds[c.curve] === 'line') {
                return one({ type: 'point_on_line_pl', p_id: c.p, l_id: c.curve });
            }
            return kinds[c.curve] === 'circle' ? one({ type: 'point_on_circle', p_id: c.p, c_id: c.curve })
                : one({ type: 'point_on_arc', p_id: c.p, a_id: c.curve });
        case 'collinear': {
            // Both ends of the second line lie on the first. An end the two
            // lines already share is left out: it would say nothing new and
            // the solver would call the constraint redundant.
            const first = find(sk, c.l1);
            const second = find(sk, c.l2);
            const out = [];
            [second.p1, second.p2].forEach(function (p, i) {
                if (p !== first.p1 && p !== first.p2) {
                    out.push({ id: c.id + (i ? ':b' : ''), type: 'point_on_line_pl', p_id: p, l_id: c.l1 });
                }
            });
            return out;
        }
        case 'horizontal':
        case 'vertical':
            return c.line ? one({ type: c.type + '_l', l_id: c.line }) : one({ type: c.type + '_pp', p1_id: c.a, p2_id: c.b });
        case 'parallel':
            return one({ type: 'parallel', l1_id: c.l1, l2_id: c.l2 });
        case 'perpendicular':
            return one({ type: 'perpendicular_ll', l1_id: c.l1, l2_id: c.l2 });
        case 'tangent': {
            // Curves joined end to end: tangent at the shared point. The plain
            // tangency below would also hold there, but with the end already on
            // both curves it is a double root: the solver calls it redundant
            // and the join could still slide along the line.
            const joint = sharedEnd(sk, c.a, c.b);
            if (joint) {
                return one({ type: 'angle_via_point', crv1_id: c.a, crv2_id: c.b, p_id: joint, angle: headingsAgree(sk, c.a, c.b, joint) ? 0 : Math.PI });
            }
            if (kinds[c.a] === 'line' || kinds[c.b] === 'line') {
                const p = pair('line');
                return kinds[p[1]] === 'circle' ? one({ type: 'tangent_lc', l_id: p[0], c_id: p[1] })
                    : one({ type: 'tangent_la', l_id: p[0], a_id: p[1] });
            }
            if (kinds[c.a] === 'circle' && kinds[c.b] === 'circle') {
                return one({ type: 'tangent_cc', c1_id: c.a, c2_id: c.b });
            }
            if (kinds[c.a] === 'arc' && kinds[c.b] === 'arc') {
                return one({ type: 'tangent_aa', a1_id: c.a, a2_id: c.b });
            }
            const p = pair('circle');
            return one({ type: 'tangent_ca', c_id: p[0], a_id: p[1] });
        }
        case 'equal': {
            if (kinds[c.a] === 'line') {
                return one({ type: 'equal_length', l1_id: c.a, l2_id: c.b });
            }
            if (kinds[c.a] === 'circle' && kinds[c.b] === 'circle') {
                return one({ type: 'equal_radius_cc', c1_id: c.a, c2_id: c.b });
            }
            if (kinds[c.a] === 'arc' && kinds[c.b] === 'arc') {
                return one({ type: 'equal_radius_aa', a1_id: c.a, a2_id: c.b });
            }
            const p = pair('circle');
            return one({ type: 'equal_radius_ca', c1_id: p[0], a2_id: p[1] });
        }
        case 'fix':
            return [
                { id: c.id, type: 'coordinate_x', p_id: c.p, x: c.x },
                { id: c.id + ':y', type: 'coordinate_y', p_id: c.p, y: c.y }
            ];
        case 'midpoint': {
            const line = find(sk, c.line);
            return one({ type: 'p2p_symmetric_ppp', p1_id: line.p1, p2_id: line.p2, p_id: c.p });
        }
        case 'symmetric':
            return one({ type: 'p2p_symmetric_ppl', p1_id: c.a, p2_id: c.b, l_id: c.line });
        case 'distance':
            return one({ type: 'p2p_distance', p1_id: c.a, p2_id: c.b, distance: c.value });
        case 'hdistance':
            return one({ type: 'difference', param1: { o_id: c.a, prop: 'x' }, param2: { o_id: c.b, prop: 'x' }, difference: c.value });
        case 'vdistance':
            return one({ type: 'difference', param1: { o_id: c.a, prop: 'y' }, param2: { o_id: c.b, prop: 'y' }, difference: c.value });
        case 'pldistance':
            return one({ type: 'p2l_distance', p_id: c.p, l_id: c.line, distance: c.value });
        case 'radius':
            return kinds[c.curve] === 'circle' ? one({ type: 'circle_radius', c_id: c.curve, radius: c.value })
                : one({ type: 'arc_radius', a_id: c.curve, radius: c.value });
        case 'diameter':
            return kinds[c.curve] === 'circle' ? one({ type: 'circle_diameter', c_id: c.curve, diameter: c.value })
                : one({ type: 'arc_diameter', a_id: c.curve, diameter: c.value });
        case 'angle':
            return one({ type: 'l2l_angle_ll', l1_id: c.l1, l2_id: c.l2, angle: c.value });
        case 'axisangle':
            return one({ type: 'p2p_angle', p1_id: c.a, p2_id: c.b, angle: c.value });
        default:
            return [];
    }
}

// The sketch as a planegcs primitive list. `drag` is an optional list of
// { p, x, y }: points the user is pulling, added as temporary constraints so
// they follow the cursor as far as the real constraints allow.
export function toPrimitives(sk, drag) {
    const out = [{ id: ORIGIN, type: 'point', x: 0, y: 0, fixed: true }];
    // A dragged point starts the solve where the cursor is. The solver then
    // brings it back to the nearest place its constraints allow, so a point
    // on a curve follows the cursor round the curve instead of sticking when
    // it is pulled straight across.
    const pulled = {};
    (drag || []).forEach(function (d) {
        pulled[d.p] = d;
    });
    sk.geometry.forEach(function (g) {
        if (g.type === 'point') {
            const d = !g.ref && pulled[g.id];
            out.push({ id: g.id, type: 'point', x: d ? d.x : g.x, y: d ? d.y : g.y, fixed: !!g.ref });
        }
    });
    sk.geometry.forEach(function (g) {
        const c = g.type === 'point' ? null : curve(sk, g);
        if (!c) {
            return;
        }
        if (g.type === 'line') {
            out.push({ id: g.id, type: 'line', p1_id: g.p1, p2_id: g.p2 });
        } else if (g.type === 'circle') {
            out.push({ id: g.id, type: 'circle', c_id: g.c, radius: g.r });
            if (g.ref) {
                // A projected circle keeps its size as well as its place
                out.push({ id: '$rr' + g.id, type: 'circle_radius', c_id: g.id, radius: g.r });
            }
        } else {
            out.push({
                id: g.id, type: 'arc', c_id: g.c, radius: c.r,
                start_angle: c.a0, end_angle: c.a0 + c.sweep, start_id: g.start, end_id: g.end
            });
            if (g.ref) {
                // A projected arc has all three points fixed, which already
                // says everything; the usual arc rules on top would be one
                // equation too many and the solver calls that a conflict.
                // Its own angles and radius are pinned instead.
                out.push({ id: '$ra' + g.id, type: 'equal', param1: { o_id: g.id, prop: 'start_angle' }, param2: c.a0 });
                out.push({ id: '$rb' + g.id, type: 'equal', param1: { o_id: g.id, prop: 'end_angle' }, param2: c.a0 + c.sweep });
                out.push({ id: '$rr' + g.id, type: 'arc_radius', a_id: g.id, radius: c.r });
            } else {
                out.push({ id: g.id + ':rules', type: 'arc_rules', a_id: g.id });
            }
        }
    });
    sk.constraints.forEach(function (c) {
        mapConstraint(sk, c).forEach(function (primitive) {
            out.push(primitive);
        });
    });
    (drag || []).forEach(function (d, i) {
        out.push({ id: '$dx' + i, type: 'coordinate_x', p_id: d.p, x: d.x, temporary: true });
        out.push({ id: '$dy' + i, type: 'coordinate_y', p_id: d.p, y: d.y, temporary: true });
    });
    return out;
}

// Copy solved positions and radii back into the sketch
export function applySolution(sk, primitives) {
    const solved = {};
    primitives.forEach(function (p) {
        solved[p.id] = p;
    });
    sk.geometry.forEach(function (g) {
        const s = solved[g.id];
        if (!s) {
            return;
        }
        if (g.type === 'point') {
            g.x = s.x;
            g.y = s.y;
        } else if (g.type === 'circle') {
            g.r = s.radius;
        }
    });
    // Driven dimensions follow what they measure
    sk.constraints.forEach(function (c) {
        if (c.driven) {
            const value = measure(sk, c);
            if (isFinite(value)) {
                c.value = value;
            }
        }
    });
}
