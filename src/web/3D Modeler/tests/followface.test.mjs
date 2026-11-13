/*
    Sketches and work planes on a face follow the face (followFace in
    kernel/occt.js, resolved in rebuild.js). Found while building a part
    through the interface: after the plate was made thicker, the mounting
    holes sketched on its top stayed at the old height and silently stopped
    short of the new top. Run with: node tests/run.mjs followface
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import { planeFrame } from '../js/kernel/profile.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

function rect(id, plane, x0, y0, w, h) {
    const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    return { id: id, type: 'sketch', name: id, plane: plane, geometry: g, constraints: [] };
}

// A sketch on the top of a plate 10 thick, as the interface stores it when
// the face is clicked at (10, 10, 10)
const top = () => ({ ref: 'face', frame: { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, face: { normal: [0, 0, 1], point: [10, 10, 10] } });

function part(thickness) {
    return { features: [
        rect('s1', { ref: 'origin:xy' }, 0, 0, 80, 50),
        { id: 'e1', type: 'extrude', name: 'E1', sketch: 's1', regions: [[5, 5]], operation: 'join', extent: { type: 'distance', value: thickness, direction: 'positive' } },
        // a 20 x 10 block on top, 6 high
        rect('s2', top(), 30, 20, 20, 10),
        { id: 'e2', type: 'extrude', name: 'E2', sketch: 's2', regions: [[40, 25]], operation: 'join', extent: { type: 'distance', value: 6, direction: 'positive' } },
        // two holes through all, sketched on the top as well
        { id: 's3', type: 'sketch', name: 'S3', plane: top(), constraints: [], geometry: [
            { id: 'h1', type: 'point', x: 8, y: 8, standalone: true }, { id: 'h2', type: 'point', x: 72, y: 42, standalone: true }] },
        { id: 'h', type: 'hole', name: 'Hole1', sketch: 's3', kind: 'simple', diameter: 6, depth: 5, through: true }
    ] };
}

function zRange(body) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 2; i < body.positions.length; i += 3) {
        lo = Math.min(lo, body.positions[i]);
        hi = Math.max(hi, body.positions[i]);
    }
    return [lo, hi];
}

const holes = 2 * Math.PI * 9;
let out = createRebuilder(oc).rebuild(part(10));
a(out.features.h.status === 'ok' && out.features.e2.status === 'ok', 'the part builds', out.features);
a(near(out.bodies[0].volume, 80 * 50 * 10 + 20 * 10 * 6 - holes * 10, 0.5), 'plate, block and two holes through', out.bodies[0].volume);
a(near(out.frames.s2.o[2], 10) && near(out.frames.s3.o[2], 10), 'the face sketches are found where they were drawn', out.frames);

// Thicker plate: the block sits on the new top and the holes go all the way
const doc = part(10);
doc.features[1].extent.value = 14;
out = createRebuilder(oc).rebuild(doc);
a(near(out.frames.s2.o[2], 14) && near(out.frames.s3.o[2], 14), 'the face sketches moved up with the face', out.frames);
a(near(zRange(out.bodies[0])[1], 20, 1e-3), 'the block now stands on the 14 mm plate: its top at 20', zRange(out.bodies[0]));
a(near(out.bodies[0].volume, 80 * 50 * 14 + 20 * 10 * 6 - holes * 14, 0.5), 'and the holes go through the whole 14 mm', [out.bodies[0].volume, 80 * 50 * 14 + 20 * 10 * 6 - holes * 14]);
a(near(planeFrame(doc.features[2].plane).o[2], 14), 'what was resolved is what planeFrame gives afterwards (in this thread)');

// A sketch whose face is gone keeps its frame, as before
const gone = part(10);
gone.features[2].plane.face.point = [500, 500, 10]; // no upward face under this point
out = createRebuilder(oc).rebuild(gone);
a(!out.frames.s2 && out.features.e2.status === 'ok', 'without the face the sketch stays where it was drawn', out.frames);

// An old document without the face description is untouched
const old = part(10);
delete old.features[4].plane.face;
old.features[1].extent.value = 14;
out = createRebuilder(oc).rebuild(old);
a(!out.frames.s3, 'an old face sketch is not moved');

// A work plane offset from the top face follows it too
const wp = part(10);
// (clicked away from the holes, which come before it in the history)
wp.features.push({ id: 'w', type: 'plane', name: 'Work Plane1', base: Object.assign(top(), { face: { normal: [0, 0, 1], point: [40, 40, 10] } }), offset: 5 });
wp.features.push(rect('s4', { ref: 'plane', id: 'w' }, 60, 5, 10, 10));
wp.features.push({ id: 'e4', type: 'extrude', name: 'E4', sketch: 's4', regions: [[65, 10]], operation: 'join', extent: { type: 'distance', value: 3, direction: 'positive' } });
wp.features[1].extent.value = 14;
out = createRebuilder(oc).rebuild(wp);
a(out.features.e4.status === 'ok' && near(zRange(out.bodies[0])[1], 22, 1e-3), 'a block on a work plane 5 above the top ends at 14 + 5 + 3', [zRange(out.bodies[0]), out.features.w, out.features.e4, out.frames.w]);

console.log(failed ? failed + ' FAILED' : 'all follow face tests passed');
process.exitCode = failed ? 1 : 0;
