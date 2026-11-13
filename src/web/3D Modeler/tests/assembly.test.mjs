/*
    Assemblies without the kernel: placement matrices, picked entities, the
    constraint solver and the assembly document (js/assembly/).
    Run with: node tests/run.mjs assembly
*/
import * as G from '../js/assembly/geometry.js';
import { solve, freedom, accepts, residualsOf } from '../js/assembly/solver.js';
import { createAssemblyDocument, validateAssembly } from '../js/assembly/document.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);
const nearV = (p, q, t) => p.every((v, i) => near(v, q[i], t || 1e-4));

/* ---------------- matrices ---------------- */
const m = G.compose([10, -5, 3], [30, -20, 75], 2);
const back = G.decompose(m);
a(nearV(back.position, [10, -5, 3]) && nearV(back.degrees, [30, -20, 75]) && near(back.scale, 2), 'compose and decompose are inverse', back);
const p = [1, 2, 3];
a(nearV(G.applyPoint(G.invert(m), G.applyPoint(m, p)), p), 'invert undoes a placement with a scale');
a(nearV(G.applyPoint(G.rotation([0, 0, 1], Math.PI / 2, [5, 0, 0]), [6, 0, 0]), [5, 1, 0]), 'a turn about a point');
a(nearV(G.applyDir(m, [1, 0, 0]).map(Math.abs).map(v => v <= 1 ? 1 : 0), [1, 1, 1]), 'directions stay unit length');
const drift = m.slice();
drift[0] += 1e-4;
const tidied = G.tidy(drift);
a(near(G.dot(tidied.slice(0, 3), tidied.slice(4, 7)), 0, 1e-9) && near(G.scaleOf(tidied), G.scaleOf(drift), 1e-3), 'tidy makes the rotation square again');
const info = G.transformInfo({ type: 'cylinder', area: 10, radius: 2, centre: [1, 0, 0], axis: { o: [0, 0, 0], d: [0, 0, 1] } }, G.compose([0, 0, 5], [0, 0, 90], 3));
a(near(info.area, 90) && near(info.radius, 6) && nearV(info.centre, [0, 3, 5]) && nearV(info.axis.d, [0, 0, 1]), 'face records are moved and scaled', info);

/* ---------------- entities ---------------- */
const desc = { faces: [{ type: 'plane', normal: [0, 0, 1], edges: [4] }, { type: 'cylinder', edges: [4] }] };
const circle = G.entityOf({ kind: 'edge', index: 4, curve: { type: 'circle', c: [5, 5, 10], r: 3, n: [0, 0, -1] } }, desc);
a(circle.kind === 'circle' && nearV(circle.d, [0, 0, 1]) && circle.r === 3, 'a round edge points out of the flat face it closes', circle);
const cyl = G.entityOf({ kind: 'face', type: 'cylinder', centre: [5, 5, 4], radius: 3, axis: { o: [5, 5, 0], d: [0, 0, 1] } }, desc);
a(cyl.kind === 'cylinder' && nearV(cyl.o, [5, 5, 4]), 'a round face gives its axis, beside the face', cyl);
a(G.entityOf({ kind: 'face', type: 'other' }) === null, 'a free form face cannot be constrained');

/* ---------------- solver ---------------- */
// A: a 40 x 30 x 10 plate, grounded at the origin; B: a 20 x 20 x 20 block
const plateTop = { comp: 'A', kind: 'plane', o: [20, 15, 10], n: [0, 0, 1] };
const plateSide = { comp: 'A', kind: 'plane', o: [40, 15, 5], n: [1, 0, 0] };
const blockBottom = { comp: 'B', kind: 'plane', o: [10, 10, 0], n: [0, 0, -1] };
const blockSide = { comp: 'B', kind: 'plane', o: [20, 10, 10], n: [1, 0, 0] };
const comps = () => [
    { id: 'A', matrix: G.identity(), grounded: true, pivot: [20, 15, 5] },
    { id: 'B', matrix: G.compose([70, 40, 25], [20, 35, -50], 1), pivot: [10, 10, 10] }
];
let cs = [{ id: 'k1', type: 'mate', a: plateTop, b: blockBottom }];
let out = solve(comps(), cs);
const bottomNow = G.entityToWorld(blockBottom, out.matrices.B);
a(out.ok && nearV(bottomNow.n, [0, 0, -1]) && near(bottomNow.o[2], 10, 1e-4), 'Mate puts the block on the plate', bottomNow);
a(nearV(out.matrices.A, G.identity()), 'the grounded plate stays');

cs.push({ id: 'k2', type: 'mate', solution: 'flush', a: plateSide, b: blockSide });
out = solve(comps(), cs);
const sideNow = G.entityToWorld(blockSide, out.matrices.B);
a(out.ok && nearV(sideNow.n, [1, 0, 0]) && near(sideNow.o[0], 40, 1e-4), 'Flush lines the block up with the side of the plate', sideNow);
const placedComps = comps();
placedComps[1].matrix = out.matrices.B;
const dof = freedom(placedComps, cs);
a(dof.A === 0 && dof.B === 1, 'mate + flush leave the block one way to slide', dof);

// An offset on the mate lifts the block
cs[0].offset = 5;
out = solve(comps(), cs);
a(out.ok && near(G.entityToWorld(blockBottom, out.matrices.B).o[2], 15, 1e-4), 'a mate offset leaves a gap');
cs[0].offset = 0;
out = solve(comps(), cs);

// Dragging along the freedom that is left: Y follows, Z is held
const start = comps();
start[1].matrix = out.matrices.B;
const target = G.multiply(G.translation([7, 12, 9]), out.matrices.B);
const dragged = solve(start, cs, { drag: { comp: 'B', matrix: target } });
const before = G.applyPoint(out.matrices.B, [10, 10, 0]);
const after = G.applyPoint(dragged.matrices.B, [10, 10, 0]);
a(dragged.ok && near(after[1] - before[1], 12, 0.05) && near(after[2], before[2], 1e-4) && near(after[0], before[0], 1e-4), 'a drag slides the block along Y only', [before, after]);

// Conflicting constraints are reported, not forced
const clash = cs.concat([{ id: 'k3', type: 'mate', solution: 'flush', a: plateTop, b: { comp: 'B', kind: 'plane', o: [10, 10, 20], n: [0, 0, 1] }, offset: 3 }]);
out = solve(comps(), clash);
a(!out.ok && Object.keys(out.errors).length > 0, 'a constraint that cannot hold is reported', out.errors);

// Insert: a pin (round edge at its end) into a hole of the plate
const holeEdge = { comp: 'A', kind: 'circle', o: [10, 10, 10], d: [0, 0, 1], r: 3 };
const pinEdge = { comp: 'P', kind: 'circle', o: [0, 0, 5], d: [0, 0, -1], r: 3 }; // the underside of the pin's head
const pinComps = [
    { id: 'A', matrix: G.identity(), grounded: true, pivot: [20, 15, 5] },
    { id: 'P', matrix: G.compose([-30, 60, 40], [80, 10, 0], 1), pivot: [0, 0, 0] }
];
out = solve(pinComps, [{ id: 'i1', type: 'insert', a: holeEdge, b: pinEdge }]);
const pinNow = G.entityToWorld(pinEdge, out.matrices.P);
a(out.ok && nearV(pinNow.o, [10, 10, 10]) && nearV(pinNow.d, [0, 0, -1]), 'Insert puts the pin in the hole, head down on the face', pinNow);
pinComps[1].matrix = out.matrices.P;
a(freedom(pinComps, [{ id: 'i1', type: 'insert', a: holeEdge, b: pinEdge }]).P === 1, 'an inserted pin can still turn');

// Angle between two faces
const hinge = [
    { id: 'A', matrix: G.identity(), grounded: true, pivot: [0, 0, 0] },
    { id: 'B', matrix: G.compose([0, 0, 0], [5, 0, 0], 1), pivot: [0, 0, 0] }
];
const faceA = { comp: 'A', kind: 'plane', o: [0, 0, 0], n: [0, 0, 1] };
const faceB = { comp: 'B', kind: 'plane', o: [0, 0, 0], n: [0, 0, 1] };
out = solve(hinge, [{ id: 'g', type: 'angle', angle: 30, a: faceA, b: faceB }]);
const nB = G.entityToWorld(faceB, out.matrices.B).n;
a(out.ok && near(Math.acos(G.dot(nB, [0, 0, 1])) * 180 / Math.PI, 30, 1e-3), 'Angle turns the face to 30 degrees', nB);

// Tangent: a cylinder lying on a plane
const roller = [
    { id: 'A', matrix: G.identity(), grounded: true, pivot: [0, 0, 0] },
    { id: 'R', matrix: G.compose([3, 4, 30], [10, 20, 30], 1), pivot: [0, 0, 0] }
];
const rollerFace = { comp: 'R', kind: 'cylinder', o: [0, 0, 0], d: [1, 0, 0], r: 6 };
out = solve(roller, [{ id: 't', type: 'tangent', a: faceA, b: rollerFace }]);
const rNow = G.entityToWorld(rollerFace, out.matrices.R);
a(out.ok && near(rNow.o[2], 6, 1e-4) && near(rNow.d[2], 0, 1e-5), 'Tangent rests the cylinder on the plane', rNow);

// A face against the assembly origin plane (comp null)
const toOrigin = [{ id: 'B', matrix: G.compose([5, 5, 5], [10, 10, 10], 1), pivot: [10, 10, 10] }];
out = solve(toOrigin, [{ id: 'o', type: 'mate', solution: 'flush', a: Object.assign({ comp: null }, G.originEntity('xy')), b: { comp: 'B', kind: 'plane', o: [10, 10, 0], n: [0, 0, 1] } }]);
a(out.ok && near(G.applyPoint(out.matrices.B, [10, 10, 0])[2], 0, 1e-4), 'a face flush with the origin XY plane');

a(accepts('insert', { kind: 'circle' }, { kind: 'circle' }) && !accepts('insert', { kind: 'plane' }, { kind: 'circle' }), 'Insert takes two round edges only');
a(accepts('tangent', { kind: 'plane' }, { kind: 'cylinder' }) && !accepts('tangent', { kind: 'plane' }, { kind: 'plane' }), 'Tangent needs something round');
a(residualsOf({ type: 'mate' }, { kind: 'plane', o: [0, 0, 0], n: [0, 0, 1] }, { kind: 'plane', o: [0, 0, 0], n: [0, 0, -1] }).every(v => near(v, 0)), 'two opposed faces in one plane are mated');

/* ---------------- document ---------------- */
const doc = createAssemblyDocument();
const pid = doc.newId('p');
const c1 = doc.newId('c');
doc.change('Place', function (d) {
    d.parts[pid] = { name: 'Plate', path: 'user:/Plate.aopart' };
    d.components.push({ id: c1, name: doc.newComponentName('Plate'), part: pid, matrix: G.identity(), grounded: true });
});
const c2 = doc.newId('c');
doc.change('Place', function (d) {
    d.components.push({ id: c2, name: doc.newComponentName('Plate'), part: pid, matrix: G.translation([50, 0, 0]) });
    d.constraints.push({ id: doc.newId('k'), name: doc.newConstraintName('mate', 'flush'), type: 'mate', solution: 'flush', a: { comp: c1 }, b: { comp: c2 } });
});
a(doc.components()[1].name === 'Plate:2' && doc.constraints()[0].name === 'Flush:1', 'occurrences and constraints get Inventor style names', [doc.components()[1].name, doc.constraints()[0].name]);
a(doc.partByPath('user:/Plate.aopart') === pid && doc.constraintsOf(c2).length === 1, 'parts are found by file, constraints by component');
doc.change('Delete', function (d) {
    doc.removeComponents(d, [c2]);
});
a(doc.components().length === 1 && doc.constraints().length === 0 && doc.part(pid), 'deleting a component takes its constraints, keeps a part still used');
doc.change('Delete', function (d) {
    doc.removeComponents(d, [c1]);
});
a(!doc.part(pid), 'a part no component uses is dropped');
doc.undo();
doc.undo();
a(doc.components().length === 2 && doc.constraints().length === 1, 'undo brings them back');
const saved = JSON.parse(doc.serialize());
a(validateAssembly(saved).components.length === 2, 'a saved assembly reads back');
let refused = false;
try {
    validateAssembly({ format: 'aopart', version: 1 });
} catch (e) {
    refused = true;
}
a(refused, 'a part file is not taken for an assembly');

console.log(failed ? failed + ' assembly checks FAILED' : 'assembly: all checks passed');
process.exitCode = failed ? 1 : 0;
