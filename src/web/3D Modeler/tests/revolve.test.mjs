/*
    Revolve (kernel/occt.js revolveTool / revolve, rebuild.js).
    Volumes are checked with Pappus: a profile of area A whose centroid is
    at distance R from the axis sweeps 2 pi R A in a full turn.
    Run with: node tests/run.mjs revolve
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as kernel from '../js/kernel/occt.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

// A 10 x 20 rectangle from u = 20..30, v = 0..20 on the XZ plane, and a
// construction line along the sketch's v axis (the world Z axis) to turn about
function doc(extent, extra) {
    const pts = [[20, 0], [30, 0], [30, 20], [20, 20]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    g.push({ id: 'q0', type: 'point', x: 0, y: -5 }, { id: 'q1', type: 'point', x: 0, y: 25 });
    g.push({ id: 'ax', type: 'line', p1: 'q0', p2: 'q1', construction: true });
    const d = { features: [
        { id: 's', type: 'sketch', name: 'S', plane: { ref: 'origin:xz' }, geometry: g, constraints: [] },
        Object.assign({ id: 'r', type: 'revolve', name: 'Revolution1', sketch: 's', regions: [[25, 10]], axis: { curve: 'ax' }, operation: 'join', extent: extent }, extra || {})
    ] };
    return d;
}
const A = 10 * 20;
const R = 25;
const fullTurn = 2 * Math.PI * R * A;

let out = createRebuilder(oc).rebuild(doc({ type: 'full' }));
a(out.features.r.status === 'ok', 'a full revolve builds', out.features.r);
a(near(out.bodies[0].volume, fullTurn, fullTurn * 1e-4), 'a full turn sweeps 2 pi R A (a ring)', [out.bodies[0].volume, fullTurn]);

out = createRebuilder(oc).rebuild(doc({ type: 'angle', value: 90, direction: 'positive' }));
a(out.features.r.status === 'ok' && near(out.bodies[0].volume, fullTurn / 4, fullTurn * 1e-4), 'ninety degrees is a quarter of the ring', out.bodies[0] && out.bodies[0].volume);

// Which way it turns: the quarter lies on one side of the XZ plane, the flipped one on the other
function ySpan(o) {
    const p = o.bodies[0].positions;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < p.length; i += 3) {
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
    }
    return [lo, hi];
}
const pos = ySpan(out);
const neg = ySpan(createRebuilder(oc).rebuild(doc({ type: 'angle', value: 90, direction: 'negative' })));
a((pos[0] > -1e-6 && neg[1] < 1e-6) || (pos[1] < 1e-6 && neg[0] > -1e-6), 'Flipped turns the other way', [pos, neg]);
const sym = ySpan(createRebuilder(oc).rebuild(doc({ type: 'angle', value: 90, direction: 'symmetric' })));
a(near(sym[0], -sym[1], 1e-3) && sym[1] > 5, 'Symmetric spans both sides equally', sym);
out = createRebuilder(oc).rebuild(doc({ type: 'angle', value: 60, value2: 30, direction: 'asymmetric' }));
a(near(out.bodies[0].volume, fullTurn / 4, fullTurn * 1e-4), 'Asymmetric 60 + 30 is a quarter too', out.bodies[0].volume);

// About an origin axis instead of a sketch line
out = createRebuilder(oc).rebuild(doc({ type: 'full' }, { axis: { origin: 'z' } }));
a(out.features.r.status === 'ok' && near(out.bodies[0].volume, fullTurn, fullTurn * 1e-4), 'about the origin Z axis it is the same ring', out.features.r);

// A profile that crosses the axis is refused, not built
const crossing = doc({ type: 'full' });
crossing.features[0].geometry.find(g => g.id === 'q0').x = 25;
crossing.features[0].geometry.find(g => g.id === 'q1').x = 25;
out = createRebuilder(oc).rebuild(crossing);
a(out.features.r.status === 'error' && /crosses the axis/.test(out.features.r.message), 'a profile across the axis is refused', out.features.r);

// A cut: a ring groove turned into a cylinder
const cyl = doc({ type: 'full' }, { operation: 'cut' });
const base = [];
[[0, 0], [40, 0], [40, 40], [0, 40]].forEach((p, i) => base.push({ id: 'b' + i, type: 'point', x: p[0], y: p[1] }));
[0, 1, 2, 3].forEach(i => base.push({ id: 'm' + i, type: 'line', p1: 'b' + i, p2: 'b' + ((i + 1) % 4) }));
// a 40 x 40 square about the same axis from u = 0 turned a full round: a 40 radius cylinder 40 high
base.push({ id: 'z0', type: 'point', x: 0, y: -5 }, { id: 'z1', type: 'point', x: 0, y: 45 }, { id: 'zz', type: 'line', p1: 'z0', p2: 'z1', construction: true });
cyl.features.unshift(
    { id: 's0', type: 'sketch', name: 'S0', plane: { ref: 'origin:xz' }, geometry: base, constraints: [] },
    { id: 'r0', type: 'revolve', name: 'Revolution0', sketch: 's0', regions: [[20, 20]], axis: { curve: 'zz' }, operation: 'join', extent: { type: 'full' } }
);
out = createRebuilder(oc).rebuild(cyl);
const cylinder = Math.PI * 40 * 40 * 40;
a(out.features.r0.status === 'ok' && out.features.r.status === 'ok', 'cylinder and groove build', out.features);
a(near(out.bodies[0].volume, cylinder - fullTurn, cylinder * 1e-4), 'the groove removes 2 pi R A from the cylinder', [out.bodies[0].volume, cylinder - fullTurn]);

console.log(failed ? failed + ' FAILED' : 'all revolve tests passed');
process.exitCode = failed ? 1 : 0;
