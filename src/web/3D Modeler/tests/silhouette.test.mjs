/*
    Outlines of round faces (js/silhouette.js), the drag that pulls an
    offset sketch plane off a plane (js/planedrag.js), and hiding a work
    plane (document.setHidden).
    Run with: node tests/run.mjs silhouette
*/
import { silhouetteSource, silhouetteSegments } from '../js/silhouette.js';
import { dragOffset, snapOffset } from '../js/planedrag.js';
import { createDocument } from '../js/document/document.js';

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-6);

// A cylinder along Z, radius 5, height 10, as the kernel meshes a face:
// `seg` quads round, the seam's points repeated (as a closed face's
// triangulation does), facing outward; then a flat cap that must be ignored
function cylinderMesh(seg, start) {
    const positions = [];
    const indices = [];
    for (let i = 0; i <= seg; i++) {
        const t = (start || 0) + i / seg * 2 * Math.PI;
        positions.push(5 * Math.cos(t), 5 * Math.sin(t), 0, 5 * Math.cos(t), 5 * Math.sin(t), 10);
    }
    for (let i = 0; i < seg; i++) {
        const b0 = i * 2;
        const t0 = i * 2 + 1;
        const b1 = (i + 1) * 2;
        const t1 = (i + 1) * 2 + 1;
        indices.push(b0, b1, t1, b0, t1, t0);
    }
    const side = { type: 'cylinder', start: 0, count: indices.length };
    const capStart = indices.length;
    const centre = positions.length / 3;
    positions.push(0, 0, 10);
    for (let i = 0; i < seg; i++) {
        indices.push(centre, i * 2 + 1, (i + 1) * 2 + 1);
    }
    const cap = { type: 'plane', start: capStart, count: indices.length - capStart };
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices), faces: [side, cap] };
}

function outline(mesh, view, perspective) {
    const src = silhouetteSource(mesh.positions, mesh.indices, mesh.faces);
    const out = new Float32Array(src.edges * 6);
    const dist = new Float32Array(src.edges * 2);
    const n = silhouetteSegments(src, view, perspective, out, dist);
    const segs = [];
    for (let i = 0; i < n; i++) {
        segs.push(Array.from(out.slice(i * 6, i * 6 + 6)));
    }
    return { src: src, segs: segs, dist: Array.from(dist.slice(0, n * 2)) };
}

/* ---- a cylinder seen from the side ---- */
const mesh = cylinderMesh(32);
let o = outline(mesh, [1, 0, 0], false);
// 32 edges along the length (the seam joined by position) and 32 quad diagonals
a(o.src.edges === 64, 'the inner edges of the round face, the seam included, not the flat cap', o.src.edges);
a(o.segs.length === 2, 'seen from the side a cylinder has two outline lines', o.segs.length);
a(o.segs.every(s => near(Math.abs(s[1]), 5, 1e-3) && near(s[0], 0, 1e-3) && near(Math.abs(s[5] - s[2]), 10)), 'along its length, at its sides', o.segs);
// The seam lies where the outline is when looking along Y
o = outline(mesh, [0, 1, 0], false);
a(o.segs.length === 2 && o.segs.some(s => near(s[0], 5, 1e-3)), 'the outline on the seam is found too', o.segs);
// Looking down the axis there is no outline line, only the circles
o = outline(mesh, [0, 0, -1], false);
a(o.segs.length === 0, 'looking down the axis: no lines', o.segs.length);
// Close up in perspective the outline moves towards the eye
o = outline(mesh, [40, 0, 5], true);
a(o.segs.length === 2 && o.segs.every(s => s[0] > 0.3), 'in perspective, the outline seen from close by', o.segs.map(s => s[0]));
o = outline(mesh, [1, 0, 0], false);
a(near(o.dist[1], 10, 1e-3) && near(o.dist[3], 20, 1e-3), 'running lengths for dashed lines', o.dist);
a(silhouetteSource(mesh.positions, mesh.indices, [mesh.faces[1]]) === null, 'flat faces only: nothing to outline');

/* ---- dragging an offset plane ---- */
// The normal shows as 4 px per mm to the right
a(near(dragOffset([100, 100], [120, 100], [4, 0], 0.25), 5), 'along the normal on screen: 20 px is 5 mm');
a(near(dragOffset([100, 100], [80, 100], [4, 0], 0.25), -5), 'the other way is negative');
a(near(dragOffset([100, 100], [100, 140], [4, 0], 0.25), 0), 'across the normal does nothing');
// Seen face on (the normal points at the eye): up is outward
a(near(dragOffset([100, 100], [100, 60], [0.01, 0], 0.25), 10), 'a plane seen face on: dragging up 40 px is 10 mm');
a(snapOffset(6.13, 0.3) === 6 && snapOffset(6.13, 0.02) === 6.1 && snapOffset(61.3, 2) === 60, 'offsets snap to a step that suits the zoom',
    [snapOffset(6.13, 0.3), snapOffset(6.13, 0.02), snapOffset(61.3, 2)]);
a(Object.is(snapOffset(-0.2, 0.3), 0), 'no minus zero');

/* ---- hiding a work plane ---- */
const doc = createDocument();
doc.reset({ format: 'aopart', version: 1, features: [{ id: 'f1', type: 'plane', name: 'Work Plane1', base: { ref: 'origin:xy' }, offset: 6 }] }, 'P', '');
doc.setHidden('f1', true);
a(doc.feature('f1').hidden === true && doc.isDirty(), 'a work plane can be hidden');
a(JSON.parse(doc.serialize()).features[0].hidden === true, 'and stays hidden in the file');
a(doc.undo() === 'Hide Work Plane1' && !doc.feature('f1').hidden, 'one undo step');
doc.setHidden('f1', true);
doc.setHidden('f1', false);
a(!('hidden' in doc.feature('f1')), 'shown again, the field is gone');

console.log(failed ? failed + ' failed' : 'silhouette: all passed');
process.exitCode = failed ? 1 : 0;
