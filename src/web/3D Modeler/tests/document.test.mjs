import { createDocument, validate, lastExtrudeDistance } from '../js/document/document.js';
import { sampleDocument } from '../js/document/sample.js';
const d = createDocument(); const ev = []; d.onChange(r => ev.push(r));
d.reset(sampleDocument(), 'S', '');
const a = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } };
a(!d.isDirty(), 'clean after reset');
a(d.rename('f2', 'Base') && d.feature('f2').name === 'Base' && d.isDirty(), 'rename');
a(!d.rename('f2', 'Base'), 'no-op change makes no undo step');
a(d.setSuppressed('f6', true) && d.feature('f6').suppressed, 'suppress');
a(d.remove('f3') && d.features().length === 4 && !d.feature('f4'), 'remove sketch takes its extrusion');
a(d.undo() === 'Delete Sketch2' && d.features().length === 6, 'undo delete');
a(d.undo().startsWith('Suppress') && !d.feature('f6').suppressed, 'undo suppress');
a(d.redo() && d.feature('f6').suppressed, 'redo');
a(d.undo() && d.undo() && !d.isDirty() && !d.canUndo(), 'back to saved state is clean');
a(d.newId() === 'f7' && d.newName('extrude') === 'Extrusion4', 'new id and name');
const round = validate(JSON.parse(d.serialize()));
a(JSON.stringify(round) === JSON.stringify(d.data()), 'serialize round trip');
for (const bad of [null, {}, { format: 'aopart', version: 99, features: [] }, { format: 'aopart', version: 1, features: [{ id: 'a', type: 'x' }, { id: 'a', type: 'x' }] }]) { let threw = false; try { validate(bad); } catch (e) { threw = true; } a(threw, 'rejects ' + JSON.stringify(bad)); }
// A new extrusion starts from the newest one that goes a distance
{
    const ex = (extent) => ({ id: 'e', type: 'extrude', extent: extent });
    a(lastExtrudeDistance([]) === null && lastExtrudeDistance(null) === null, 'no extrusion: no distance');
    const got = lastExtrudeDistance([ex({ type: 'distance', value: 7 }), { type: 'sketch' }, ex({ type: 'distance', value: 2, direction: 'positive' }), ex({ type: 'all' })]);
    a(got && got.value === 2 && got.value2 === 2 && got.expr === null, 'the newest distance extrusion, skipping Through All');
    const asym = lastExtrudeDistance([ex({ type: 'distance', value: 3, value2: 5, expr: 'wall', direction: 'asymmetric' })]);
    a(asym && asym.value === 3 && asym.value2 === 5 && asym.expr === 'wall', 'both distances and the formula');
    a(lastExtrudeDistance([ex({ value: 4 })]).value === 4, 'an extent with no type is a distance');
}
console.log('events', ev.join(','), process.exitCode ? 'FAILED' : 'document tests passed');
