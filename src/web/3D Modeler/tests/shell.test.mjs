/*
    Shell (kernel/occt.js shell, findFaces, describeFaceRefs).
    Run with: node tests/run.mjs shell
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as kernel from '../js/kernel/occt.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

// A 40 x 30 box, `h` high
function box(h) {
    const pts = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    return { features: [
        { id: 's', type: 'sketch', name: 'S', plane: { ref: 'origin:xy' }, geometry: g, constraints: [] },
        { id: 'e', type: 'extrude', name: 'E', sketch: 's', regions: [[20, 15]], operation: 'join', extent: { type: 'distance', value: h, direction: 'positive' } }
    ] };
}

// The top face picked as the interface does, with its surface key
function topRef(doc) {
    const rb = createRebuilder(oc);
    const out = rb.rebuild(doc);
    const h = doc.features[1].extent.value;
    const face = out.bodies[0].faces.find(f => f.type === 'plane' && near(f.centre[2], h));
    return kernel.describeFaceRefs(oc, rb.shapesBefore(doc, null).bodies, [{ body: 0, centre: face.centre, area: face.area }]);
}

let doc = box(20);
const faces = topRef(doc);
a(faces[0].sig === 'plane:0.000,0.000,1.000', 'the top face is described by its surface', faces[0]);
doc.features.push({ id: 'sh', type: 'shell', name: 'Shell1', faces: faces, thickness: 2, direction: 'inside' });
let out = createRebuilder(oc).rebuild(doc);
a(out.features.sh.status === 'ok' && near(out.bodies[0].volume, 40 * 30 * 20 - 36 * 26 * 18, 0.01), 'an open box with 2 mm walls inside', [out.features.sh, out.bodies[0] && out.bodies[0].volume]);

doc.features[2].direction = 'outside';
out = createRebuilder(oc).rebuild(doc);
a(out.features.sh.status === 'ok' && near(out.bodies[0].volume, 44 * 34 * 22 - 40 * 30 * 20, 0.5), 'walls grown outwards keep the inside at the old outside', [out.features.sh, out.bodies[0] && out.bodies[0].volume]);
doc.features[2].direction = 'inside';

// The box made taller: the open top is found again
doc.features[1].extent.value = 25;
out = createRebuilder(oc).rebuild(doc);
a(out.features.sh.status === 'ok' && near(out.bodies[0].volume, 40 * 30 * 25 - 36 * 26 * 23, 0.01), 'a taller box is still shelled open at its new top', [out.features.sh, out.bodies[0] && out.bodies[0].volume]);

// The live preview names the new faces: the five inner walls
const report = { fresh: [] };
const rb = createRebuilder(oc);
rb.rebuild(doc);
const made = kernel.shell(oc, rb.shapesBefore(doc, 'sh').bodies, doc.features[2], report);
a(report.fresh[0].filter(Boolean).length === 5, 'the inner floor and four inner walls are the new faces', report.fresh[0]);
made[0].delete();

// Walls thicker than the box allows are refused, not built broken
doc.features[2].thickness = 16;
out = createRebuilder(oc).rebuild(doc);
a(out.features.sh.status === 'error' || (out.bodies[0].volume > 0 && out.bodies[0].volume < 40 * 30 * 25), 'walls too thick are refused or still give a sound solid', [out.features.sh, out.bodies[0] && out.bodies[0].volume]);

console.log(failed ? failed + ' FAILED' : 'all shell tests passed');
process.exitCode = failed ? 1 : 0;
