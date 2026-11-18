/*
    Random parts must mesh watertight.

    Builds 80 random parts (a base extrusion, then joins, cuts, tapers,
    fillets and chamfers on the three origin planes, with sizes on a 5 mm
    grid so that faces and edges line up exactly as often as they do in real
    sketches) and checks after every feature that the welded mesh of each
    solid has no open and no non-manifold edge. Features may fail (a fillet
    too big, zero thickness refused); the mesh of what is built may not leak.

    The seed is fixed, so a failure can be reproduced. In a run like this
    before the meshing fix, 57 of 150 parts leaked (the caps of extrusions
    kept the mesh of their sketch region). Run with:
    node tests/run.mjs meshfuzz
*/

import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import { meshCheck } from '../js/io/exchange.js';

const oc = await init();

const rect = (x, y, w, h, n) => {
    const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const g = [];
    p.forEach((c, i) => g.push({ id: n + 'p' + i, type: 'point', x: c[0], y: c[1] }));
    p.forEach((c, i) => g.push({ id: n + 'l' + i, type: 'line', p1: n + 'p' + i, p2: n + 'p' + ((i + 1) % 4) }));
    return g;
};

let seed = 20261116;
const runs = 80;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const pick = a => a[Math.floor(rnd() * a.length)];
const nice = (lo, hi, step) => lo + Math.round(rnd() * (hi - lo) / step) * step;

const PLANES = ['origin:xy', 'origin:xz', 'origin:yz'];
let nid = 0;
function shape(n) {
    const kind = pick(['rect', 'rect', 'circle', 'slotish', 'tri']);
    const cx = nice(-10, 70, 5), cy = nice(-10, 50, 5);
    if (kind === 'rect') {
        const w = nice(5, 60, 5), h = nice(5, 40, 5);
        return { geo: rect(cx, cy, w, h, n), inside: [cx + w / 2, cy + h / 2] };
    }
    if (kind === 'circle') {
        const r = nice(3, 20, 1);
        return { geo: [{ id: n + 'c', type: 'point', x: cx, y: cy }, { id: n + 'k', type: 'circle', c: n + 'c', r }], inside: [cx, cy] };
    }
    if (kind === 'tri') {
        const w = nice(10, 50, 5), h = nice(10, 40, 5);
        const pts = [[cx, cy], [cx + w, cy], [cx + w / 2 + nice(-10, 10, 5), cy + h]];
        const g = [];
        pts.forEach((c, i) => g.push({ id: n + 'p' + i, type: 'point', x: c[0], y: c[1] }));
        pts.forEach((c, i) => g.push({ id: n + 'l' + i, type: 'line', p1: n + 'p' + i, p2: n + 'p' + ((i + 1) % 3) }));
        return { geo: g, inside: [cx + w / 2, cy + h / 3] };
    }
    // a rectangle with a semicircle on top (arch)
    const w = nice(10, 40, 10), h = nice(5, 30, 5), r = w / 2;
    const g = [
        { id: n + 'p0', type: 'point', x: cx, y: cy }, { id: n + 'p1', type: 'point', x: cx + w, y: cy },
        { id: n + 'p2', type: 'point', x: cx + w, y: cy + h }, { id: n + 'p3', type: 'point', x: cx, y: cy + h },
        { id: n + 'pc', type: 'point', x: cx + r, y: cy + h },
        { id: n + 'l0', type: 'line', p1: n + 'p0', p2: n + 'p1' }, { id: n + 'l1', type: 'line', p1: n + 'p1', p2: n + 'p2' },
        { id: n + 'a', type: 'arc', c: n + 'pc', start: n + 'p2', end: n + 'p3' },
        { id: n + 'l2', type: 'line', p1: n + 'p3', p2: n + 'p0' }
    ];
    return { geo: g, inside: [cx + r, cy + h / 2] };
}

function makeDoc() {
    const feats = [];
    const base = shape('b');
    feats.push({ id: 's0', type: 'sketch', name: 'S0', plane: { ref: 'origin:xy' }, geometry: base.geo, constraints: [] });
    feats.push({ id: 'e0', type: 'extrude', name: 'E0', sketch: 's0', regions: [base.inside], operation: 'join', extent: { type: 'distance', value: nice(5, 40, 5), direction: 'positive' } });
    const steps = 1 + Math.floor(rnd() * 4);
    for (let i = 1; i <= steps; i++) {
        const t = rnd();
        if (t < 0.7) {
            const s = shape('s' + i);
            const op = pick(['join', 'cut', 'cut']);
            const ext = pick([
                { type: 'distance', value: nice(5, 60, 5), direction: pick(['positive', 'negative', 'symmetric']) },
                { type: 'all', direction: pick(['positive', 'negative', 'both']) }
            ]);
            if (ext.type === 'distance' && ext.direction !== 'symmetric' && rnd() < 0.3) ext.taper = pick([3, 5, 10, -5]);
            feats.push({ id: 'k' + i, type: 'sketch', name: 'K' + i, plane: { ref: pick(PLANES) }, geometry: s.geo, constraints: [] });
            feats.push({ id: 'x' + i, type: 'extrude', name: 'X' + i, sketch: 'k' + i, regions: [s.inside], operation: op, extent: ext });
        } else {
            feats.push({ id: 'r' + i, type: rnd() < 0.5 ? 'fillet' : 'chamfer', name: 'R' + i, pickEdges: 1 + Math.floor(rnd() * 3), size: pick([1, 2, 3, 5]) });
        }
    }
    return { format: 'aopart', version: 1, features: feats };
}

let bad = 0;
const t0 = Date.now();
for (let run = 0; run < runs; run++) {
    const startSeed = seed;
    const doc = makeDoc();
    const rb = createRebuilder(oc);
    // fill in edge picks from the body as it is before each edge feature
    const real = { format: 'aopart', version: 1, features: [] };
    let lastResult = null;
    let issue = null;
    for (const f of doc.features) {
        if (f.pickEdges) {
            if (!lastResult || !lastResult.bodies.length) continue;
            const b = lastResult.bodies[0];
            const edges = [];
            for (let k = 0; k < f.pickEdges && b.edges.length; k++) {
                const e = pick(b.edges);
                edges.push({ body: 0, mid: e.mid, length: e.length });
            }
            const g = f.type === 'fillet' ? { id: f.id, type: 'fillet', name: f.name, edges, radius: f.size } : { id: f.id, type: 'chamfer', name: f.name, edges, distance: f.size };
            real.features.push(g);
        } else {
            real.features.push(f);
        }
        if (f.type === 'sketch') continue;
        lastResult = rb.rebuild(real);
        const st = lastResult.features[f.id];
        const d = lastResult.bodies.map(b => meshCheck(b));
        if (d.some(x => !x.watertight) || lastResult.bodies.some(b => b.health.empty)) {
            issue = { at: f.id, type: f.type, status: st.status, d };
            break;
        }
    }
    if (issue) {
        bad++;
        console.log('seed', startSeed, JSON.stringify(issue));
    }
}
if (bad) {
    console.log('FAIL', bad, 'of', runs, 'random parts have a mesh that is not watertight');
}
console.log('meshfuzz: ' + runs + ' random parts checked in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exitCode = bad ? 1 : 0;
