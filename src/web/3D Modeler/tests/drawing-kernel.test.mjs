/*
    Drawings in the kernel (js/kernel/drawing.js): hidden line projection of
    parts, placed components and picked faces, cleaned by geometry2d.js,
    and the sample drawing laid out from real projections.
    Run with: node tests/run.mjs drawing-kernel
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import { project } from '../js/kernel/drawing.js';
import * as G2 from '../js/drawing/geometry2d.js';
import * as S from '../js/drawing/sheet.js';
import * as L from '../js/drawing/layout.js';
import { validateDrawing } from '../js/drawing/document.js';
import { sampleDocument } from '../js/document/sample.js';
import { sampleDrawing } from '../js/document/sampledrw.js';
import { toPDF } from '../js/io/pdf.js';
import { toDXF } from '../js/io/dxf.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);
const nearV = (p, q, t) => p.length === q.length && p.every((v, i) => near(v, q[i], t));

// A w x d x h box with a through hole of radius r in the middle of its top
function block(w, d, h, r) {
    const pts = [[0, 0], [w, 0], [w, d], [0, d]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    g.push({ id: 'c', type: 'point', x: w / 2, y: d / 2 }, { id: 'k', type: 'circle', c: 'c', r: r });
    return { features: [
        { id: 's', type: 'sketch', name: 'S', plane: { ref: 'origin:xy' }, geometry: g, constraints: [] },
        { id: 'e', type: 'extrude', name: 'E', sketch: 's', regions: [[1, 1]], operation: 'join', extent: { type: 'distance', value: h, direction: 'positive' } }
    ] };
}

const part = createRebuilder(oc);
const desc = part.rebuild(block(40, 30, 10, 5));
const shapes = part.bodies();

// Top view: the outline and the hole, a full circle of radius 5 at (20, 15)
const front = S.orientation('front');
const top = S.orientation('top');
let raw = project(oc, [{ shapes: shapes, matrix: null }], { dir: top.dir, xdir: top.xdir, hidden: true, smooth: true, deflection: 0.01 });
let edges = G2.cleanEdges(raw.edges);
let box = G2.boundsOf(edges);
a(nearV(box, [0, 0, 40, 30]), 'the top view of a 40 x 30 block', box);
const holes = edges.filter(e => e.type === 'circle' && e.closed && e.visible);
a(holes.length === 1 && near(holes[0].r, 5) && nearV(holes[0].c, [20, 15]), 'the hole is one visible circle with its true centre and radius', holes.map(h => [h.c, h.r]));
a(edges.filter(e => e.type === 'line' && e.visible).length === 4, 'four visible outline lines', edges.filter(e => e.visible).map(e => e.type));

// Front view: x right, z up; the hole shows as two hidden lines
raw = project(oc, [{ shapes: shapes, matrix: null }], { dir: front.dir, xdir: front.xdir, hidden: true, smooth: true, deflection: 0.01 });
edges = G2.cleanEdges(raw.edges);
box = G2.boundsOf(edges);
a(nearV(box, [0, 0, 40, 10]), 'the front view: 40 wide, 10 high', box);
const hidden = edges.filter(e => !e.visible && e.type === 'line' && near(e.a[0], e.b[0]));
a(hidden.some(e => near(e.a[0], 15)) && hidden.some(e => near(e.a[0], 25)), 'the hole wall shows as hidden lines at x 15 and 25', hidden.map(e => [e.a, e.b]));
const noHidden = G2.cleanEdges(project(oc, [{ shapes: shapes, matrix: null }], { dir: front.dir, xdir: front.xdir, hidden: false, smooth: true, deflection: 0.01 }).edges);
a(noHidden.every(e => e.visible), 'hidden lines can be left out');

// Placed copies (an assembly component): moved and turned a quarter turn about Z
const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 100, 50, 0, 1];
edges = G2.cleanEdges(project(oc, [{ shapes: shapes, matrix: m }], { dir: top.dir, xdir: top.xdir, hidden: false, smooth: true, deflection: 0.01 }).edges);
box = G2.boundsOf(edges);
a(nearV(box, [70, 50, 100, 90]), 'a placed component is drawn where it is', box);

// Faces alone: the top face of the block, looked at straight
const topFace = desc.bodies[0].faces.findIndex(f => f.type === 'plane' && near(f.normal[2], 1) && near(f.origin ? f.origin[2] : 10, 10));
const face = K.itemShape(oc, shapes, { type: 'face', body: 0, index: topFace });
edges = G2.cleanEdges(project(oc, [{ shapes: [face], matrix: null }], { dir: top.dir, xdir: top.xdir, hidden: true, smooth: true, deflection: 0.01 }).edges);
a(edges.length === 5 && edges.filter(e => e.type === 'circle').length === 1 && edges.every(e => e.visible), 'a face drawn alone: its outline and its hole', edges.map(e => e.type));
face.delete();

// The sample drawing laid out from real projections, with every dimension on its geometry
const drawing = validateDrawing(sampleDrawing());
const sample = createRebuilder(oc);
sample.rebuild(sampleDocument());
const projections = {};
drawing.views.filter(v => v.source === 's1').forEach(v => {
    const frame = L.frameOf(drawing, v);
    const t0 = performance.now();
    const e = G2.cleanEdges(project(oc, [{ shapes: sample.bodies(), matrix: null }], { dir: frame.dir, xdir: frame.xdir, hidden: !!v.hidden, smooth: true, deflection: 0.01 }).edges);
    projections[v.id] = { edges: e, box: G2.boundsOf(e), snaps: G2.snapPoints(e), ms: performance.now() - t0 };
});
a(nearV(L.frameOf(drawing, drawing.views[1]).dir, [0, 0, 1]), 'the sample: the view below the front view is the top view (first angle)');
a(nearV(L.frameOf(drawing, drawing.views[3]).dir, [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)], 1e-6), 'the sample: its corner view is the iso view from the top right');
a(nearV(projections.v1.box, [0, 0, 80, 28]), 'the sample front view: 80 x 28', projections.v1.box);
a(nearV(projections.v2.box, [0, 0, 80, 50]), 'the sample top view: 80 x 50', projections.v2.box);
const tol = 0.01;
drawing.annotations.filter(x => x.view && projections[x.view]).forEach(x => {
    const e = projections[x.view].edges;
    let ok = true;
    if (x.type === 'linear') {
        ok = G2.onGeometry(e, x.p1, tol) && G2.onGeometry(e, x.p2, tol);
    } else if (x.c) {
        ok = G2.hasCircle(e, x.c, x.r, tol);
    } else if (x.type === 'note') {
        ok = G2.onGeometry(e, x.p, tol);
    }
    a(ok, 'the sample ' + x.type + ' ' + x.id + ' sits on its view geometry');
});
const groups = L.build(drawing, projections, {});
const pdf = Buffer.from(toPDF(groups, drawing.sheet, { title: 'Sample' })).toString('latin1');
a(/\/MediaBox \[0 0 1190\.551 841\.89\]/.test(pdf) && pdf.length > 10000, 'the sample drawing writes a PDF');
const dxf = toDXF(groups, drawing.sheet);
a((dxf.match(/\r\nLINE\r\n/g) || []).length > 50 && /\r\nCIRCLE\r\n/.test(dxf), 'and a DXF with lines and circles');

console.log(failed ? failed + ' failed' : 'drawing-kernel: all passed (' + Object.values(projections).map(p => Math.round(p.ms) + ' ms').join(', ') + ')');
process.exitCode = failed ? 1 : 0;
