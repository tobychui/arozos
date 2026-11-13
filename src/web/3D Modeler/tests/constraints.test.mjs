import * as M from '../js/sketch/model.js';
import { projectInto, addProjected } from '../js/sketch/project.js';
import { createSolver } from '../js/sketch/solver.js';
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y) => Math.abs(x - y) < 1e-5;
const solver = await createSolver();
const line = (sk, x1, y1, x2, y2) => M.addLine(sk, M.addPoint(sk, x1, y1), M.addPoint(sk, x2, y2));
// collinear of two separate lines
{
    const sk = { geometry: [], constraints: [] };
    const l1 = line(sk, 0, 0, 20, 1), l2 = line(sk, 30, 6, 50, 9);
    M.addConstraint(sk, { type: 'fix', p: M.find(sk, l1).p1, x: 0, y: 0 });
    M.addConstraint(sk, { type: 'horizontal', line: l1 });
    const b = M.build(sk, 'collinear', [l1, l2]);
    a(b.add && b.add[0].type === 'collinear', 'build collinear', b);
    a(M.build(sk, 'collinear', [l1]).more && M.build(sk, 'collinear', [l1, M.find(sk, l1).p1]).error, 'collinear needs two lines');
    M.addConstraint(sk, b.add[0]);
    const r = solver.solve(sk);
    const c2 = M.curve(sk, l2);
    a(r.ok && near(c2.a[1], 0) && near(c2.b[1], 0), 'second line lies on the first', [r, c2]);
    a(r.dof === 3, 'two points on the line cost two freedoms (1 + 4 - 2)', r.dof);
    a(r.redundant.length === 0 && r.conflicting.length === 0, 'clean', r);
}
// collinear of two lines that share an end: one equation, not redundant
{
    const sk = { geometry: [], constraints: [] };
    const p1 = M.addPoint(sk, 0, 0), p2 = M.addPoint(sk, 10, 1), p3 = M.addPoint(sk, 20, 5);
    const l1 = M.addLine(sk, p1, p2), l2 = M.addLine(sk, p2, p3);
    M.addConstraint(sk, { type: 'collinear', l1: l1, l2: l2 });
    const r = solver.solve(sk);
    const A = M.point(sk, p1), B = M.point(sk, p2), C = M.point(sk, p3);
    const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    a(r.ok && Math.abs(cross) < 1e-4 && r.redundant.length === 0, 'chained lines straighten without a redundancy', [r, cross]);
}
// collinear with a projected model edge: the sketch line moves, the edge stays
{
    const top = { o: [0, 0, 12], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
    const sk = { geometry: [], constraints: [] };
    const made = projectInto(sk, top, { type: 'line', a: [0, 40, 12], b: [60, 40, 12] });
    a(made && made.added, 'projectInto adds');
    const again = projectInto(sk, top, { type: 'line', a: [60, 40, 12], b: [0, 40, 12] });
    a(again && !again.added && again.id === made.id, 'projectInto finds the existing curve', again);
    a(!addProjected(sk, top, { type: 'line', a: [0, 40, 12], b: [60, 40, 12] }), 'addProjected still reports nothing new');
    const l = line(sk, 10, 30, 30, 33);
    M.addConstraint(sk, { type: 'collinear', l1: made.id, l2: l });
    const r = solver.solve(sk);
    const c = M.curve(sk, l), e = M.curve(sk, made.id);
    a(r.ok && near(c.a[1], 40) && near(c.b[1], 40) && near(e.a[1], 40) && near(e.a[0], 0), 'line snaps onto the model edge', [r, c]);
    // coincident: a point on the projected edge can slide along it
    const p = M.addPoint(sk, 5, 20, true);
    const b = M.build(sk, 'coincident', [made.id, p]);
    a(b.add && b.add[0].type === 'pointon' && b.add[0].p === p, 'coincident accepts curve then point', b);
    M.addConstraint(sk, b.add[0]);
    const r2 = solver.solve(sk, [{ p: p, x: 44, y: 10 }]);
    a(r2.ok && near(M.point(sk, p)[1], 40) && near(M.point(sk, p)[0], 44), 'point slides along the edge', M.point(sk, p));
    a(/Collinear/.test(M.build(sk, 'coincident', [made.id, l]).error), 'two lines point to Collinear');
}
console.log(failed ? failed + ' FAILED' : 'all collinear and coincident tests passed');
process.exitCode = failed ? 1 : 0;
