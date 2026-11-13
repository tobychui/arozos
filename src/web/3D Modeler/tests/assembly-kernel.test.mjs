/*
    Assemblies in the kernel (js/kernel/assembly.js): placed copies of part
    solids, exact distances, interference, export and mass.
    Run with: node tests/run.mjs assembly-kernel
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import * as A from '../js/kernel/assembly.js';
import * as G from '../js/assembly/geometry.js';
import { solve, freedom, unsatisfied } from '../js/assembly/solver.js';
import { sampleAssembly } from '../js/document/sampleasm.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

// A w x d box h high, built as a part document
function box(w, d, h) {
    const pts = [[0, 0], [w, 0], [w, d], [0, d]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    return { features: [
        { id: 's', type: 'sketch', name: 'S', plane: { ref: 'origin:xy' }, geometry: g, constraints: [] },
        { id: 'e', type: 'extrude', name: 'E', sketch: 's', regions: [[w / 2, d / 2]], operation: 'join', extent: { type: 'distance', value: h, direction: 'positive' } }
    ] };
}

const plate = createRebuilder(oc);
plate.rebuild(box(40, 30, 10));
const block = createRebuilder(oc);
const blockDesc = block.rebuild(box(20, 20, 20));

// The block 10 mm above the plate, turned a quarter turn and doubled
const lifted = G.multiply(G.translation([0, 0, 20]), G.compose([0, 0, 0], [0, 0, 90], 1));
const comps = [
    { id: 'plate', shapes: plate.bodies(), matrix: G.identity() },
    { id: 'block', shapes: block.bodies(), matrix: lifted }
];
const bottom = blockDesc.bodies[0].faces.findIndex(f => f.type === 'plane' && near(f.normal[2], -1));
const d = A.distance(oc, { shapes: comps[0].shapes, matrix: comps[0].matrix, item: { type: 'component' } },
    { shapes: comps[1].shapes, matrix: lifted, item: { type: 'face', body: 0, index: bottom } });
a(near(d.distance, 10) && near(d.p1[2], 10) && near(d.p2[2], 20), 'distance from the plate to the block bottom, with the closest points', d);

a(A.interference(oc, comps).length === 0, 'apart, nothing interferes');
// Lowered 4 mm into the plate: a 4 mm slab overlaps where they meet
comps[1].matrix = G.multiply(G.translation([0, 0, -14]), lifted);
let found = A.interference(oc, comps);
// The turned block covers x -20..0: only x 0 touches the plate, so move it in
comps[1].matrix = G.multiply(G.translation([30, 5, -14]), lifted);
found = A.interference(oc, comps);
a(found.length === 1 && near(found[0].volume, 20 * 20 * 4, 0.01) && found[0].mesh.indices.length > 0, 'a block sunk 4 mm into the plate overlaps 1600 mm3', found.map(f => f.volume));

// Touching faces (as a Mate leaves them) are not an interference
comps[1].matrix = G.multiply(G.translation([30, 5, -10]), lifted);
a(A.interference(oc, comps).length === 0, 'faces that only touch do not interfere');

// Scaled components keep a true volume
comps[1].matrix = G.multiply(G.translation([100, 0, 0]), G.compose([0, 0, 0], [0, 0, 0], 2));
const m = A.mass(oc, comps);
a(near(m.volume, 40 * 30 * 10 + 20 * 20 * 20 * 8, 0.1), 'mass of the assembly counts the doubled block eight times', m.volume);

// Export: both solids, where they are, read back
const text = A.exportText(oc, comps, 'step');
const solids = K.importSTEP(oc, text);
a(solids.length === 2, 'the STEP of the assembly holds both solids', solids.length);
const boxes = solids.map(s => {
    const b = new oc.Bnd_Box();
    oc.BRepBndLib.Add(s, b, false);
    const out = [b.GetXMin(), b.GetXMax()];
    b.delete();
    return out;
}).sort((p, q) => p[0] - q[0]);
a(near(boxes[1][0], 100, 0.01) && near(boxes[1][1], 140, 0.01), 'the exported block is where it was placed, at twice the size', boxes);

const meshes = A.mesh(oc, comps, 0.1, 0.3);
a(meshes.length === 2 && meshes[1].positions.length > 0, 'every component is meshed for STL');

/* ---------------- the sample assembly ---------------- */
const sample = sampleAssembly();
const built = {};
Object.keys(sample.parts).forEach(function (pid) {
    const rb = createRebuilder(oc);
    built[pid] = rb.rebuild(sample.parts[pid].data);
    a(built[pid].bodies.length === 1, 'sample part ' + sample.parts[pid].name + ' builds one solid', Object.values(built[pid].features));
});
const partOf = {};
sample.components.forEach(c => { partOf[c.id] = c.part; });
let matched = 0;
sample.constraints.forEach(function (c) {
    [c.a, c.b].forEach(function (e) {
        const found = G.matchEntity(e, built[partOf[e.comp]].bodies[0]);
        // A face's centre moves with its holes: a plane only has to be the same plane
        const same = found && (e.kind === 'plane' ? Math.abs(G.dot(G.sub(found.entity.o, e.o), e.n)) < 1e-3 && G.dot(found.entity.n, e.n) > 0.9999
            : G.length(G.sub(found.entity.o, e.o)) < 1e-3 && (found.entity.r === undefined || Math.abs(found.entity.r - e.r) < 1e-6));
        if (same) {
            matched++;
            Object.assign(e, found.entity);
            e.pick.index = found.index;
        } else {
            a(false, 'sample entity ' + c.name + ' ' + e.kind + ' is found on its part', found && found.entity);
        }
    });
});
a(matched === sample.constraints.length * 2, 'every entity of the sample is found by its geometry', matched);
const pivots = {};
Object.keys(built).forEach(pid => {
    const box = G.boundsOf(built[pid].bodies);
    pivots[pid] = G.scale(G.add(box[0], box[1]), 0.5);
});
const comps2 = sample.components.map(c => ({ id: c.id, matrix: c.matrix, grounded: !!c.grounded, pivot: pivots[c.part] }));
a(Object.keys(unsatisfied(comps2, sample.constraints)).length === 0, 'the sample is saved already solved', unsatisfied(comps2, sample.constraints));
const dofs = freedom(comps2, sample.constraints);
a(dofs.c1 === 0 && dofs.c2 === 1 && dofs.c3 === 1 && dofs.c4 === 0, 'pins can turn, the block is fully held', dofs);

// A pin standing upright, to go into a hole from above, has to be turned
// over: the solver gets past the saddle where it starts
const upright = comps2.map(c => Object.assign({}, c));
upright[1].matrix = G.translation([20, 32, 30]);
const solvedPins = solve(upright, sample.constraints);
a(solvedPins.ok, 'an upright pin is turned over into its hole', solvedPins.errors);
const rimNow = G.entityToWorld(sample.constraints[0].b, solvedPins.matrices.c2);
a(G.length(G.sub(rimNow.o, [20, 32, 8])) < 1e-3 && rimNow.d[2] < -0.999, 'its head rests on the plate', rimNow);

// No interference in the sample: the pins fit their holes exactly
const placed = sample.components.map(c => {
    const rb = createRebuilder(oc);
    rb.rebuild(sample.parts[c.part].data);
    return { id: c.id, shapes: rb.bodies(), matrix: c.matrix };
});
a(A.interference(oc, placed).length === 0, 'pins of the same diameter as their holes do not interfere');

console.log(failed ? failed + ' assembly kernel checks FAILED' : 'assembly-kernel: all checks passed');
process.exitCode = failed ? 1 : 0;
