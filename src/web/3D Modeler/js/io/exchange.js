/*
    3D Modeler - mesh export formats

    Writers for the triangle formats: STL (binary), OBJ and 3MF. They take the
    meshes the kernel returns from its "mesh" operation,
        [{ positions: Float32Array, indices: Uint32Array }]   one per solid
    in millimetres, and return the file as text or bytes. STEP and BREP are
    written by the kernel itself (kernel/occt.js exportText).

    Pure functions, no DOM: they run under Node for tests.
*/

// The kernel meshes every face on its own, so a corner appears once per face
// that meets there. OBJ and 3MF want each corner once, or slicers call the
// mesh "not watertight": merge the vertices that sit in the same place.
export function weld(mesh) {
    const seen = new Map();
    const positions = [];
    const remap = new Uint32Array(mesh.positions.length / 3);
    for (let i = 0; i < remap.length; i++) {
        const x = mesh.positions[i * 3];
        const y = mesh.positions[i * 3 + 1];
        const z = mesh.positions[i * 3 + 2];
        const key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
        let index = seen.get(key);
        if (index === undefined) {
            index = positions.length / 3;
            seen.set(key, index);
            positions.push(x, y, z);
        }
        remap[i] = index;
    }
    const indices = [];
    for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = remap[mesh.indices[i]];
        const b = remap[mesh.indices[i + 1]];
        const c = remap[mesh.indices[i + 2]];
        if (a !== b && b !== c && a !== c) { // a sliver that collapsed is dropped
            indices.push(a, b, c);
        }
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function n(v) {
    return String(+v.toFixed(5));
}

// Binary STL of all solids together: Uint8Array
export function toSTL(meshes) {
    let triangles = 0;
    meshes.forEach(function (m) {
        triangles += m.indices.length / 3;
    });
    const buffer = new ArrayBuffer(84 + triangles * 50);
    const view = new DataView(buffer);
    const header = 'Binary STL written by ArozOS 3D Modeler, units mm';
    for (let i = 0; i < header.length; i++) {
        view.setUint8(i, header.charCodeAt(i));
    }
    view.setUint32(80, triangles, true);
    let at = 84;
    meshes.forEach(function (m) {
        const p = m.positions;
        for (let i = 0; i < m.indices.length; i += 3) {
            const a = m.indices[i] * 3;
            const b = m.indices[i + 1] * 3;
            const c = m.indices[i + 2] * 3;
            const ux = p[b] - p[a];
            const uy = p[b + 1] - p[a + 1];
            const uz = p[b + 2] - p[a + 2];
            const vx = p[c] - p[a];
            const vy = p[c + 1] - p[a + 1];
            const vz = p[c + 2] - p[a + 2];
            let nx = uy * vz - uz * vy;
            let ny = uz * vx - ux * vz;
            let nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]].forEach(function (value) {
                view.setFloat32(at, value, true);
                at += 4;
            });
            at += 2; // attribute byte count, unused
        }
    });
    return new Uint8Array(buffer);
}

// Wavefront OBJ, one object per solid: text
export function toOBJ(meshes, name) {
    const lines = ['# Written by ArozOS 3D Modeler, units mm'];
    let offset = 1;
    meshes.forEach(function (raw, i) {
        const m = weld(raw);
        lines.push('o ' + (name || 'Part') + (meshes.length > 1 ? '_' + (i + 1) : ''));
        for (let v = 0; v < m.positions.length; v += 3) {
            lines.push('v ' + n(m.positions[v]) + ' ' + n(m.positions[v + 1]) + ' ' + n(m.positions[v + 2]));
        }
        for (let f = 0; f < m.indices.length; f += 3) {
            lines.push('f ' + (m.indices[f] + offset) + ' ' + (m.indices[f + 1] + offset) + ' ' + (m.indices[f + 2] + offset));
        }
        offset += m.positions.length / 3;
    });
    return lines.join('\n') + '\n';
}

/* ---------------- zip (stored, no compression) ---------------- */
let crcTable = null;

function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            }
            crcTable[i] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// files: [{ name, text }] -> Uint8Array of a zip archive
export function zip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach(function (file) {
        const name = encoder.encode(file.name);
        const data = encoder.encode(file.text);
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);       // version needed
        local.setUint16(6, 0x0800, true);   // names are UTF-8
        local.setUint16(8, 0, true);        // stored
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        parts.push(new Uint8Array(local.buffer), name, data);
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, data.length, true);
        entry.setUint32(24, data.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(new Uint8Array(entry.buffer), name);
        offset += 30 + name.length + data.length;
    });
    let centralSize = 0;
    central.forEach(function (part) {
        centralSize += part.length;
    });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(offset + centralSize + 22);
    let at = 0;
    all.forEach(function (part) {
        out.set(part, at);
        at += part.length;
    });
    return out;
}

// 3MF (the 3D printing format slicers prefer): Uint8Array
export function to3MF(meshes) {
    const objects = [];
    const items = [];
    meshes.forEach(function (raw, i) {
        const m = weld(raw);
        const vertices = [];
        for (let v = 0; v < m.positions.length; v += 3) {
            vertices.push('<vertex x="' + n(m.positions[v]) + '" y="' + n(m.positions[v + 1]) + '" z="' + n(m.positions[v + 2]) + '"/>');
        }
        const triangles = [];
        for (let f = 0; f < m.indices.length; f += 3) {
            triangles.push('<triangle v1="' + m.indices[f] + '" v2="' + m.indices[f + 1] + '" v3="' + m.indices[f + 2] + '"/>');
        }
        objects.push('<object id="' + (i + 1) + '" type="model"><mesh><vertices>' + vertices.join('') + '</vertices><triangles>' +
            triangles.join('') + '</triangles></mesh></object>');
        items.push('<item objectid="' + (i + 1) + '"/>');
    });
    const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
    return zip([
        { name: '[Content_Types].xml', text: head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
        { name: '_rels/.rels', text: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
        { name: '3D/3dmodel.model', text: head + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
            '<resources>' + objects.join('') + '</resources><build>' + items.join('') + '</build></model>' }
    ]);
}

export function toHex(bytes) {
    const digits = '0123456789abcdef';
    const out = new Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        out[i] = digits[bytes[i] >> 4] + digits[bytes[i] & 15];
    }
    return out.join('');
}

export function fromHex(hex) {
    const out = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
}
