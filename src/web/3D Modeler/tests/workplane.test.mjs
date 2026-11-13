/*
    Work planes: frames, sketches on them through the kernel, and what
    deleting one takes along. Run with: node tests/run.mjs workplane
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import { planeFrame, workPlaneFrame, withResolvedPlane } from '../js/kernel/profile.js';
import { createDocument } from '../js/document/document.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

const circle = (id, plane, r) => ({ id: id, type: 'sketch', name: id, plane: plane, geometry: [{ id: 'p', type: 'point', x: 0, y: 0 }, { id: 'k', type: 'circle', c: 'p', r: r }], constraints: [] });
const extrude = (id, sketch, value) => ({ id: id, type: 'extrude', name: id, sketch: sketch, regions: [[0, 0]], operation: 'join', extent: { type: 'distance', value: value, direction: 'positive' } });

// frames
const features = [
    { id: 'w1', type: 'plane', name: 'Work Plane1', base: { ref: 'origin:xy' }, offset: 15 },
    { id: 'w2', type: 'plane', name: 'Work Plane2', base: { ref: 'plane', id: 'w1' }, offset: -5 },
    { id: 'w3', type: 'plane', name: 'Loop', base: { ref: 'plane', id: 'w3' }, offset: 1 }
];
a(near(workPlaneFrame(features[0], features).o[2], 15), 'offset from an origin plane');
a(near(planeFrame({ ref: 'plane', id: 'w2' }, features).o[2], 10), 'a plane offset from a plane adds up');
a(planeFrame({ ref: 'plane', id: 'w3' }, features) === null, 'a plane based on itself resolves to nothing');
a(planeFrame({ ref: 'plane', id: 'nope' }, features) === null && planeFrame({ ref: 'plane', id: 'w1' }) === null, 'unknown plane, or no feature list');
features[0].suppressed = true;
a(planeFrame({ ref: 'plane', id: 'w2' }, features) === null, 'a suppressed base takes its planes with it');
features[0].suppressed = false;
const resolved = withResolvedPlane(circle('s', { ref: 'plane', id: 'w1' }, 5), features);
a(resolved.plane.ref === 'face' && near(resolved.plane.frame.o[2], 15), 'withResolvedPlane gives the kernel an explicit frame');
a(withResolvedPlane(circle('s', { ref: 'origin:xy' }, 5), features).plane.ref === 'origin:xy', 'other planes pass through');

// kernel: a disc extruded from a sketch on a work plane sits at the plane
const doc = { features: [
    { id: 'w', type: 'plane', name: 'Work Plane1', base: { ref: 'origin:xy' }, offset: 20 },
    circle('s', { ref: 'plane', id: 'w' }, 10),
    extrude('e', 's', 4)
] };
const rb = createRebuilder(oc);
let r = rb.rebuild(doc);
const zs = b => { const z = []; for (let i = 2; i < b.positions.length; i += 3) z.push(b.positions[i]); return [Math.min(...z), Math.max(...z)]; };
a(Object.values(r.features).every(s => s.status === 'ok') && near(r.bodies[0].volume, Math.PI * 100 * 4, 0.5), 'builds', r.features);
a(near(zs(r.bodies[0])[0], 20) && near(zs(r.bodies[0])[1], 24), 'the solid starts at the work plane', zs(r.bodies[0]));
// moving the plane moves what was built on it
doc.features[0].offset = -8;
r = rb.rebuild(doc);
a(near(zs(r.bodies[0])[0], -8) && near(zs(r.bodies[0])[1], -4), 'changing the offset moves the solid', zs(r.bodies[0]));
// a missing plane is reported on the feature that needs it
doc.features[0].suppressed = true;
r = rb.rebuild(doc);
a(r.features.e.status === 'error' && /plane/.test(r.features.e.message) && r.bodies.length === 0, 'a suppressed plane fails the extrusion', r.features.e);

// document: deleting a plane takes its sketches and their features along
const d = createDocument();
d.reset({ format: 'aopart', version: 1, units: 'mm', features: JSON.parse(JSON.stringify(doc.features)).concat([
    { id: 'w2', type: 'plane', name: 'Work Plane2', base: { ref: 'plane', id: 'w' }, offset: 5 },
    circle('s2', { ref: 'plane', id: 'w2' }, 3),
    circle('free', { ref: 'origin:xz' }, 3)
]) }, 'T', '');
a(d.dependents('w').map(f => f.id).sort().join(',') === 'e,s,s2,w2', 'dependents are found through sketches and planes', d.dependents('w').map(f => f.id));
a(d.dependents('s').map(f => f.id).join(',') === 'e', 'a sketch only takes its feature');
d.remove('w');
a(d.features().map(f => f.id).join(',') === 'free', 'removing the plane removes the whole chain', d.features().map(f => f.id));
a(d.undo() && d.features().length === 6, 'and one undo brings it all back');

console.log(failed ? failed + ' FAILED' : 'all work plane tests passed');
process.exitCode = failed ? 1 : 0;
