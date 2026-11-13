/*
    A chamfer put on a body that already has fillets (reported broken: faces
    went missing). Run with: node tests/run.mjs chamfer
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);

function box() {
    const pts = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const g = [];
    pts.forEach((p, i) => g.push({ id: 'p' + i, type: 'point', x: p[0], y: p[1] }));
    pts.forEach((p, i) => g.push({ id: 'l' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % 4) }));
    return { features: [
        { id: 's', type: 'sketch', name: 'S', plane: { ref: 'origin:xy' }, geometry: g, constraints: [] },
        { id: 'e', type: 'extrude', name: 'E', sketch: 's', regions: [[20, 15]], operation: 'join', extent: { type: 'distance', value: 60, direction: 'positive' } }
    ] };
}
const ref = e => ({ body: 0, mid: e.mid, length: e.length });
// signed volume of the display mesh: equals the solid's volume only when every face was meshed
function meshVolume(b) {
    let v = 0;
    const p = b.positions, ix = b.indices;
    for (let i = 0; i < ix.length; i += 3) {
        const A = ix[i] * 3, B = ix[i + 1] * 3, C = ix[i + 2] * 3;
        v += (p[A] * (p[B + 1] * p[C + 2] - p[B + 2] * p[C + 1]) - p[A + 1] * (p[B] * p[C + 2] - p[B + 2] * p[C]) + p[A + 2] * (p[B] * p[C + 1] - p[B + 1] * p[C])) / 6;
    }
    return v;
}
const whole = (b, label) => a(b.faces.every(f => f.count > 0) && near(meshVolume(b), b.volume, b.volume * 0.01), label + ': every face is meshed and the mesh encloses the volume', { empty: b.faces.filter(f => f.count === 0).length, mesh: meshVolume(b), volume: b.volume });

const d = box();
const rb = createRebuilder(oc);
let r = rb.rebuild(d);
const verticals = r.bodies[0].edges.filter(e => near(e.length, 60));
a(verticals.length === 4, 'four vertical edges');
d.features.push({ id: 'f', type: 'fillet', name: 'Fillet1', edges: verticals.map(ref), radius: 5 });
r = rb.rebuild(d);
a(r.features.f.status === 'ok', 'fillet builds', r.features.f);
whole(r.bodies[0], 'after the fillet');
const filleted = r.bodies[0];
const volumeBefore = filleted.volume;

// every kind of edge the user can click after the fillet
const kinds = {
    'top straight edge': e => e.curve && e.curve.type === 'line' && near(e.mid[2], 60),
    'top arc of a rounded corner': e => e.curve && e.curve.type === 'circle' && near(e.mid[2], 60),
    'vertical seam between a flat face and a fillet': e => e.curve && e.curve.type === 'line' && near(e.length, 60),
    'bottom straight edge': e => e.curve && e.curve.type === 'line' && near(e.mid[2], 0)
};
for (const name of Object.keys(kinds)) {
    const edge = filleted.edges.find(kinds[name]);
    a(!!edge, 'found a ' + name);
    const doc = JSON.parse(JSON.stringify(d));
    doc.features.push({ id: 'c', type: 'chamfer', name: 'Chamfer1', edges: [ref(edge)], distance: 2 });
    const out = createRebuilder(oc).rebuild(doc);
    const status = out.features.c;
    if (status.status === 'ok') {
        const b = out.bodies[0];
        a(b.volume < volumeBefore && b.volume > volumeBefore * 0.8, name + ': a chamfer removes a little material', [b.volume, volumeBefore]);
        whole(b, name);
    } else {
        // Refusing is fine; a broken solid is not
        a(out.bodies.length === 1 && near(out.bodies[0].volume, volumeBefore, 0.01), name + ': refused and the body is untouched', status);
    }
    console.log('  ' + name + ' -> ' + status.status + (status.message ? ' (' + status.message + ')' : ''));
}
// several edges of one tangent chain picked together, as a user does when
// clicking round an outline (this is what broke the solid)
const topLoop = filleted.edges.filter(e => near(e.mid[2], 60));
const bottomLoop = filleted.edges.filter(e => near(e.mid[2], 0));
const sets = {
    'two neighbours of one loop': topLoop.slice(0, 2),
    'the whole top loop': topLoop,
    'top and bottom loops': topLoop.concat(bottomLoop)
};
for (const name of Object.keys(sets)) {
    for (const type of ['chamfer', 'fillet']) {
        const doc = JSON.parse(JSON.stringify(d));
        const f = { id: 'c', type: type, name: 'X', edges: sets[name].map(ref) };
        f[type === 'chamfer' ? 'distance' : 'radius'] = 2;
        doc.features.push(f);
        const out = createRebuilder(oc).rebuild(doc);
        const status = out.features.c;
        if (status.status === 'ok') {
            a(out.bodies[0].volume < volumeBefore && out.bodies[0].volume > volumeBefore * 0.8, type + ' on ' + name + ': removes a little material', [out.bodies[0].volume, volumeBefore]);
            whole(out.bodies[0], type + ' on ' + name);
        } else {
            a(out.bodies.length === 1 && near(out.bodies[0].volume, volumeBefore, 0.01), type + ' on ' + name + ': refused and the body is untouched', status);
        }
        console.log('  ' + type + ' on ' + name + ' (' + sets[name].length + ' edges) -> ' + status.status + (status.message ? ' (' + status.message + ')' : ''));
    }
}
// sizes at and beyond the fillet radius (5): the corner arcs run out of room
for (const size of [4, 5, 6, 8]) {
    for (const type of ['chamfer', 'fillet']) {
        const doc = JSON.parse(JSON.stringify(d));
        const f = { id: 'c', type: type, name: 'X', edges: topLoop.concat(bottomLoop).map(ref) };
        f[type === 'chamfer' ? 'distance' : 'radius'] = size;
        doc.features.push(f);
        const out = createRebuilder(oc).rebuild(doc);
        const status = out.features.c;
        if (status.status === 'ok') {
            a(out.bodies[0].volume < volumeBefore && out.bodies[0].volume > volumeBefore * 0.6, type + ' ' + size + ': removes some material', [out.bodies[0].volume, volumeBefore]);
            whole(out.bodies[0], type + ' ' + size);
        } else {
            a(out.bodies.length === 1 && near(out.bodies[0].volume, volumeBefore, 0.01), type + ' ' + size + ': refused and the body is untouched', status);
        }
        console.log('  ' + type + ' of ' + size + ' on both loops -> ' + status.status + (status.message ? ' (' + status.message + ')' : '') + (status.status === 'ok' ? ' volume ' + out.bodies[0].volume.toFixed(0) + ' of ' + volumeBefore.toFixed(0) : ''));
    }
}
console.log(failed ? failed + ' FAILED' : 'all chamfer after fillet tests passed');
process.exitCode = failed ? 1 : 0;
