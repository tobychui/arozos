/*
    View and inspect (PROPOSAL.md 14.10, built in 14.28): the part's
    material and its mass. (Previous View, F5, needs the page: checked in
    the browser.)
    Run with: node tests/run.mjs a9
*/

import { MATERIALS, materialById, normalizeMaterial, massOf } from '../js/materials.js';
import { validate } from '../js/document/document.js';

let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};

a(MATERIALS.every(m => m.density > 0 && m.density < 30 && m.label), 'every material has a density and a name');
a(new Set(MATERIALS.map(m => m.id)).size === MATERIALS.length, 'material ids are unique');
a(materialById('steel').density === 7.85 && materialById('nope') === null, 'look up by id');

a(JSON.stringify(normalizeMaterial({ id: 'pla', density: 99 })) === '{"id":"pla","density":1.24}', 'a known material keeps its own density', normalizeMaterial({ id: 'pla', density: 99 }));
a(JSON.stringify(normalizeMaterial({ id: 'custom', density: 2.5 })) === '{"id":"custom","density":2.5}', 'a custom density is kept');
a(normalizeMaterial({ id: 'custom', density: -1 }) === null && normalizeMaterial({ id: 'custom', density: 31 }) === null, 'a custom density out of range is dropped');
a(normalizeMaterial({ id: 'unobtainium' }) === null && normalizeMaterial(null) === null, 'unknown or missing: no material');

const pla = massOf(52971.9, { id: 'pla' });
a(pla && pla.text === '65.69 g' && /PLA \(1\.24/.test(pla.material), 'mass of the sample part in PLA', pla);
const steel = massOf(529719, { id: 'steel' });
a(steel && steel.text === '4.158 kg', 'a kilogram and more is given in kg', steel);
a(massOf(1000, null) === null, 'no material: no mass');

const data = validate({ format: 'aopart', version: 1, features: [], material: { id: 'brass' } });
a(data.material && data.material.id === 'brass' && data.material.density === 8.5, 'a part file keeps its material', data.material);
a(!('material' in validate({ format: 'aopart', version: 1, features: [], material: { id: 'x' } })), 'a bad material is dropped on open');

console.log(failed ? failed + ' checks failed' : 'a9: all checks passed');
process.exitCode = failed ? 1 : 0;
