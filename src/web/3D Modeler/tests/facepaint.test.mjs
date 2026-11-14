/*
    Painted faces on a real part (appearance.js matchFaces against the
    face descriptions the kernel gives): the top of the sample part's plate
    is painted, then the plate is made thicker. The face moves up and the
    cross hole of the boss now cuts a groove across it, splitting it in
    two; both pieces must keep the paint, and nothing else may take it.
    Found while trying it in the app: only the larger piece was painted.
    Run with: node tests/run.mjs facepaint
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import { sampleDocument } from '../js/document/sample.js';
import { faceRef, matchFaces, faceSignature } from '../js/appearance.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

const doc = sampleDocument();
let out = createRebuilder(oc).rebuild(doc);
a(out.bodies.length === 1, 'the sample part builds', out.features);
const faces = out.bodies[0].faces;
// The top of the plate: the largest face looking up
const ups = faces.map((f, i) => ({ f, i })).filter(x => faceSignature(x.f) === 'plane:0,0,1');
ups.sort((p, q) => q.f.area - p.f.area);
const top = ups[0];
a(Math.abs(top.f.centre[2] - 12) < 1e-6, 'the plate top is at 12', top.f.centre);
const ref = faceRef(top.f, 0);
let hit = matchFaces(faces, [ref], 0);
a(hit.filter(r => r === 0).length === 1 && hit[top.i] === 0, 'painted where it is');

// Thicker plate: 12 -> 18
const extrude = doc.features.find(f => f.type === 'extrude');
extrude.extent.value = 18;
out = createRebuilder(oc).rebuild(doc);
a(Object.values(out.features).every(r => r.status === 'ok'), 'the thicker part builds', out.features);
const after = out.bodies[0].faces;
hit = matchFaces(after, [ref], 0);
const painted = after.filter((f, i) => hit[i] === 0);
a(painted.length >= 1 && painted.every(f => faceSignature(f) === 'plane:0,0,1' && Math.abs(f.centre[2] - 18) < 1e-6),
    'the paint moved up with the face', painted.map(f => f.centre));
const tops = after.filter(f => faceSignature(f) === 'plane:0,0,1' && Math.abs(f.centre[2] - 18) < 1e-6);
a(painted.length === tops.length, 'every piece of the top at 18 is painted (' + tops.length + ' pieces)', [painted.length, tops.length]);
const area = painted.reduce((s, f) => s + f.area, 0);
a(area <= top.f.area * 1.1 && area > top.f.area * 0.7, 'the pieces add up to about the face that was painted', [area, top.f.area]);

console.log(failed ? failed + ' failed' : 'facepaint: all passed');
process.exitCode = failed ? 1 : 0;
