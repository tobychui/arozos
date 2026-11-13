import * as M from '../js/sketch/model.js';
import { createSolver, selfTest } from '../js/sketch/solver.js';
import * as G from '../js/sketch/geom.js';

let failed = 0;
const a = (c, m, extra) => { if (!c) { failed++; console.log('FAIL', m, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (x, y, tol) => Math.abs(x - y) < (tol || 1e-6);
const P = (sk, id) => M.point(sk, id);

console.log('selftest', JSON.stringify(await selfTest()));
const solver = await createSolver();

function rect() {
    const sk = { geometry: [], constraints: [] };
    const p = [[2, 1], [50, 3], [52, 30], [1, 33]].map(c => M.addPoint(sk, c[0], c[1]));
    const l = [0, 1, 2, 3].map(i => M.addLine(sk, p[i], p[(i + 1) % 4]));
    ['horizontal', 'vertical', 'horizontal', 'vertical'].forEach((t, i) => M.addConstraint(sk, { type: t, line: l[i] }));
    return { sk, p, l };
}

// 1. rectangle solves, 4 dof left (x, y, w, h)
{
    const { sk, p } = rect();
    const r = solver.solve(sk);
    a(r.ok && r.dof === 4, 'rect dof 4', r);
    a(near(P(sk, p[0])[1], P(sk, p[1])[1]) && near(P(sk, p[1])[0], P(sk, p[2])[0]), 'rect is square-cornered');
}
// 2. horizontal / vertical distance sign
{
    const { sk, p } = rect();
    M.addConstraint(sk, { type: 'hdistance', a: p[0], b: p[1], value: 25 });
    M.addConstraint(sk, { type: 'vdistance', a: p[1], b: p[2], value: 12 });
    const r = solver.solve(sk);
    a(r.ok, 'hv solve', r);
    a(near(P(sk, p[1])[0] - P(sk, p[0])[0], 25), 'hdistance = b.x - a.x', P(sk, p[1])[0] - P(sk, p[0])[0]);
    a(near(P(sk, p[2])[1] - P(sk, p[1])[1], 12), 'vdistance = b.y - a.y', P(sk, p[2])[1] - P(sk, p[1])[1]);
    a(r.dof === 2, 'dof 2 after two dims', r.dof);
    // fully constrain: anchor to origin
    M.addConstraint(sk, { type: 'coincident', a: p[0], b: M.ORIGIN });
    const r2 = solver.solve(sk);
    a(r2.ok && r2.dof === 0, 'fully constrained', r2);
    // redundant: horizontal again through two points
    const id = M.addConstraint(sk, { type: 'horizontal', a: p[0], b: p[1] });
    const r3 = solver.solve(sk);
    a(r3.redundant.indexOf(id) >= 0 || r3.redundant.length > 0, 'redundant reported', r3);
    M.remove(sk, [id]);
    // conflict: a second, different width
    const id2 = M.addConstraint(sk, { type: 'distance', a: p[0], b: p[1], value: 99 });
    const before = JSON.stringify(sk.geometry);
    const r4 = solver.solve(sk);
    a(!r4.ok && r4.conflicting.length > 0, 'conflict reported', r4);
    a(JSON.stringify(sk.geometry) === before, 'failed solve leaves the sketch alone');
    M.remove(sk, [id2]);
    // change a dimension
    sk.constraints.filter(c => c.type === 'hdistance')[0].value = 40;
    const r5 = solver.solve(sk);
    a(r5.ok && near(P(sk, p[2])[0], 40) && near(P(sk, p[2])[1], 12), 'dimension edit drives the sketch', P(sk, p[2]));
}
// 3. point-line distance on both sides
for (const side of [1, -1]) {
    const sk = { geometry: [], constraints: [] };
    const p1 = M.addPoint(sk, 0, 0), p2 = M.addPoint(sk, 20, 0), q = M.addPoint(sk, 5, 3 * side);
    const l = M.addLine(sk, p1, p2);
    M.addConstraint(sk, { type: 'fix', p: p1, x: 0, y: 0 });
    M.addConstraint(sk, { type: 'fix', p: p2, x: 20, y: 0 });
    const d = { type: 'pldistance', p: q, line: l, value: 8 };
    M.addConstraint(sk, d);
    const r = solver.solve(sk);
    a(r.ok && near(Math.abs(P(sk, q)[1]), 8), 'pldistance magnitude side ' + side, P(sk, q));
    a(Math.sign(P(sk, q)[1]) === side, 'pldistance keeps its side ' + side, P(sk, q));
    a(near(M.measure(sk, d), 8), 'measure pldistance');
}
// 4. angle
{
    const sk = { geometry: [], constraints: [] };
    const o = M.addPoint(sk, 0, 0), b = M.addPoint(sk, 20, 0), c = M.addPoint(sk, 17, 10);
    const l1 = M.addLine(sk, o, b), l2 = M.addLine(sk, o, c);
    M.addConstraint(sk, { type: 'fix', p: o, x: 0, y: 0 });
    M.addConstraint(sk, { type: 'horizontal', line: l1 });
    const d = { type: 'angle', l1: l1, l2: l2, value: 0 };
    const start = M.measure(sk, d);
    a(near(start, Math.atan2(10, 17)), 'measure angle', start);
    d.value = Math.PI / 4;
    M.addConstraint(sk, d);
    const r = solver.solve(sk);
    a(r.ok && near(M.measure(sk, d), Math.PI / 4, 1e-5), 'angle 45 same sense as measure', [M.measure(sk, d), P(sk, c)]);
    a(P(sk, c)[1] > 0, 'angle stays on its side', P(sk, c));
}
// 5. arc, tangent line, radius, pointon, equal, midpoint, symmetric
{
    const sk = { geometry: [], constraints: [] };
    const c = M.addPoint(sk, 0, 0), s = M.addPoint(sk, 10, 0.5), e = M.addPoint(sk, 0.3, 10);
    const arc = M.addArc(sk, c, s, e);
    const t = M.addPoint(sk, 10.4, -15);
    const line = M.addLine(sk, t, s);
    M.addConstraint(sk, { type: 'fix', p: c, x: 0, y: 0 });
    const rad = { type: 'radius', curve: arc, value: 12 };
    M.addConstraint(sk, rad);
    M.addConstraint(sk, { type: 'tangent', a: arc, b: line });
    const r = solver.solve(sk);
    a(r.ok, 'arc solve', r);
    const cv = M.curve(sk, arc);
    a(near(cv.r, 12) && near(G.dist(cv.c, cv.b), 12), 'arc radius 12 at both ends', cv);
    const lc = M.curve(sk, line);
    const dot = (lc.b[0] - lc.a[0]) * (lc.b[0] - cv.c[0]) + (lc.b[1] - lc.a[1]) * (lc.b[1] - cv.c[1]);
    a(Math.abs(dot) < 1e-3, 'line tangent to arc at shared point', dot);
    // circle through point, equal to arc radius
    const kc = M.addPoint(sk, 40, 0);
    const k = M.addCircle(sk, kc, 5);
    M.addConstraint(sk, { type: 'equal', a: k, b: arc });
    const q = M.addPoint(sk, 47, 1, true);
    M.addConstraint(sk, { type: 'pointon', p: q, curve: k });
    const r2 = solver.solve(sk);
    a(r2.ok && near(M.find(sk, k).r, 12) && near(G.dist(P(sk, q), P(sk, kc)), 12), 'equal radius + point on circle', [r2, M.find(sk, k)]);
    // midpoint + symmetric
    const m = M.addPoint(sk, 3, -9, true);
    M.addConstraint(sk, { type: 'midpoint', p: m, line: line });
    const r3 = solver.solve(sk);
    const L = M.curve(sk, line);
    a(r3.ok && near(P(sk, m)[0], (L.a[0] + L.b[0]) / 2) && near(P(sk, m)[1], (L.a[1] + L.b[1]) / 2), 'midpoint', r3);
    const x1 = M.addPoint(sk, -30, 5, true), x2 = M.addPoint(sk, -20, 7, true);
    const a1 = M.addPoint(sk, -25, -10), a2 = M.addPoint(sk, -25, 30);
    const axis = M.addLine(sk, a1, a2, true);
    M.addConstraint(sk, { type: 'vertical', line: axis });
    M.addConstraint(sk, { type: 'symmetric', a: x1, b: x2, line: axis });
    const r4 = solver.solve(sk);
    const ax = P(sk, a1)[0];
    a(r4.ok && near(P(sk, x1)[1], P(sk, x2)[1]) && near(ax - P(sk, x1)[0], P(sk, x2)[0] - ax), 'symmetric', [r4, P(sk, x1), P(sk, x2), ax]);
    // diameter on circle (replaces equal)
    M.remove(sk, sk.constraints.filter(x => x.type === 'equal').map(x => x.id));
    M.addConstraint(sk, { type: 'diameter', curve: k, value: 30 });
    const r5 = solver.solve(sk);
    a(r5.ok && near(M.find(sk, k).r, 15), 'diameter', M.find(sk, k));
}
// 6. drag
{
    const { sk, p } = rect();
    solver.solve(sk);
    M.addConstraint(sk, { type: 'coincident', a: p[0], b: M.ORIGIN });
    const r = solver.solve(sk, [{ p: p[2], x: 100, y: 80 }]);
    a(r.ok && near(P(sk, p[2])[0], 100, 1e-4) && near(P(sk, p[2])[1], 80, 1e-4), 'dragged corner follows', P(sk, p[2]));
    a(near(P(sk, p[1])[0], 100, 1e-4) && near(P(sk, p[1])[1], 0, 1e-4) && near(P(sk, p[0])[0], 0), 'rectangle stays a rectangle', [P(sk, p[0]), P(sk, p[1])]);
    a(r.dof === 2, 'drag constraints do not count as dof', r.dof);
    // dragging a pinned point does not break it
    const r2 = solver.solve(sk, [{ p: p[0], x: 30, y: 30 }]);
    a(near(P(sk, p[0])[0], 0, 1e-4) && near(P(sk, p[0])[1], 0, 1e-4), 'pinned point stays', [r2, P(sk, p[0])]);
}
// 7. editing helpers
{
    const { sk, p, l } = rect();
    const extra = M.addPoint(sk, 9, 9);
    const l5 = M.addLine(sk, p[2], extra);
    M.addConstraint(sk, { type: 'parallel', l1: l[0], l2: l5 });
    M.remove(sk, [l5]);
    a(!M.find(sk, extra) && M.find(sk, p[2]) && !sk.constraints.some(c => c.type === 'parallel'), 'remove curve drops orphan point and constraint');
    const q = M.addPoint(sk, 5, 5);
    const l6 = M.addLine(sk, q, p[0]);
    M.mergePoints(sk, p[1], q);
    a(M.find(sk, l6).p1 === p[1] && !M.find(sk, q), 'mergePoints');
    a(M.build(sk, 'parallel', [l[0]]).more && M.build(sk, 'parallel', [l[0], l[2]]).add.length === 1 && M.build(sk, 'parallel', [p[0]]).error, 'build parallel');
    a(M.build(sk, 'horizontal', [p[0]]).more && M.build(sk, 'horizontal', [p[0], p[1]]).add[0].a === p[0], 'build horizontal pp');
    a(M.build(sk, 'coincident', [p[0], l[1]]).add[0].type === 'pointon', 'build pointon');
    a(M.build(sk, 'fix', [l[0]]).add.length === 2, 'build fix line');
    a(M.build(sk, 'tangent', [l[0], l[1]]).error, 'two lines not tangent');
}
// 8. geometry
{
    const l = { type: 'line', a: [0, 0], b: [10, 0] };
    const k = { type: 'circle', c: [5, 0], r: 3 };
    a(G.intersect(l, k).length === 2, 'line circle');
    const arc = G.arcFrom('a', [5, 0], [8, 0], [5, 3]);
    a(G.intersect(l, arc).length === 1 && near(G.intersect(l, arc)[0][0], 8), 'line arc', G.intersect(l, arc));
    a(G.intersect(l, { type: 'line', a: [5, -5], b: [5, 5] }).length === 1 && G.intersect(l, { type: 'line', a: [15, -5], b: [15, 5] }).length === 0, 'line line');
    a(G.intersect(l, { type: 'line', a: [15, -5], b: [15, 5] }, true).length === 1, 'unbounded');
    a(G.intersect(k, { type: 'circle', c: [9, 0], r: 3 }).length === 2, 'circle circle');
    a(near(G.nearest(arc, [20, 20])[0], 6.8), 'nearest on arc');
    a(G.sample(arc).length > 5 && near(G.sample(arc).pop()[1], 3), 'sample arc ends at end');
}
console.log(failed ? failed + ' FAILED' : 'all sketch tests passed');
process.exitCode = failed ? 1 : 0;
