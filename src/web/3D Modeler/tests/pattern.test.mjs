/*
    Rectangular and circular patterns and mirror (kernel/occt.js placements,
    patternTools, pattern; rebuild.js sourcesOf).
    Run with: node tests/run.mjs pattern
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import { placements } from '../js/kernel/occt.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

function rect(id, x0, y0, w, h) {
    const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    return { id: id, type: 'sketch', name: id, plane: { ref: 'origin:xy' }, geometry: g, constraints: [] };
}

// A 100 x 60 x 10 plate, one 6 mm hole through it at (10, 10), and a
// 10 x 10 x 5 block on top at (70, 40)
function plate() {
    return { features: [
        rect('s1', 0, 0, 100, 60),
        { id: 'e1', type: 'extrude', name: 'E1', sketch: 's1', regions: [[50, 30]], operation: 'join', extent: { type: 'distance', value: 10, direction: 'positive' } },
        { id: 's2', type: 'sketch', name: 'S2', plane: { ref: 'face', frame: { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] } }, constraints: [],
            geometry: [{ id: 'h', type: 'point', x: 10, y: 10, standalone: true }] },
        { id: 'h1', type: 'hole', name: 'Hole1', sketch: 's2', kind: 'simple', diameter: 6, depth: 5, through: true },
        rect('s3', 70, 40, 10, 10),
        { id: 'e3', type: 'extrude', name: 'E3', sketch: 's3', regions: [[75, 45]], operation: 'join', extent: { type: 'distance', value: 15, direction: 'positive' } }
    ] };
}
const plateVolume = 100 * 60 * 10;
const hole = Math.PI * 9 * 10;
const block = 10 * 10 * 5; // the part of the block above the plate

/* ---- placements ---- */
a(placements({ type: 'pattern', kind: 'rect', dir1: [1, 0, 0], count1: 3, spacing1: 20 }).length === 2, 'three in a row is two copies');
a(placements({ type: 'pattern', kind: 'rect', dir1: [1, 0, 0], count1: 3, spacing1: 20, dir2: [0, 1, 0], count2: 2, spacing2: 15 }).length === 5, 'three by two is five copies');
const turns = placements({ type: 'pattern', kind: 'circ', axis: { o: [0, 0, 0], d: [0, 0, 1] }, count: 6, angle: 360 });
a(turns.length === 5 && near(turns[0].turn.angle, 60) && near(turns[4].turn.angle, 300), 'six round a full turn are 60 degrees apart', turns.map(t => t.turn.angle));
const fan = placements({ type: 'pattern', kind: 'circ', axis: { o: [0, 0, 0], d: [0, 0, 1] }, count: 3, angle: 90 });
a(near(fan[1].turn.angle, 90), 'three over 90 degrees end at 90', fan.map(t => t.turn.angle));
let refused = false;
try {
    placements({ type: 'pattern', kind: 'rect', dir1: [1, 0, 0], count1: 30, spacing1: 1, dir2: [0, 1, 0], count2: 30, spacing2: 1 });
} catch (err) {
    refused = /more than/.test(err.message);
}
a(refused, 'a typo of a thousand copies is refused');

/* ---- rectangular pattern of a hole ---- */
let doc = plate();
doc.features.push({ id: 'p', type: 'pattern', kind: 'rect', name: 'Pattern1', features: ['h1'], dir1: [1, 0, 0], count1: 3, spacing1: 20, dir2: [0, 1, 0], count2: 2, spacing2: 40 });
let out = createRebuilder(oc).rebuild(doc);
a(out.features.p.status === 'ok' && near(out.bodies[0].volume, plateVolume - 6 * hole + block, 0.5), 'a 3 x 2 pattern of a through hole makes six holes', [out.features.p, out.bodies[0].volume, plateVolume - 6 * hole + block]);

/* ---- circular pattern of the block about the plate centre ---- */
doc = plate();
doc.features.push({ id: 'p', type: 'pattern', kind: 'circ', name: 'Pattern1', features: ['e3'], axis: { o: [50, 30, 0], d: [0, 0, 1] }, count: 2, angle: 360 });
out = createRebuilder(oc).rebuild(doc);
a(out.features.p.status === 'ok' && near(out.bodies[0].volume, plateVolume - hole + 2 * block, 0.5), 'two blocks half a turn apart', [out.features.p, out.bodies[0].volume]);

/* ---- mirror of features and of the whole solid ---- */
doc = plate();
doc.features.push({ id: 'm', type: 'mirror', name: 'Mirror1', features: ['h1', 'e3'], plane: { o: [50, 0, 0], n: [1, 0, 0] } });
out = createRebuilder(oc).rebuild(doc);
a(out.features.m.status === 'ok' && near(out.bodies[0].volume, plateVolume - 2 * hole + 2 * block, 0.5), 'mirroring the hole and the block across the middle doubles both', [out.features.m, out.bodies[0].volume]);
doc = plate();
doc.features.push({ id: 'm', type: 'mirror', name: 'Mirror1', features: [], plane: { o: [100, 0, 0], n: [1, 0, 0] } });
out = createRebuilder(oc).rebuild(doc);
a(out.features.m.status === 'ok' && near(out.bodies[0].volume, 2 * (plateVolume - hole + block), 0.5), 'mirroring the whole solid across its end doubles it', [out.features.m, out.bodies[0].volume]);

/* ---- what cannot be repeated ---- */
doc = plate();
doc.features.push({ id: 'p', type: 'pattern', kind: 'rect', name: 'Pattern1', features: ['missing'], dir1: [1, 0, 0], count1: 2, spacing1: 20 });
out = createRebuilder(oc).rebuild(doc);
a(out.features.p.status === 'error', 'a pattern of a feature that is gone fails', out.features.p);
doc = plate();
doc.features.push({ id: 'f', type: 'fillet', name: 'Fillet1', edges: [], radius: 1 });
doc.features.push({ id: 'p', type: 'pattern', kind: 'rect', name: 'Pattern1', features: ['f'], dir1: [1, 0, 0], count1: 2, spacing1: 20 });
out = createRebuilder(oc).rebuild(doc);
a(out.features.p.status === 'error' && /cannot be repeated/.test(out.features.p.message), 'a fillet cannot be patterned, and says so', out.features.p);

console.log(failed ? failed + ' FAILED' : 'all pattern tests passed');
process.exitCode = failed ? 1 : 0;
