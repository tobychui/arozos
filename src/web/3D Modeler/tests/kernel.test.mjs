import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import { sampleDocument } from '../js/document/sample.js';
const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);
const doc = sampleDocument();
// regions of the sample sketches
const r1 = K.sketchRegions(oc, doc.features[0]);
a(r1.length === 2, 'plate sketch has 2 regions', r1.map(r => r.area));
const areas = r1.map(r => +r.area.toFixed(1)).sort((x, y) => x - y);
a(near(areas[0], Math.PI * 36, 0.5) && near(areas[1], 3945.06 - Math.PI * 36, 1), 'region areas', areas);
a(r1.every(r => K.inRegion(r, r.sample)), 'sample point inside its region');
const r3 = K.sketchRegions(oc, doc.features[2]);
a(r3.length === 2 && near(r3.map(r => r.area).sort((x, y) => x - y)[1], Math.PI * (196 - 49), 1), 'annulus + disc', r3.map(r => r.area));
// crossing rectangles: 3 regions; T junction
const rect = (x, y, w, h, n) => { const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; const g = []; p.forEach((c, i) => g.push({ id: n + 'p' + i, type: 'point', x: c[0], y: c[1] })); p.forEach((c, i) => g.push({ id: n + 'l' + i, type: 'line', p1: n + 'p' + i, p2: n + 'p' + ((i + 1) % 4) })); return g; };
const cross = { type: 'sketch', plane: { ref: 'origin:xy' }, geometry: rect(0, 0, 20, 20, 'a').concat(rect(10, 10, 20, 20, 'b')) };
const rc = K.sketchRegions(oc, cross);
a(rc.length === 3 && near(rc.reduce((s, r) => s + r.area, 0), 700, 0.5), 'overlapping rectangles give 3 regions', rc.map(r => r.area));
const tee = { type: 'sketch', plane: { ref: 'origin:xz' }, geometry: rect(0, 0, 20, 10, 'a').concat([{ id: 'q1', type: 'point', x: 8, y: 0 }, { id: 'q2', type: 'point', x: 8, y: 10 }, { id: 'ql', type: 'line', p1: 'q1', p2: 'q2' }, { id: 'o1', type: 'point', x: 50, y: 50 }, { id: 'o2', type: 'point', x: 60, y: 50 }, { id: 'ol', type: 'line', p1: 'o1', p2: 'o2' }]) };
const rt = K.sketchRegions(oc, tee);
a(rt.length === 2 && near(rt.map(r => r.area).sort((x, y) => x - y)[0], 80, 0.5), 'T junction splits, open line ignored', rt.map(r => r.area));
a(K.sketchRegions(oc, { plane: { ref: 'origin:xy' }, geometry: [] }).length === 0, 'empty sketch');
// rebuild sample with point regions
const rb = createRebuilder(oc);
let r = rb.rebuild(doc);
a(Object.values(r.features).every(s => s.status === 'ok'), 'sample builds', r.features);
a(near(r.bodies[0].volume, 52971.9, 1), 'sample volume unchanged', r.bodies[0].volume);
const b = r.bodies[0];
a(b.faces.every(f => Array.isArray(f.edges) && f.edges.length > 0), 'faces list their edges');
const top = b.faces.find(f => f.type === 'plane' && near(f.normal[2], 1) && near(f.origin[2], 12));
const kinds = top.edges.map(i => b.edges[i].curve ? b.edges[i].curve.type + (b.edges[i].curve.closed ? '*' : '') : 'other').sort().join(',');
a(kinds === 'circle,circle,circle,circle,circle*,circle*,line,line,line,line', 'top face edges: 4 lines, 4 arcs, 2 full circles', kinds);
const hole = top.edges.map(i => b.edges[i].curve).find(c => c.type === 'circle' && c.closed && near(c.r, 6));
a(hole && near(hole.c[0], 20) && near(hole.c[1], 25) && near(hole.c[2], 12) && near(Math.abs(hole.n[2]), 1), 'hole rim circle', hole);
// extents
const base = sampleDocument(); base.features = base.features.slice(0, 2);
const vol = d => { const rr = createRebuilder(oc).rebuild(d); return { v: rr.bodies[0] ? rr.bodies[0].volume : 0, s: rr.features }; };
const A = 3945.06 - Math.PI * 36;
base.features[1].extent = { type: 'distance', value: 10, direction: 'symmetric' };
a(near(vol(base).v, A * 10, 2), 'symmetric volume', vol(base).v);
base.features[1].extent = { type: 'distance', value: 10, value2: 4, direction: 'asymmetric' };
let rr = createRebuilder(oc).rebuild(base);
a(near(rr.bodies[0].volume, A * 14, 2), 'asymmetric volume', rr.bodies[0].volume);
const zs = []; for (let i = 2; i < rr.bodies[0].positions.length; i += 3) zs.push(rr.bodies[0].positions[i]);
a(near(Math.min(...zs), -4) && near(Math.max(...zs), 10), 'asymmetric spans -4..10', [Math.min(...zs), Math.max(...zs)]);
// through-all cut from a face sketch
const d2 = sampleDocument(); d2.features = d2.features.slice(0, 2);
d2.features.push({ id: 's', type: 'sketch', name: 'S', plane: { ref: 'face', frame: { o: [0, 0, 12], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] } }, geometry: [{ id: 'p', type: 'point', x: 60, y: 25 }, { id: 'k', type: 'circle', c: 'p', r: 5 }] });
d2.features.push({ id: 'e', type: 'extrude', name: 'E', sketch: 's', regions: [[60, 25]], operation: 'cut', extent: { type: 'all', direction: 'negative' } });
rr = createRebuilder(oc).rebuild(d2);
a(rr.features.e.status === 'ok' && near(rr.bodies[0].volume, (A - Math.PI * 25) * 12, 2), 'through all cut', [rr.features, rr.bodies[0].volume]);
d2.features[3].regions = [[200, 200]];
rr = createRebuilder(oc).rebuild(d2);
a(rr.features.e.status === 'error' && /no longer exists/.test(rr.features.e.message), 'lost profile is reported', rr.features.e);
// preview tool
const tool = K.extrudeTool(oc, [], { regions: [[40, 10]], extent: { type: 'distance', value: 5, direction: 'positive' } }, doc.features[0]);
a(near(K.volume(oc, tool), A * 5, 1), 'tool volume');
console.log(failed ? failed + ' FAILED' : 'all kernel M3 tests passed');
process.exitCode = failed ? 1 : 0;
