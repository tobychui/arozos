/*
    Watertight meshes, zero-thickness refusal and the Repair feature.

    The reported fault: extrusions sometimes came out as a "non-manifold"
    mesh - cracks along the rim of the caps, faces missing - and trying again
    sometimes worked. The caps of an extrusion are the sketch region faces,
    which kept the finer mesh made when the regions were worked out; the
    walls were meshed later at another fineness, so the two did not meet.

    Run with: node tests/run.mjs repair
*/

import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import * as H from '../js/kernel/heal.js';
import { triangulate } from '../js/kernel/earclip.js';
import { meshCheck, weld } from '../js/io/exchange.js';
import { sampleDocument } from '../js/document/sample.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

const rect = (x, y, w, h, n) => {
    const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const g = [];
    p.forEach((c, i) => g.push({ id: n + 'p' + i, type: 'point', x: c[0], y: c[1] }));
    p.forEach((c, i) => g.push({ id: n + 'l' + i, type: 'line', p1: n + 'p' + i, p2: n + 'p' + ((i + 1) % 4) }));
    return g;
};
const circle = (x, y, r, n) => [{ id: n + 'c', type: 'point', x: x, y: y }, { id: n + 'k', type: 'circle', c: n + 'c', r: r }];
const sketch = (id, plane, geometry) => ({ id: id, type: 'sketch', name: id, plane: { ref: plane }, geometry: geometry, constraints: [] });
const extrude = (id, sk, at, value, operation, more) => Object.assign({ id: id, type: 'extrude', name: id, sketch: sk, regions: [at], operation: operation || 'join',
    extent: { type: 'distance', value: value, direction: 'positive' } }, more || {});
const watertight = (body, what) => {
    const m = meshCheck(body);
    a(m.watertight, what + ': welded mesh is watertight', m);
    a(body.health && !body.health.open && !body.health.multiple && !body.health.empty, what + ': description health is clean', body.health);
};

// ---- the reported fault: caps meshed at another fineness than the walls ----
const disc = sketch('s', 'origin:xy', circle(10, 10, 8, 'a'));
let tool = K.extrudeTool(oc, [], { regions: [[10, 10]], extent: { type: 'distance', value: 20 } }, disc);
watertight(K.describe(oc, tool), 'a cylinder straight from its sketch');
tool.delete();

const slotted = { format: 'aopart', version: 1, features: [
    sketch('s1', 'origin:xy', rect(0, 0, 60, 40, 'a')),
    extrude('e1', 's1', [5, 5], 10),
    sketch('s2', 'origin:xy', circle(30, 20, 9, 'b')),
    extrude('e2', 's2', [30, 20], 25),
    sketch('s3', 'origin:xz', circle(30, 15, 4, 'c')),
    extrude('e3', 's3', [30, 15], 60, 'cut', { extent: { type: 'distance', value: 30, direction: 'symmetric' } })
] };
const rb = createRebuilder(oc);
let r = rb.rebuild(slotted);
a(Object.values(r.features).every(f => f.status === 'ok'), 'plate, boss and cross hole build', r.features);
watertight(r.bodies[0], 'plate with boss and cross hole');

// An export meshes the solids finer; the next feature must still meet them
rb.bodies().forEach(shape => K.describe(oc, shape, 0.02, 0.1));
slotted.features.push(sketch('s4', 'origin:xy', rect(45, 5, 10, 10, 'd')), extrude('e4', 's4', [50, 10], 18));
r = rb.rebuild(slotted);
watertight(r.bodies[0], 'a feature added after an export at another fineness');

// Tapered cut whose circle touches the edge of the face it starts on (the
// first screenshot: a hood over a slab, a tapered cut into its end)
const hood = { format: 'aopart', version: 1, features: [
    sketch('s1', 'origin:xy', rect(0, 0, 120, 60, 'a')),
    extrude('e1', 's1', [5, 5], 10),
    { id: 's2', type: 'sketch', name: 's2', plane: { ref: 'origin:yz' }, constraints: [], geometry: [
        { id: 'p0', type: 'point', x: 0, y: 10 }, { id: 'p1', type: 'point', x: 0, y: 40 }, { id: 'p2', type: 'point', x: 35, y: 40 },
        { id: 'c', type: 'point', x: 35, y: 22 },
        { id: 'p3', type: 'point', x: 35 + 18 * Math.cos(Math.PI / 9), y: 22 + 18 * Math.sin(Math.PI / 9) }, { id: 'p4', type: 'point', x: 60, y: 10 },
        { id: 'l0', type: 'line', p1: 'p0', p2: 'p1' }, { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
        { id: 'ar', type: 'arc', c: 'c', start: 'p3', end: 'p2' }, { id: 'l2', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'l3', type: 'line', p1: 'p4', p2: 'p0' }
    ] },
    extrude('e2', 's2', [10, 20], 120),
    sketch('s3', 'origin:yz', circle(25, 22, 12, 'k')),
    extrude('e3', 's3', [25, 22], 100, 'cut', { extent: { type: 'distance', value: 100, direction: 'positive', taper: 5 } })
] };
r = createRebuilder(oc).rebuild(hood);
a(Object.values(r.features).every(f => f.status === 'ok'), 'hood with a tapered cut builds', r.features);
watertight(r.bodies[0], 'hood with a tapered cut');

// The sample part, every feature
r = createRebuilder(oc).rebuild(sampleDocument());
watertight(r.bodies[0], 'the sample part');

// ---- booleans leave their inputs alone ----
const maxTol = shape => oc.BRep_Tool.MaxTolerance(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);
const boxA = K.extrudeTool(oc, [], { regions: [[5, 5]], extent: { type: 'distance', value: 10 } }, sketch('x', 'origin:xy', rect(0, 0, 10, 10, 'a')));
const boxB = K.extrudeTool(oc, [], { regions: [[15, 5]], extent: { type: 'distance', value: 10 } }, sketch('y', 'origin:xy', rect(10.00003, 0, 10, 10, 'b')));
const before = maxTol(boxA);
const fused = H.safeBoolean(oc, 'join', boxA, boxB);
a(maxTol(boxA) === before, 'a join does not change the tolerances of its input', [before, maxTol(boxA)]);
a(H.checkShape(oc, fused).open.length === 0, 'a join across a hair-wide gap is closed');

// ---- zero thickness is refused ----
const touching = (geometry, at, what) => {
    const doc = { format: 'aopart', version: 1, features: [
        sketch('s1', 'origin:xy', circle(25, 20, 15, 'a')),
        extrude('e1', 's1', [25, 20], 40),
        sketch('s2', 'origin:xy', geometry),
        extrude('e2', 's2', at, 40)
    ] };
    const out = createRebuilder(oc).rebuild(doc);
    a(out.features.e2.status === 'error' && /zero thickness/.test(out.features.e2.message), what + ' is refused', out.features.e2);
    a(out.bodies.length === 1 && meshCheck(out.bodies[0]).watertight, what + ': the model stays as it was before', out.bodies.length);
};
touching(rect(-10, 0, 20, 40, 'b'), [0, 20], 'a block touching the cylinder along a line');
touching(rect(25, 35, 20, 10, 'b'), [35, 40], 'a block touching the cylinder top tangent line');

const corners = { format: 'aopart', version: 1, features: [
    sketch('s1', 'origin:xy', rect(0, 0, 10, 10, 'a').concat(rect(10, 10, 10, 10, 'b'))),
    extrude('e1', 's1', [5, 5], 10, 'join', { regions: [[5, 5], [15, 15]] })
] };
r = createRebuilder(oc).rebuild(corners);
a(r.features.e1.status === 'error' && /zero thickness/.test(r.features.e1.message), 'two profiles meeting at a corner are refused', r.features.e1);

// an overlap is fine
const overlap = { format: 'aopart', version: 1, features: [
    sketch('s1', 'origin:xy', circle(25, 20, 15, 'a')),
    extrude('e1', 's1', [25, 20], 40),
    sketch('s2', 'origin:xy', rect(-10, 0, 21, 40, 'b')),
    extrude('e2', 's2', [0, 20], 40)
] };
r = createRebuilder(oc).rebuild(overlap);
a(r.features.e2.status === 'ok', 'a block that overlaps the cylinder joins', r.features.e2);
watertight(r.bodies[0], 'block overlapping a cylinder');

// ---- the fallback mesh of a face meets its neighbours ----
const plate = createRebuilder(oc);
plate.rebuild(sampleDocument());
const body = plate.bodies()[0];
const whole = K.describe(oc, body);
const topIndex = whole.faces.findIndex(f => f.type === 'plane' && near(f.normal[2], 1) && near(f.origin[2], 12));
let faceIndex = 0;
let topFace = null;
const fx = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_FACE);
for (; fx.More(); fx.Next()) {
    if (faceIndex++ === topIndex) {
        topFace = oc.TopoDS.Face(fx.Current());
    }
}
const patch = H.fallbackTriangles(oc, body, topFace, 0.1);
a(patch && patch.tris.length > 0, 'the fallback triangulates the plate top (holes and rounded corners)');
let patchArea = 0;
for (let i = 0; i < patch.tris.length; i += 3) {
    const p = k => patch.points.slice(patch.tris[i + k] * 3, patch.tris[i + k] * 3 + 3);
    const u = p(1).map((v, j) => v - p(0)[j]);
    const w = p(2).map((v, j) => v - p(0)[j]);
    patchArea += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    a((u[0] * w[1] - u[1] * w[0]) > -1e-9, 'fallback triangles face up on the top face');
}
a(near(patchArea, whole.faces[topIndex].area, whole.faces[topIndex].area * 0.01), 'fallback covers the face', [patchArea, whole.faces[topIndex].area]);
// swap the top face's own triangles for the fallback ones: still watertight
const positions = Array.from(whole.positions);
const indices = [];
for (let i = 0; i < whole.indices.length; i++) {
    const f = whole.faces[topIndex];
    if (i >= f.start && i < f.start + f.count) {
        continue;
    }
    indices.push(whole.indices[i]);
}
const base = positions.length / 3;
positions.push(...patch.points);
patch.tris.forEach(t => indices.push(t + base));
a(meshCheck({ positions: new Float32Array(positions), indices: new Uint32Array(indices) }).watertight, 'the patched face meets its neighbours without cracks');

// ---- ear clipping ----
const sq = triangulate([[0, 0], [10, 0], [10, 10], [0, 10]], [[[3, 3], [3, 7], [7, 7], [7, 3]]]);
const area2 = t => {
    let s = 0;
    for (let i = 0; i < t.tris.length; i += 3) {
        const [p, q, w] = [t.points[t.tris[i]], t.points[t.tris[i + 1]], t.points[t.tris[i + 2]]];
        s += ((q[0] - p[0]) * (w[1] - p[1]) - (w[0] - p[0]) * (q[1] - p[1])) / 2;
    }
    return s;
};
a(near(area2(sq), 84), 'square with a square hole', area2(sq));
const ell = triangulate([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], []);
a(near(area2(ell), 64) && ell.tris.length === 12, 'an L shape: 4 triangles of positive area', [area2(ell), ell.tris.length]);
const holes = triangulate([[0, 0], [20, 0], [20, 10], [0, 10]].reverse(), [[[2, 2], [5, 2], [5, 5], [2, 5]], [[12, 3], [16, 3], [16, 7], [12, 7]]]);
a(near(area2(holes), 200 - 9 - 16), 'clockwise outline with two holes', area2(holes));

// ---- weld: copies of a corner on both sides of a cell wall ----
const w = weld({ positions: new Float32Array([0.00009999, 0, 0, 0.0001, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 2, 3, 1, 3, 2]) });
a(w.positions.length === 9, 'two copies of a point a hair apart across a cell wall merge', w.positions.length);

// ---- repair ----
// A box handed over as six loose faces (as a broken STEP file would be)
const box = K.extrudeTool(oc, [], { regions: [[5, 5]], extent: { type: 'distance', value: 10 } }, sketch('z', 'origin:xy', rect(0, 0, 10, 10, 'q')));
const builder = new oc.TopoDS_Builder();
const loose = new oc.TopoDS_Compound();
builder.MakeCompound(loose);
const ex = new oc.TopExp_Explorer(box, oc.TopAbs_ShapeEnum.TopAbs_FACE);
for (; ex.More(); ex.Next()) {
    const trsf = new oc.gp_Trsf();
    const copy = new oc.BRepBuilderAPI_Transform(ex.Current(), trsf, true, false);
    builder.Add(loose, copy.Shape());
}
const looseCheck = H.checkShape(oc, loose);
a(looseCheck.open.length === 24 && looseCheck.solids === 0, 'six loose faces: all 24 edges open, no solid', looseCheck);
const healed = H.heal(oc, loose, 1e-3);
a(healed.changed && healed.after.solids === 1 && healed.after.open.length === 0 && healed.after.valid, 'repair sews the faces into a closed solid', healed.after);
a(near(K.volume(oc, healed.shape), 1000, 1e-3), 'repaired box holds 1000 mm3', K.volume(oc, healed.shape));
watertight(K.describe(oc, healed.shape), 'repaired box');

// A hair-wide gap between two faces
const gap = H.heal(oc, loose, 1e-6);
a(gap.after.open.length === 0, 'a tiny tolerance still sews faces that share their edges exactly', gap.after.open.length);

// A sound solid is left as it is
const fine = H.heal(oc, box, 1e-3);
a(!fine.changed && fine.notes.length === 0, 'repair leaves a sound solid alone', fine.notes);

// The Repair feature in a part
const withRepair = sampleDocument();
withRepair.features.push({ id: 'r1', type: 'repair', name: 'Repair1', tolerance: 0.001 });
r = createRebuilder(oc).rebuild(withRepair);
a(r.features.r1.status === 'ok' && /nothing to repair/.test(r.features.r1.note || ''), 'Repair on the sample part reports nothing to do', r.features.r1);
a(near(r.bodies[0].volume, 52971.9, 1), 'and keeps its volume', r.bodies[0].volume);
const noBody = { format: 'aopart', version: 1, features: [{ id: 'r1', type: 'repair', name: 'Repair1' }] };
r = createRebuilder(oc).rebuild(noBody);
a(r.features.r1.status === 'error', 'Repair with no solid is reported', r.features.r1);

// A STEP file whose box was never sewn (only loose faces) is sewn on import
const imported = K.importSTEP(oc, K.toSTEP(oc, loose));
a(imported.length === 1 && H.checkShape(oc, imported[0]).open.length === 0 && near(K.volume(oc, imported[0]), 1000, 1e-3), 'loose faces in a STEP file import as a closed solid', imported.length);

// checkBodies for Inspect > Check Geometry
const checks = K.checkBodies(oc, [box, loose]);
a(checks[0].valid && checks[0].solids === 1 && !checks[0].open.length && !checks[0].multiple.length, 'check: the box is sound', checks[0]);
a(checks[1].open.length === 24, 'check: the loose faces are open', checks[1].open.length);

console.log(failed ? failed + ' checks failed' : 'repair: all checks passed');
process.exitCode = failed ? 1 : 0;
