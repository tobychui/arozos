/*
    Part appearance (js/appearance.js): finishes, clean records, the part
    document keeping them, pictures and rotation, painted faces and how
    they are found again, the scene settings, and the patterns drawing the
    same every time.
    Run with: node tests/run.mjs appearance
*/
import {
    FINISHES, finishById, normalizeAppearance, drawPattern, DEFAULT_COLOR, DEFAULT_SCALE, MAX_IMAGE_CHARS,
    faceSignature, faceRef, matchFaces, paintFaces, clearFaces, normalizeScene, DEFAULT_SCENE, LIGHTING, lightingById
} from '../js/appearance.js';
import { textureSize } from '../js/io/image.js';
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

/* ---- pictures and rotation ---- */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pic = normalizeAppearance({ color: '#ffffff', texture: 'image', scale: 100, image: PNG });
a(pic && pic.texture === 'image' && pic.image === PNG && pic.scale === 100, 'an Image finish keeps its picture', pic);
a(normalizeAppearance({ color: '#ffffff', texture: 'image', scale: 100 }).texture === 'plain', 'an Image finish without a picture is plain');
a(normalizeAppearance({ texture: 'image', image: 'javascript:alert(1)' }) === null, 'only picture data URLs are kept');
a(normalizeAppearance({ texture: 'image', image: 'data:image/svg+xml;base64,PHN2Zz4=' }) === null, 'no SVG (it could carry script)');
a(normalizeAppearance({ texture: 'image', image: 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_CHARS) }) === null, 'a picture too large is dropped');
a(!('image' in normalizeAppearance({ color: '#112233', texture: 'wood', image: PNG })), 'another finish drops the picture');
a(normalizeAppearance({ texture: 'wood', rotation: 450 }).rotation === 90, 'rotation is kept within a turn');
a(normalizeAppearance({ texture: 'wood', rotation: -90 }).rotation === 270, 'negative rotation turns the other way');
a(!('rotation' in normalizeAppearance({ texture: 'wood', rotation: 720 })) && normalizeAppearance({ rotation: 360 }) === null, 'a whole turn is no rotation');
a(normalizeAppearance({ rotation: 30 }).rotation === 30, 'rotation alone is a look of its own');
const big = textureSize(4000, 3000, 1024);
a(big[0] === 1024 && big[1] === 768 && textureSize(300, 200, 1024).join() === '300,200', 'pictures are made at most 1024 pixels on the long side', big);

/* ---- painted faces ---- */
a(faceSignature({ type: 'plane', normal: [0, -0.0000001, 1] }) === 'plane:0,0,1', 'a plane by the way it faces (no -0)');
const cylA = faceSignature({ type: 'cylinder', radius: 5, axis: { o: [0, 0, 0], d: [0, 0, 1] } });
const cylB = faceSignature({ type: 'cylinder', radius: 5, axis: { o: [3, 0, 0], d: [0, 0, -1] } });
a(cylA === cylB && cylA === 'cylinder:5:0,0,1', 'a cylinder by radius and axis, either way along it', [cylA, cylB]);
a(faceSignature({ type: 'other' }) === 'other' && faceSignature(null) === '', 'other surfaces by type');

const topFace = { type: 'plane', normal: [0, 0, 1], centre: [40, 25, 12], area: 3200 };
const wallFace = { type: 'plane', normal: [1, 0, 0], centre: [80, 25, 6], area: 600 };
const boss = { type: 'cylinder', radius: 13, axis: { o: [55, 25, 0], d: [0, 0, 1] }, centre: [55, 25, 26], area: 1150 };
const refTop = faceRef(topFace, 0);
a(refTop.sig === 'plane:0,0,1' && refTop.body === 0 && refTop.centre.join() === '40,25,12', 'a face reference', refTop);
a(matchFaces([wallFace, topFace, boss], [refTop], 0).join() === '-1,0,-1', 'found where it was');
a(matchFaces([wallFace, topFace], [refTop], 1).join() === '-1,-1', 'only on its own body');
// Moved up by a thicker plate, and a little sideways by a longer one
const moved = { type: 'plane', normal: [0, 0, 1], centre: [43, 25, 18], area: 3500 };
a(matchFaces([wallFace, moved], [refTop], 0).join() === '-1,0', 'found again after an edit moved it');
// Split in two by a groove a later feature cut across it
const left = { type: 'plane', normal: [0, 0, 1], centre: [24, 25, 18], area: 1700 };
const right = { type: 'plane', normal: [0, 0, 1], centre: [61, 25, 18], area: 1300 };
const far = { type: 'plane', normal: [0, 0, 1], centre: [300, 25, 18], area: 400 };
a(matchFaces([left, right, far, wallFace], [refTop], 0).join() === '0,0,-1,-1', 'both pieces of a split face, not a face far away');
const step = { type: 'plane', normal: [0, 0, 1], centre: [40, 60, 30], area: 3000 };
a(matchFaces([moved, step], [refTop], 0).join() === '0,-1', 'not another face of the same kind that would make the area too large');
a(matchFaces([{ type: 'plane', normal: [0, 0, 1], centre: [400, 25, 12], area: 3200 }], [refTop], 0).join() === '-1', 'a face that went away is not painted elsewhere');
a(matchFaces([topFace], [refTop, Object.assign({}, refTop)], 0).join() === '1', 'the look painted last wins');

let look = paintFaces(null, [refTop], '#d64545', 'plain');
a(look && look.faces.length === 1 && look.faces[0].color === '#d64545' && look.color === DEFAULT_COLOR, 'painting a face of a part with no look', look);
look = paintFaces(look, [faceRef(boss, 0)], '#34373c', 'rubber');
look = paintFaces(look, [refTop], '#2f7fe0', 'glossy');
a(look.faces.length === 2 && look.faces[1].color === '#2f7fe0' && look.faces[1].texture === 'glossy', 'painting a painted face paints it over', look.faces);
a(paintFaces(look, [refTop], '#123456', 'image').faces[1].texture === 'plain', 'faces take no pictures');
const lessOne = clearFaces(look, [refTop]);
a(lessOne.faces.length === 1 && lessOne.faces[0].texture === 'rubber', 'removing the paint of one face');
a(clearFaces(look, null) === null, 'removing all paint of a part with no other look leaves no record');
a(clearFaces(Object.assign({}, look, { texture: 'wood' }), null).texture === 'wood', 'and keeps the part\'s own look');
const dirty = normalizeAppearance({ faces: [{ centre: [1, 2], area: 3 }, { centre: [1, 2, 3], area: -1 }, { centre: [1, 2, 3], area: 5, color: 'red', texture: 'lava', body: -2 }] });
a(dirty.faces.length === 1 && dirty.faces[0].color === DEFAULT_COLOR && dirty.faces[0].texture === 'plain' && dirty.faces[0].body === 0, 'face records are cleaned', dirty);
const kept = validate({ format: 'aopart', version: 1, features: [], appearance: look });
a(kept.appearance && kept.appearance.faces.length === 2, 'the part document keeps painted faces', kept.appearance);

/* ---- the scene ---- */
a(JSON.stringify(normalizeScene(null)) === JSON.stringify(DEFAULT_SCENE), 'the default scene');
const sc = normalizeScene({ lighting: 'warm', shadows: true, ground: 'yes', textures: false });
a(sc.lighting === 'warm' && sc.shadows === true && sc.ground === false && sc.textures === false && sc.reflections === true, 'a scene is cleaned', sc);
a(normalizeScene({ lighting: 'disco' }).lighting === 'studio' && lightingById('nope').id === 'studio', 'unknown lighting is the studio');
a(new Set(LIGHTING.map(l => l.id)).size === LIGHTING.length && LIGHTING.every(l => l.hemi > 0 && l.headIntensity > 0), 'lighting presets are distinct and light something');

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
