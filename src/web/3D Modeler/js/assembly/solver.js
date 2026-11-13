/*
    3D Modeler - assembly constraint solver

    Places the components of an assembly so their constraints hold, as
    Inventor's Mate, Flush, Angle, Tangent and Insert do.

    Every constraint is a short list of residuals: numbers that are zero when
    it holds. Distances are in millimetres; directions and angles are
    multiplied by a length scale (L, about the size of the assembly) so a
    small turn and a small shift weigh about the same.

    Each component that is not grounded has six unknowns: a turn (a rotation
    vector) about its own centre and a shift. Levenberg-Marquardt brings the
    residuals to zero from where the components are now, so they move as
    little as needed: a new Mate pulls a part across to its partner and
    leaves everything else alone. The Jacobian is taken by finite
    differences, which is plenty for a few dozen components.

    A constraint refers to two entities (see geometry.js entityOf), each in
    the coordinates of its component, or of the assembly origin when
    `comp` is null:
        { comp, kind: "plane" | "cylinder" | "circle" | "line" | "point", o, n | d, r }

    Constraint records (also what the assembly file stores):
        { id, type: "mate", solution: "mate" | "flush", offset, a, b }
            planes: faces against each other ("mate", normals opposed, the
            offset is the gap) or side by side ("flush", normals the same
            way); an axis (cylinder, line or circle) with a plane: the axis
            lies in the plane; two axes: the same line; a point (the centre
            of a circle) with a plane or a line
        { id, type: "angle", angle (degrees), a, b }      planes or axes
        { id, type: "tangent", solution: "outside" | "inside", offset, a, b }
            a cylinder against a plane or another cylinder
        { id, type: "insert", solution: "opposed" | "aligned", offset, a, b }
            two round edges: on one axis, their faces against each other
        suppressed: true leaves a constraint out.

    No DOM here; runs under Node for the tests.
*/

import * as G from './geometry.js';

export const TOLERANCE = 1e-4;  // how close a constraint has to be to hold (mm)
const STEP = 1e-6;              // finite difference step (rad and mm)

/* ================= residuals ================= */
// The direction of an entity: a plane's normal or an axis
function dirOf(e) {
    return e.n || e.d;
}

function isAxis(e) {
    return e.kind === 'cylinder' || e.kind === 'line' || e.kind === 'circle';
}

// What an entity counts as in a Mate: "plane", "axis" or "point"
function mateKind(e) {
    return e.kind === 'plane' ? 'plane' : isAxis(e) ? 'axis' : 'point';
}

function vec3(out, v, k) {
    out.push(v[0] * k, v[1] * k, v[2] * k);
}

function mate(c, a, b, L, out) {
    const ka = mateKind(a);
    const kb = mateKind(b);
    const offset = c.offset || 0;
    if (ka === 'plane' && kb === 'plane') {
        const sgn = c.solution === 'flush' ? 1 : -1;
        vec3(out, G.sub(a.n, G.scale(b.n, sgn)), L);
        out.push(G.dot(G.sub(b.o, a.o), a.n) - offset);
        return;
    }
    if (ka === 'plane' || kb === 'plane') {
        const plane = ka === 'plane' ? a : b;
        const other = ka === 'plane' ? b : a;
        if (mateKind(other) === 'axis') {
            out.push(G.dot(other.d, plane.n) * L);
        }
        out.push(G.dot(G.sub(other.o, plane.o), plane.n) - offset);
        return;
    }
    if (ka === 'axis' && kb === 'axis') {
        if (c.solution === 'aligned') {
            vec3(out, G.sub(a.d, b.d), L);
        } else if (c.solution === 'opposed') {
            vec3(out, G.add(a.d, b.d), L);
        } else {
            vec3(out, G.cross(a.d, b.d), L);
        }
        const gap = G.perpendicular(G.sub(b.o, a.o), a.d);
        if (offset) {
            out.push(G.length(gap) - offset);
        } else {
            vec3(out, gap, 1);
        }
        return;
    }
    if (ka === 'axis' || kb === 'axis') {
        const axis = ka === 'axis' ? a : b;
        const point = ka === 'axis' ? b : a;
        vec3(out, G.perpendicular(G.sub(point.o, axis.o), axis.d), 1);
        return;
    }
    const gap = G.sub(b.o, a.o);
    if (offset) {
        out.push(G.length(gap) - offset);
    } else {
        vec3(out, gap, 1);
    }
}

function angle(c, a, b, L, out) {
    const da = dirOf(a);
    const db = dirOf(b);
    const now = Math.atan2(G.length(G.cross(da, db)), G.dot(da, db));
    out.push((now - (c.angle || 0) * Math.PI / 180) * L);
}

function tangent(c, a, b, L, out) {
    const inside = c.solution === 'inside';
    const offset = c.offset || 0;
    if (a.kind === 'plane' || b.kind === 'plane') {
        const plane = a.kind === 'plane' ? a : b;
        const round = a.kind === 'plane' ? b : a;
        out.push(G.dot(round.d, plane.n) * L);
        const want = (round.r + offset) * (inside ? -1 : 1);
        out.push(G.dot(G.sub(round.o, plane.o), plane.n) - want);
        return;
    }
    vec3(out, G.cross(a.d, b.d), L);
    const apart = G.length(G.perpendicular(G.sub(b.o, a.o), a.d));
    out.push(apart - (inside ? Math.abs(a.r - b.r) : a.r + b.r) - offset);
}

function insert(c, a, b, L, out) {
    vec3(out, c.solution === 'aligned' ? G.sub(a.d, b.d) : G.add(a.d, b.d), L);
    const gap = G.sub(b.o, a.o);
    vec3(out, G.perpendicular(gap, a.d), 1);
    out.push(G.dot(gap, a.d) - (c.offset || 0));
}

const RESIDUALS = { mate: mate, angle: angle, tangent: tangent, insert: insert };

// Which entity kinds each constraint takes, for the panel and for checks
export function accepts(type, a, b) {
    const kinds = [a.kind, b.kind];
    const has = function (k) {
        return kinds.indexOf(k) >= 0;
    };
    if (type === 'mate') {
        return true;
    }
    if (type === 'angle') {
        return kinds.every(function (k) {
            return k !== 'point';
        });
    }
    if (type === 'tangent') {
        return (has('plane') && (has('cylinder') || has('circle'))) || (kinds.every(function (k) {
            return k === 'cylinder' || k === 'circle';
        }));
    }
    if (type === 'insert') {
        return kinds.every(function (k) {
            return k === 'circle';
        });
    }
    return false;
}

// The residuals of one constraint with its entities in assembly coordinates
export function residualsOf(c, a, b, L) {
    const out = [];
    const fn = RESIDUALS[c.type];
    if (fn) {
        fn(c, a, b, L || 50, out);
    }
    return out;
}

/* ================= the model ================= */
// components: [{ id, matrix, grounded, pivot }] (pivot: a point near the
// middle of the part, in its own coordinates). Returns a solver state.
function makeState(components, constraints, L) {
    const byId = {};
    components.forEach(function (comp) {
        byId[comp.id] = comp;
    });
    const active = constraints.filter(function (c) {
        if (c.suppressed || !RESIDUALS[c.type] || !c.a || !c.b) {
            return false;
        }
        const ok = function (e) {
            return e.comp === null || e.comp === undefined || !!byId[e.comp];
        };
        return ok(c.a) && ok(c.b);
    });
    return { byId: byId, constraints: active, L: L || 50 };
}

function worldEntity(e, matrices) {
    return e.comp ? G.entityToWorld(e, matrices[e.comp]) : e;
}

function constraintResiduals(state, matrices, c) {
    return residualsOf(c, worldEntity(c.a, matrices), worldEntity(c.b, matrices), state.L);
}

// A placement turned by the rotation vector w about the world point p and
// shifted by v
function moved(m, delta, p) {
    const turn = G.rotationVector([delta[0], delta[1], delta[2]], p);
    const shift = G.translation([delta[3], delta[4], delta[5]]);
    return G.multiply(shift, G.multiply(turn, m));
}

// Solve A x = b for a small dense symmetric system (Gauss with pivoting)
function linearSolve(A, b) {
    const n = b.length;
    const M = A.map(function (row, i) {
        return row.concat([b[i]]);
    });
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) {
                pivot = r;
            }
        }
        if (Math.abs(M[pivot][col]) < 1e-300) {
            continue;
        }
        const tmp = M[col];
        M[col] = M[pivot];
        M[pivot] = tmp;
        for (let r = 0; r < n; r++) {
            if (r !== col) {
                const f = M[r][col] / M[col][col];
                if (f) {
                    for (let k = col; k <= n; k++) {
                        M[r][k] -= f * M[col][k];
                    }
                }
            }
        }
    }
    return M.map(function (row, i) {
        return Math.abs(row[i]) < 1e-300 ? 0 : row[n] / row[i];
    });
}

function sumSquares(r) {
    let s = 0;
    for (let i = 0; i < r.length; i++) {
        s += r[i] * r[i];
    }
    return s;
}

/*
    Run Levenberg-Marquardt.
      matrices   { id: matrix } where every component is now (copied)
      free       ids that may move
      residual   function(matrices) -> [numbers]
    Returns the new matrices and the final sum of squares.
*/
function levenberg(state, matrices, free, residual, maxIterations, goal) {
    let current = Object.assign({}, matrices);
    let r = residual(current);
    let cost = sumSquares(r);
    let lambda = 1e-3;
    const n = free.length * 6;
    let iterations = 0;
    for (; iterations < maxIterations && cost > goal; iterations++) {
        // Turns about each component's middle as it is now
        const pivots = free.map(function (id) {
            return G.applyPoint(current[id], state.byId[id].pivot || [0, 0, 0]);
        });
        // Jacobian by forward differences, one column per unknown
        const J = [];
        for (let i = 0; i < free.length; i++) {
            for (let k = 0; k < 6; k++) {
                const delta = [0, 0, 0, 0, 0, 0];
                delta[k] = STEP;
                const trial = Object.assign({}, current);
                trial[free[i]] = moved(current[free[i]], delta, pivots[i]);
                const r2 = residual(trial);
                const column = new Array(r.length);
                for (let j = 0; j < r.length; j++) {
                    column[j] = (r2[j] - r[j]) / STEP;
                }
                J.push(column);
            }
        }
        // Normal equations: (J^T J + lambda diag) x = -J^T r
        const A = [];
        const g = [];
        for (let p = 0; p < n; p++) {
            A.push(new Array(n));
            let s = 0;
            for (let j = 0; j < r.length; j++) {
                s += J[p][j] * r[j];
            }
            g.push(-s);
            for (let q = 0; q <= p; q++) {
                let t = 0;
                for (let j = 0; j < r.length; j++) {
                    t += J[p][j] * J[q][j];
                }
                A[p][q] = t;
            }
        }
        for (let p = 0; p < n; p++) {
            for (let q = p + 1; q < n; q++) {
                A[p][q] = A[q][p];
            }
        }
        let accepted = false;
        for (let tries = 0; tries < 12 && !accepted; tries++) {
            const D = A.map(function (row, p) {
                const copy = row.slice();
                copy[p] += lambda * (row[p] + 1e-9) + 1e-12;
                return copy;
            });
            const x = linearSolve(D, g);
            const trial = Object.assign({}, current);
            free.forEach(function (id, i) {
                trial[id] = G.tidy(moved(current[id], x.slice(i * 6, i * 6 + 6), pivots[i]));
            });
            const r2 = residual(trial);
            const cost2 = sumSquares(r2);
            if (cost2 < cost) {
                current = trial;
                r = r2;
                cost = cost2;
                lambda = Math.max(lambda / 4, 1e-12);
                accepted = true;
            } else {
                lambda *= 6;
            }
        }
        if (!accepted) {
            break; // stuck: as close as it gets
        }
    }
    return { matrices: current, cost: cost, iterations: iterations };
}

// The components connected to `seeds` through constraints, grounded ones
// stop the spread (they do not move, so what lies beyond them is not affected)
function cluster(state, seeds) {
    const reach = new Set(seeds);
    let grew = true;
    while (grew) {
        grew = false;
        state.constraints.forEach(function (c) {
            const ids = [c.a.comp, c.b.comp].filter(Boolean);
            if (ids.some(function (id) {
                return reach.has(id) && !state.byId[id].grounded;
            })) {
                ids.forEach(function (id) {
                    if (!reach.has(id)) {
                        reach.add(id);
                        grew = true;
                    }
                });
            }
        });
    }
    return reach;
}

/*
    Solve the assembly.
      components   [{ id, matrix, grounded, pivot }]
      constraints  constraint records (above)
      options      lengthScale (mm), maxIterations,
                   drag: { comp, matrix } to pull a component towards a
                   placement while the constraints hold (Free Move, the
                   triad): the constraints win, the component follows the
                   pointer along whatever freedom it has left
                   only: [ids] to solve just the components reached from these
    Returns { matrices: { id: matrix } (every component), errors: { constraintId: size },
              ok: no constraint left unsatisfied }
*/
export function solve(components, constraints, options) {
    const opts = options || {};
    const state = makeState(components, constraints, opts.lengthScale);
    const start = {};
    components.forEach(function (comp) {
        start[comp.id] = comp.matrix.slice();
    });
    // Components that may move: not grounded, and constrained or dragged
    const seeds = [];
    state.constraints.forEach(function (c) {
        [c.a.comp, c.b.comp].forEach(function (id) {
            if (id && seeds.indexOf(id) < 0) {
                seeds.push(id);
            }
        });
    });
    if (opts.drag && seeds.indexOf(opts.drag.comp) < 0) {
        seeds.push(opts.drag.comp);
    }
    const reach = opts.only ? cluster(state, opts.only.concat(opts.drag ? [opts.drag.comp] : [])) : null;
    const free = seeds.filter(function (id) {
        return state.byId[id] && !state.byId[id].grounded && (!reach || reach.has(id));
    });
    const used = state.constraints.filter(function (c) {
        return !reach || [c.a.comp, c.b.comp].some(function (id) {
            return id && reach.has(id);
        });
    });
    const constraintsOnly = function (matrices) {
        const out = [];
        used.forEach(function (c) {
            const r = constraintResiduals(state, matrices, c);
            for (let i = 0; i < r.length; i++) {
                out.push(r[i]);
            }
        });
        return out;
    };
    let matrices = start;
    if (free.length) {
        if (opts.drag) {
            // First towards the pointer: the constraints weigh a thousand
            // times more than the pull, then the constraints alone tidy up
            const target = opts.drag.matrix;
            const comp = state.byId[opts.drag.comp];
            const pivot = comp.pivot || [0, 0, 0];
            const reach2 = state.L / (G.scaleOf(target) || 1);
            const marks = [pivot, G.add(pivot, [reach2, 0, 0]), G.add(pivot, [0, reach2, 0])];
            const wanted = marks.map(function (p) {
                return G.applyPoint(target, p);
            });
            const pulled = function (m) {
                const out = constraintsOnly(m).map(function (v) {
                    return v * 30;
                });
                marks.forEach(function (p, i) {
                    const at = G.applyPoint(m[opts.drag.comp], p);
                    out.push((at[0] - wanted[i][0]) * 0.03, (at[1] - wanted[i][1]) * 0.03, (at[2] - wanted[i][2]) * 0.03);
                });
                return out;
            };
            const first = Object.assign({}, start);
            if (!comp.grounded) {
                first[opts.drag.comp] = target.slice();
            }
            matrices = levenberg(state, first, free, pulled, opts.maxIterations || 40, 1e-18).matrices;
        }
        const goal = TOLERANCE * TOLERANCE * 1e-4;
        let best = levenberg(state, matrices, free, constraintsOnly, opts.maxIterations || 80, goal);
        // Two faces that must face each other but start facing the same way
        // (a pin standing upright above a hole it must go into from above)
        // sit on a saddle: no small turn helps, so the solver stops there.
        // Try again with one component turned over, about each of its axes.
        if (best.cost > goal * 100 && !opts.drag) {
            const flips = [];
            free.forEach(function (id) {
                [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(function (axis) {
                    flips.push({ id: id, axis: axis });
                });
            });
            for (let i = 0; i < flips.length && best.cost > goal * 100; i++) {
                const f = flips[i];
                const m = best.matrices[f.id];
                const pivot = G.applyPoint(m, state.byId[f.id].pivot || [0, 0, 0]);
                const axis = G.applyDir(m, f.axis);
                const start2 = Object.assign({}, best.matrices);
                start2[f.id] = G.multiply(G.rotation(axis, Math.PI, pivot), m);
                const tried = levenberg(state, start2, free, constraintsOnly, opts.maxIterations || 80, goal);
                if (tried.cost < best.cost * 0.5) {
                    best = tried;
                }
            }
        }
        matrices = best.matrices;
    }
    const errors = {};
    let ok = true;
    state.constraints.forEach(function (c) {
        const size = Math.sqrt(sumSquares(constraintResiduals(state, matrices, c)));
        if (size > TOLERANCE * 10) {
            errors[c.id] = size;
            ok = false;
        }
    });
    return { matrices: matrices, errors: errors, ok: ok };
}

/* ================= degrees of freedom ================= */
// Eigenvalues of a small symmetric matrix (Jacobi rotations)
function eigenvalues(S) {
    const n = S.length;
    const A = S.map(function (row) {
        return row.slice();
    });
    for (let sweep = 0; sweep < 60; sweep++) {
        let off = 0;
        for (let p = 0; p < n; p++) {
            for (let q = p + 1; q < n; q++) {
                off += A[p][q] * A[p][q];
            }
        }
        if (off < 1e-30) {
            break;
        }
        for (let p = 0; p < n; p++) {
            for (let q = p + 1; q < n; q++) {
                if (Math.abs(A[p][q]) < 1e-300) {
                    continue;
                }
                const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
                const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                const c = 1 / Math.sqrt(t * t + 1);
                const s = t * c;
                for (let k = 0; k < n; k++) {
                    const akp = A[k][p];
                    const akq = A[k][q];
                    A[k][p] = c * akp - s * akq;
                    A[k][q] = s * akp + c * akq;
                }
                for (let k = 0; k < n; k++) {
                    const apk = A[p][k];
                    const aqk = A[q][k];
                    A[p][k] = c * apk - s * aqk;
                    A[q][k] = s * apk + c * aqk;
                }
            }
        }
    }
    return A.map(function (row, i) {
        return row[i];
    });
}

// How many of its six degrees of freedom each component has left, with the
// others held where they are: { id: 0..6 }. A grounded component has 0.
export function freedom(components, constraints, options) {
    const opts = options || {};
    const state = makeState(components, constraints, opts.lengthScale);
    const matrices = {};
    components.forEach(function (comp) {
        matrices[comp.id] = comp.matrix;
    });
    const out = {};
    components.forEach(function (comp) {
        if (comp.grounded) {
            out[comp.id] = 0;
            return;
        }
        const mine = state.constraints.filter(function (c) {
            return c.a.comp === comp.id || c.b.comp === comp.id;
        });
        if (!mine.length) {
            out[comp.id] = 6;
            return;
        }
        const pivot = G.applyPoint(comp.matrix, comp.pivot || [0, 0, 0]);
        const residual = function (m) {
            const r = [];
            mine.forEach(function (c) {
                residualsOf(c, worldEntity(c.a, m), worldEntity(c.b, m), state.L).forEach(function (v) {
                    r.push(v);
                });
            });
            return r;
        };
        const r0 = residual(matrices);
        const columns = [];
        for (let k = 0; k < 6; k++) {
            const delta = [0, 0, 0, 0, 0, 0];
            delta[k] = 1e-5;
            const trial = Object.assign({}, matrices);
            trial[comp.id] = moved(comp.matrix, delta, pivot);
            const r1 = residual(trial);
            columns.push(r1.map(function (v, j) {
                return (v - r0[j]) / 1e-5;
            }));
        }
        const S = columns.map(function (a) {
            return columns.map(function (b) {
                let t = 0;
                for (let j = 0; j < a.length; j++) {
                    t += a[j] * b[j];
                }
                return t;
            });
        });
        const values = eigenvalues(S);
        const top = Math.max.apply(null, values.concat([0]));
        const rank = values.filter(function (v) {
            return v > Math.max(top * 1e-7, 1e-9);
        }).length;
        out[comp.id] = 6 - rank;
    });
    return out;
}

// The constraints that do not hold where the components are now, without
// moving anything: { constraintId: size }
export function unsatisfied(components, constraints, options) {
    const opts = options || {};
    const state = makeState(components, constraints, opts.lengthScale);
    const matrices = {};
    components.forEach(function (comp) {
        matrices[comp.id] = comp.matrix;
    });
    const out = {};
    state.constraints.forEach(function (c) {
        const size = Math.sqrt(sumSquares(constraintResiduals(state, matrices, c)));
        if (size > TOLERANCE * 10) {
            out[c.id] = size;
        }
    });
    return out;
}
