/*
    Sketch tools of phase A2: three point arc, tangent arc, sketch fillet
    and chamfer, concentric. The pure geometry, the edits of the sketch and
    that the solver accepts them. Run with: node tests/run.mjs sketch-tools
*/
import * as M from '../js/sketch/model.js';
import * as G from '../js/sketch/geom.js';
import { createSolver } from '../js/sketch/solver.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);
const nearP = (p, q, t) => near(p[0], q[0], t) && near(p[1], q[1], t);
const solver = await createSolver();

/* ---- three point arc ---- */
{
    const c = G.circleThrough([10, 0], [-10, 0], [0, 10]);
    a(c && nearP(c.c, [0, 0]) && near(c.r, 10), 'circle through three points', c);
    a(G.circleThrough([0, 0], [1, 1], [2, 2]) === null, 'three points in line make no circle');
    const up = G.arcThrough([10, 0], [-10, 0], [0, 10]);
    a(up.forward, 'an arc over the top runs counter clockwise from the right end to the left');
    const down = G.arcThrough([10, 0], [-10, 0], [0, -10]);
    a(!down.forward, 'the same ends through the bottom run the other way');
    const arc = G.arcFrom('', down.c, [-10, 0], [10, 0]);
    a(G.onArc(arc, [0, -10], 1e-9) && !G.onArc(arc, [0, 10], 1e-9), 'stored from the other end, it passes through the third point');
}

/* ---- tangent arc ---- */
{
    // Leaving (10, 0) heading +x, ending at (10, 20): a half circle turning left
    const t = G.tangentArc([10, 0], [1, 0], [10, 20]);
    a(t && nearP(t.c, [10, 10]) && near(t.r, 10) && t.forward, 'a tangent arc turning left', t);
    const r = G.tangentArc([10, 0], [1, 0], [10, -20]);
    a(r && nearP(r.c, [10, -10]) && !r.forward, 'turning right runs clockwise', r);
    a(G.tangentArc([0, 0], [1, 0], [5, 0]) === null, 'straight ahead is a line, not an arc');
}

/* ---- corner geometry ---- */
{
    const f = G.cornerCut([0, 0], [10, 0], [0, 10], 2, 'fillet');
    a(nearP(f.t1, [2, 0]) && nearP(f.t2, [0, 2]) && nearP(f.c, [2, 2]), 'a right angle corner rounds 2 back along each line', f);
    const arc = f.forward ? G.arcFrom('', f.c, f.t1, f.t2) : G.arcFrom('', f.c, f.t2, f.t1);
    a(near(arc.sweep, Math.PI / 2), 'the round of a right angle is a quarter turn', arc.sweep);
    const sharp = G.cornerCut([0, 0], [10, 0], [10, 10], 1, 'fillet');
    a(near(G.dist(sharp.t1, [0, 0]), 1 / Math.tan(Math.PI / 8)), 'a 45 degree corner is cut back r / tan(22.5)', sharp);
    a(G.cornerCut([0, 0], [3, 0], [0, 3], 5, 'fillet').error, 'a radius too large for the lines is refused');
    a(G.cornerCut([0, 0], [10, 0], [-10, 0], 1, 'fillet').error, 'lines in line have no corner');
    const ch = G.cornerCut([0, 0], [10, 0], [0, 10], 3, 'chamfer');
    a(nearP(ch.t1, [3, 0]) && nearP(ch.t2, [0, 3]) && ch.c === undefined, 'a chamfer cuts back its distance', ch);
}

// A 40 x 30 rectangle drawn as the tool draws it, fully dimensioned
function rectangle() {
    const sk = { geometry: [], constraints: [] };
    const p = [[0, 0], [40, 0], [40, 30], [0, 30]].map(c => M.addPoint(sk, c[0], c[1]));
    const l = [0, 1, 2, 3].map(i => M.addLine(sk, p[i], p[(i + 1) % 4]));
    ['horizontal', 'vertical', 'horizontal', 'vertical'].forEach((t, i) => M.addConstraint(sk, { type: t, line: l[i] }));
    M.addConstraint(sk, { type: 'coincident', a: p[0], b: M.ORIGIN });
    M.addConstraint(sk, { type: 'distance', a: p[0], b: p[1], value: 40, pos: [20, -5] });
    M.addConstraint(sk, { type: 'distance', a: p[1], b: p[2], value: 30, pos: [45, 15] });
    return { sk, p, l };
}

/* ---- sketch fillet ---- */
{
    const { sk, p, l } = rectangle();
    a(solver.solve(sk).dof === 0, 'the rectangle starts fully constrained');
    a(M.cornerLines(sk, p[2]).sort().join() === [l[1], l[2]].sort().join(), 'the lines meeting at a corner are found');
    const out = M.roundCorner(sk, l[1], l[2], 5, 'fillet');
    a(out.id && !out.error, 'the top right corner is rounded', out);
    const r = solver.solve(sk);
    a(r.ok && r.dof === 0, 'the rounded rectangle is still fully constrained', r);
    const arc = M.curve(sk, out.id);
    a(arc && near(arc.r, 5, 1e-6) && nearP(arc.c, [35, 25], 1e-6) && near(arc.sweep, Math.PI / 2, 1e-6), 'the round has radius 5 centred 5 in from the corner', arc);
    a(nearP(M.curve(sk, l[1]).b, [40, 25], 1e-6) && nearP(M.curve(sk, l[2]).a, [35, 30], 1e-6), 'the two lines now stop where the round starts');
    a(!M.find(sk, p[2]) || sk.constraints.some(c => c.type === 'pointon' && c.p === p[2]), 'the old corner is gone, or held on both lines');
    // The 40 and 30 still measure the full size: their dimensions hang on the old corner point
    a(M.find(sk, p[2]) && near(M.point(sk, p[2])[0], 40, 1e-6) && near(M.point(sk, p[2])[1], 30, 1e-6), 'the corner a dimension hangs on stays at the sharp corner');
    // Changing the radius moves the round
    sk.constraints.find(c => c.type === 'radius' && c.curve === out.id).value = 8;
    a(solver.solve(sk).ok && near(M.curve(sk, out.id).r, 8, 1e-6), 'the radius dimension drives the round');
    // A second corner with the same radius is made equal to the first
    const second = M.roundCorner(sk, l[3], l[0], 8, 'fillet', out.id);
    const r2 = solver.solve(sk);
    a(second.id && r2.ok && r2.dof === 0 && near(M.curve(sk, second.id).r, 8, 1e-6), 'a second round of the same size follows the first through Equal', r2);
    a(sk.constraints.some(c => c.type === 'equal' && c.b === second.id) && sk.constraints.filter(c => c.type === 'radius').length === 1, 'one radius dimension, one equal');
    a(M.roundCorner(sk, l[1], l[3], 2, 'fillet').error, 'two lines that do not meet are refused');
}

/* ---- sketch chamfer ---- */
{
    const { sk, l } = rectangle();
    const out = M.roundCorner(sk, l[0], l[1], 4, 'chamfer');
    const r = solver.solve(sk);
    a(out.id && r.ok && r.dof === 0, 'a chamfered corner is fully constrained', r);
    const bevel = M.curve(sk, out.id);
    a(bevel.type === 'line' && near(G.dist(bevel.a, bevel.b), 4 * Math.SQRT2, 1e-6), 'the bevel of a 4 mm chamfer is 4 * sqrt(2) long', bevel);
}

/* ---- a free corner disappears ---- */
{
    const sk = { geometry: [], constraints: [] };
    const p = [[0, 0], [20, 0], [20, 20]].map(c => M.addPoint(sk, c[0], c[1]));
    const l1 = M.addLine(sk, p[0], p[1]);
    const l2 = M.addLine(sk, p[1], p[2]);
    const out = M.roundCorner(sk, l1, l2, 3, 'fillet');
    // (its id may be taken again by the new centre point, so look by position)
    a(out.id && !sk.geometry.some(g => g.type === 'point' && near(g.x, 20) && near(g.y, 0)), 'a corner nothing else uses is removed');
    a(solver.solve(sk).ok, 'and the sketch solves');
}

/* ---- tangent arcs chained from a line, as the Tangent Arc tool adds them ---- */
{
    const sk = { geometry: [], constraints: [] };
    const p0 = M.addPoint(sk, 0, 0);
    const p1 = M.addPoint(sk, 10, 0);
    const line = M.addLine(sk, p0, p1);
    // Leaving the line's end heading +x, ending at (10, 20): turns left
    const t = G.tangentArc([10, 0], [1, 0], [10, 20]);
    const e1 = M.addPoint(sk, 10, 20);
    const arc1 = M.addArc(sk, M.addPoint(sk, t.c[0], t.c[1]), p1, e1);
    M.addConstraint(sk, { type: 'tangent', a: line, b: arc1 });
    // Then on from the arc's end (heading -x there), ending at (0, 30): turns right
    const t2 = G.tangentArc([10, 20], [-1, 0], [0, 30]);
    const e2 = M.addPoint(sk, 0, 30);
    const arc2 = M.addArc(sk, M.addPoint(sk, t2.c[0], t2.c[1]), e2, e1); // clockwise, so stored from the far end
    M.addConstraint(sk, { type: 'tangent', a: arc1, b: arc2 });
    let r = solver.solve(sk);
    a(r.ok && !r.redundant.length, 'line, arc, arc joined tangent solve without redundancy', r);
    // Pull the far end: the joins stay smooth
    r = solver.solve(sk, [{ p: e2, x: -6, y: 34 }]);
    const c1 = M.curve(sk, arc1);
    const c2 = M.curve(sk, arc2);
    const join = M.point(sk, e1);
    const cross = (c1.c[0] - join[0]) * (c2.c[1] - join[1]) - (c1.c[1] - join[1]) * (c2.c[0] - join[0]);
    a(r.ok && near(cross, 0, 1e-6), 'after a drag the two centres and the join are still in line (tangent)', cross);
    const ln = M.curve(sk, line);
    const dot = (ln.b[0] - ln.a[0]) * (ln.b[0] - c1.c[0]) + (ln.b[1] - ln.a[1]) * (ln.b[1] - c1.c[1]);
    a(near(dot, 0, 1e-6), 'the line still runs square to the first arc radius at the join', dot);
}

/* ---- mirror ---- */
{
    const sk = { geometry: [], constraints: [] };
    // a construction line along the Y axis to mirror about
    const m1 = M.addPoint(sk, 0, -10);
    const m2 = M.addPoint(sk, 0, 40);
    const axis = M.addLine(sk, m1, m2, true);
    M.addConstraint(sk, { type: 'fix', p: m1, x: 0, y: -10 });
    M.addConstraint(sk, { type: 'fix', p: m2, x: 0, y: 40 });
    // an L: a line from the axis out, a line up, and a circle and an arc
    const p0 = M.addPoint(sk, 0, 0);
    const p1 = M.addPoint(sk, 20, 0);
    const p2 = M.addPoint(sk, 20, 15);
    const l1 = M.addLine(sk, p0, p1);
    const l2 = M.addLine(sk, p1, p2);
    const k = M.addCircle(sk, M.addPoint(sk, 10, 25), 4);
    const arc = M.addArc(sk, M.addPoint(sk, 30, 30), M.addPoint(sk, 35, 30), M.addPoint(sk, 30, 35));
    const out = M.mirrorGeometry(sk, [l1, l2, k, arc], axis);
    a(out.ids && out.ids.length === 4, 'four copies', out);
    let r = solver.solve(sk);
    a(r.ok && !r.redundant.length, 'the mirrored sketch solves without redundancy', r);
    const copy1 = M.find(sk, out.ids[0]);
    a(copy1.p1 === p0, 'a point on the mirror line is shared, not copied');
    a(nearP(M.point(sk, copy1.p2), [-20, 0], 1e-6), 'a point is mirrored across the line', M.point(sk, copy1.p2));
    const arcCopy = M.curve(sk, out.ids[3]);
    a(nearP(arcCopy.c, [-30, 30], 1e-6) && near(arcCopy.sweep, Math.PI / 2, 1e-6), 'the arc is mirrored and still a quarter turn', arcCopy);
    // Drag the original corner: the copy follows
    r = solver.solve(sk, [{ p: p2, x: 25, y: 18 }]);
    a(r.ok && nearP(M.point(sk, M.find(sk, out.ids[1]).p2), [-M.point(sk, p2)[0], M.point(sk, p2)[1]], 1e-6), 'the copy follows the original', [M.point(sk, p2), M.point(sk, M.find(sk, out.ids[1]).p2)]);
    M.find(sk, k).r = 6;
    a(solver.solve(sk).ok && near(M.find(sk, out.ids[2]).r, 6, 1e-6), 'the circle copy keeps the radius of the original');
    a(M.mirrorGeometry(sk, [l1], k).error, 'a circle is not a mirror line');
}

/* ---- polygon ---- */
{
    const sk = { geometry: [], constraints: [] };
    const lines = M.addPolygon(sk, M.ORIGIN, [10, 0], 6);
    const r = solver.solve(sk);
    a(lines.length === 6 && r.ok && r.dof === 2, 'a hexagon about the origin is free to turn and grow only', r);
    const len = lines.map(id => { const c = M.curve(sk, id); return G.dist(c.a, c.b); });
    a(len.every(l => near(l, 10, 1e-6)), 'all six sides 10 long', len);
}

/* ---- slot ---- */
{
    const sk = { geometry: [], constraints: [] };
    const c1 = M.addPoint(sk, 0, 0);
    const c2 = M.addPoint(sk, 30, 0);
    const slot = M.addSlot(sk, c1, c2, 5);
    let r = solver.solve(sk);
    a(r.ok && r.dof === 5 && !r.redundant.length, 'a slot is two centres and a width', r);
    M.addConstraint(sk, { type: 'radius', curve: slot.arcs[0], value: 8, pos: [0, 10] });
    r = solver.solve(sk);
    const top = M.curve(sk, slot.lines[0]);
    const c = M.point(sk, c1);
    const off = Math.abs((c[0] - top.a[0]) * (top.b[1] - top.a[1]) - (c[1] - top.a[1]) * (top.b[0] - top.a[0])) / G.dist(top.a, top.b);
    a(r.ok && near(M.curve(sk, slot.arcs[1]).r, 8, 1e-6) && near(off, 8, 1e-6), 'the width dimension drives both ends and the sides', [M.curve(sk, slot.arcs[1]).r, off]);
}

/* ---- driven dimensions ---- */
{
    const { sk, p } = rectangle();
    // the diagonal of a fully dimensioned rectangle: already set, so driven
    const id = M.addConstraint(sk, { type: 'distance', a: p[0], b: p[2], value: 1, driven: true, pos: [20, 15] });
    let r = solver.solve(sk);
    const diagonal = () => sk.constraints.find(c => c.id === id);
    a(r.ok && r.dof === 0 && !r.redundant.length, 'a driven dimension does not over-constrain the sketch', r);
    a(near(diagonal().value, 50, 1e-6), 'and shows the size it measures (the 40 x 30 diagonal is 50)', diagonal().value);
    sk.constraints.find(c => c.type === 'distance' && c.b === p[1]).value = 30;
    sk.constraints.find(c => c.type === 'distance' && c.a === p[1]).value = 40;
    r = solver.solve(sk);
    a(r.ok && near(diagonal().value, 50, 1e-6), 'it follows when the driving sizes change');
    sk.constraints.find(c => c.type === 'distance' && c.b === p[1]).value = 60;
    solver.solve(sk);
    a(near(diagonal().value, Math.hypot(60, 40), 1e-6), 'a 60 x 40 rectangle shows its new diagonal', diagonal().value);
    const { dimensionLabel } = await import('../js/sketch/render.js');
    a(/^\(.*\)$/.test(dimensionLabel(diagonal())), 'it is drawn in brackets', dimensionLabel(diagonal()));
}

/* ---- concentric ---- */
{
    const sk = { geometry: [], constraints: [] };
    const k1 = M.addCircle(sk, M.addPoint(sk, 0, 0), 10);
    const k2 = M.addCircle(sk, M.addPoint(sk, 3, 2), 4);
    const built = M.build(sk, 'concentric', [k1, k2]);
    a(built.add && built.add[0].type === 'coincident', 'concentric ties the two centres', built);
    built.add.forEach(c => M.addConstraint(sk, c));
    a(solver.solve(sk).ok && nearP(M.point(sk, M.find(sk, k1).c), M.point(sk, M.find(sk, k2).c), 1e-6), 'the circles end up sharing a centre');
    a(M.build(sk, 'concentric', [k1]).more, 'one circle asks for a second');
    a(M.build(sk, 'concentric', [k1, M.find(sk, k1).c]).error, 'a point is refused');
}

console.log(failed ? failed + ' FAILED' : 'all sketch tool tests passed');
process.exitCode = failed ? 1 : 0;
