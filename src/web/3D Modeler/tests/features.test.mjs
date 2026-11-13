/*
    Fillet, chamfer, hole, rollback, export / import and inspection, against
    the real kernel. Run with: node tests/run.mjs features
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import { sampleDocument } from '../js/document/sample.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);
const A = 3945.06 - Math.PI * 36; // plate area of the sample sketch

function plate() {
    const d = sampleDocument();
    d.features = d.features.slice(0, 2); // 80 x 50 x 12 rounded plate with a hole
    return d;
}
const edgeRef = (body, test) => { const e = body.edges.find(test); return { body: 0, mid: e.mid, length: e.length }; };
const vertical = e => e.curve && e.curve.type === 'line' && near(e.length, 12);
const topLine = e => e.curve && e.curve.type === 'line' && near(e.mid[2], 12) && near(e.length, 64);

// edges carry a midpoint
{
    const b = createRebuilder(oc).rebuild(plate()).bodies[0];
    a(b.edges.every(e => Array.isArray(e.mid) && e.mid.length === 3), 'every edge has a midpoint');
    a(b.edges.filter(vertical).length === 8, 'eight vertical edges (two per rounded corner)', b.edges.filter(vertical).length);
}
// fillet and chamfer
{
    const d = plate();
    const b = createRebuilder(oc).rebuild(d).bodies[0];
    d.features.push({ id: 'fl', type: 'fillet', name: 'Fillet1', edges: [edgeRef(b, topLine)], radius: 2 });
    const rb = createRebuilder(oc);
    let r = rb.rebuild(d);
    a(r.features.fl.status === 'ok' && r.bodies[0].volume < A * 12 && r.bodies[0].volume > A * 12 - 400, 'fillet removes a little material', [r.features.fl, r.bodies[0].volume, A * 12]);
    const faces = r.bodies[0].faces.length;
    d.features.push({ id: 'ch', type: 'chamfer', name: 'Chamfer1', edges: [edgeRef(b, e => e.curve && e.curve.type === 'line' && near(e.mid[2], 0) && near(e.length, 64))], distance: 1.5 });
    r = rb.rebuild(d);
    a(r.features.ch.status === 'ok' && r.bodies[0].faces.length > faces, 'chamfer on a bottom edge', r.features.ch);
    // too large a radius is reported, the body survives
    d.features[2].radius = 500;
    r = rb.rebuild(d);
    a(r.features.fl.status === 'error' && r.bodies.length === 1, 'impossible fillet is reported', r.features.fl);
    d.features[2].radius = 2;
    // a moved edge is reported, not misapplied
    d.features[1].extent.value = 20;
    r = rb.rebuild(d);
    a(r.features.fl.status === 'error' && /no longer there/.test(r.features.fl.message), 'moved edge fails loudly', r.features.fl);
    a(r.features.ch.status === 'ok', 'the chamfer on the unmoved bottom edge still builds', r.features.ch);
    d.features[1].extent.value = 12;
    // rollback: the model before the fillet, without losing the cache
    const back = rb.rollback(d, 'fl');
    a(near(back.bodies[0].volume, A * 12, 1) && !back.features.fl, 'rollback shows the body before the feature', back.bodies[0].volume);
    r = rb.rebuild(d);
    a(r.reused >= 2 && r.features.fl.status === 'ok', 'full rebuild after a rollback reuses what the rollback built', r.reused);
}
// holes
{
    const d = plate();
    d.features.push({ id: 's', type: 'sketch', name: 'S', plane: { ref: 'face', frame: { o: [0, 0, 12], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] } },
        geometry: [{ id: 'p1', type: 'point', x: 50, y: 15, standalone: true }, { id: 'p2', type: 'point', x: 65, y: 35, standalone: true }, { id: 'e1', type: 'point', x: 1, y: 1 }], constraints: [] });
    d.features.push({ id: 'h', type: 'hole', name: 'Hole1', sketch: 's', kind: 'simple', diameter: 6, depth: 5 });
    const vol = () => { const r = createRebuilder(oc).rebuild(d); return { v: r.bodies[0] ? r.bodies[0].volume : 0, s: r.features.h }; };
    const base = A * 12;
    let r = vol();
    a(r.s.status === 'ok' && near(base - r.v, 2 * Math.PI * 9 * 5, 0.5), 'two blind holes at the two placed points', [r.s, base - r.v]);
    d.features[3].through = true;
    r = vol();
    a(near(base - r.v, 2 * Math.PI * 9 * 12, 0.5), 'through all', base - r.v);
    Object.assign(d.features[3], { through: false, depth: 8, kind: 'counterbore', cbDiameter: 10, cbDepth: 3 });
    r = vol();
    a(r.s.status === 'ok' && near(base - r.v, 2 * (Math.PI * 25 * 3 + Math.PI * 9 * 5), 0.5), 'counterbore', [r.s, base - r.v]);
    Object.assign(d.features[3], { kind: 'countersink', csDiameter: 10, csAngle: 90 });
    r = vol();
    const cone = Math.PI * 2 / 3 * (25 + 15 + 9); // frustum r 5 -> 3 over h 2
    a(r.s.status === 'ok' && near(base - r.v, 2 * (cone + Math.PI * 9 * 6), 0.5), 'countersink', [r.s, base - r.v, 2 * (cone + Math.PI * 9 * 6)]);
    Object.assign(d.features[3], { kind: 'simple', depth: 5, drillPoint: true });
    r = vol();
    const tip = Math.PI * 9 * (3 / Math.tan(59 * Math.PI / 180)) / 3;
    a(near(base - r.v, 2 * (Math.PI * 9 * 5 + tip), 0.5), 'drill point', base - r.v);
    Object.assign(d.features[3], { drillPoint: false, flip: true });
    r = vol();
    a(r.s.status === 'ok' && near(base - r.v, 2 * Math.PI * 9 * 1, 0.5), 'a flipped hole only takes the 1 mm start margin', [r.s, base - r.v]);
    d.features[3].diameter = 0;
    a(vol().s.status === 'error', 'zero diameter is reported');
    d.features[2].geometry = d.features[2].geometry.filter(g => !g.standalone);
    d.features[3].diameter = 6;
    a(/no points/.test(vol().s.message), 'no points is reported');
}
// export, import, mass, distance
{
    const rb = createRebuilder(oc);
    const full = rb.rebuild(sampleDocument());
    const step = K.exportText(oc, rb.bodies(), 'step');
    a(step.startsWith('ISO-10303-21') && step.length > 10000, 'STEP text');
    const brep = K.exportText(oc, rb.bodies(), 'brep');
    a(brep.length > 5000, 'BREP text', brep.slice(0, 60));
    const solids = K.importSTEP(oc, step);
    a(solids.length === 1 && near(K.volume(oc, solids[0]), full.bodies[0].volume, 0.5), 'STEP round trip keeps the volume');
    let threw = false;
    try { K.importSTEP(oc, 'not a step file'); } catch (e) { threw = true; }
    a(threw, 'garbage is refused as STEP');
    const imported = createRebuilder(oc).rebuild({ features: [{ id: 'i', type: 'import', name: 'Imported', format: 'step', data: step }] });
    a(imported.features.i.status === 'ok' && near(imported.bodies[0].volume, full.bodies[0].volume, 0.5), 'import feature', imported.features.i);
    const mass = K.massProperties(oc, rb.bodies());
    a(near(mass.volume, full.bodies[0].volume, 0.01) && near(mass.size[0], 80, 0.01) && near(mass.size[1], 50, 0.01) && near(mass.size[2], 28, 0.01) && mass.area > 0, 'mass properties', mass);
    const b = full.bodies[0];
    const top = b.faces.findIndex(f => f.type === 'plane' && near(f.normal[2], 1) && near(f.origin[2], 12));
    const bottom = b.faces.findIndex(f => f.type === 'plane' && near(f.normal[2], -1));
    a(near(K.distanceBetween(oc, rb.bodies(), { type: 'face', body: 0, index: top }, { type: 'face', body: 0, index: bottom }), 12), 'distance between two faces');
    const e = b.edges.find(vertical);
    a(near(K.distanceBetween(oc, rb.bodies(), { type: 'edge', body: 0, mid: e.mid, length: e.length }, { type: 'face', body: 0, index: bottom }), 0), 'edge touching a face');
    // two bodies export as one compound
    const two = sampleDocument();
    two.features[3].operation = 'new';
    const rb2 = createRebuilder(oc);
    const r2 = rb2.rebuild(two);
    a(r2.bodies.length === 2 && K.importSTEP(oc, K.exportText(oc, rb2.bodies(), 'step')).length === 2, 'two bodies in one STEP file', r2.bodies.length);
}
console.log(failed ? failed + ' FAILED' : 'all feature tests passed');
process.exitCode = failed ? 1 : 0;
