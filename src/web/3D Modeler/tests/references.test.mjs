/*
    Edge references that survive edits upstream (edgeSignature and the
    fallback of findEdges in kernel/occt.js). The case found while building
    a part through the interface: a chamfer on the top edge of a boss failed
    once the boss was made taller. Run with: node tests/run.mjs references
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as kernel from '../js/kernel/occt.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

function rectSketch(id, plane, w, h) {
    const pts = [[0, 0], [w, 0], [w, h], [0, h]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    return { id: id, type: 'sketch', name: id, plane: plane, geometry: g, constraints: [] };
}

// An 80 x 50 x 10 plate with a 34 mm boss, 15 high, on the XY plane at (40, 25)
function part(bossHeight, plateHeight) {
    const boss = { id: 's2', type: 'sketch', name: 'S2', plane: { ref: 'origin:xy' }, constraints: [], geometry: [
        { id: 'c', type: 'point', x: 40, y: 25 }, { id: 'k', type: 'circle', c: 'c', r: 17 }
    ] };
    return { features: [
        rectSketch('s1', { ref: 'origin:xy' }, 80, 50),
        { id: 'e1', type: 'extrude', name: 'E1', sketch: 's1', regions: [[5, 5]], operation: 'join', extent: { type: 'distance', value: plateHeight || 10, direction: 'positive' } },
        boss,
        { id: 'e2', type: 'extrude', name: 'E2', sketch: 's2', regions: [[40, 25]], operation: 'join', extent: { type: 'distance', value: bossHeight, direction: 'positive' } }
    ] };
}

// Pick edges as the interface does, and store them with their descriptions
function refsFor(doc, test) {
    const rb = createRebuilder(oc);
    const out = rb.rebuild(doc);
    const bodies = rb.shapesBefore(doc, null).bodies;
    const picked = out.bodies[0].edges.filter(test).map(e => ({ body: 0, mid: e.mid, length: e.length }));
    return kernel.describeEdgeRefs(oc, bodies, picked);
}

/* ---- descriptions ---- */
{
    const doc = part(15);
    const top = refsFor(doc, e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 15) && near(e.curve.r, 17));
    const bottom = refsFor(doc, e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 10) && near(e.curve.r, 17));
    a(top.length === 1 && bottom.length === 1, 'the boss has one top and one bottom outline', [top.length, bottom.length]);
    a(top[0].sig.convex === true && bottom[0].sig.convex === false, 'the top outline is an outside corner, where the boss meets the plate an inside one', [top[0].sig, bottom[0].sig]);
    a(top[0].sig.curve === bottom[0].sig.curve && top[0].sig.faces.join() !== bottom[0].sig.faces.join() || top[0].sig.convex !== bottom[0].sig.convex, 'the two are told apart');
}

/* ---- the chamfer follows a taller boss ---- */
{
    const doc = part(15);
    const top = refsFor(doc, e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 15) && near(e.curve.r, 17));
    doc.features.push({ id: 'c1', type: 'chamfer', name: 'Chamfer1', edges: top, distance: 1 });
    let out = createRebuilder(oc).rebuild(doc);
    a(out.features.c1.status === 'ok', 'the chamfer builds', out.features.c1);
    const before = out.bodies[0].volume;
    doc.features.find(f => f.id === 'e2').extent.value = 20;
    out = createRebuilder(oc).rebuild(doc);
    a(out.features.c1.status === 'ok', 'with the boss made taller the chamfer still builds', out.features.c1);
    // The same part built at the new height with the edge picked there
    const direct = part(20);
    direct.features.push({ id: 'c1', type: 'chamfer', name: 'Chamfer1', distance: 1,
        edges: refsFor(part(20), e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 20) && near(e.curve.r, 17)) });
    const expected = createRebuilder(oc).rebuild(direct).bodies[0].volume;
    a(before > 0 && near(out.bodies[0].volume, expected, 1e-3), 'and it is the top edge: the same as chamfering the taller boss directly', [out.bodies[0].volume, expected]);
    const topNow = out.bodies[0].edges.filter(e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 20));
    a(topNow.length >= 1 && topNow.every(e => e.curve.r < 17 - 0.5), 'the outline at the new top is the chamfered one', topNow.map(e => e.curve.r));
}

/* ---- fillets on the vertical corners follow a thicker plate ---- */
{
    const doc = part(15, 10);
    const verticals = refsFor(doc, e => e.curve && e.curve.type === 'line' && near(e.length, 10) && (near(e.mid[0], 0) || near(e.mid[0], 80)));
    a(verticals.length === 4, 'four vertical corner edges', verticals.length);
    a(new Set(verticals.map(r => r.sig.faces.join())).size === 4, 'each corner has its own pair of faces');
    doc.features.push({ id: 'f1', type: 'fillet', name: 'Fillet1', edges: verticals, radius: 6 });
    let out = createRebuilder(oc).rebuild(doc);
    a(out.features.f1.status === 'ok', 'the fillet builds', out.features.f1);
    doc.features.find(f => f.id === 'e1').extent.value = 14;
    out = createRebuilder(oc).rebuild(doc);
    a(out.features.f1.status === 'ok', 'with the plate made thicker the fillet still builds', out.features.f1);
    const direct = part(15, 14);
    direct.features.push({ id: 'f1', type: 'fillet', name: 'Fillet1', radius: 6,
        edges: refsFor(part(15, 14), e => e.curve && e.curve.type === 'line' && near(e.length, 14) && (near(e.mid[0], 0) || near(e.mid[0], 80))) });
    const expected = createRebuilder(oc).rebuild(direct).bodies[0].volume;
    a(near(out.bodies[0].volume, expected, 1e-3), 'all four corners are rounded over the new thickness, as if picked there', [out.bodies[0].volume, expected]);
}

/* ---- old references and real losses ---- */
{
    const doc = part(15);
    const top = refsFor(doc, e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 15) && near(e.curve.r, 17)).map(r => ({ body: r.body, mid: r.mid, length: r.length }));
    doc.features.push({ id: 'c1', type: 'chamfer', name: 'Chamfer1', edges: top, distance: 1 });
    doc.features.find(f => f.id === 'e2').extent.value = 20;
    const out = createRebuilder(oc).rebuild(doc);
    a(out.features.c1.status === 'error', 'a reference saved without a description still fails loudly when moved', out.features.c1);
}
{
    const doc = part(15);
    const top = refsFor(doc, e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 15) && near(e.curve.r, 17));
    doc.features.push({ id: 'c1', type: 'chamfer', name: 'Chamfer1', edges: top, distance: 1 });
    doc.features.find(f => f.id === 's2').geometry.find(g => g.id === 'k').r = 12;
    const out = createRebuilder(oc).rebuild(doc);
    a(out.features.c1.status === 'error', 'a boss of another size is not the same edge: the chamfer fails rather than guess', out.features.c1);
}

console.log(failed ? failed + ' FAILED' : 'all reference tests passed');
process.exitCode = failed ? 1 : 0;
