import * as M from '../js/sketch/model.js';
import { projectInto, addProjected } from '../js/sketch/project.js';
import { createSolver, spareParts } from '../js/sketch/solver.js';
import { dimensionValue } from '../js/parameters.js';
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
// collinear of two lines already held parallel (both vertical, both
// horizontal, or a Parallel constraint): the second end follows from the
// first, so that part is left out instead of refusing the whole constraint
{
    const rect = (sk, x0, y0, x1, y1) => {
        const p = [M.addPoint(sk, x0, y0), M.addPoint(sk, x1, y0), M.addPoint(sk, x1, y1), M.addPoint(sk, x0, y1)];
        const l = [0, 1, 2, 3].map((i) => M.addLine(sk, p[i], p[(i + 1) % 4]));
        ['horizontal', 'vertical', 'horizontal', 'vertical'].forEach((type, i) => M.addConstraint(sk, { type: type, line: l[i] }));
        return { p, l };
    };
    for (const order of ['inner first', 'outer first']) {
        // As in the sketcher: a free outer rectangle and a fully dimensioned
        // inner one; make their right edges collinear
        const sk = { geometry: [], constraints: [] };
        const outer = rect(sk, -75, -50, 81, 50);
        const inner = rect(sk, -75, -16, 75, 16);
        M.addConstraint(sk, { type: 'fix', p: inner.p[0], x: -75, y: -16 });
        M.addConstraint(sk, { type: 'distance', a: inner.p[0], b: inner.p[1], value: 150 });
        M.addConstraint(sk, { type: 'distance', a: inner.p[1], b: inner.p[2], value: 32 });
        a(solver.solve(sk).redundant.length === 0, order + ': sketch starts clean');
        const pair = order === 'inner first' ? [inner.l[1], outer.l[1]] : [outer.l[1], inner.l[1]];
        const b = M.build(sk, 'collinear', pair);
        M.addConstraint(sk, b.add[0]);
        const r = solver.solve(sk);
        const o = M.curve(sk, outer.l[1]), i = M.curve(sk, inner.l[1]);
        a(r.ok && r.redundant.length === 0 && r.conflicting.length === 0, order + ': collinear is not called redundant', r);
        a(near(i.a[0], 75) && near(i.b[0], 75), order + ': the fixed inner edge stays', i);
        a(near(o.a[0], 75) && near(o.b[0], 75), order + ': the free outer edge moves onto it', o);
        a(r.dof === 3, order + ': collinear costs one freedom here (free rectangle 4 - 1)', r.dof);
    }
    for (const kind of ['vertical', 'horizontal', 'parallel']) {
        const sk = { geometry: [], constraints: [] };
        const l1 = kind === 'horizontal' ? line(sk, 0, 0, 20, 0) : line(sk, 0, 0, 0, 20);
        const l2 = kind === 'horizontal' ? line(sk, 3, 5, 25, 5) : line(sk, 5, 3, 5, 25);
        if (kind === 'parallel') {
            M.addConstraint(sk, { type: 'parallel', l1: l1, l2: l2 });
        } else {
            M.addConstraint(sk, { type: kind, line: l1 });
            M.addConstraint(sk, { type: kind, line: l2 });
        }
        M.addConstraint(sk, { type: 'collinear', l1: l1, l2: l2 });
        const r = solver.solve(sk);
        const A = M.point(sk, M.find(sk, l1).p1), B = M.point(sk, M.find(sk, l1).p2);
        const onLine = (p) => Math.abs((B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0])) < 1e-4;
        const c2 = M.curve(sk, l2);
        a(r.ok && r.redundant.length === 0, kind + ' lines made collinear are not redundant', r);
        a(onLine(c2.a) && onLine(c2.b), kind + ' lines end up on one line', [A, B, c2]);
    }
}
// a collinear that adds nothing at all is still reported, so the
// constraint tool can say the sketch is already constrained that way
{
    const sk = { geometry: [], constraints: [] };
    const l1 = line(sk, 0, 0, 20, 0), l2 = line(sk, 30, 0, 50, 0);
    M.addConstraint(sk, { type: 'collinear', l1: l1, l2: l2 });
    a(solver.solve(sk).redundant.length === 0, 'first collinear is clean');
    M.addConstraint(sk, { id: 'again', type: 'collinear', l1: l1, l2: l2 });
    const r = solver.solve(sk);
    a(r.redundant.indexOf('again') >= 0, 'a repeated collinear is still redundant', r);
}
// Fix on a point whose y is already set by the sketch: the x part still
// applies instead of the whole Fix being called redundant
{
    const sk = { geometry: [], constraints: [] };
    const l = line(sk, 0, 0, 20, 0);
    const ln = M.find(sk, l);
    M.addConstraint(sk, { type: 'fix', p: ln.p1, x: 0, y: 0 });
    M.addConstraint(sk, { type: 'horizontal', line: l });
    M.addConstraint(sk, { id: 'pin', type: 'fix', p: ln.p2, x: 20, y: 0 });
    const r = solver.solve(sk);
    a(r.ok && r.redundant.length === 0 && r.dof === 0, 'a half implied fix still pins the other coordinate', r);
}
// a distance of 0 between two parallel lines (the dimension tool makes a
// point to line distance for them): the lines become one, and the size can
// go back up again afterwards
{
    const sk = { geometry: [], constraints: [] };
    const l1 = line(sk, 0, 0, 0, 40), l2 = line(sk, 6, 5, 6, 30);
    M.addConstraint(sk, { type: 'fix', p: M.find(sk, l1).p1, x: 0, y: 0 });
    M.addConstraint(sk, { type: 'fix', p: M.find(sk, l1).p2, x: 0, y: 40 });
    M.addConstraint(sk, { type: 'vertical', line: l2 });
    const id = M.addConstraint(sk, { type: 'pldistance', p: M.find(sk, l2).p1, line: l1, value: 6 });
    const d = sk.constraints.filter((c) => c.id === id)[0];
    a(solver.solve(sk).ok, 'parallel lines 6 apart');
    d.value = dimensionValue(d, 0);
    const r = solver.solve(sk);
    const c2 = M.curve(sk, l2);
    a(r.ok && r.redundant.length === 0 && near(c2.a[0], 0) && near(c2.b[0], 0), 'a distance of 0 puts the second line on the first', [r, c2]);
    a(near(M.measure(sk, d), 0), 'the dimension measures 0', M.measure(sk, d));
    d.value = dimensionValue(d, 4);
    const r2 = solver.solve(sk);
    const c3 = M.curve(sk, l2);
    a(r2.ok && near(Math.abs(c3.a[0]), 4) && near(c3.a[0], c3.b[0]), 'and back to 4 apart', [r2, c3]);
}
// pickable() offers a constraint tool only kinds build() accepts next, so
// the sketcher can hide the rest: every kind it offers, after any picks the
// tool still collects on, must not make build() refuse
{
    const sk = { geometry: [], constraints: [] };
    const pts = [M.addPoint(sk, 3, 40, true), M.addPoint(sk, 9, 44, true)];
    const lines = [line(sk, 0, 0, 20, 3), line(sk, 0, 10, 18, 25)];
    const c1 = M.addPoint(sk, 50, 0);
    const c2 = M.addPoint(sk, 80, 5);
    const circles = [M.addCircle(sk, c1, 5), M.addCircle(sk, c2, 8)];
    const arcs = [M.addArc(sk, M.addPoint(sk, 0, 80), M.addPoint(sk, 10, 80), M.addPoint(sk, 0, 90))];
    const byKind = { point: pts, line: lines, circle: circles, arc: arcs };
    const types = ['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'tangent', 'equal', 'coincident', 'concentric', 'midpoint', 'symmetric', 'fix'];
    for (const type of types) {
        const walk = (picks, depth) => {
            const kinds = M.pickable(sk, type, picks);
            a(Array.isArray(kinds) && kinds.length > 0, type + ' offers something after ' + picks.join(','), kinds);
            for (const kind of kinds) {
                const next = (byKind[kind] || []).filter((id) => picks.indexOf(id) < 0)[0];
                if (!next) {
                    continue;
                }
                const built = M.build(sk, type, picks.concat([next]));
                a(!built.error, type + ': ' + kind + ' offered after [' + picks.join(',') + '] but refused', built);
                if (built.more && depth < 3) {
                    walk(picks.concat([next]), depth + 1);
                }
            }
        };
        walk([], 0);
    }
    a(M.pickable(sk, 'collinear', []).join() === 'line', 'collinear takes lines only, no points');
    a(M.pickable(sk, 'coincident', [lines[0]]).join() === 'point', 'coincident after a curve takes a point');
    a(M.pickable(sk, 'midpoint', [pts[0]]).join() === 'line' && M.pickable(sk, 'midpoint', [lines[0]]).join() === 'point', 'midpoint wants one of each');
}
// spareParts never empties a constraint
{
    const sk = { constraints: [{ id: 'c1' }, { id: 'c2' }] };
    const prims = [{ id: 'l1' }, { id: 'c1' }, { id: 'c1:b' }, { id: 'c2' }, { id: 'l1:rules' }];
    const out = spareParts(sk, prims, ['c1:b', 'c2', 'l1:rules']);
    a(out.length === 1 && out[0] === 'c1:b', 'only the implied part of a multi equation constraint', out);
    a(spareParts(sk, prims, ['c1', 'c1:b']).length === 0, 'all parts redundant: keep them, report the constraint');
}
console.log(failed ? failed + ' FAILED' : 'all collinear and coincident tests passed');
process.exitCode = failed ? 1 : 0;
