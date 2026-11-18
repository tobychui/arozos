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
import { toPrimitives, applySolution } from './model.js';

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

    // Push the sketch, minus the equations in `skip`, and solve it
    function attempt(sketch, drag, skip) {
        wrapper.clear_data();
        const primitives = toPrimitives(sketch, drag).filter(function (p) {
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

    function solve(sketch, drag) {
        const skip = new Set();
        let run = null;
        try {
            // Each pass leaves out the parts of constraints found to be implied
            // by the rest (see spareParts); one pass is the usual case
            for (let pass = 0; pass < 4; pass++) {
                run = attempt(sketch, drag, skip);
                const spare = run.conflicting.length ? [] : spareParts(sketch, run.primitives, run.redundant);
                if (!spare.length) {
                    break;
                }
                spare.forEach(function (id) {
                    skip.add(id);
                });
            }
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

    return {
        solve: solve,
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
