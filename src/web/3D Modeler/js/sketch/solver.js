/*
    3D Modeler - sketch constraint solver

    Wraps planegcs (FreeCAD's 2D geometric constraint solver, lib/planegcs).
    The solver is small and answers in milliseconds, so it runs on the main
    thread where the sketcher can call it on every pointer move of a drag.

    model.js turns a sketch into the solver's primitive list; this file runs
    the solve and reports what the sketcher shows: the degrees of freedom left
    and the constraints that conflict or are redundant.
*/

import { init_planegcs_module, GcsWrapper } from '../../lib/planegcs/index.js';
import { toPrimitives, applySolution, dimensionSides, measure, find, ORIGIN } from './model.js';

// A point that ends up closer than this to where it was has not moved (mm)
const STILL = 1e-6;

let modulePromise = null;

export function loadSolver() {
    if (!modulePromise) {
        modulePromise = init_planegcs_module();
    }
    return modulePromise;
}

function baseIds(list) {
    const out = [];
    list.forEach(function (id) {
        const base = String(id).split(':')[0];
        if (base.charAt(0) !== '$' && out.indexOf(base) < 0) {
            out.push(base);
        }
    });
    return out;
}

// A constraint made of several equations (Collinear: both ends of the second
// line on the first; Fix: x and y) can have a part that the rest of the sketch
// already implies. Two vertical lines made collinear only need one end on the
// other line: the vertical constraints carry the second end along. The solver
// calls that part redundant, which would refuse the whole constraint. Those
// parts are returned here so they can be left out, as long as the constraint
// keeps at least one equation. A redundant equation is one the solution of the
// others satisfies anyway, so leaving it out does not change the answer.
export function spareParts(sketch, primitives, redundant) {
    const constraints = new Set(sketch.constraints.map(function (c) {
        return c.id;
    }));
    const flagged = new Set(redundant.map(String));
    const parts = new Map(); // constraint id -> ids of its equations
    primitives.forEach(function (p) {
        const base = String(p.id).split(':')[0];
        if (constraints.has(base)) {
            if (!parts.has(base)) {
                parts.set(base, []);
            }
            parts.get(base).push(String(p.id));
        }
    });
    const out = [];
    parts.forEach(function (ids) {
        const extra = ids.filter(function (id) {
            return flagged.has(id);
        });
        if (extra.length && extra.length < ids.length) {
            Array.prototype.push.apply(out, extra);
        }
    });
    return out;
}

// createSolver().then(solver => solver.solve(sketch, drag))
// solve() moves the geometry of `sketch` in place when it succeeds and returns
//   { ok, dof, conflicting: [constraint id], redundant: [constraint id] }
// ok is false when the constraints cannot all be met; the sketch is then
// left untouched.
export async function createSolver() {
    const mod = await loadSolver();
    const wrapper = new GcsWrapper(new mod.GcsSystem());
    wrapper.debug_mode = 0; // DebugMode.NoDebug: keep the solver out of the console

    // Push the sketch and the `extra` primitives, minus the equations in
    // `skip`, and solve it
    function attempt(sketch, drag, skip, extra) {
        wrapper.clear_data();
        const primitives = toPrimitives(sketch, drag).concat(extra || []).filter(function (p) {
            return !skip.has(String(p.id));
        });
        wrapper.push_primitives_and_params(primitives);
        const status = wrapper.solve();
        return {
            primitives: primitives,
            status: status,
            conflicting: wrapper.get_gcs_conflicting_constraints(),
            redundant: wrapper.get_gcs_redundant_constraints()
        };
    }

    // Each pass leaves out the parts of constraints found to be implied by
    // the rest (see spareParts); one pass is the usual case. Throws when the
    // solver does.
    function passes(sketch, drag, extra) {
        const skip = new Set();
        let run = null;
        for (let pass = 0; pass < 4; pass++) {
            run = attempt(sketch, drag, skip, extra);
            const spare = run.conflicting.length ? [] : spareParts(sketch, run.primitives, run.redundant);
            if (!spare.length) {
                break;
            }
            spare.forEach(function (id) {
                skip.add(id);
            });
        }
        return run;
    }

    function solve(sketch, drag) {
        let run = null;
        try {
            run = passes(sketch, drag);
        } catch (err) {
            return { ok: false, dof: -1, conflicting: [], redundant: [], error: String(err && err.message ? err.message : err) };
        }
        const conflicting = baseIds(run.conflicting);
        const redundant = baseIds(run.redundant);
        // 0 = solved, 1 = converged to the nearest answer; anything else failed
        const ok = (run.status === 0 || run.status === 1) && !conflicting.length;
        if (ok) {
            wrapper.apply_solution();
            applySolution(sketch, wrapper.sketch_index.get_primitives());
        }
        return { ok: ok, dof: wrapper.gcs.dof(), conflicting: conflicting, redundant: redundant };
    }

    /* ---------- changing a dimension ---------- */
    // Holds for a change: each free point (not the origin, not projected
    // from the model) gets a pair of coordinate equations keeping it where
    // it is. Those of the points in `keep` are hard; the others are soft
    // (planegcs temporary constraints, which the solver meets as closely as
    // the real constraints allow, the way a dragged point follows the
    // cursor). Circles keep their size softly as well.
    function holds(sketch, keep) {
        const out = [];
        sketch.geometry.forEach(function (g, i) {
            if (g.ref) {
                return;
            }
            if (g.type === 'point') {
                const soft = !keep.has(g.id);
                out.push({ id: '$hx' + i, type: 'coordinate_x', p_id: g.id, x: g.x, temporary: soft });
                out.push({ id: '$hy' + i, type: 'coordinate_y', p_id: g.id, y: g.y, temporary: soft });
            } else if (g.type === 'circle') {
                out.push({ id: '$hr' + i, type: 'circle_radius', c_id: g.id, radius: g.r, temporary: true });
            }
        });
        return out;
    }

    // Solve `sketch` with the points in `keep` held and the rest held
    // softly, then once more without the holds to make sure every constraint
    // is met. True when both work; the sketch has then moved.
    function holding(sketch, keep) {
        let run = null;
        try {
            run = passes(sketch, null, holds(sketch, keep));
        } catch (err) {
            return false;
        }
        if ((run.status !== 0 && run.status !== 1) || run.conflicting.length) {
            return false;
        }
        wrapper.apply_solution();
        applySolution(sketch, wrapper.sketch_index.get_primitives());
        return solve(sketch).ok;
    }

    // How many points (and circle sizes) differ between two copies
    function moved(before, after) {
        let count = 0;
        after.geometry.forEach(function (g, i) {
            const b = before.geometry[i];
            const d = g.type === 'point' ? Math.hypot(g.x - b.x, g.y - b.y) : g.type === 'circle' ? Math.abs(g.r - b.r) : 0;
            if (d > STILL) {
                count++;
            }
        });
        return count;
    }

    // How early an end of a dimension was drawn: the place of its first
    // point in the geometry list; the origin and model edges come first
    function age(sketch, side) {
        let first = Infinity;
        side.forEach(function (id) {
            const g = id === ORIGIN ? null : find(sketch, id);
            const at = !g || g.ref ? -1 : sketch.geometry.indexOf(g);
            first = Math.min(first, at);
        });
        return first;
    }

    function copyPlaces(from, to) {
        to.geometry.forEach(function (g, i) {
            const s = from.geometry[i];
            if (g.type === 'point') {
                g.x = s.x;
                g.y = s.y;
            } else if (g.type === 'circle') {
                g.r = s.r;
            }
        });
    }

    // Meet the new value of dimension `dim` moving as little as possible:
    // hold each of its ends in turn, everything else held softly, and keep
    // the answer that moves the fewest points. On a tie the end drawn first
    // stays. When no end can be held, everything is held softly. False if
    // nothing worked; the sketch is then untouched.
    function settle(sketch, dim) {
        const text = JSON.stringify({ geometry: sketch.geometry, constraints: sketch.constraints });
        let best = null;
        const tryKeeping = function (side) {
            const copy = JSON.parse(text);
            const keep = new Set(side.filter(function (id) {
                const g = id === ORIGIN ? null : find(copy, id);
                return g && !g.ref; // the origin and model edges never move anyway
            }));
            if (!holding(copy, keep)) {
                return;
            }
            const score = [moved(sketch, copy), age(sketch, side)];
            if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
                best = { copy: copy, score: score };
            }
        };
        dimensionSides(sketch, dim).forEach(tryKeeping);
        if (!best) {
            tryKeeping([]);
        }
        if (best) {
            copyPlaces(best.copy, sketch);
        }
        return !!best;
    }

    // solveChange(sketch, ids): solve after the value of the dimensions
    // `ids` was edited. A plain solve shares a change out over the whole
    // sketch: shortening a rectangle moved the edge it shares with the
    // shapes beside it, dragging them along, or turned shapes over. Here the
    // edited dimension moves only what it must, and an edge that is joined
    // to others stays. Several dimensions are settled one at a time, each
    // from the sizes the sketch has now; if that fails, all at once with
    // everything held softly. Same result as solve().
    function solveChange(sketch, ids) {
        const wanted = new Set([].concat(ids || []));
        const dims = sketch.constraints.filter(function (c) {
            return wanted.has(c.id) && !c.driven;
        });
        if (!dims.length) {
            return solve(sketch);
        }
        const start = JSON.stringify(sketch.geometry);
        const values = dims.map(function (d) {
            return d.value;
        });
        // The others wait at what they measure now, so each step changes one
        dims.forEach(function (d) {
            const now = measure(sketch, d);
            if (isFinite(now)) {
                d.value = now;
            }
        });
        let ok = true;
        dims.forEach(function (d, i) {
            d.value = values[i];
            ok = ok && settle(sketch, d);
        });
        dims.forEach(function (d, i) {
            d.value = values[i];
        });
        if (!ok) {
            copyPlaces({ geometry: JSON.parse(start) }, sketch);
            if (dims.length > 1) {
                ok = settle(sketch, { type: 'none' });
            }
            if (!ok) {
                // Nothing held: the plain solve below decides on its own
                copyPlaces({ geometry: JSON.parse(start) }, sketch);
            }
        }
        return solve(sketch);
    }

    return {
        solve: solve,
        solveChange: solveChange,
        destroy: function () {
            wrapper.destroy_gcs_module();
        }
    };
}

// Solve a sloppy quadrilateral into a fully constrained 60 x 40 rectangle.
// Returns { ok, dof, ms }; used at start-up to confirm the solver works here.
export async function selfTest() {
    const solver = await createSolver();
    const started = performance.now();
    const sketch = {
        geometry: [
            { id: 'p1', type: 'point', x: 1, y: -2 },
            { id: 'p2', type: 'point', x: 52, y: 3 },
            { id: 'p3', type: 'point', x: 55, y: 31 },
            { id: 'p4', type: 'point', x: -3, y: 35 },
            { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
            { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' },
            { id: 'l3', type: 'line', p1: 'p3', p2: 'p4' },
            { id: 'l4', type: 'line', p1: 'p4', p2: 'p1' }
        ],
        constraints: [
            { id: 'c0', type: 'coincident', a: 'p1', b: '$o' },
            { id: 'c1', type: 'horizontal', line: 'l1' },
            { id: 'c2', type: 'vertical', line: 'l2' },
            { id: 'c3', type: 'horizontal', line: 'l3' },
            { id: 'c4', type: 'vertical', line: 'l4' },
            { id: 'd1', type: 'distance', a: 'p1', b: 'p2', value: 60 },
            { id: 'd2', type: 'distance', a: 'p2', b: 'p3', value: 40 }
        ]
    };
    const result = solver.solve(sketch);
    const corner = sketch.geometry[2];
    const ok = result.ok && Math.abs(corner.x - 60) < 1e-6 && Math.abs(corner.y - 40) < 1e-6;
    const ms = performance.now() - started;
    solver.destroy();
    return { ok: ok, dof: result.dof, ms: ms };
}
