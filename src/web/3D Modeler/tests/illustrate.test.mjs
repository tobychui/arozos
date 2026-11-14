/*
    The pictures beside and inside panels: the animated scenes of
    constraint types and Booleans (js/features/illustrations.js), the Hole
    panel's section (js/features/holefigure.js), and the mesh export
    choices and sizes (js/io/exportdialog.js).
    Run with: node tests/run.mjs illustrate
*/
import { SCENES, COLORS, sceneFor, progress, renderFrame, sceneBounds, project, box, above, layer } from '../js/features/illustrations.js';
import { holeFigure, holeShape } from '../js/features/holefigure.js';
import { MESH_LEVELS, levelById, formatSize } from '../js/io/exportdialog.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const finite = p => p.every(Number.isFinite);

/* ---- every type a panel offers has a scene ---- */
['mate', 'flush', 'angle', 'tangent', 'insert'].forEach(id => a(sceneFor('constraint', id), 'a scene for the ' + id + ' constraint'));
['join', 'cut', 'intersect', 'new'].forEach(id => a(sceneFor('operation', id), 'a scene for the ' + id + ' Boolean'));
a(sceneFor('constraint', 'nope') === null, 'no scene for an unknown type');

/* ---- the scenes draw at every moment ---- */
Object.keys(SCENES).forEach(key => {
    const sc = SCENES[key];
    a(sc.title && sc.text && typeof sc.frame === 'function', key + ' has a title, a text and frames');
    [0, 0.1, 0.33, 0.5, 0.77, 1].forEach(t => {
        const out = sc.frame(t);
        const ok = (out.faces || []).every(f => f.p.length >= 3 && f.p.every(finite) && finite(f.n) && COLORS[f.color] && f.alpha >= 0 && f.alpha <= 1) &&
            (out.lines || []).every(l => finite(l.a) && finite(l.b) && COLORS[l.color]) &&
            (out.arrows || []).every(r => finite(r.from) && finite(r.dir) && COLORS[r.color]);
        a(ok, key + ' at ' + t + ': faces, lines and arrows are well formed');
        const svg = renderFrame(out, 0.3);
        a(svg.length > 100 && !/NaN|undefined|Infinity/.test(svg), key + ' at ' + t + ' renders', svg.slice(0, 80));
    });
    const b = sceneBounds(sc);
    a(b.w > 0 && b.h > 0 && Math.abs(b.w / b.h - 244 / 150) < 1e-9, key + ': its view keeps the card\'s proportions', b);
    // Something moves between the start and the end
    a(renderFrame(sc.frame(0), 1) !== renderFrame(sc.frame(1), 1), key + ': the start and the end differ');
});

/* ---- the timing: a pause, the change, a pause ---- */
a(progress(0) === 0 && progress(0.1) === 0 && progress(0.8) === 1 && progress(0.99) === 1, 'it rests before and after the change');
let last = -1;
let monotonic = true;
for (let p = 0; p < 1; p += 0.01) {
    const v = progress(p);
    monotonic = monotonic && v >= last;
    last = v;
}
a(monotonic && Math.abs(progress(1.4) - progress(0.4)) < 1e-9, 'the change only goes forward, and loops');

/* ---- drawing: back faces are left out, nearer faces drawn last ---- */
const cube = box([0, 0, 0], [10, 10, 10]);
const shown = renderFrame({ faces: cube }, 1).match(/<polygon/g).length;
a(shown === 3, 'a box shows three faces from the isometric view', shown);
// A small part on a plate: every face of the part comes after the plate's
const fills = renderFrame({ faces: box([0, 0, 0], [30, 30, 1], { color: 'grey' }).concat(layer(box([2, 2, 1], [6, 6, 5], { color: 'orange' }))) }, 1)
    .match(/fill="rgb\((\d+),(\d+),(\d+)\)"/g).map(f => f.match(/\d+/g).map(Number));
const kinds = fills.map(c => (c[0] / c[1] > 1.2 ? 'orange' : 'grey'));
a(kinds.join() === 'grey,grey,grey,orange,orange,orange', 'the part on top is drawn after the plate under it', kinds);
const p = project([10, 0, 0]);
a(p[0] > 0 && p[1] > 0 && project([0, 0, 10])[1] < 0, 'X goes right and down, Z up');
const cut = above(box([0, 0, 0], [10, 10, 10]), 4);
a(cut.every(f => f.p.every(q => q[2] >= 4 - 1e-9)) && cut.length === 5, 'a part going into a hole is cut at the face', cut.length);

/* ---- the Hole panel's section ---- */
const base = { kind: 'simple', diameter: 5, through: false, depth: 10, drillPoint: false, flip: false, cbDiameter: 9, cbDepth: 5, csDiameter: 10, csAngle: 90 };
['simple', 'counterbore', 'countersink'].forEach(kind => [false, true].forEach(through => [false, true].forEach(drill => [false, true].forEach(flip => {
    const d = Object.assign({}, base, { kind: kind, through: through, drillPoint: drill, flip: flip });
    const s = holeFigure(d, null);
    const tag = [kind, through ? 'through' : 'depth', drill ? 'point' : 'flat', flip ? 'flipped' : 'default'].join(' ');
    a(!/NaN|undefined/.test(s), tag + ': draws');
    a(s.includes('data-focus="diameter"') && s.includes('⌀5 mm'), tag + ': the diameter is written');
    a(s.includes('data-focus="depth"') === !through && s.includes('Through All') === through, tag + ': depth, or Through All');
    a(s.includes('118° point') === (drill && !through), tag + ': the drill point when there is one');
    a(s.includes('data-focus="cbDiameter"') === (kind === 'counterbore') && s.includes('data-focus="cbDepth"') === (kind === 'counterbore'), tag + ': the counterbore sizes');
    a(s.includes('data-focus="csDiameter"') === (kind === 'countersink') && s.includes('data-focus="csAngle"') === (kind === 'countersink'), tag + ': the countersink sizes');
}))));
const cs = holeFigure(Object.assign({}, base, { kind: 'countersink', csDiameter: 6, csAngle: 82 }), null);
a(cs.includes('⌀6 mm') && cs.includes('82°'), 'the real values are written, not the picture\'s', cs.match(/data-focus="cs[^<]*/g));
a(holeFigure(base, 'depth').includes('hf-label on" data-focus="depth"') && !holeFigure(base, null).includes(' on"'), 'the size with the caret is coloured');
a(holeFigure(base, null) !== holeFigure(Object.assign({}, base, { flip: true }), null), 'Flipped draws the hole the other way');
const narrow = holeShape(Object.assign({}, base, { kind: 'countersink', csAngle: 60 }));
const wide = holeShape(Object.assign({}, base, { kind: 'countersink', csAngle: 120 }));
a(narrow.seatDepth > wide.seatDepth, 'a sharper countersink is drawn deeper', [narrow.seatDepth, wide.seatDepth]);

/* ---- mesh export choices ---- */
a(MESH_LEVELS.every((l, i) => i === 0 || l.deflection < MESH_LEVELS[i - 1].deflection), 'each level is finer than the one before');
a(levelById('nope').id === 'normal' && levelById('fine').deflection === 0.01, 'unknown levels fall back to normal');
a(formatSize(840) === '840 bytes' && formatSize(69884) === '68 KB' && formatSize(11175) === '11 KB' && formatSize(5 * 1024) === '5.0 KB' && formatSize(3.2 * 1024 * 1024) === '3.2 MB', 'sizes read as people say them',
    [formatSize(840), formatSize(69884), formatSize(11175), formatSize(5 * 1024), formatSize(3.2 * 1024 * 1024)]);

console.log(failed ? failed + ' failed' : 'illustrate: all passed');
process.exitCode = failed ? 1 : 0;
