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
// "The same place" is within WELD mm. Points are filed in cells of CELL mm;
// a point close to a cell wall is also looked for in the cell next to it, so
// two copies of a corner a hair apart on both sides of a wall still meet.
const WELD = 1e-5;
const CELL = 1e-4;

export function weld(mesh) {
    const cells = new Map();  // cell key -> [vertex index]
    const positions = [];
    const remap = new Uint32Array(mesh.positions.length / 3);
    const near = function (v, i) {
        const f = v / CELL - i;
        return f < WELD / CELL ? [i, i - 1] : f > 1 - WELD / CELL ? [i, i + 1] : [i];
    };
    for (let i = 0; i < remap.length; i++) {
        const x = mesh.positions[i * 3];
        const y = mesh.positions[i * 3 + 1];
        const z = mesh.positions[i * 3 + 2];
        const ix = Math.floor(x / CELL);
        const iy = Math.floor(y / CELL);
        const iz = Math.floor(z / CELL);
        let index = -1;
        const xs = near(x, ix);
        const ys = near(y, iy);
        const zs = near(z, iz);
        for (let a = 0; a < xs.length && index < 0; a++) {
            for (let b = 0; b < ys.length && index < 0; b++) {
                for (let c = 0; c < zs.length && index < 0; c++) {
                    const list = cells.get(xs[a] + ',' + ys[b] + ',' + zs[c]);
                    if (!list) {
                        continue;
                    }
                    for (let k = 0; k < list.length; k++) {
                        const j = list[k] * 3;
                        if (Math.abs(positions[j] - x) <= WELD && Math.abs(positions[j + 1] - y) <= WELD && Math.abs(positions[j + 2] - z) <= WELD) {
                            index = list[k];
                            break;
                        }
                    }
                }
            }
        }
        if (index < 0) {
            index = positions.length / 3;
            positions.push(x, y, z);
            const key = ix + ',' + iy + ',' + iz;
            const list = cells.get(key);
            if (list) {
                list.push(index);
            } else {
                cells.set(key, [index]);
            }
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

// What a slicer would say about a mesh once its corners are merged:
// { triangles, open, multiple, watertight } - open edges belong to one
// triangle (a crack or a missing face), multiple ones to more than two (the
// solid touches itself there, "non-manifold")
export function meshCheck(mesh) {
    const m = weld(mesh);
    const uses = new Map();
    for (let i = 0; i < m.indices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const a = m.indices[i + k];
            const b = m.indices[i + (k + 1) % 3];
            const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
            uses.set(key, (uses.get(key) || 0) + 1);
        }
    }
    let open = 0;
    let multiple = 0;
    uses.forEach(function (count) {
        if (count === 1) {
            open++;
        } else if (count > 2) {
            multiple++;
        }
    });
    return { triangles: m.indices.length / 3, open: open, multiple: multiple, watertight: !open && !multiple };
}

function n(v) {
    return String(+v.toFixed(5));
}

// Binary STL of all solids together: Uint8Array
export function toSTL(meshes, units) {
    let triangles = 0;
    meshes.forEach(function (m) {
        triangles += m.indices.length / 3;
    });
    const buffer = new ArrayBuffer(84 + triangles * 50);
    const view = new DataView(buffer);
    const header = 'Binary STL written by ArozOS 3D Modeler, units ' + (units === 'in' ? 'inch' : 'mm');
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

// ASCII STL of all solids together: text (for programs that read no binary)
export function toSTLText(meshes, name) {
    const title = (name || 'part').replace(/\s+/g, '_');
    const lines = ['solid ' + title];
    meshes.forEach(function (m) {
        const p = m.positions;
        for (let i = 0; i < m.indices.length; i += 3) {
            const a = m.indices[i] * 3;
            const b = m.indices[i + 1] * 3;
            const c = m.indices[i + 2] * 3;
            const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
            const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
            const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const len = Math.hypot(nn[0], nn[1], nn[2]) || 1;
            lines.push('  facet normal ' + n(nn[0] / len) + ' ' + n(nn[1] / len) + ' ' + n(nn[2] / len), '    outer loop');
            [a, b, c].forEach(function (k) {
                lines.push('      vertex ' + n(p[k]) + ' ' + n(p[k + 1]) + ' ' + n(p[k + 2]));
            });
            lines.push('    endloop', '  endfacet');
        }
    });
    lines.push('endsolid ' + title);
    return lines.join('\n') + '\n';
}

// The meshes scaled (millimetres to inches for an export in inches)
export function scaled(meshes, factor) {
    if (factor === 1) {
        return meshes;
    }
    return meshes.map(function (m) {
        const positions = new Float32Array(m.positions.length);
        for (let i = 0; i < positions.length; i++) {
            positions[i] = m.positions[i] * factor;
        }
        return Object.assign({}, m, { positions: positions });
    });
}

/* ---------------- reading meshes (STL, OBJ) ---------------- */
// The largest mesh read in: more triangles make the part file too big
export const MAX_TRIANGLES = 1000000;

function looksAscii(bytes) {
    let head = '';
    for (let i = 0; i < Math.min(bytes.length, 512); i++) {
        head += String.fromCharCode(bytes[i]);
    }
    head = head.toLowerCase();
    return /^\s*solid/.test(head) && head.indexOf('facet') >= 0;
}

// An STL file (binary or ASCII bytes) as an indexed mesh
// { positions: Float32Array, indices: Uint32Array } with shared corners
export function parseSTL(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        bytes = new Uint8Array(bytes);
    }
    const positions = [];
    if (bytes.length >= 84) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const count = view.getUint32(80, true);
        if (84 + count * 50 === bytes.length && !(count === 0 && looksAscii(bytes))) {
            if (count > MAX_TRIANGLES) {
                throw new Error('This STL file has ' + count + ' triangles; at most ' + MAX_TRIANGLES + ' can be brought in');
            }
            for (let t = 0; t < count; t++) {
                const at = 84 + t * 50 + 12;
                for (let k = 0; k < 9; k++) {
                    positions.push(view.getFloat32(at + k * 4, true));
                }
            }
            return finish(positions);
        }
    }
    if (!looksAscii(bytes)) {
        throw new Error('This is not an STL file');
    }
    const text = new TextDecoder().decode(bytes);
    const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m;
    while ((m = vertex.exec(text))) {
        positions.push(Number(m[1]), Number(m[2]), Number(m[3]));
        if (positions.length > MAX_TRIANGLES * 9) {
            throw new Error('This STL file has more than ' + MAX_TRIANGLES + ' triangles');
        }
    }
    if (!positions.length || positions.length % 9 !== 0 || positions.some(function (v) {
        return !isFinite(v);
    })) {
        throw new Error('This STL file is damaged: its triangles do not add up');
    }
    return finish(positions);
}

// A Wavefront OBJ file's faces (polygons fanned into triangles; texture and
// normal indices ignored; negative indices count from the end)
export function parseOBJ(text) {
    const verts = [];
    const positions = [];
    String(text).split(/\r?\n/).forEach(function (line) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'v' && parts.length >= 4) {
            verts.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
        } else if (parts[0] === 'f' && parts.length >= 4) {
            const ids = parts.slice(1).map(function (q) {
                const k = parseInt(q.split('/')[0], 10);
                return k < 0 ? verts.length + k : k - 1;
            });
            for (let i = 1; i + 1 < ids.length; i++) {
                [ids[0], ids[i], ids[i + 1]].forEach(function (k) {
                    const v = verts[k];
                    if (!v) {
                        throw new Error('This OBJ file is damaged: a face uses a corner that does not exist');
                    }
                    positions.push(v[0], v[1], v[2]);
                });
            }
            if (positions.length > MAX_TRIANGLES * 9) {
                throw new Error('This OBJ file has more than ' + MAX_TRIANGLES + ' triangles');
            }
        }
    });
    if (!positions.length) {
        throw new Error('This OBJ file has no faces');
    }
    if (positions.some(function (v) {
        return !isFinite(v);
    })) {
        throw new Error('This OBJ file is damaged: a corner is not a number');
    }
    return finish(positions);
}

// Triangle soup -> welded indexed mesh
function finish(positions) {
    const soup = new Float32Array(positions);
    const indices = new Uint32Array(soup.length / 3);
    for (let i = 0; i < indices.length; i++) {
        indices[i] = i;
    }
    const out = weld({ positions: soup, indices: indices });
    if (!out.indices.length) {
        throw new Error('The file has no triangles with an area');
    }
    return out;
}

// A mesh kept in a part file: base64 of its Float32 / Uint32 buffers
function toBase64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
}

function fromBase64(text) {
    const raw = atob(text);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}

export function encodeMesh(mesh) {
    return {
        positions: toBase64(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength)),
        indices: toBase64(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength))
    };
}

export function decodeMesh(stored) {
    const p = fromBase64(stored.positions || '');
    const i = fromBase64(stored.indices || '');
    if (p.length % 12 || i.length % 12) {
        throw new Error('The mesh kept in this part is damaged');
    }
    return { positions: new Float32Array(p.buffer), indices: new Uint32Array(i.buffer) };
}

// Triangles and bounds of a mesh, for the import message
export function meshInfo(mesh) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], mesh.positions[i + k]);
            max[k] = Math.max(max[k], mesh.positions[i + k]);
        }
    }
    return { triangles: mesh.indices.length / 3, min: min, max: max };
}

// Wavefront OBJ, one object per solid: text
export function toOBJ(meshes, name, units) {
    const lines = ['# Written by ArozOS 3D Modeler, units ' + (units === 'in' ? 'inch' : 'mm')];
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
export function to3MF(meshes, units) {
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
        { name: '3D/3dmodel.model', text: head + '<model unit="' + (units === 'in' ? 'inch' : 'millimeter') + '" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
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
