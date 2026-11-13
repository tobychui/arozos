/*
    Tangent chains (edgeChains in kernel/occt.js): the edges a fillet or
    chamfer takes along from one picked edge, which the pick highlights.
    Run with: node tests/run.mjs chains
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as kernel from '../js/kernel/occt.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

// A 40 x 30 x 60 block with its four vertical edges rounded (r 5)
const pts = [[0, 0], [40, 0], [40, 30], [0, 30]];
const g = [];
pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
const doc = { features: [
    { id: 's', type: 'sketch', name: 'S', plane: { ref: 'origin:xy' }, geometry: g, constraints: [] },
    { id: 'e', type: 'extrude', name: 'E', sketch: 's', regions: [[20, 15]], operation: 'join', extent: { type: 'distance', value: 60, direction: 'positive' } }
] };
const ref = e => ({ body: 0, mid: e.mid, length: e.length });

// Before the corners are rounded every edge stands alone
let rb = createRebuilder(oc);
let out = rb.rebuild(doc);
let chains = kernel.edgeChains(oc, rb.shapesBefore(doc, null).bodies[0], out.bodies[0].edges);
a(chains.length === out.bodies[0].edges.length, 'one chain number per edge');
a(new Set(chains).size === chains.length, 'a sharp block has no chains: twelve edges on their own', chains);

const verticals = out.bodies[0].edges.filter(e => near(e.length, 60));
doc.features.push({ id: 'f', type: 'fillet', name: 'F', edges: verticals.map(ref), radius: 5 });
rb = createRebuilder(oc);
out = rb.rebuild(doc);
const body = out.bodies[0];
const shape = rb.shapesBefore(doc, null).bodies[0];
chains = kernel.edgeChains(oc, shape, body.edges);

const top = body.edges.map((e, i) => i).filter(i => near(body.edges[i].mid[2], 60));
const bottom = body.edges.map((e, i) => i).filter(i => near(body.edges[i].mid[2], 0));
a(top.length === 8 && bottom.length === 8, 'four lines and four arcs round the top and the bottom', [top.length, bottom.length]);
a(top.every(i => chains[i] === chains[top[0]]), 'the top outline is one chain', top.map(i => chains[i]));
a(bottom.every(i => chains[i] === chains[bottom[0]]), 'the bottom outline is one chain', bottom.map(i => chains[i]));
a(chains[top[0]] !== chains[bottom[0]], 'top and bottom are different chains');
const seams = body.edges.map((e, i) => i).filter(i => near(body.edges[i].length, 60));
a(seams.every(i => chains.filter(c => c === chains[i]).length === 1), 'the seams between flat and round faces stand alone', seams.map(i => chains[i]));

// What the highlight promises is what the feature builds: chamfering one
// straight top edge cuts the whole top outline
const one = body.edges[top.find(i => body.edges[i].curve && body.edges[i].curve.type === 'line')];
const report = { fresh: [] };
const made = kernel.chamfer(oc, [shape], { edges: [ref(one)], distance: 1 }, report);
a(report.fresh[0].filter(Boolean).length === 8, 'a chamfer on one edge of the chain bevels all eight', report.fresh[0].filter(Boolean).length);
made[0].delete();

console.log(failed ? failed + ' FAILED' : 'all chain tests passed');
process.exitCode = failed ? 1 : 0;
