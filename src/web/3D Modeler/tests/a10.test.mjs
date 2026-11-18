/*
    Exchange (PROPOSAL.md 14.11, built in 14.28): STL and OBJ brought in as
    reference meshes, ASCII STL, exports in inches.
    Run with: node tests/run.mjs a10
*/

import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import { toSTL, toSTLText, toOBJ, to3MF, parseSTL, parseOBJ, encodeMesh, decodeMesh, meshInfo, scaled, meshCheck } from '../js/io/exchange.js';
import { sampleDocument } from '../js/document/sample.js';

const oc = await init();
let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};
const near = (x, y, t) => Math.abs(x - y) < (t || 1e-3);
const throwsLike = (fn, re) => {
    try {
        fn();
    } catch (err) {
        return re.test(err.message);
    }
    return false;
};

// A real part as the mesh to read back
const rebuilt = createRebuilder(oc).rebuild(sampleDocument());
const part = { positions: rebuilt.bodies[0].positions, indices: rebuilt.bodies[0].indices };
const triangles = part.indices.length / 3;

const binary = parseSTL(toSTL([part]));
a(binary.indices.length / 3 === triangles, 'binary STL read back: every triangle', [binary.indices.length / 3, triangles]);
a(meshCheck(binary).watertight, 'binary STL read back is welded watertight');
a(binary.positions.length < part.positions.length, 'corners are shared after reading', [binary.positions.length, part.positions.length]);
const info = meshInfo(binary);
a(near(info.min[0], 0, 1e-3) && near(info.max[0], 80, 1e-3) && near(info.max[1], 50, 1e-3) && near(info.max[2], 28, 1e-3), 'bounds of the sample part', info);

const text = toSTLText([part], 'Sample Part');
a(/^solid Sample_Part\n  facet normal /.test(text) && /endsolid Sample_Part\n$/.test(text), 'ASCII STL layout', text.slice(0, 40));
const ascii = parseSTL(new TextEncoder().encode(text));
a(ascii.indices.length / 3 === triangles && meshCheck(ascii).watertight, 'ASCII STL read back', ascii.indices.length / 3);

// an ASCII file whose length happens to look binary is still read as text
const tiny = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
a(parseSTL(new TextEncoder().encode(tiny)).indices.length === 3, 'a one-triangle ASCII STL');
a(throwsLike(() => parseSTL(new Uint8Array(100)), /not an STL/), 'random bytes are not an STL');
const lying = new Uint8Array(84);
new DataView(lying.buffer).setUint32(80, 5, true);
a(throwsLike(() => parseSTL(lying), /not an STL/), 'a binary header promising triangles that are not there');

// OBJ: quads, negative indices, v/vt/vn faces
const obj = 'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\nv 0 0 10\nf 1 2 3 4\nf -5/1/1 -4/2/2 -1/3/3\n';
const quad = parseOBJ(obj);
a(quad.indices.length === 9, 'a quad becomes two triangles, a negative-index face one', quad.indices.length);
a(throwsLike(() => parseOBJ('v 0 0 0\nf 1 2 3\n'), /does not exist/), 'a face using a missing corner is refused');
a(throwsLike(() => parseOBJ('v 0 0 0\n'), /no faces/), 'an OBJ without faces is refused');
const back = parseOBJ(toOBJ([part], 'P'));
a(back.indices.length / 3 === triangles && meshCheck(back).watertight, 'OBJ written then read back', back.indices.length / 3);

// storing in the part file
const stored = encodeMesh(binary);
const decoded = decodeMesh(stored);
a(decoded.positions.length === binary.positions.length && decoded.indices.length === binary.indices.length &&
    decoded.positions.every((v, i) => v === binary.positions[i]), 'a mesh survives the trip through base64');
a(throwsLike(() => decodeMesh({ positions: 'AAAA', indices: '' }), /damaged/), 'damaged stored data is refused');

// inches
const inch = scaled([part], 1 / 25.4);
a(near(meshInfo(inch[0]).max[0], 80 / 25.4, 1e-4), 'scaled to inches', meshInfo(inch[0]).max[0]);
a(scaled([part], 1)[0] === part, 'scale 1 leaves the mesh as it is');
const mf = to3MF([part], 'in');
const xml = new TextDecoder().decode(mf);
a(xml.indexOf('unit="inch"') >= 0, '3MF in inches says so');
a(new TextDecoder().decode(toSTL([part], 'in').subarray(0, 80)).indexOf('units inch') >= 0, 'STL header says inch');

// the mesh feature: the kernel ignores it, its data is not hashed
const doc = sampleDocument();
doc.features.push({ id: 'm1', type: 'mesh', name: 'Mesh1', format: 'stl', source: 'x.stl', data: stored });
const rb = createRebuilder(oc);
let r = rb.rebuild(doc);
a(r.features.m1.status === 'ok' && r.bodies.length === 1 && near(r.bodies[0].volume, 52971.9, 1), 'a reference mesh adds no solid and fails nothing', r.features.m1);
doc.features.push({ id: 'h', type: 'sketch', name: 'S', plane: { ref: 'origin:xy' }, geometry: [{ id: 'p', type: 'point', x: 60, y: 25 }, { id: 'k', type: 'circle', c: 'p', r: 1 }], constraints: [] });
r = rb.rebuild(doc);
a(r.reused >= 6, 'features before and after the mesh are reused from the cache', r.reused);

console.log(failed ? failed + ' checks failed' : 'a10: all checks passed');
process.exitCode = failed ? 1 : 0;
