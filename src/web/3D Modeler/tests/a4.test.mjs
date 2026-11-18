/*
    Stable references (PROPOSAL.md 14.5, built further in 14.29): projected
    sketch geometry follows its model edges.
    Run with: node tests/run.mjs a4
*/

import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import * as M from '../js/sketch/model.js';
import { addProjected, applyFollow } from '../js/sketch/project.js';
import { createSolver } from '../js/sketch/solver.js';

const oc = await init();
const solver = await createSolver();
let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);

const rect = (x, y, w, h, n) => {
    const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const g = [];
    p.forEach((c, i) => g.push({ id: n + 'p' + i, type: 'point', x: c[0], y: c[1] }));
    p.forEach((c, i) => g.push({ id: n + 'l' + i, type: 'line', p1: n + 'p' + i, p2: n + 'p' + ((i + 1) % 4) }));
    return g;
};

// A 60 x 40 x 10 plate; a sketch on its top face with the face's edges
// projected (as Start 2D Sketch on a face does), a hole circle 10 from the
// right edge and 10 from the back edge, cut through
const top = { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
const doc = {
    format: 'aopart', version: 1, units: 'mm',
    features: [
        { id: 's1', type: 'sketch', name: 'Sketch1', plane: { ref: 'origin:xy' }, geometry: rect(0, 0, 60, 40, 'a'), constraints: [] },
        { id: 'e1', type: 'extrude', name: 'Plate', sketch: 's1', regions: [[5, 5]], operation: 'join', extent: { type: 'distance', value: 10, direction: 'positive' } }
    ]
};
const rb = createRebuilder(oc);
let r = rb.rebuild(doc);
const body = r.bodies[0];
const topFace = body.faces.findIndex(f => f.type === 'plane' && near(f.normal[2], 1) && near(f.origin[2], 10));
const sk = { id: 's2', type: 'sketch', name: 'Sketch2', plane: { ref: 'face', frame: top, face: { normal: [0, 0, 1], point: [30, 20, 10] } }, geometry: [], constraints: [] };
body.faces[topFace].edges.forEach(i => {
    const e = body.edges[i];
    addProjected(sk, top, Object.assign({}, e.curve, { source: { body: 0, mid: e.mid, length: e.length } }));
});
const refLines = sk.geometry.filter(g => g.type === 'line' && g.ref);
a(refLines.length === 4 && refLines.every(g => g.source && g.source.mid), 'the face outline is projected with where each edge came from', refLines.length);
// the right edge (x = 60) and the back edge (y = 40)
const right = refLines.find(g => near(M.point(sk, g.p1)[0], 60) && near(M.point(sk, g.p2)[0], 60));
const back = refLines.find(g => near(M.point(sk, g.p1)[1], 40) && near(M.point(sk, g.p2)[1], 40));
const c = M.addPoint(sk, 48, 31);
const hole = M.addCircle(sk, c, 4);
M.addConstraint(sk, { type: 'pldistance', p: c, line: right.id, value: 10 });
M.addConstraint(sk, { type: 'pldistance', p: c, line: back.id, value: 10 });
M.addConstraint(sk, { type: 'radius', curve: hole, value: 4 });
a(solver.solve(sk).ok && near(M.point(sk, c)[0], 50) && near(M.point(sk, c)[1], 30), 'the hole sits 10 from the right and back edges', M.point(sk, c));
// The regions know the curves around them: the disc is bounded by the
// circle alone, the plate face by the four projected edges and the circle
const regions = K.sketchRegions(oc, sk);
const disc = regions.find(rg => K.inRegion(rg, [50, 30]));
a(JSON.stringify(disc.curves) === JSON.stringify([hole]), 'the disc is bounded by the circle', disc.curves);
a(regions.some(rg => rg.curves.length === 5 && rg.curves.indexOf(hole) >= 0), 'the plate face by the four edges and the circle', regions.map(rg => rg.curves));
doc.features.push(sk, { id: 'e2', type: 'extrude', name: 'Hole', sketch: 's2', regions: [[50, 30]], regionCurves: [disc.curves], operation: 'cut', extent: { type: 'all', direction: 'negative' } });

r = rb.rebuild(doc);
a(r.features.e2.status === 'ok' && near(r.bodies[0].volume, (60 * 40 - Math.PI * 16) * 10, 1e-3), 'the hole is cut', r.bodies[0].volume);
// The first rebuild only adds the edges' descriptions (no geometry moved)
let p = r.projections.s2 || [];
a(p.length === 4 && p.every(ch => ch.source && ch.source.sig && !ch.curve), 'first rebuild: every projected edge gains its description, nothing moves', p);
applyFollow(doc.features[2], p);
r = rb.rebuild(doc);
a(!r.projections.s2, 'then nothing more to report', r.projections);

// The plate grows to 80 wide: the right edge moves to x = 80
doc.features[0].geometry.find(g => g.id === 'ap1').x = 80;
doc.features[0].geometry.find(g => g.id === 'ap2').x = 80;
r = rb.rebuild(doc);
p = r.projections.s2 || [];
const moved = p.filter(ch => ch.curve);
a(moved.length === 3, 'the right edge and the two edges along X moved (the left one did not)', p.map(ch => ch.id));
const out = applyFollow(doc.features[2], p);
a(out.moved && !out.lost.length, 'applied');
a(near(M.point(doc.features[2], right.p1)[0], 80) && near(M.point(doc.features[2], right.p2)[0], 80), 'the projected right edge is at x 80 now');
a(solver.solve(doc.features[2]).ok, 'the sketch solves');
a(near(M.point(doc.features[2], c)[0], 70) && near(M.point(doc.features[2], c)[1], 30), 'the hole followed the right edge to x 70', M.point(doc.features[2], c));
r = rb.rebuild(doc);
a(!r.projections.s2 && r.features.e2.status === 'ok' && near(r.bodies[0].volume, (80 * 40 - Math.PI * 16) * 10, 1e-3), 'rebuilt: settled, the hole cut at its new place', [r.projections, r.bodies[0].volume]);
// Without the curves, the old point (50, 30) now falls in the plate face
// and the cut would take the plate away: the curves are what keeps it right
const pointOnly = JSON.parse(JSON.stringify(doc));
delete pointOnly.features[3].regionCurves;
const wrong = createRebuilder(oc).rebuild(pointOnly);
a(near(wrong.bodies[0].volume, Math.PI * 16 * 10, 1e-3), 'a point alone picks the wrong area after the move (why the curves are kept)', wrong.bodies[0].volume);
// the hole is really at x 70: the solid has a cylinder face there
const cyl = r.bodies[0].faces.find(f => f.type === 'cylinder');
a(cyl && near(cyl.axis.o[0], 70) && near(cyl.axis.o[1], 30), 'the cut is at (70, 30)', cyl && cyl.axis);

// The face goes away (the sketch's source edges vanish): reported as lost
const lost = K.followEdges(oc, [], [{ body: 0, mid: [999, 0, 0], length: 3 }]);
a(lost[0].found === false, 'an edge that is gone is not found');

// applyFollow: a lost curve stays, a circle moves and changes radius
const small = { geometry: [], constraints: [] };
addProjected(small, top, { type: 'circle', c: [5, 5, 10], r: 2, n: [0, 0, 1], a: [7, 5, 10], b: [7, 5, 10], closed: true, source: { body: 0, mid: [7, 5, 10], length: 12.566 } });
const circle = small.geometry.find(g => g.type === 'circle');
const res = applyFollow(small, [{ id: circle.id, source: { body: 0, mid: [9, 9, 10], length: 18.85 }, curve: { type: 'circle', c: [6, 6], r: 3 } }]);
a(res.moved && circle.r === 3 && near(M.point(small, circle.c)[0], 6) && near(circle.source.mid[0], 9), 'a circle follows', circle);
a(applyFollow(small, [{ id: circle.id, lost: true }]).lost[0] === circle.id && circle.r === 3, 'a lost curve is reported and left where it is');

// ---- face names (phase A) ----
{
    const named = createRebuilder(oc).rebuild((await import('../js/document/sample.js')).sampleDocument());
    const names = named.bodies[0].faces.map(f => f.name);
    a(names.indexOf('f2/start') >= 0 && names.indexOf('f2/end+') >= 0 && names.indexOf('f2/side:l1') >= 0 && names.indexOf('f4/side:k1') >= 0,
        'the sample plate: caps and sides by sketch curve, the boss by its own', names);
    a(names.filter(n => n === 'f6/side:k1').length === 2, 'the cross hole cut in two pieces: both keep its name');
    const edge = named.bodies[0].edges.find(e => e.names && e.names.join() === 'f2/end+,f4/side:k1');
    a(edge && edge.curve.type === 'circle' && near(edge.curve.r, 14), 'an edge knows the faces it lies between: the boss foot', edge && edge.names);
}

// A plate whose left side leans: (0, 0) (60, 0) (60, 40) (10, 40). Its top
// edge along the leaning side gets a fillet, the side is removed by a
// shell, and a sketch sits on it; then the side leans more: (20, 40)
const lean = (x) => {
    const g = [[0, 0], [60, 0], [60, 40], [x, 40]].map((c, i) => ({ id: 'q' + i, type: 'point', x: c[0], y: c[1] }));
    [0, 1, 2, 3].forEach(i => g.push({ id: 'm' + i, type: 'line', p1: 'q' + i, p2: 'q' + ((i + 1) % 4) }));
    return { format: 'aopart', version: 1, features: [
        { id: 's1', type: 'sketch', name: 'Sketch1', plane: { ref: 'origin:xy' }, geometry: g, constraints: [] },
        { id: 'e1', type: 'extrude', name: 'Plate', sketch: 's1', regions: [[30, 20]], operation: 'join', extent: { type: 'distance', value: 10, direction: 'positive' } }
    ] };
};
{
    const doc = lean(10);
    const rb2 = createRebuilder(oc);
    let res = rb2.rebuild(doc);
    const side = res.bodies[0].faces.findIndex(f => f.name === 'e1/side:m3');
    a(side >= 0 && res.bodies[0].faces[side].type === 'plane', 'the leaning side is e1/side:m3');
    const topEdge = res.bodies[0].edges.find(e => e.names && e.names.join() === 'e1/end+,e1/side:m3');
    const refs = K.describeEdgeRefs(oc, rb2.bodies(), [{ body: 0, mid: topEdge.mid, length: topEdge.length }]);
    a(JSON.stringify(refs[0].names) === '["e1/end+","e1/side:m3"]', 'a stored edge reference keeps the names of its faces', refs[0].names);
    const faceInfo = res.bodies[0].faces[side];
    const faceRefs = K.describeFaceRefs(oc, rb2.bodies(), [{ body: 0, centre: faceInfo.centre, area: faceInfo.area }], false);
    a(faceRefs[0].name === 'e1/side:m3', 'a stored face reference keeps its name', faceRefs[0]);
    const n = faceInfo.normal;
    // the sketch frame on the side: X up, Y = N x X
    const frame = { o: faceInfo.origin, x: [0, 0, 1], y: null, n: n };
    frame.y = [n[1] * frame.x[2] - n[2] * frame.x[1], n[2] * frame.x[0] - n[0] * frame.x[2], n[0] * frame.x[1] - n[1] * frame.x[0]];
    doc.features.push({ id: 'f1', type: 'fillet', name: 'Fillet1', edges: refs, radius: 2 });
    doc.features.push({ id: 's9', type: 'sketch', name: 'OnSide', plane: { ref: 'face', frame: frame, face: { normal: n, point: [5, 20, 5], name: 'e1/side:m3' } }, geometry: [], constraints: [] });
    res = rb2.rebuild(doc);
    a(res.features.f1.status === 'ok', 'the fillet builds', res.features);
    // the side leans more
    doc.features[0].geometry.find(g => g.id === 'q3').x = 20;
    res = rb2.rebuild(doc);
    a(res.features.f1.status === 'ok', 'the fillet follows the edge though its face turned (by name)', res.features.f1);
    const turned = res.frames.s9;
    // the side now runs from (0, 0) to (20, 40): its normal is along (2, -1)
    const want = [2, -1, 0].map(v => v / Math.hypot(2, 1));
    a(turned && near(Math.abs(turned.n[0]), want[0], 1e-6) && near(Math.abs(turned.n[1]), Math.abs(want[1]), 1e-6) && near(turned.n[2], 0, 1e-9),
        'the sketch on the side turned with it', turned && turned.n);
    // The same references without names cannot follow the turn
    const bare = JSON.parse(JSON.stringify(doc));
    bare.features[2].edges = bare.features[2].edges.map(r => ({ body: r.body, mid: r.mid, length: r.length, sig: r.sig }));
    const old = createRebuilder(oc).rebuild(bare);
    a(old.features.f1.status === 'error', 'without names the turned edge is lost (why names are kept)', old.features.f1);
    // the result equals picking the edge where it is now
    const direct = lean(20);
    const rb3 = createRebuilder(oc);
    const now = rb3.rebuild(direct);
    const edgeNow = now.bodies[0].edges.find(e => e.names && e.names.join() === 'e1/end+,e1/side:m3');
    direct.features.push({ id: 'f1', type: 'fillet', name: 'Fillet1', edges: [{ body: 0, mid: edgeNow.mid, length: edgeNow.length }], radius: 2 });
    const filletOnly = JSON.parse(JSON.stringify(doc));
    filletOnly.features = filletOnly.features.filter(f => f.id !== 's9');
    a(near(createRebuilder(oc).rebuild(filletOnly).bodies[0].volume, rb3.rebuild(direct).bodies[0].volume, 1e-3), 'the same fillet as one picked on the new edge');
    // A shell with the leaning side open, then the side leans more
    const shelled = lean(10);
    shelled.features.push({ id: 'h1', type: 'shell', name: 'Shell1', faces: faceRefs, thickness: 1, direction: 'inside' });
    const rb4 = createRebuilder(oc);
    a(rb4.rebuild(shelled).features.h1.status === 'ok', 'the shell builds');
    shelled.features[0].geometry.find(g => g.id === 'q3').x = 20;
    const after = rb4.rebuild(shelled);
    a(after.features.h1.status === 'ok', 'the shell keeps the turned face open (by name)', after.features.h1);
}

console.log(failed ? failed + ' checks failed' : 'a4: all checks passed');
process.exitCode = failed ? 1 : 0;
