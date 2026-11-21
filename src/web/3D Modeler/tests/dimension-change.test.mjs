// Changing a dimension moves as little of the sketch as it can (solveChange
// in js/sketch/solver.js): an edge shared with other shapes stays, the free
// end of the dimension moves, and nothing turns over.
import * as M from '../js/sketch/model.js';
import { createSolver } from '../js/sketch/solver.js';

let failed = 0;
const a = (c, m, extra) => { if (!c) { failed++; console.log('FAIL', m, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (x, y, tol) => Math.abs(x - y) < (tol || 1e-6);
const P = (sk, id) => M.point(sk, id);
const solver = await createSolver();

// A rectangle as the Rectangle tool draws it: first corner, the corner level
// with it, the opposite corner, the corner above / below the first
function rect(sk, from, to, start) {
    const c = [from, [to[0], from[1]], to, [from[0], to[1]]];
    const p = [start || M.addPoint(sk, c[0][0], c[0][1]), M.addPoint(sk, c[1][0], c[1][1]),
        M.addPoint(sk, c[2][0], c[2][1]), M.addPoint(sk, c[3][0], c[3][1])];
    const l = p.map((id, i) => M.addLine(sk, id, p[(i + 1) % 4]));
    ['horizontal', 'vertical', 'horizontal', 'vertical'].forEach((t, i) => M.addConstraint(sk, { type: t, line: l[i] }));
    return { p, l };
}

const places = sk => JSON.stringify(sk.geometry.filter(g => g.type === 'point').map(g => [g.id, +g.x.toFixed(6), +g.y.toFixed(6)]));
const setValue = (sk, id, value) => { sk.constraints.find(c => c.id === id).value = value; };

// Three rectangles side by side on one bottom line, the corners where they
// meet shared (snapped), as in the owner's report
function threeInARow() {
    const sk = { geometry: [], constraints: [] };
    const L = rect(sk, [-15, 2.9], [-5, -4.1]);
    const Mi = rect(sk, [-5, -4.1], [6.5, -2.05], L.p[2]);
    const R = rect(sk, [6.5, -4.1], [16.5, 30.6], Mi.p[1]);
    const d = {
        lw: M.addConstraint(sk, { type: 'distance', a: L.p[0], b: L.p[1], value: 10 }),
        lh: M.addConstraint(sk, { type: 'distance', a: L.p[3], b: L.p[0], value: 7 }),
        mh: M.addConstraint(sk, { type: 'distance', a: Mi.p[3], b: Mi.p[0], value: 2.05 }),
        rw: M.addConstraint(sk, { type: 'distance', a: R.p[3], b: R.p[2], value: 10 }),
        rh: M.addConstraint(sk, { type: 'distance', a: R.p[1], b: R.p[2], value: 34.7 }),
        all: M.addConstraint(sk, { type: 'hdistance', a: L.p[3], b: R.p[1], value: 31.5 })
    };
    a(solver.solve(sk).ok, 'three rectangles solve');
    return { sk, L, Mi, R, d };
}

// 1. the report: shortening the tall rectangle brings its top down; the
// shared bottom line and the other two rectangles stay where they are
{
    const { sk, L, Mi, R, d } = threeInARow();
    const others = JSON.stringify([L.p, Mi.p].flat().map(id => P(sk, id)));
    setValue(sk, d.rh, 7);
    const r = solver.solveChange(sk, [d.rh]);
    a(r.ok && r.dof === 2, 'shorter tall rectangle solves', r);
    a(near(P(sk, R.p[1])[1], -4.1) && near(P(sk, R.p[0])[1], -4.1), 'its bottom edge stays on the shared line', [P(sk, R.p[0]), P(sk, R.p[1])]);
    a(near(P(sk, R.p[2])[1], 2.9) && near(P(sk, R.p[3])[1], 2.9), 'its top edge comes down', [P(sk, R.p[2]), P(sk, R.p[3])]);
    a(JSON.stringify([L.p, Mi.p].flat().map(id => P(sk, id))) === others, 'the other two rectangles do not move');
    // and back up, past where it started
    setValue(sk, d.rh, 50);
    a(solver.solveChange(sk, [d.rh]).ok && near(P(sk, R.p[1])[1], -4.1) && near(P(sk, R.p[2])[1], 45.9), 'taller: the top goes up', P(sk, R.p[2]));
}
// the plain solve is what moved the shared line before
{
    const { sk, R, d } = threeInARow();
    setValue(sk, d.rh, 7);
    solver.solve(sk);
    a(!near(P(sk, R.p[1])[1], -4.1), 'a plain solve still shares the change out (the old behaviour)', P(sk, R.p[1]));
}

// 2. the same for the other snapped edges: the free edge moves
{
    const { sk, L, Mi, R, d } = threeInARow();
    setValue(sk, d.lh, 12);
    a(solver.solveChange(sk, [d.lh]).ok, 'left height solves');
    a(near(P(sk, L.p[3])[1], -4.1) && near(P(sk, L.p[0])[1], 7.9), 'left rectangle grows upwards from the shared line', [P(sk, L.p[3]), P(sk, L.p[0])]);
    a(near(P(sk, R.p[2])[1], 30.6) && near(P(sk, Mi.p[2])[1], -2.05), 'the others stay');

    setValue(sk, d.mh, 5);
    a(solver.solveChange(sk, [d.mh]).ok, 'middle height solves');
    a(near(P(sk, Mi.p[0])[1], -4.1) && near(P(sk, Mi.p[3])[1], 0.9) && near(P(sk, Mi.p[2])[1], 0.9), 'middle rectangle grows upwards', [P(sk, Mi.p[3]), P(sk, Mi.p[2])]);

    // Width of the left rectangle with the overall 31.5 holding both outer
    // sides: it grows into the middle one (3 points move) rather than
    // pushing the right rectangle along (7 points)
    setValue(sk, d.lw, 14);
    a(solver.solveChange(sk, [d.lw]).ok, 'left width solves');
    a(near(P(sk, L.p[3])[0], -15) && near(P(sk, L.p[2])[0], -1) && near(P(sk, R.p[1])[0], 16.5), 'left rectangle grows into the middle one', [P(sk, L.p[3]), P(sk, L.p[2])]);
}
// Without the overall width the left rectangle's free side moves out
{
    const { sk, L, d } = threeInARow();
    M.remove(sk, [d.all]);
    solver.solve(sk);
    setValue(sk, d.lw, 14);
    a(solver.solveChange(sk, [d.lw]).ok, 'left width solves without the overall width');
    a(near(P(sk, L.p[2])[0], -5) && near(P(sk, L.p[3])[0], -19) && near(P(sk, L.p[0])[0], -19), 'left rectangle widens to the left', [P(sk, L.p[0]), P(sk, L.p[2])]);
}

// 3. a rectangle alone: on a tie the corner drawn first stays
{
    const sk = { geometry: [], constraints: [] };
    const { p } = rect(sk, [0, 0], [20, -10]);
    const w = M.addConstraint(sk, { type: 'distance', a: p[0], b: p[1], value: 20 });
    const h = M.addConstraint(sk, { type: 'distance', a: p[1], b: p[2], value: 10 });
    a(solver.solve(sk).ok, 'lone rectangle');
    setValue(sk, w, 30);
    setValue(sk, h, 4);
    a(solver.solveChange(sk, [w]).ok && solver.solveChange(sk, [h]).ok, 'lone rectangle resizes');
    a(near(P(sk, p[0])[0], 0) && near(P(sk, p[0])[1], 0), 'first corner stays', P(sk, p[0]));
    a(near(P(sk, p[2])[0], 30) && near(P(sk, p[2])[1], -4), 'opposite corner moves', P(sk, p[2]));
    // A size the other way round keeps the same corner
    const sk2 = { geometry: [], constraints: [] };
    const q = rect(sk2, [0, 0], [20, -10]).p;
    const h2 = M.addConstraint(sk2, { type: 'distance', a: q[2], b: q[1], value: 10 });
    solver.solve(sk2);
    setValue(sk2, h2, 4);
    a(solver.solveChange(sk2, [h2]).ok && near(P(sk2, q[1])[1], 0) && near(P(sk2, q[2])[1], -4), 'the earlier end stays whichever way the dimension was picked', [P(sk2, q[1]), P(sk2, q[2])]);
}

// 4. anchored to the origin and fully constrained: the change still lands
{
    const sk = { geometry: [], constraints: [] };
    const { p } = rect(sk, [0, 0], [20, 10]);
    M.addConstraint(sk, { type: 'coincident', a: p[0], b: M.ORIGIN });
    M.addConstraint(sk, { type: 'distance', a: p[0], b: p[1], value: 20 });
    const h = M.addConstraint(sk, { type: 'distance', a: p[2], b: p[1], value: 10 });
    a(solver.solve(sk).dof === 0, 'anchored rectangle is fully constrained');
    setValue(sk, h, 25);
    const r = solver.solveChange(sk, [h]);
    a(r.ok && r.dof === 0 && near(P(sk, p[2])[1], 25) && near(P(sk, p[0])[0], 0), 'fully constrained change', P(sk, p[2]));
    a(r.redundant.length === 0 && r.conflicting.length === 0, 'no holds left in the report', r);
}

// 5. a diameter keeps the centre; an angle turns the later line
{
    const sk = { geometry: [], constraints: [] };
    const c = M.addPoint(sk, 5, 5);
    const k = M.addCircle(sk, c, 3);
    const dia = M.addConstraint(sk, { type: 'diameter', curve: k, value: 6 });
    const o = M.addPoint(sk, 30, 0);
    const e1 = M.addPoint(sk, 50, 0);
    const e2 = M.addPoint(sk, 40, 10);
    const l1 = M.addLine(sk, o, e1);
    const l2 = M.addLine(sk, o, e2);
    M.addConstraint(sk, { type: 'distance', a: o, b: e2, value: Math.hypot(10, 10) });
    const ang = M.addConstraint(sk, { type: 'angle', l1: l1, l2: l2, value: Math.PI / 4 });
    a(solver.solve(sk).ok, 'circle and angle');
    setValue(sk, dia, 16);
    a(solver.solveChange(sk, [dia]).ok && near(M.find(sk, k).r, 8) && near(P(sk, c)[0], 5) && near(P(sk, c)[1], 5), 'circle grows about its centre', [M.find(sk, k).r, P(sk, c)]);
    setValue(sk, ang, Math.PI / 2);
    a(solver.solveChange(sk, [ang]).ok, 'angle solves');
    a(near(P(sk, e1)[0], 50) && near(P(sk, e1)[1], 0) && near(P(sk, o)[0], 30), 'the first line stays', [P(sk, o), P(sk, e1)]);
    a(near(P(sk, e2)[0], 30, 1e-5) && near(P(sk, e2)[1], Math.hypot(10, 10), 1e-5), 'the second line turns about the shared end', P(sk, e2));
}

// 6. several at once (Manage > Parameters), and a value that cannot be met
{
    const { sk, L, Mi, R, d } = threeInARow();
    setValue(sk, d.lh, 3);
    setValue(sk, d.rh, 9);
    const r = solver.solveChange(sk, [d.lh, d.rh]);
    a(r.ok && near(P(sk, L.p[0])[1], -1.1) && near(P(sk, R.p[2])[1], 4.9), 'two heights at once, both from the shared line', [P(sk, L.p[0]), P(sk, R.p[2])]);
    a(near(P(sk, Mi.p[0])[1], -4.1) && near(P(sk, R.p[1])[1], -4.1), 'shared line stays');
    a(sk.constraints.find(c => c.id === d.lh).value === 3 && sk.constraints.find(c => c.id === d.rh).value === 9, 'values are kept as typed');

}
// a value that cannot be met: a triangle side longer than the other two
{
    const sk = { geometry: [], constraints: [] };
    const t = [[0, 0], [10, 0], [5, 8.66]].map(c => M.addPoint(sk, c[0], c[1]));
    t.forEach((id, i) => M.addLine(sk, id, t[(i + 1) % 3]));
    const s = t.map((id, i) => M.addConstraint(sk, { type: 'distance', a: id, b: t[(i + 1) % 3], value: 10 }));
    a(solver.solve(sk).ok, 'triangle solves');
    const before = places(sk);
    setValue(sk, s[0], 25);
    const bad = solver.solveChange(sk, [s[0]]);
    a(!bad.ok && places(sk) === before, 'an impossible value fails and leaves the sketch alone', bad);
    setValue(sk, s[0], 15);
    a(solver.solveChange(sk, [s[0]]).ok && near(M.measure(sk, sk.constraints.find(c => c.id === s[0])), 15), 'a possible one lands');
}

// 7. a long row: a change at one end leaves the rest alone, and stays quick
{
    const sk = { geometry: [], constraints: [] };
    let start = null;
    let last = null;
    const heights = [];
    for (let i = 0; i < 25; i++) {
        last = rect(sk, [i * 10, 0], [i * 10 + 10, 5 + i % 3], start);
        start = last.p[1];
        heights.push(M.addConstraint(sk, { type: 'distance', a: last.p[1], b: last.p[2], value: 5 + i % 3 }));
        M.addConstraint(sk, { type: 'distance', a: last.p[0], b: last.p[1], value: 10 });
    }
    a(solver.solve(sk).ok, 'row of 25 solves');
    const first = JSON.parse(JSON.stringify(sk.geometry.slice(0, 8)));
    setValue(sk, heights[24], 20);
    const t0 = performance.now();
    const r = solver.solveChange(sk, [heights[24]]);
    const ms = performance.now() - t0;
    a(r.ok && near(P(sk, last.p[2])[1], 20) && near(P(sk, last.p[1])[1], 0), 'last rectangle grows upwards', P(sk, last.p[2]));
    const drift = Math.max(...first.map((g, k) => g.type === 'point' ? Math.hypot(sk.geometry[k].x - g.x, sk.geometry[k].y - g.y) : 0));
    a(drift < 1e-6, 'the first rectangles do not move', drift);
    a(ms < 1500, 'quick enough to run on Enter', ms);
    console.log('row of 25: ' + ms.toFixed(0) + ' ms');
}

solver.destroy();
console.log(failed ? failed + ' FAILED' : 'all dimension change tests passed');
process.exitCode = failed ? 1 : 0;
