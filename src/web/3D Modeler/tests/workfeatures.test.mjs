/*
    Work axes, work points and the other kinds of work plane (PROPOSAL.md
    14.13, 14.25): the geometry of every kind (kernel/profile.js), what a
    feature refers to (document usesOf / dependents), and in the kernel: a
    work axis on a round face or an edge follows it when an earlier
    feature moves it, and Revolve and Circular Pattern turn about one.
    Run with: node tests/run.mjs workfeatures
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as kernel from '../js/kernel/occt.js';
import * as P from '../js/kernel/profile.js';
import { sampleDocument } from '../js/document/sample.js';
import { createDocument, usesOf } from '../js/document/document.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);
const nearV = (u, v, t) => u && v && u.every((c, i) => near(c, v[i], t));
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

const XY = { ref: 'origin:xy' };
const XZ = { ref: 'origin:xz' };
const YZ = { ref: 'origin:yz' };

/* ---- axes and points ---- */
a(nearV(P.axisLine({ ref: 'origin:y' }).d, [0, 1, 0]), 'the origin axes');
a(P.pointAt({ ref: 'origin' }).join() === '0,0,0' && P.pointAt({ ref: 'vertex', at: [1, 2, 3] }).join() === '1,2,3', 'the centre point and a corner');
let line = P.planesLine(P.planeFrame(XZ), P.planeFrame(YZ));
a(line && near(Math.abs(line.d[2]), 1) && nearV(line.o, [0, 0, 0]), 'XZ meets YZ along Z', line);
a(P.planesLine(P.planeFrame(XY), { o: [0, 0, 5], n: [0, 0, 1] }) === null, 'parallel planes do not meet');
const tilted = { o: [0, 0, 10], n: [0, Math.SQRT1_2, Math.SQRT1_2] };
line = P.planesLine(P.planeFrame(XY), tilted);
a(line && near(dot(line.o, [0, 0, 1]), 0) && near(dot(line.o, tilted.n), dot(tilted.o, tilted.n)), 'the line lies on both planes', line);
a(nearV(P.linePlane({ o: [1, 2, 0], d: [0, 0, 1] }, { o: [0, 0, 7], n: [0, 0, 1] }), [1, 2, 7]), 'a line meets a plane');
a(P.linePlane({ o: [0, 0, 0], d: [1, 0, 0] }, P.planeFrame(XY)) === null, 'a line along a plane does not meet it');
const f = P.frameFromNormal([1, 1, 1], [0, 0, 2]);
a(near(dot(f.x, f.n), 0) && near(dot(f.y, f.n), 0) && near(dot(f.x, f.y), 0) && nearV(f.n, [0, 0, 1]), 'a frame square to a normal');

const features = [
    { id: 'w1', type: 'plane', base: XY, offset: 20 },
    { id: 'ax', type: 'axis', def: { kind: 'planes', a: XZ, b: YZ } },
    { id: 'ax2', type: 'axis', def: { kind: 'points', a: { ref: 'origin' }, b: { ref: 'vertex', at: [10, 0, 0] } } },
    { id: 'ax3', type: 'axis', def: { kind: 'edge', edge: { body: 0, mid: [0, 0, 0], length: 1 }, line: { o: [5, 5, 0], d: [0, 2, 0] } } },
    { id: 'p1', type: 'point', def: { kind: 'axisplane', axis: { ref: 'axis', id: 'ax' }, plane: { ref: 'plane', id: 'w1' } } },
    { id: 'p2', type: 'point', def: { kind: 'coords', at: [30, 0, 0] } },
    { id: 'mid', type: 'plane', def: { kind: 'midplane', a: XY, b: { ref: 'plane', id: 'w1' } } },
    { id: 'ang', type: 'plane', def: { kind: 'angle', base: XY, axis: { ref: 'axis', id: 'ax2' }, angle: 90 } },
    { id: 'ang0', type: 'plane', def: { kind: 'angle', base: XY, axis: { ref: 'origin:x' }, angle: 0 } },
    { id: 'tri', type: 'plane', def: { kind: 'points', a: { ref: 'origin' }, b: { ref: 'point', id: 'p2' }, c: { ref: 'point', id: 'p1' } } },
    { id: 'tan', type: 'plane', def: { kind: 'tangent', face: {}, line: { o: [0, 0, 5], d: [1, 0, 0] }, radius: 5, base: XY, side: [3, 0, 12] } },
    { id: 'tan2', type: 'plane', def: { kind: 'tangent', face: {}, line: { o: [0, 0, 5], d: [1, 0, 0] }, radius: 5, base: XY, side: [3, 0, -2] } },
    { id: 'nor', type: 'plane', def: { kind: 'normal', axis: { ref: 'axis', id: 'ax2' }, point: { ref: 'point', id: 'p2' } } },
    { id: 'badmid', type: 'plane', def: { kind: 'midplane', a: XY, b: XZ } },
    { id: 'badang', type: 'plane', def: { kind: 'angle', base: XY, axis: { ref: 'origin:z' }, angle: 30 } },
    { id: 'loop', type: 'plane', def: { kind: 'midplane', a: { ref: 'plane', id: 'loop2' }, b: XY } },
    { id: 'loop2', type: 'plane', def: { kind: 'midplane', a: { ref: 'plane', id: 'loop' }, b: XY } }
];
const frame = id => P.planeFrame({ ref: 'plane', id: id }, features);
a(nearV(P.axisLine({ ref: 'axis', id: 'ax' }, features).o, [0, 0, 0]), 'a work axis where two planes meet');
a(nearV(P.axisLine({ ref: 'axis', id: 'ax2' }, features).d, [1, 0, 0]), 'a work axis through two points');
a(nearV(P.axisLine({ ref: 'axis', id: 'ax3' }, features).d, [0, 1, 0]), 'a work axis on an edge keeps the line it was made with');
a(nearV(P.pointAt({ ref: 'point', id: 'p1' }, features), [0, 0, 20]), 'a work point where an axis meets a work plane');
a(nearV(frame('mid').o, [0, 0, 10]) && nearV(frame('mid').n, [0, 0, 1]), 'a midplane halfway between two parallel planes', frame('mid'));
a(nearV(frame('ang').n.map(Math.abs), [0, 1, 0]) && near(dot(frame('ang').x, [1, 0, 0]), 1), 'turned 90 degrees about an axis in the plane', frame('ang'));
a(nearV(frame('ang0').n, [0, 0, 1]), 'turned 0 degrees it is the plane itself');
const t = frame('tri');
a(t && near(dot(t.n, [0, 0, 1]), 0) && near(Math.abs(dot(t.n, [0, 1, 0])), 1), 'through three points (here the XZ plane)', t);
a(nearV(frame('tan').o, [0, 0, 10]) && nearV(frame('tan2').o, [0, 0, 0]), 'tangent to a round face, on the side clicked', [frame('tan').o, frame('tan2').o]);
a(nearV(frame('nor').o, [30, 0, 0]) && nearV(frame('nor').n, [1, 0, 0]), 'square to an axis through a point');
a(frame('badmid') === null && frame('badang') === null, 'planes that are not parallel, an axis not in the plane: nothing');
a(frame('loop') === null, 'planes defined by each other end instead of looping');
a(P.planeFrame({ ref: 'plane', id: 'mid' }, features.map(x => x.id === 'w1' ? Object.assign({}, x, { suppressed: true }) : x)) === null, 'a plane on a suppressed plane is gone');

/* ---- what refers to what ---- */
a(usesOf(features.find(x => x.id === 'tri')).sort().join() === 'p1,p2', 'a plane through points uses those points', usesOf(features.find(x => x.id === 'tri')));
a(usesOf({ id: 'r', type: 'revolve', sketch: 's', axis: { work: 'ax' } }).sort().join() === 'ax,s', 'a revolution about a work axis uses it');
a(usesOf({ id: 'pt', type: 'pattern', features: ['e'], axisRef: { ref: 'axis', id: 'ax' } }).sort().join() === 'ax,e', 'a pattern about a work axis uses it');
const doc = createDocument();
doc.reset({ format: 'aopart', version: 1, features: features.slice(0, 7).map(x => Object.assign({ name: x.id }, x)) }, 'P', '');
a(doc.dependents('ax').map(x => x.id).sort().join() === 'p1', 'deleting a work axis takes what uses it', doc.dependents('ax').map(x => x.id));
a(doc.dependents('w1').map(x => x.id).sort().join() === 'mid,p1', 'and a work plane', doc.dependents('w1').map(x => x.id));
a(doc.newName('axis') === 'Work Axis1' && doc.newName('point') === 'Work Point1', 'names');

/* ---- in the kernel ---- */
const oc = await init();
const sample = sampleDocument();
let out = createRebuilder(oc).rebuild(sample);
const boss = out.bodies[0].faces.find(x => x.type === 'cylinder' && near(x.radius, 14, 1e-6));
a(boss, 'the sample has the boss face');
// A face reference with its surface key, as the panel stores it (worker faceRefs)
const shapes = createRebuilder(oc).shapesBefore(sample, null).bodies;
const faceRef = kernel.describeFaceRefs(oc, shapes, [{ body: 0, centre: boss.centre, area: boss.area }], false)[0];
a(faceRef && faceRef.sig, 'the face reference gets its surface key', faceRef);
const work = { id: 'wa', type: 'axis', name: 'Work Axis1', def: { kind: 'cylinder', face: faceRef, line: { o: boss.axis.o, d: boss.axis.d } } };
const described = JSON.parse(JSON.stringify(sample));
described.features.push(work);
out = createRebuilder(oc).rebuild(described);
a(out.lines.wa && near(out.lines.wa.o[0], 56, 1e-6) && near(out.lines.wa.o[1], 25, 1e-6) && near(out.lines.wa.r, 14, 1e-6), 'the work axis is on the boss', out.lines.wa);
// The boss moved: the axis follows it (found by position, then by kind)
const moved = JSON.parse(JSON.stringify(described));
// (its profile is remembered by the point (66, 25), still inside the ring at 58)
moved.features.find(x => x.id === 'f3').geometry.find(g => g.id === 'p1').x = 58;
out = createRebuilder(oc).rebuild(moved);
a(out.lines.wa && near(out.lines.wa.o[0], 58, 1e-6), 'the work axis follows the boss when it moves', out.lines.wa);

// A circular pattern of the cross hole about the work axis
const patterned = JSON.parse(JSON.stringify(described));
patterned.features.push({ id: 'cp', type: 'pattern', name: 'Pattern1', kind: 'circ', features: ['f6'], axis: { o: boss.axis.o, d: boss.axis.d }, axisRef: { ref: 'axis', id: 'wa' }, count: 4, angle: 360 });
const before = createRebuilder(oc).rebuild(described).bodies[0].volume;
out = createRebuilder(oc).rebuild(patterned);
a(out.features.cp.status === 'ok' && out.bodies[0].volume < before - 1, 'a circular pattern about the work axis cuts more holes', [out.features.cp, out.bodies[0].volume, before]);
const gone = JSON.parse(JSON.stringify(patterned));
gone.features = gone.features.filter(x => x.id !== 'wa');
out = createRebuilder(oc).rebuild(gone);
a(out.features.cp.status === 'error' && /work axis/.test(out.features.cp.message), 'without its work axis the pattern says so', out.features.cp);

// A work axis on an edge follows the edge: the top edge of the plate goes up with it
out = createRebuilder(oc).rebuild(sample);
const ei = out.bodies[0].edges.findIndex(e => e.curve && e.curve.type === 'line' && near(e.curve.a[2], 12) && near(e.curve.b[2], 12) && near(Math.abs(e.curve.b[0] - e.curve.a[0]), 64, 1e-3));
a(ei >= 0, 'the plate has a long top edge');
const edge = out.bodies[0].edges[ei];
const onEdge = JSON.parse(JSON.stringify(sample));
onEdge.features.push({ id: 'we', type: 'axis', name: 'Work Axis2', def: { kind: 'edge', edge: { body: 0, mid: edge.mid, length: edge.length }, line: { o: edge.curve.a, d: [1, 0, 0] } } });
onEdge.features.find(x => x.id === 'f2').extent.value = 12; // as it was: found by position
out = createRebuilder(oc).rebuild(onEdge);
a(out.lines.we && near(out.lines.we.o[2], 12, 1e-6) && near(Math.abs(out.lines.we.d[0]), 1, 1e-9), 'a work axis on an edge', out.lines.we);

// A revolution about a work axis (where XZ and YZ meet: Z), its sketch on XZ
const P2 = (id, x, y) => ({ id, type: 'point', x, y });
const L2 = (id, p1, p2) => ({ id, type: 'line', p1, p2 });
const revDoc = { features: [
    { id: 'zx', type: 'axis', name: 'Work Axis1', def: { kind: 'planes', a: XZ, b: YZ } },
    { id: 's', type: 'sketch', name: 'S', plane: XZ, constraints: [], geometry: [P2('a', 20, 0), P2('b', 30, 0), P2('c', 30, 20), P2('d', 20, 20),
        L2('l1', 'a', 'b'), L2('l2', 'b', 'c'), L2('l3', 'c', 'd'), L2('l4', 'd', 'a')] },
    { id: 'r', type: 'revolve', name: 'R', sketch: 's', regions: [[25, 10]], axis: { work: 'zx' }, operation: 'join', extent: { type: 'full' } }
] };
out = createRebuilder(oc).rebuild(revDoc);
const ring = 2 * Math.PI * 25 * 200;
a(out.features.r.status === 'ok' && near(out.bodies[0].volume, ring, ring * 1e-4), 'a revolution about a work axis', [out.features.r, out.bodies[0] && out.bodies[0].volume, ring]);

console.log(failed ? failed + ' failed' : 'workfeatures: all passed');
process.exitCode = failed ? 1 : 0;
