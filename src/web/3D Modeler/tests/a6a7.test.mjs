/*
    A6 and A7 (PROPOSAL.md 14.7, 14.8, 14.26): Extrude extents (To a plane,
    To Next) and taper, chamfers by two distances or a distance and an angle,
    fillets with several radii, threads and the linear hole placement; End
    of Part, reordering with its dependency check, shared sketches, hidden
    bodies and what a restored autosave looks like to the document.
    Run with: node tests/run.mjs a6a7
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import { createDocument, validate } from '../js/document/document.js';
import { createAssemblyDocument } from '../js/assembly/document.js';
import { createDrawingDocument } from '../js/drawing/document.js';
import { sceneFor } from '../js/features/illustrations.js';

// hole.js pulls in ui.js, which listens on the document when it loads
globalThis.document = globalThis.document || { addEventListener() {}, getElementById() { return null; } };
const { THREADS, threadById, linearPoint } = await import('../js/features/hole.js');

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);

function rect(id, plane, x0, y0, w, h) {
    const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    return { id: id, type: 'sketch', name: id, plane: plane, geometry: g, constraints: [] };
}
const XY = { ref: 'origin:xy' };
// The top of the 40 x 30 x 10 plate, as the interface stores a clicked face
const top = { ref: 'face', frame: { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, face: { normal: [0, 0, 1], point: [5, 5, 10] } };
const extrude = (id, sketch, region, extent, operation) => ({ id: id, type: 'extrude', name: id, sketch: sketch, regions: [region], operation: operation || 'join', extent: extent });

function plate() {
    return { features: [
        rect('s1', XY, 0, 0, 40, 30),
        extrude('e1', 's1', [20, 15], { type: 'distance', value: 10, direction: 'positive' })
    ] };
}
// A 10 x 10 boss on the plate, extruded with `extent`
function boss(extent, more) {
    const d = plate();
    (more || []).forEach(f => d.features.push(f));
    d.features.push(rect('s2', top, 15, 10, 10, 10));
    d.features.push(extrude('e2', 's2', [20, 15], extent));
    return d;
}
const volume = r => r.bodies.reduce((s, b) => s + b.volume, 0);
const PLATE = 40 * 30 * 10;

/* ---- Extrude: taper ---- */
{
    const frustum = (side, h, deg) => {
        const t = side - 2 * h * Math.tan(deg * Math.PI / 180);
        return h / 3 * (side * side + t * t + side * t);
    };
    let r = createRebuilder(oc).rebuild(boss({ type: 'distance', value: 10, direction: 'positive', taper: 5 }));
    a(r.features.e2.status === 'ok' && near(volume(r), PLATE + frustum(10, 10, 5), 0.5), 'a positive taper narrows the boss', [r.features.e2, volume(r) - PLATE, frustum(10, 10, 5)]);
    r = createRebuilder(oc).rebuild(boss({ type: 'distance', value: 10, direction: 'positive', taper: -5 }));
    a(r.features.e2.status === 'ok' && near(volume(r), PLATE + frustum(10, 10, -5), 0.5), 'a negative taper widens it', [volume(r) - PLATE, frustum(10, 10, -5)]);
    r = createRebuilder(oc).rebuild(boss({ type: 'distance', value: 10, direction: 'symmetric', taper: 5 }));
    a(r.features.e2.status === 'error', 'a taper is refused both ways at once', r.features.e2);
}

/* ---- Extrude: To a plane, To Next ---- */
{
    const w = { id: 'w', type: 'plane', name: 'W', base: XY, offset: 25 };
    let r = createRebuilder(oc).rebuild(boss({ type: 'to', plane: { ref: 'plane', id: 'w' } }, [w]));
    a(r.features.e2.status === 'ok' && near(volume(r), PLATE + 10 * 10 * 15, 0.5), 'To a work plane 25 up: the boss is 15 high', [r.features.e2, volume(r) - PLATE]);
    r = createRebuilder(oc).rebuild(boss({ type: 'to' }, [w]));
    a(r.features.e2.status === 'error', 'To without a plane is reported', r.features.e2);
    // A slab 30 to 35 up, made as a body of its own; To Next stops under it
    const slab = [
        { id: 'w30', type: 'plane', name: 'W30', base: XY, offset: 30 },
        rect('s3', { ref: 'plane', id: 'w30' }, 0, 0, 40, 30),
        extrude('e3', 's3', [20, 15], { type: 'distance', value: 5, direction: 'positive' }, 'new')
    ];
    r = createRebuilder(oc).rebuild(boss({ type: 'next', direction: 'positive' }, slab));
    a(r.features.e2.status === 'ok' && near(volume(r), PLATE + 40 * 30 * 5 + 10 * 10 * 20, 1), 'To Next runs up to the slab', [r.features.e2, volume(r)]);
    r = createRebuilder(oc).rebuild(boss({ type: 'next', direction: 'positive' }));
    a(r.features.e2.status === 'error', 'To Next with nothing ahead is reported', r.features.e2);
}

/* ---- Chamfer types, fillet sets ---- */
{
    const base = createRebuilder(oc).rebuild(plate()).bodies[0];
    const edge = test => { const e = base.edges.find(test); return { body: 0, mid: e.mid, length: e.length }; };
    const front = edge(e => near(e.length, 40) && near(e.mid[1], 0) && near(e.mid[2], 10));
    const back = edge(e => near(e.length, 40) && near(e.mid[1], 30) && near(e.mid[2], 10));
    const run = f => { const d = plate(); d.features.push(Object.assign({ id: 'c', name: 'C' }, f)); return createRebuilder(oc).rebuild(d); };
    const topArea = r => r.bodies[0].faces.filter(f => f.type === 'plane' && near(f.normal[2], 1, 1e-6) && near(f.origin ? f.centre[2] : 0, 10, 1e-6)).reduce((s, f) => s + f.area, 0);

    let r = run({ type: 'chamfer', edges: [front], distance: 3 });
    a(r.features.c.status === 'ok' && near(volume(r), PLATE - 0.5 * 9 * 40, 0.01), 'an equal chamfer', volume(r));
    r = run({ type: 'chamfer', edges: [front], distance: 2, mode: 'two', distance2: 4 });
    const two = topArea(r);
    a(r.features.c.status === 'ok' && near(volume(r), PLATE - 0.5 * 2 * 4 * 40, 0.01), 'two distances', volume(r));
    r = run({ type: 'chamfer', edges: [front], distance: 2, mode: 'two', distance2: 4, flip: true });
    const flipped = topArea(r);
    a(r.features.c.status === 'ok' && near(Math.abs(two - flipped), 2 * 40, 0.01), 'Flip swaps which face takes which distance', [two, flipped]);
    r = run({ type: 'chamfer', edges: [front], distance: 3, mode: 'angle', angle: 30 });
    a(r.features.c.status === 'ok' && near(volume(r), PLATE - 0.5 * 3 * 3 * Math.tan(Math.PI / 6) * 40, 0.01), 'a distance and an angle', volume(r));
    // Two edges of the top picked together measure from the top both times
    r = run({ type: 'chamfer', edges: [front, back], distance: 2, mode: 'two', distance2: 4 });
    a(r.features.c.status === 'ok' && (near(topArea(r), 40 * (30 - 4)) || near(topArea(r), 40 * (30 - 8))), 'edges picked together measure from the same face', topArea(r));
    r = run({ type: 'chamfer', edges: [front], distance: 2, mode: 'angle', angle: 95 });
    a(r.features.c.status === 'error', 'an angle of 90 or more is refused', r.features.c);

    const cut = rr => (1 - Math.PI / 4) * rr * rr * 40;
    r = run({ type: 'fillet', sets: [{ edges: [front], radius: 2 }, { edges: [back], radius: 4 }] });
    a(r.features.c.status === 'ok' && near(volume(r), PLATE - cut(2) - cut(4), 0.5), 'a fillet with two radii', [r.features.c, PLATE - volume(r), cut(2) + cut(4)]);
    r = run({ type: 'fillet', sets: [{ edges: [front], radius: 2 }, { edges: [back], radius: 60 }] });
    a(r.features.c.status === 'error', 'a set that does not fit fails the fillet', r.features.c);
}

/* ---- End of Part in the rebuild ---- */
{
    const d = boss({ type: 'distance', value: 10, direction: 'positive' });
    d.end = 'e1';
    let r = createRebuilder(oc).rebuild(d);
    a(r.features.e2.status === 'rolled' && r.features.s2.status === 'rolled' && near(volume(r), PLATE, 0.01), 'features below End of Part are not built', r.features);
    d.end = '';
    r = createRebuilder(oc).rebuild(d);
    a(r.bodies.length === 0 && r.features.e1.status === 'rolled', 'End of Part above everything: nothing is built', r.features);
    delete d.end;
    r = createRebuilder(oc).rebuild(d);
    a(near(volume(r), PLATE + 1000, 0.01), 'no marker: everything is built');
}

/* ---- the document: End of Part, reordering, sharing, hiding ---- */
function makeDoc(features) {
    const doc = createDocument();
    doc.reset({ format: 'aopart', version: 1, units: 'mm', features: features }, 'T', '');
    return doc;
}
const ids = doc => doc.features().map(f => f.id).join(',');
{
    const doc = makeDoc(boss({ type: 'distance', value: 10, direction: 'positive' }).features);
    a(doc.endIndex() === 3, 'without a marker every feature is built');
    doc.setEnd('e1');
    a(doc.endIndex() === 1 && doc.data().end === 'e1', 'End of Part after e1');
    doc.change('add', d => d.features.push({ id: 'x', type: 'point', name: 'X', def: { kind: 'coords', at: [0, 0, 0] } }));
    a(ids(doc) === 's1,e1,x,s2,e2' && doc.data().end === 'x', 'a new feature goes in at End of Part, which moves past it', [ids(doc), doc.data().end]);
    doc.setEnd(null);
    a(doc.data().end === undefined && doc.endIndex() === 4, 'Move to End removes the marker');
    doc.setEnd('e2');
    a(doc.data().end === undefined, 'a marker after the last feature is no marker');
    doc.setEnd('');
    a(doc.endIndex() === -1, 'End of Part above every feature');
}
{
    // Reordering: a feature moves with the sketch only it is built from
    const doc = makeDoc(boss({ type: 'distance', value: 10, direction: 'positive' }).features);
    a(doc.canMove('e2', 's1') === null, 'a boss can move before the plate (it is on a face, not on a feature)');
    doc.move('e2', 's1');
    a(ids(doc) === 's2,e2,s1,e1', 'its sketch moves with it', ids(doc));
    const w = makeDoc([
        { id: 'w', type: 'plane', name: 'W', base: XY, offset: 5 },
        rect('s', { ref: 'plane', id: 'w' }, 0, 0, 10, 10)
    ]);
    a(/built from W/.test(w.canMove('s', 'w') || ''), 'a sketch cannot go before its work plane', w.canMove('s', 'w'));
    a(w.move('s', 'w') === false && ids(w) === 'w,s', 'and the move is refused');
    // The marker stays where it was when its own feature moves away
    const m = makeDoc(boss({ type: 'distance', value: 10, direction: 'positive' }).features);
    m.setEnd('e2');
    m.setEnd('e1');
    m.move('e1', null);
    a(ids(m) === 's2,e2,s1,e1' && m.data().end === '', 'the marker keeps its place when e1 moves to the bottom', [ids(m), m.data().end]);
    // Dropped just above End of Part: built
    const b = makeDoc(boss({ type: 'distance', value: 10, direction: 'positive' }).features);
    b.change('add', d => d.features.push({ id: 'x', type: 'point', name: 'X', def: { kind: 'coords', at: [0, 0, 0] } }));
    b.setEnd('e1');
    b.move('x', 's2', true);
    a(ids(b) === 's1,e1,x,s2,e2' && b.data().end === 'x', 'a feature dropped above End of Part is built', [ids(b), b.data().end]);
}
{
    // Visual changes: no rebuild
    const doc = makeDoc(boss({ type: 'distance', value: 10, direction: 'positive' }).features);
    const heard = [];
    doc.onChange(reason => heard.push(reason));
    doc.setShared('s2', true);
    doc.setHidden('s1', true);
    doc.setBodyHidden(1, true);
    doc.setBodyHidden(0, true);
    a(heard.join() === 'visual,visual,visual,visual', 'share, hide and hide body are visual changes', heard);
    a(doc.feature('s2').shared === true && doc.data().hiddenBodies.join() === '0,1', 'they are stored', doc.data().hiddenBodies);
    doc.setBodyHidden(0, false);
    doc.setBodyHidden(1, false);
    a(doc.data().hiddenBodies === undefined, 'no hidden bodies: nothing stored');
    doc.undo();
    a(doc.data().hiddenBodies.join() === '1', 'undo brings a hidden body back');
    a(doc.setShared('e2', true) === false, 'only sketches are shared');
}
{
    // validate keeps a marker only when it names a feature
    const ok = validate({ format: 'aopart', version: 1, units: 'mm', features: plate().features, end: 's1', hiddenBodies: [2, -1, 'x'] });
    a(ok.end === 's1' && ok.hiddenBodies.join() === '2', 'a valid marker and body numbers are kept', ok);
    const bad = validate({ format: 'aopart', version: 1, units: 'mm', features: plate().features, end: 'gone' });
    a(bad.end === undefined, 'a marker naming no feature is dropped');
    // A restored autosave is unsaved in every kind of document
    [createDocument(), createAssemblyDocument(), createDrawingDocument()].forEach((d, i) => {
        a(!d.isDirty(), 'a new document is clean (' + i + ')');
        d.markUnsaved();
        a(d.isDirty(), 'a restored document is unsaved (' + i + ')');
    });
}

/* ---- threads and the linear placement ---- */
a(THREADS.length === 11 && threadById('M6x1').tap === 5 && threadById('M8x1.25').tap === 6.75 && threadById('M7') === null, 'metric threads with their tap drills');
a(THREADS.every(t => t.tap < t.major && t.pitch > 0), 'every tap drill is smaller than the thread');
{
    const l1 = { a: [0, 0], b: [40, 0] };
    const l2 = { a: [0, 0], b: [0, 30] };
    let p = linearPoint(l1, l2, 10, 7, [20, 15]);
    a(p && near(p[0], 7) && near(p[1], 10), '10 from the bottom edge, 7 from the left one', p);
    p = linearPoint(l1, l2, 10, 7, [-20, -15]);
    a(p && near(p[0], -7) && near(p[1], -10), 'on the side of the click', p);
    a(linearPoint(l1, { a: [0, 5], b: [40, 5] }, 10, 7, [1, 1]) === null, 'parallel edges give no point');
}

/* ---- the cards of the new choices ---- */
['distance', 'to', 'next', 'all'].forEach(id => a(sceneFor('extent', id), 'a card for the ' + id + ' extent'));
['equal', 'two', 'angle'].forEach(id => a(sceneFor('chamfer', id), 'a card for the ' + id + ' chamfer'));
['sketch', 'linear'].forEach(id => a(sceneFor('placement', id), 'a card for the ' + id + ' hole placement'));

console.log(failed ? 'FAIL ' + failed + ' checks failed' : 'a6a7: all checks passed');
process.exitCode = failed ? 1 : 0;
