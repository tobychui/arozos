/*
    The mesh export writers (STL, OBJ, 3MF) on a real kernel mesh.
    Run with: node tests/run.mjs exchange
*/
import init from '../lib/occt/replicad_single.js';
import { createRebuilder } from '../js/kernel/rebuild.js';
import * as K from '../js/kernel/occt.js';
import { sampleDocument } from '../js/document/sample.js';
import { weld, toSTL, toOBJ, to3MF, zip, toHex, fromHex } from '../js/io/exchange.js';
import { inflateRawSync } from 'node:zlib';

const oc = await init();
let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

const rb = createRebuilder(oc);
const full = rb.rebuild(sampleDocument());
const meshes = rb.bodies().map(s => { const d = K.describe(oc, s, 0.05, 0.2); return { positions: d.positions, indices: d.indices }; });
const tris = meshes[0].indices.length / 3;

// signed volume of a triangle mesh: closed and consistently wound if it matches the solid
function volumeOf(positions, indices) {
    let v = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const p = [0, 1, 2].map(k => [positions[indices[i + k] * 3], positions[indices[i + k] * 3 + 1], positions[indices[i + k] * 3 + 2]]);
        v += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    }
    return v;
}
a(Math.abs(volumeOf(meshes[0].positions, meshes[0].indices) - full.bodies[0].volume) < full.bodies[0].volume * 0.002, 'kernel mesh encloses the solid volume, facing outwards');

// weld: fewer vertices, every edge shared by exactly two triangles (watertight)
const w = weld(meshes[0]);
a(w.positions.length < meshes[0].positions.length && w.indices.length <= meshes[0].indices.length, 'weld merges shared corners');
const edges = new Map();
for (let i = 0; i < w.indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
        const p = w.indices[i + k], q = w.indices[i + (k + 1) % 3];
        const key = Math.min(p, q) + '-' + Math.max(p, q);
        edges.set(key, (edges.get(key) || 0) + 1);
    }
}
const open = [...edges.values()].filter(c => c !== 2).length;
a(open === 0, 'welded mesh is watertight (every edge has two triangles)', open + ' of ' + edges.size);

// STL
const stl = toSTL(meshes);
const view = new DataView(stl.buffer);
a(stl.length === 84 + tris * 50 && view.getUint32(80, true) === tris, 'binary STL size and triangle count', [stl.length, tris]);
const nlen = Math.hypot(view.getFloat32(84, true), view.getFloat32(88, true), view.getFloat32(92, true));
a(Math.abs(nlen - 1) < 1e-4, 'STL normals are unit length', nlen);

// OBJ
const obj = toOBJ(meshes, 'Sample');
const vs = obj.split('\n').filter(l => l.startsWith('v ')).length;
const fs = obj.split('\n').filter(l => l.startsWith('f '));
a(vs === w.positions.length / 3 && fs.length === w.indices.length / 3 && obj.includes('o Sample'), 'OBJ vertex and face counts');
a(fs.every(l => l.split(' ').slice(1).every(i => +i >= 1 && +i <= vs)), 'OBJ indices are 1-based and in range');

// zip + 3MF: readable by an independent reader of the local headers
const z = zip([{ name: 'a.txt', text: 'hello' }, { name: 'dir/b.txt', text: 'world, with é' }]);
function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const out = {};
    let at = 0;
    while (dv.getUint32(at, true) === 0x04034b50) {
        const size = dv.getUint32(at + 18, true), nameLen = dv.getUint16(at + 26, true), extra = dv.getUint16(at + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
        out[name] = new TextDecoder().decode(bytes.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size));
        at += 30 + nameLen + extra + size;
    }
    const eocd = bytes.length - 22;
    return { files: out, count: dv.getUint16(eocd + 10, true), sig: dv.getUint32(eocd, true), centralAt: dv.getUint32(eocd + 16, true), end: at };
}
const rz = readZip(z);
a(rz.files['a.txt'] === 'hello' && rz.files['dir/b.txt'] === 'world, with é' && rz.count === 2 && rz.sig === 0x06054b50 && rz.centralAt === rz.end, 'zip structure', rz);
const mf = readZip(to3MF(meshes));
const model = mf.files['3D/3dmodel.model'] || '';
a(Object.keys(mf.files).length === 3 && mf.files['[Content_Types].xml'].includes('3dmanufacturing') && mf.files['_rels/.rels'].includes('/3D/3dmodel.model'), '3MF package parts', Object.keys(mf.files));
a((model.match(/<vertex /g) || []).length === w.positions.length / 3 && (model.match(/<triangle /g) || []).length === w.indices.length / 3 && model.includes('unit="millimeter"') && model.includes('<item objectid="1"/>'), '3MF model content');
void inflateRawSync; // the archive is stored, not deflated: nothing to inflate

// hex round trip
const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255]);
a(toHex(bytes) === '00010f107f80ff' && fromHex(toHex(bytes)).every((b, i) => b === bytes[i]), 'hex round trip');

console.log(failed ? failed + ' FAILED' : 'all exchange tests passed');
process.exitCode = failed ? 1 : 0;
