/*
    The live preview of Fillet and Chamfer picks out the faces the feature
    makes (freshFaces in kernel/occt.js). Run with: node tests/run.mjs preview
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as kernel from '../js/kernel/occt.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

// A 40 x 30 x 20 block from a sketch, as the app builds it
const pts = [[0, 0], [40, 0], [40, 30], [0, 30]];
const g = [];
pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
const doc = { features: [
    { id: 's', type: 'sketch', name: 'S', plane: { ref: 'origin:xy' }, geometry: g, constraints: [] },
    { id: 'e', type: 'extrude', name: 'E', sketch: 's', regions: [[20, 15]], operation: 'join', extent: { type: 'distance', value: 20, direction: 'positive' } }
] };
const rb = createRebuilder(oc);
const block = rb.rebuild(doc).bodies[0];
const state = rb.shapesBefore(doc, null);
const ref = e => ({ body: 0, mid: e.mid, length: e.length });

// What the preview gets: per face of the result, is it new?
function preview(type, edges, size) {
    const feature = { type: type, edges: edges.map(ref) };
    feature[type === 'fillet' ? 'radius' : 'distance'] = size;
    const report = { fresh: [] };
    const made = kernel[type](oc, state.bodies, feature, report);
    const described = kernel.describe(oc, made[0]);
    const flags = report.fresh[0];
    made[0].delete();
    return { faces: described.faces, flags: flags };
}

const topFront = block.edges.find(e => e.curve && e.curve.type === 'line' && near(e.mid[2], 20) && near(e.mid[1], 0));
const topBack = block.edges.find(e => e.curve && e.curve.type === 'line' && near(e.mid[2], 20) && near(e.mid[1], 30));
a(topFront && topBack, 'found the top front and back edges');

let p = preview('fillet', [topFront], 3);
a(p.flags.length === p.faces.length, 'one flag per face', [p.flags.length, p.faces.length]);
a(p.flags.filter(Boolean).length === 1, 'a fillet on one edge makes one new face', p.flags);
a(p.faces[p.flags.indexOf(true)].type === 'cylinder', 'the new face is the round', p.faces[p.flags.indexOf(true)].type);

p = preview('chamfer', [topFront, topBack], 2);
const fresh = p.faces.filter((f, i) => p.flags[i]);
a(fresh.length === 2, 'a chamfer on two edges makes two new faces', p.flags);
a(fresh.every(f => f.type === 'plane' && near(Math.abs(f.normal[1]), Math.SQRT1_2) && near(f.normal[2], Math.SQRT1_2)), 'the new faces are the 45 degree bevels', fresh.map(f => f.normal));
a(near(fresh[0].area, 40 * 2 * Math.SQRT2, 1e-6), 'a bevel is 40 long and 2 * sqrt(2) wide', fresh[0].area);

// The whole top outline: the rounds are new, the trimmed top and sides are not
const top = block.edges.filter(e => near(e.mid[2], 20));
p = preview('fillet', top, 2);
const old = p.faces.filter((f, i) => !p.flags[i]);
a(old.length === 6 && old.every(f => f.type === 'plane'), 'the six faces of the block are kept as old faces', old.map(f => f.type));
a(p.flags.filter(Boolean).length >= 4, 'the rounds of the outline are new', p.flags);

// The rebuild path does not ask for the report and is unchanged
const d2 = JSON.parse(JSON.stringify(doc));
d2.features.push({ id: 'f', type: 'fillet', name: 'F', edges: [ref(topFront)], radius: 3 });
const r = createRebuilder(oc).rebuild(d2);
a(r.features.f.status === 'ok' && r.bodies[0].faces.length === 7, 'the fillet still rebuilds', r.features.f);

console.log(failed ? failed + ' FAILED' : 'all preview face tests passed');
process.exitCode = failed ? 1 : 0;
