/*
    Sweep, Loft and Draft (PROPOSAL.md 14.14, built in 14.28).
    Run with: node tests/run.mjs a13
*/

import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import { meshCheck } from '../js/io/exchange.js';
import { usesOf, sketchesOf, createDocument } from '../js/document/document.js';
import { connectedCurves } from '../js/sketch/chain.js';
import { curves as sketchCurves } from '../js/sketch/model.js';

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
const sketch = (id, plane, geometry) => ({ id: id, type: 'sketch', name: id, plane: plane, geometry: geometry, constraints: [] });
const build = features => createRebuilder(oc).rebuild({ format: 'aopart', version: 1, features: features });

// ---- path chains ----
// An L shaped path on the XZ plane: up 30, then a quarter arc of radius 20
// over to the side (centre at (20, 30))
const pathGeometry = [
    { id: 'a', type: 'point', x: 0, y: 0 }, { id: 'b', type: 'point', x: 0, y: 30 },
    { id: 'c', type: 'point', x: 20, y: 30 }, { id: 'd', type: 'point', x: 20, y: 50 },
    { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
    { id: 'ar', type: 'arc', c: 'c', start: 'd', end: 'b' },
    { id: 'm1', type: 'point', x: 50, y: 50 }, { id: 'm2', type: 'point', x: 60, y: 60 },
    { id: 'cl', type: 'line', p1: 'm1', p2: 'm2', construction: true }
];
const chain = K.chainCurves({ geometry: pathGeometry }, ['ar', 'l1']);
a(chain.length === 2 && ((chain[0].id === 'l1' && !chain[0].reversed && chain[1].reversed) || (chain[0].id === 'ar' && !chain[0].reversed && chain[1].reversed)),
    'a chain starts at a free end and runs each curve its way, whatever order they were picked in', chain);
const back = K.reverseChain(chain);
a(back[0].id === chain[1].id && back[0].reversed === !chain[1].reversed, 'a chain run the other way', back);
a(K.chainCurves({ geometry: pathGeometry }).length === 2, 'no ids: every curve that is not construction');
let threw = null;
try {
    K.chainCurves({ geometry: pathGeometry }, ['l1', 'cl']);
} catch (err) {
    threw = err.message;
}
a(/end to end/.test(threw || ''), 'curves with a gap between them are refused', threw);

const pathList = sketchCurves({ geometry: pathGeometry, constraints: [] });
a(JSON.stringify(connectedCurves(pathList, 'ar').sort()) === '["ar","l1"]', 'a click on one path curve takes the curves joined to it', connectedCurves(pathList, 'ar'));
a(JSON.stringify(connectedCurves(pathList, 'cl')) === '["cl"]', 'a curve on its own comes alone');

// ---- sweep ----
// A disc of radius 2 on the XY plane swept up the path: a bent tube.
// Volume = area x path length (the profile's centre runs along the path)
const disc = sketch('s1', { ref: 'origin:xy' }, circle(0, 0, 2, 'q'));
const path = sketch('s2', { ref: 'origin:xz' }, pathGeometry);
let r = build([disc, path, { id: 'f1', type: 'sweep', name: 'Sweep1', sketch: 's1', regions: [[0, 0]], path: { sketch: 's2', curves: ['ar', 'l1'] }, operation: 'join' }]);
const tubeLength = 30 + Math.PI * 20 / 2;
a(r.features.f1.status === 'ok', 'sweep builds', r.features.f1);
a(r.bodies.length === 1 && near(r.bodies[0].volume, Math.PI * 4 * tubeLength, 0.5), 'swept tube volume = area x path length', r.bodies[0] && r.bodies[0].volume);
a(r.bodies[0] && meshCheck(r.bodies[0]).watertight, 'the swept tube meshes watertight');
// the whole sketch as the path (construction left out) gives the same
r = build([disc, path, { id: 'f1', type: 'sweep', name: 'Sweep1', sketch: 's1', regions: [[0, 0]], path: { sketch: 's2' }, operation: 'join' }]);
a(r.features.f1.status === 'ok' && near(r.bodies[0].volume, Math.PI * 4 * tubeLength, 0.5), 'the whole path sketch', r.features.f1);
// a cut: a groove swept through a block
const block = sketch('s0', { ref: 'origin:xy' }, rect(-10, -10, 20, 20, 'b'));
r = build([block, { id: 'e0', type: 'extrude', name: 'E0', sketch: 's0', regions: [[5, 5]], operation: 'join', extent: { type: 'distance', value: 40, direction: 'positive' } },
    disc, path, { id: 'f1', type: 'sweep', name: 'Sweep1', sketch: 's1', regions: [[0, 0]], path: { sketch: 's2', curves: ['l1'] }, operation: 'cut' }]);
a(r.features.f1.status === 'ok' && near(r.bodies[0].volume, 20 * 20 * 40 - Math.PI * 4 * 30, 0.5), 'a straight sweep cut removes a cylinder', [r.features.f1, r.bodies[0] && r.bodies[0].volume]);
// a path that bends tighter than the profile
const fat = sketch('s1', { ref: 'origin:xy' }, circle(0, 0, 25, 'q'));
r = build([fat, path, { id: 'f1', type: 'sweep', name: 'Sweep1', sketch: 's1', regions: [[0, 0]], path: { sketch: 's2' }, operation: 'join' }]);
a(r.features.f1.status === 'error' && /bends tighter/.test(r.features.f1.message), 'a profile wider than the bend is refused', r.features.f1);
// the tube starts where the profile is: its bounding box reaches z 0 and x 20 + 2
const zs = [];
const xs = [];
r = build([disc, path, { id: 'f1', type: 'sweep', name: 'Sweep1', sketch: 's1', regions: [[0, 0]], path: { sketch: 's2', curves: ['ar', 'l1'] }, operation: 'join' }]);
for (let i = 0; i < r.bodies[0].positions.length; i += 3) {
    xs.push(r.bodies[0].positions[i]);
    zs.push(r.bodies[0].positions[i + 2]);
}
a(near(Math.min(...zs), 0, 0.01) && near(Math.max(...xs), 20, 0.01) && near(Math.max(...zs), 52, 0.01), 'the sweep starts at the profile and follows the path', [Math.min(...zs), Math.max(...xs), Math.max(...zs)]);
// the path sketch removed
r = build([disc, { id: 'f1', type: 'sweep', name: 'Sweep1', sketch: 's1', regions: [[0, 0]], path: { sketch: 'gone' }, operation: 'join' }]);
a(r.features.f1.status === 'error' && /path sketch/.test(r.features.f1.message), 'a missing path sketch is reported', r.features.f1);

// ---- loft ----
// A 20 x 20 square at z 0 to a 10 x 10 square at z 30, ruled: a frustum,
// V = h / 3 (A1 + A2 + sqrt(A1 A2)) = 10 (400 + 100 + 200) = 7000
const bottom = sketch('l1', { ref: 'origin:xy' }, rect(-10, -10, 20, 20, 'a'));
const plane = { id: 'w1', type: 'plane', name: 'Work Plane1', base: { ref: 'origin:xy' }, offset: 30 };
const top = sketch('l2', { ref: 'plane', id: 'w1' }, rect(-5, -5, 10, 10, 'b'));
const loftFeature = { id: 'f2', type: 'loft', name: 'Loft1', sketch: 'l1', sections: [{ sketch: 'l1', region: [0, 0] }, { sketch: 'l2', region: [0, 0] }], ruled: true, operation: 'join' };
r = build([bottom, plane, top, loftFeature]);
a(r.features.f2.status === 'ok' && near(r.bodies[0].volume, 7000, 0.5), 'ruled loft of two squares is a frustum', [r.features.f2, r.bodies[0] && r.bodies[0].volume]);
a(r.bodies[0] && meshCheck(r.bodies[0]).watertight, 'the loft meshes watertight');
// square to circle, smooth
const round = sketch('l2', { ref: 'plane', id: 'w1' }, circle(0, 0, 6, 'c'));
r = build([bottom, plane, round, Object.assign({}, loftFeature, { ruled: false })]);
a(r.features.f2.status === 'ok' && r.bodies[0].volume > Math.PI * 36 * 30 && r.bodies[0].volume < 400 * 30, 'a square lofted into a circle', [r.features.f2, r.bodies[0] && r.bodies[0].volume]);
// one section only
r = build([bottom, Object.assign({}, loftFeature, { sections: [{ sketch: 'l1', region: [0, 0] }] })]);
a(r.features.f2.status === 'error' && /two sections/.test(r.features.f2.message), 'one section is refused', r.features.f2);
// two sections in the same plane
const beside = sketch('l2', { ref: 'origin:xy' }, rect(30, -5, 10, 10, 'b'));
r = build([bottom, beside, Object.assign({}, loftFeature, { sections: [{ sketch: 'l1', region: [0, 0] }, { sketch: 'l2', region: [35, 0] }] })]);
a(r.features.f2.status === 'error', 'two sections in one plane are refused', r.features.f2);

// ---- draft ----
// A 20 x 20 x 20 box; its four sides drafted 5 degrees about the bottom,
// pulling up: the top shrinks by 20 tan 5 on each side
const box = [sketch('s0', { ref: 'origin:xy' }, rect(0, 0, 20, 20, 'b')),
    { id: 'e0', type: 'extrude', name: 'E0', sketch: 's0', regions: [[5, 5]], operation: 'join', extent: { type: 'distance', value: 20, direction: 'positive' } }];
const sides = [[10, 0, 10], [20, 10, 10], [10, 20, 10], [0, 10, 10]].map(c => ({ body: 0, centre: c, area: 400 }));
r = build(box.concat([{ id: 'd1', type: 'draft', name: 'Draft1', faces: sides, plane: { ref: 'origin:xy' }, angle: 5 }]));
const t = 20 * Math.tan(5 * Math.PI / 180);
const topSide = 20 - 2 * t;
const frustum = 20 / 3 * (400 + topSide * topSide + 20 * topSide);
a(r.features.d1.status === 'ok' && near(r.bodies[0].volume, frustum, 0.5), 'four sides drafted 5 degrees: a frustum', [r.features.d1, r.bodies[0] && r.bodies[0].volume, frustum]);
a(r.bodies[0] && meshCheck(r.bodies[0]).watertight, 'the drafted box meshes watertight');
r = build(box.concat([{ id: 'd1', type: 'draft', name: 'Draft1', faces: sides, plane: { ref: 'origin:xy' }, angle: 5, flip: true }]));
const wider = 20 + 2 * t;
a(r.features.d1.status === 'ok' && near(r.bodies[0].volume, 20 / 3 * (400 + wider * wider + 20 * wider), 0.5), 'flipped pull direction widens the top', r.bodies[0] && r.bodies[0].volume);
r = build(box.concat([{ id: 'd1', type: 'draft', name: 'Draft1', faces: [{ body: 0, centre: [10, 10, 20], area: 400 }], plane: { ref: 'origin:xy' }, angle: 5 }]));
a(r.features.d1.status === 'error', 'a face across the pull direction (the top) is refused', r.features.d1);
r = build(box.concat([{ id: 'd1', type: 'draft', name: 'Draft1', faces: sides, plane: { ref: 'origin:xy' }, angle: 0 }]));
a(r.features.d1.status === 'error' && /angle/.test(r.features.d1.message), 'a zero angle is refused', r.features.d1);

// ---- the document knows what a sweep and a loft use ----
const sweepF = { id: 'f1', type: 'sweep', sketch: 's1', path: { sketch: 's2' } };
a(JSON.stringify(sketchesOf(sweepF)) === '["s1","s2"]', 'a sweep uses its profile and path sketches', sketchesOf(sweepF));
a(usesOf(loftFeature).indexOf('l2') >= 0, 'a loft uses every section sketch', usesOf(loftFeature));
const doc = createDocument();
doc.reset({ format: 'aopart', version: 1, features: [bottom, plane, top, loftFeature] });
a(doc.dependents('l2').some(f => f.id === 'f2'), 'deleting a section sketch takes the loft along', doc.dependents('l2').map(f => f.id));
a(doc.newName('loft') === 'Loft2' && doc.newName('sweep') === 'Sweep1' && doc.newName('draft') === 'Draft1', 'default names', [doc.newName('loft'), doc.newName('sweep')]);

console.log(failed ? failed + ' checks failed' : 'a13: all checks passed');
process.exitCode = failed ? 1 : 0;
