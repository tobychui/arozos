/*
    Drawings without the kernel: sheets and scales, view directions, the
    text of dimensions, edge clean-up, the layout of dimensions, and the
    SVG, PDF and DXF writers.
    Run with: node tests/run.mjs drawing
*/
import * as S from '../js/drawing/sheet.js';
import * as F from '../js/drawing/format.js';
import * as G2 from '../js/drawing/geometry2d.js';
import * as L from '../js/drawing/layout.js';
import { textWidth } from '../js/drawing/font.js';
import { createDrawingDocument, validateDrawing, emptyDrawing } from '../js/drawing/document.js';
import { toSVG } from '../js/io/drawsvg.js';
import { toPDF } from '../js/io/pdf.js';
import { toDXF, dxfText } from '../js/io/dxf.js';
import { withResolution } from '../js/io/png.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);
const nearV = (p, q, t) => p.length === q.length && p.every((v, i) => near(v, q[i], t));

/* ---- sheets, units, scales ---- */
a(nearV(S.presetSize('A4', 'portrait'), [210, 297]) && nearV(S.presetSize('A3', 'landscape'), [420, 297]), 'preset sizes turn with the orientation');
a(near(S.toMm(1, 'in'), 25.4) && near(S.toMm(300, 'px', 300), 25.4) && near(S.fromMm(25.4, 'px', 600), 600), 'sizes in inches and pixels');
a(nearV(S.pixelSize({ width: 297, height: 210, dpi: 300 }), [3508, 2480]), 'A4 at 300 dpi is 3508 x 2480 pixels');
a(S.parseScale('1:2') === 0.5 && S.parseScale('2:1') === 2 && S.parseScale(' 1 : 2.5 ') === 0.4 && S.parseScale('0.25') === 0.25, 'scales are read');
a(S.parseScale('x') === null && S.parseScale('0') === null && S.parseScale('1:0') === null, 'nonsense is not a scale');
a(S.scaleText(0.5) === '1:2' && S.scaleText(2) === '2:1' && S.scaleText(1) === '1:1' && S.scaleText(0.4) === '1:2.5', 'scales are written');

/* ---- view directions ---- */
const front = S.orientation('front');
a(nearV(S.upOf(front), [0, 0, 1]), 'the front view has Z up');
const top = S.orientation('top');
a(nearV(S.upOf(top), [0, 1, 0]), 'the top view has Y up');
// Third angle: the view on the right is seen from the right, the one above from the top
let f = S.projectedFrame(front, 'right', 'third');
a(nearV(f.dir, [1, 0, 0]) && nearV(f.xdir, [0, 1, 0]), 'third angle, right of front: the right view', f);
f = S.projectedFrame(front, 'top', 'third');
a(nearV(f.dir, [0, 0, 1]) && nearV(f.xdir, [1, 0, 0]), 'third angle, above front: the top view', f);
// First angle swaps them
f = S.projectedFrame(front, 'right', 'first');
a(nearV(f.dir, [-1, 0, 0]) && nearV(f.xdir, [0, -1, 0]), 'first angle, right of front: the left view', f);
f = S.projectedFrame(front, 'top', 'first');
a(nearV(f.dir, [0, 0, -1]) && nearV(f.xdir, [1, 0, 0]) && nearV(S.upOf(f), [0, -1, 0]), 'first angle, above front: the bottom view', f);
// Aligned views share the axis they line up along
['right', 'left'].forEach(rel => ['first', 'third'].forEach(p => {
    a(nearV(S.upOf(S.projectedFrame(front, rel, p)), S.upOf(front)), rel + ' (' + p + ') keeps the paper up of its parent');
}));
['top', 'bottom'].forEach(rel => ['first', 'third'].forEach(p => {
    a(nearV(S.projectedFrame(front, rel, p).xdir, front.xdir), rel + ' (' + p + ') keeps the paper right of its parent');
}));
const iso = [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)];
f = S.projectedFrame(front, 'tr', 'third');
a(nearV(f.dir, iso, 1e-9) && f.xdir[2] === 0, 'third angle: the top right corner is the iso view from front, right and top', f);
f = S.projectedFrame(front, 'br', 'first');
a(nearV(f.dir, [-iso[0], iso[1], iso[2]], 1e-9), 'first angle: the bottom right corner looks from the top left', f);
// Swapping sides gives the same direction under the other rule (Sheet Setup keeps placed views so)
[['right', 'left'], ['top', 'bottom'], ['tr', 'bl'], ['tl', 'br']].forEach(pair => {
    const g1 = S.projectedFrame(front, pair[0], 'first');
    const g2 = S.projectedFrame(front, pair[1], 'third');
    a(nearV(g1.dir, g2.dir, 1e-9) && nearV(g1.xdir, g2.xdir, 1e-9), pair[0] + ' in first angle = ' + pair[1] + ' in third angle');
});
a(S.orientationKey(S.orientation('isoTR')) === 'isoTR' && S.orientationKey({ dir: [0, -1, 0], xdir: [1, 0, 0] }) === 'front', 'named orientations are recognised');
a(S.sideFor(50, 3) === 'right' && S.sideFor(-2, -40) === 'bottom' && S.sideFor(30, 30) === 'tr', 'the side of a parent the pointer asks for');
const box = S.boxOnPaper(front, [[0, 0, 0], [80, 50, 12]]);
a(nearV(box, [0, 0, 80, 12]), 'a box seen from the front', box);

/* ---- text of dimensions ---- */
const style = F.defaultStyle();
a(F.formatLength(25, 'linear', null, style) === '25' && F.formatLength(12.5, 'linear', null, style) === '12.5', 'lengths drop trailing zeros');
a(F.formatLength(25.4, 'linear', { units: 'in', precision: 3 }, style) === '1', 'inches');
a(F.formatLength(12.345, 'linear', null, Object.assign({}, style, { trailingZeros: true, showUnits: true })) === '12.35 mm', 'trailing zeros and the unit when asked');
a(F.formatLength(4, 'radius', null, style) === 'R4' && F.formatLength(8, 'diameter', null, style) === F.DIAMETER + '8', 'radius and diameter symbols');
a(F.formatLength(8, 'diameter', { prefix: '' }, style) === '8', 'the symbol is a prefix that can be cleared');
a(F.formatLength(50, 'linear', { prefix: '2x ', suffix: ' TYP', precision: 1 }, style) === '2x 50 TYP', 'prefix and suffix');
a(F.formatLength(50, 'linear', { tol: { type: 'sym', upper: 0.1 } }, style) === '50 ' + F.PLUSMINUS + '0.1', 'symmetric tolerance');
a(F.formatLength(50, 'linear', { tol: { type: 'dev', upper: 0.1, lower: 0.05 } }, style) === '50 +0.1/-0.05', 'deviation');
a(F.formatAngle(45, null, style) === '45' + F.DEGREE && F.formatAngle(30.25, { precision: 2 }, style) === '30.25' + F.DEGREE, 'angles');
a(F.formatHole(8, 4, null, style) === '4x ' + F.DIAMETER + '8' && F.formatHole(8, 1, null, style) === F.DIAMETER + '8', 'hole notes count the holes');
a(F.formatLength(1000, 'linear', { units: 'm' }, style) === '1' && F.formatLength(304.8, 'linear', { units: 'ft' }, style) === '1', 'metres and feet');
a(near(textWidth('10', 3.5), 2 * 0.556 * 3.5 / 0.718), 'text width from Helvetica metrics');

/* ---- clean edges ---- */
// A circle cut into pieces with a speck between them, and an edge-on circle (there and back)
const circlePiece = (c, r, a0, a1, n) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = a0 + (a1 - a0) * i / n;
        pts.push(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t));
    }
    return pts;
};
const raw = [
    { visible: true, kind: 'sharp', type: 'curve', pts: circlePiece([10, 5], 3, 0, 2, 20) },
    { visible: true, kind: 'sharp', type: 'curve', pts: circlePiece([10, 5], 3, 2, 4.5, 20) },
    { visible: true, kind: 'sharp', type: 'curve', pts: circlePiece([10, 5], 3, 4.5, 2 * Math.PI, 20) },
    { visible: true, kind: 'sharp', type: 'curve', pts: [0, 0, 5, 0, 10, 0, 5, 0, 0, 0] },
    { visible: false, kind: 'sharp', type: 'curve', pts: circlePiece([10, 5], 3, 1, 1.5, 6) },
    { visible: true, kind: 'sharp', type: 'line', pts: [0, 0, 0, 20] },
    { visible: true, kind: 'sharp', type: 'line', pts: [1, 1, 1, 1.00001] }
];
const clean = G2.cleanEdges(raw);
const circles = clean.filter(e => e.type === 'circle');
a(circles.length === 1 && circles[0].closed && near(circles[0].r, 3, 1e-6) && nearV(circles[0].c, [10, 5], 1e-6), 'pieces of a circle join into one full circle', circles);
a(clean.some(e => e.type === 'line' && nearV([e.a[0], e.a[1], e.b[0], e.b[1]].map(Math.abs).sort(), [0, 0, 0, 10].sort())), 'an edge-on circle becomes a line');
a(!clean.some(e => !e.visible && e.type !== 'line'), 'a hidden piece under a visible circle goes');
a(clean.length === 3, 'specks are dropped', clean.map(e => e.type));
const snaps = G2.snapPoints(clean);
a(snaps.some(s => s.kind === 'center' && nearV(s.p, [10, 5], 1e-6)) && snaps.some(s => s.kind === 'mid' && nearV(s.p, [0, 10])), 'snap points: centres, ends and middles');
a(G2.edgeAt(clean, [10, 8.1], 0.5) === circles[0], 'the edge under a point');
a(G2.countCircles([circles[0], Object.assign({}, circles[0], { c: [20, 5] }), Object.assign({}, circles[0], { r: 4 })], 3) === 2, 'equal holes are counted');
a(nearV(G2.lineIntersection([0, 0], [1, 0], [5, -1], [5, 1]), [5, 0]) && G2.lineIntersection([0, 0], [1, 0], [0, 1], [1, 1]) === null, 'line intersections');
const arcEdges = G2.cleanEdges([{ visible: true, kind: 'sharp', type: 'curve', pts: circlePiece([0, 0], 5, Math.PI / 2, 0, 12) }]);
a(arcEdges[0].type === 'circle' && !arcEdges[0].closed && near(arcEdges[0].a0, 0, 1e-6) && near(arcEdges[0].sweep, Math.PI / 2, 1e-6), 'an arc drawn clockwise is stored counter-clockwise', arcEdges[0]);

/* ---- document ---- */
const doc = createDrawingDocument();
doc.change('Add', d => {
    d.sources.s1 = { name: 'Plate', kind: 'part', path: 'user:/Desktop/Plate.aopart' };
    d.views.push({ id: 'v1', name: 'VIEW1', source: 's1', dir: [0, -1, 0], xdir: [1, 0, 0], x: 100, y: 150, scale: null, hidden: true });
    d.views.push({ id: 'v2', name: 'VIEW2', source: 's1', parent: 'v1', rel: 'right', x: 250, y: 150, scale: null });
    d.views.push({ id: 'v3', name: 'VIEW3', source: 's1', parent: 'v2', rel: 'top', x: 250, y: 250, scale: null });
    d.annotations.push({ id: 'd1', type: 'linear', view: 'v2', p1: [0, 0], p2: [10, 0], orient: 'h', at: [5, -10] });
    d.annotations.push({ id: 'd2', type: 'text', view: null, at: [20, 20], text: 'Free text' });
});
a(doc.descendants('v1').map(v => v.id).join() === 'v2,v3' && doc.baseOf(doc.view('v3')).id === 'v1', 'projected views know their base');
a(doc.newViewName() === 'VIEW4' && doc.newId('v') === 'v4' && doc.sourceByPath('user:/Desktop/Plate.aopart') === 's1', 'names, ids, sources by path');
const again = validateDrawing(JSON.parse(doc.serialize()));
a(again.views.length === 3 && again.sheet.preset === 'A3' && again.style.textHeight === 3.5, 'a saved drawing reads back');
doc.change('Delete', d => doc.removeViews(d, ['v2']));
a(doc.views().length === 1 && doc.annotations().length === 1 && doc.annotations()[0].id === 'd2' && doc.data().sources.s1, 'deleting a view takes its projected views and dimensions along');
doc.change('Delete', d => doc.removeViews(d, ['v1']));
a(!doc.data().sources.s1, 'a model no view shows is dropped');
doc.undo();
a(doc.views().length === 1 && doc.canRedo(), 'undo');
let threw = false;
try {
    validateDrawing({ format: 'aodrw', version: 1, views: [{ id: 'a', source: 'nope', dir: [0, 0, 1], xdir: [1, 0, 0] }] });
} catch (e) {
    threw = /does not list/.test(e.message);
}
a(threw, 'a view of a missing model is refused');

/* ---- layout ---- */
const data = emptyDrawing();
data.sources.s1 = { name: 'P', kind: 'part', path: '' };
data.views.push({ id: 'v1', name: 'VIEW1', source: 's1', dir: [0, -1, 0], xdir: [1, 0, 0], x: 50, y: 100, scale: 2, hidden: true, centers: true, label: true });
data.views.push({ id: 'v2', name: 'VIEW2', source: 's1', parent: 'v1', rel: 'right', x: 200, y: 100, scale: null });
a(L.scaleOf(data, data.views[1]) === 2, 'a projected view takes its parent scale');
a(nearV(L.frameOf(data, data.views[1]).dir, [-1, 0, 0]), 'first angle by default: the left view on the right');
const proj = { v1: { edges: G2.cleanEdges([
    { visible: true, kind: 'sharp', type: 'line', pts: [0, 0, 40, 0] },
    { visible: true, kind: 'sharp', type: 'line', pts: [40, 0, 40, 20] },
    { visible: false, kind: 'sharp', type: 'line', pts: [10, 0, 10, 20] },
    { visible: true, kind: 'sharp', type: 'circle', c: [20, 10], r: 4, pts: circlePiece([20, 10], 4, 0, 2 * Math.PI, 24) }
]), box: [0, 0, 40, 20] } };
data.annotations.push({ id: 'd1', type: 'linear', view: 'v1', p1: [0, 0], p2: [40, 0], orient: 'h', at: [20, -8] });
data.annotations.push({ id: 'd2', type: 'diameter', view: 'v1', c: [20, 10], r: 4, at: [35, 30] });
data.annotations.push({ id: 'd3', type: 'angle', view: 'v1', l1: [[0, 0], [40, 0]], l2: [[0, 0], [30, 30]], at: [15, 5] });
data.annotations.push({ id: 'd4', type: 'note', view: 'v1', p: [40, 10], at: [55, 25], text: 'Polish', end: 'dot' });
data.annotations.push({ id: 'd5', type: 'hole', view: 'v1', c: [20, 10], r: 4, count: 2, at: [-10, 30] });
data.sheet.fields.title = 'Bracket';
const groups = L.build(data, proj, { estimate: () => [0, 0, 10, 10] });
const owner = o => groups.filter(g => g.owner === o)[0];
a(groups.length === 1 + 2 + 5, 'sheet, two views, five annotations', groups.map(g => g.owner));
const v1 = owner('view:v1');
a(v1.items.some(i => i.t === 'line' && i.layer === 'hidden') && v1.items.some(i => i.t === 'circle' && near(i.r, 8)) && v1.items.filter(i => i.layer === 'center').length === 2, 'a view: hidden lines, circles at scale, a centre mark');
a(nearV(v1.box, [50, 100, 130, 140]), 'the sheet box of a view at 2:1', v1.box);
a(v1.items.some(i => i.t === 'text' && i.text === 'SCALE 2:1'), 'a view label with its scale');
a(owner('view:v2').pending && owner('view:v2').box, 'a view without edges yet has an estimated box');
const texts = g => owner(g).items.filter(i => i.t === 'text').map(i => i.text);
a(texts('ann:d1')[0] === '40', 'the linear dimension measures the model, not the paper', texts('ann:d1'));
a(texts('ann:d2')[0] === F.DIAMETER + '8', 'diameter text', texts('ann:d2'));
a(texts('ann:d3')[0] === '45' + F.DEGREE, 'angle between the lines on the side of the text', texts('ann:d3'));
a(texts('ann:d4')[0] === 'Polish' && owner('ann:d4').items.some(i => i.filled), 'a note with a dot end');
a(texts('ann:d5')[0] === '2x ' + F.DIAMETER + '8', 'a hole note');
const d1 = owner('ann:d1').items;
a(d1.filter(i => i.t === 'fill').length === 2 && d1.some(i => i.t === 'line' && near(i.a[1], 84) && near(i.b[1], 84)), 'two arrows and a dimension line 16 mm (8 x 2) below', d1.filter(i => i.t === 'line'));
const frame = owner('sheet').items;
a(frame.some(i => i.layer === 'border') && frame.some(i => i.t === 'text' && i.text === 'Bracket') && frame.some(i => i.t === 'text' && i.text === '1:1'), 'border and title block with title and scale');
const span = L.angleSpan([[0, 0], [10, 0]], [[0, 0], [0, 10]], [-5, 5]);
a(span && near(span.sweep, Math.PI / 2) && near(span.start, Math.PI / 2), 'the angle on the other side of a line', span);
const ib = L.itemsBox(owner('ann:d1').items);
a(ib && ib[1] < 84 && ib[3] > 84, 'the box of an annotation');

/* ---- writers ---- */
const svg = toSVG(groups, data.sheet, { title: 'Bracket' });
a(svg.startsWith('<?xml') && /width="420mm" height="297mm"/.test(svg) && /stroke-dasharray="3 1.5"/.test(svg) && svg.indexOf('>Bracket</text>') > 0, 'SVG file at paper size with dashed hidden lines');
const pdf = toPDF(groups, data.sheet, { title: 'Bracket' });
const pdfText = Buffer.from(pdf).toString('latin1');
a(pdfText.startsWith('%PDF-1.4') && pdfText.trim().endsWith('%%EOF') && /\/MediaBox \[0 0 1190\.551 841\.89\]/.test(pdfText), 'PDF page at A3 size', pdfText.slice(0, 80));
const xrefAt = +/startxref\n(\d+)/.exec(pdfText)[1];
a(pdfText.slice(xrefAt, xrefAt + 4) === 'xref', 'the PDF cross reference table is where the trailer says');
const objOffsets = [...pdfText.matchAll(/(\d{10}) 00000 n/g)].map(m => +m[1]);
a(objOffsets.every((o, i) => pdfText.slice(o).startsWith((i + 1) + ' 0 obj')), 'every PDF object is where the table says');
a(/\(Bracket\) Tj/.test(pdfText) && /\(\\3308\) Tj/.test(pdfText) && / c\n/.test(pdfText), 'PDF text (with the diameter sign) and curves');
const rasterized = toPDF([{ owner: 'x', items: [{ t: 'text', p: [10, 10], text: '支架', h: 3.5, rot: 0, anchor: 'start', layer: 'text' }] }], data.sheet,
    { rasterize: () => ({ width: 8, height: 2, bits: new Uint8Array([255, 0]), mmWidth: 7, mmHeight: 3, mmBelow: 1 }) });
const rt = Buffer.from(rasterized).toString('latin1');
a(/\/ImageMask true/.test(rt) && /\/Im1 Do/.test(rt), 'letters Helvetica lacks go in as an image');
const dxf = toDXF(groups, data.sheet);
const codes = dxf.split('\r\n');
a(codes[0] === '0' && codes[1] === 'SECTION' && codes[codes.length - 2] === 'EOF' && codes.length % 2 === 1, 'DXF is pairs of lines ending in EOF');
a(/\r\nAC1009\r\n/.test(dxf) && /\r\nHIDDEN\r\n/.test(dxf) && /\r\nSOLID\r\n/.test(dxf) && /\r\n%%c8\r\n/.test(dxf), 'DXF R12 with a hidden layer, arrow heads and the diameter code');
a(dxfText('45' + F.DEGREE + ' ' + F.PLUSMINUS + '0.1 100%') === '45%%d %%p0.1 100%%%' && dxfText('支') === '\\U+652F', 'DXF text codes');
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const withDpi = withResolution(png, 300);
const phys = Buffer.from(withDpi).indexOf('pHYs');
a(phys === 37 && new DataView(withDpi.buffer).getUint32(phys + 4) === 11811 && withDpi.length === png.length + 21, 'PNG gets its resolution (300 dpi = 11811 per metre)');

console.log(failed ? failed + ' failed' : 'drawing: all passed');
process.exitCode = failed ? 1 : 0;
