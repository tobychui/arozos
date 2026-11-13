/*
    Part appearance (js/appearance.js): finishes, clean records, the part
    document keeping them, and the patterns drawing the same every time.
    Run with: node tests/run.mjs appearance
*/
import { FINISHES, finishById, normalizeAppearance, drawPattern, DEFAULT_COLOR, DEFAULT_SCALE } from '../js/appearance.js';
import { validate, createDocument } from '../js/document/document.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

a(new Set(FINISHES.map(f => f.id)).size === FINISHES.length && FINISHES[0].id === 'plain', 'finish ids are unique, plain first');
a(FINISHES.every(f => f.roughness >= 0 && f.roughness <= 1 && f.metalness >= 0 && f.metalness <= 1), 'finishes give valid material values');
a(finishById('nope').id === 'plain' && finishById('wood').pattern === 'wood', 'unknown finishes fall back to plain');

a(normalizeAppearance(null) === null && normalizeAppearance({ color: DEFAULT_COLOR, texture: 'plain', scale: DEFAULT_SCALE }) === null, 'the default look is no record at all');
const n = normalizeAppearance({ color: '#C08A52', texture: 'wood', scale: 12 });
a(n && n.color === '#c08a52' && n.texture === 'wood' && n.scale === 12, 'a record is cleaned', n);
const bad = normalizeAppearance({ color: 'red', texture: 'lava', scale: -3 });
a(bad === null, 'nonsense becomes the default', bad);
a(normalizeAppearance({ color: '#112233' }).texture === 'plain' && normalizeAppearance({ color: '#112233' }).scale === DEFAULT_SCALE, 'missing fields get their defaults');

// The part document keeps the look, and only when there is one
const plain = validate({ format: 'aopart', version: 1, features: [] });
a(!('appearance' in plain), 'a part without a look has no appearance field');
const dressed = validate({ format: 'aopart', version: 1, features: [], appearance: { color: '#3a3d43', texture: 'carbon', scale: 15 } });
a(dressed.appearance && dressed.appearance.texture === 'carbon', 'a part keeps its look', dressed.appearance);
const doc = createDocument();
doc.reset(dressed, 'P', '');
a(!doc.isDirty() && JSON.parse(doc.serialize()).appearance.color === '#3a3d43', 'and saves it again');
doc.change('Appearance', d => { delete d.appearance; });
a(doc.isDirty() && doc.undo() === 'Appearance' && doc.data().appearance.texture === 'carbon', 'a change of look is one undo step');

// Patterns draw the same every time (a recording 2D context)
function recorder(size) {
    const log = [];
    const pixels = new Uint8ClampedArray(size * size * 4);
    return {
        log: log,
        set fillStyle(v) { log.push('fill ' + v); },
        set strokeStyle(v) { log.push('stroke ' + v); },
        set globalAlpha(v) { log.push('alpha ' + v); },
        set lineWidth(v) { log.push('width ' + v); },
        fillRect: (...args) => log.push('rect ' + args.map(v => v.toFixed(3)).join()),
        beginPath: () => {},
        moveTo: (x, y) => log.push('m ' + x.toFixed(3) + ',' + y.toFixed(3)),
        lineTo: (x, y) => log.push('l ' + x.toFixed(3) + ',' + y.toFixed(3)),
        stroke: () => {},
        getImageData: () => ({ data: pixels }),
        putImageData: (img) => log.push('img ' + img.data.slice(0, 64).join()),
        createLinearGradient: () => ({ addColorStop: (o, c) => log.push('stop ' + o + c) })
    };
}
['brushed', 'speckle', 'fine', 'wood', 'weave'].forEach(pattern => {
    const r1 = recorder(32);
    const r2 = recorder(32);
    drawPattern(r1, 32, pattern);
    drawPattern(r2, 32, pattern);
    a(r1.log.length > 3 && r1.log.join('|') === r2.log.join('|'), pattern + ' draws the same every time');
});

console.log(failed ? failed + ' failed' : 'appearance: all passed');
process.exitCode = failed ? 1 : 0;
