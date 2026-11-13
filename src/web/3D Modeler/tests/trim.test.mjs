import * as M from '../js/sketch/model.js';
import { trim, extend } from '../js/sketch/trim.js';
import { createSolver } from '../js/sketch/solver.js';

let failed = 0;
const a = (c, m, extra) => { if (!c) { failed++; console.log('FAIL', m, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (x, y) => Math.abs(x - y) < 1e-6;
const solver = await createSolver();
const line = (sk, x1, y1, x2, y2) => M.addLine(sk, M.addPoint(sk, x1, y1), M.addPoint(sk, x2, y2));
const kinds = sk => sk.geometry.filter(g => g.type !== 'point').map(g => g.type).sort().join(',');

// a horizontal line crossed by two verticals
function cross() {
    const sk = { geometry: [], constraints: [] };
    const h = line(sk, 0, 0, 30, 0);
    M.addConstraint(sk, { type: 'horizontal', line: h });
    const v1 = line(sk, 10, -5, 10, 5);
    const v2 = line(sk, 20, -5, 20, 5);
    return { sk, h, v1, v2 };
}
{
    const { sk, h } = cross();
    a(trim(sk, h, [15, 0]), 'trim middle');
    const lines = M.curves(sk).filter(c => Math.abs(c.a[1]) < 1e-9 && Math.abs(c.b[1]) < 1e-9);
    a(lines.length === 2, 'middle trim leaves two pieces', lines);
    const xs = lines.map(c => [c.a[0], c.b[0]].sort((p, q) => p - q).join('-')).sort().join(' ');
    a(xs === '0-10 20-30', 'pieces are 0-10 and 20-30', xs);
    a(sk.constraints.filter(c => c.type === 'pointon').length === 2 && sk.constraints.filter(c => c.type === 'horizontal').length === 2, 'constraints added', sk.constraints);
    a(solver.solve(sk).ok, 'trimmed sketch solves');
}
{
    const { sk, h } = cross();
    a(trim(sk, h, [5, 0]), 'trim start');
    const c = M.curve(sk, h);
    a(near(Math.min(c.a[0], c.b[0]), 10) && near(Math.max(c.a[0], c.b[0]), 30), 'start trimmed to 10..30', c);
    a(sk.geometry.filter(g => g.type === 'point').length === 6, 'old end point removed', sk.geometry.length);
}
{
    const { sk, v1 } = cross();
    const before = sk.geometry.length;
    a(trim(sk, v1, [10, 3]), 'trim top of vertical');
    const c = M.curve(sk, v1);
    a(near(Math.max(c.a[1], c.b[1]), 0), 'vertical now ends on the horizontal', c);
    a(sk.geometry.length === before, 'one point swapped', [before, sk.geometry.length]);
}
{
    const sk = { geometry: [], constraints: [] };
    const l = line(sk, 0, 0, 5, 5);
    a(trim(sk, l, [2, 2]) && sk.geometry.length === 0, 'lonely line is deleted', sk.geometry);
}
// circle crossed by a line -> arc
{
    const sk = { geometry: [], constraints: [] };
    const k = M.addCircle(sk, M.addPoint(sk, 0, 0), 10);
    M.addConstraint(sk, { type: 'radius', curve: k, value: 10 });
    line(sk, -20, 0, 20, 0);
    a(trim(sk, k, [0, 10]), 'trim top half of circle');
    const c = M.curve(sk, k);
    a(c.type === 'arc' && near(c.sweep, Math.PI) && near(c.a[0], -10) && near(c.b[0], 10), 'lower half remains', c);
    const r = solver.solve(sk);
    a(r.ok && near(M.curve(sk, k).r, 10), 'radius dimension survives on the arc', r);
}
// arc split in the middle
{
    const sk = { geometry: [], constraints: [] };
    const arc = M.addArc(sk, M.addPoint(sk, 0, 0), M.addPoint(sk, 10, 0), M.addPoint(sk, -10, 0));
    line(sk, -3, 0, -3, 20);
    line(sk, 3, 0, 3, 20);
    a(trim(sk, arc, [0, 10]), 'trim middle of arc');
    a(kinds(sk) === 'arc,arc,line,line', 'two arcs remain', kinds(sk));
    const arcs = M.curves(sk).filter(c => c.type === 'arc');
    a(arcs.every(c => c.sweep < Math.PI / 2 && near(c.r, 10)), 'both are short arcs', arcs.map(c => c.sweep));
}
// extend
{
    const sk = { geometry: [], constraints: [] };
    const l = line(sk, 0, 0, 10, 0);
    line(sk, 25, -5, 25, 5);
    line(sk, 40, -5, 40, 5);
    a(extend(sk, l, [9, 0]), 'extend end');
    const c = M.curve(sk, l);
    a(near(c.b[0], 25) && near(c.a[0], 0), 'reaches the first wall', c);
    a(!extend(sk, l, [1, 0]), 'nothing behind the start');
    const arc = M.addArc(sk, M.addPoint(sk, 0, 50), M.addPoint(sk, 10, 50), M.addPoint(sk, 0, 60));
    line(sk, -20, 50, -5, 50);
    a(extend(sk, arc, [0, 60]), 'extend arc end');
    const ac = M.curve(sk, arc);
    a(near(ac.b[0], -10) && near(ac.b[1], 50) && near(ac.sweep, Math.PI), 'arc now a half circle', ac);
    a(solver.solve(sk).ok, 'extended sketch solves');
}
console.log(failed ? failed + ' FAILED' : 'all trim tests passed');
process.exitCode = failed ? 1 : 0;
