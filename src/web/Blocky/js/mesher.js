/*
    Blocky - mesher.js

    Builds the geometry of one 16x16x16 chunk section. The section and a one
    block border (taken from the neighbouring chunks) are copied into padded
    arrays first, so the inner loop never has to look up a chunk.

    Cube faces get smooth lighting and ambient occlusion: every corner
    averages the light of the four voxels in front of it and darkens with
    the solid blocks around it. Everything else (plants, crops, torches,
    slabs, cactus, farmland, ladders, water) is built from boxes and planes
    with flat light.

    Vertex layout: position (3), uv (2), layer (1), light (sky, block) (2),
    colour (tint x shade x occlusion) (3).
*/

import { B, OPAQUE, SHAPE, BLOCKS, blockFaceLayer, layerOfTile, ITEMS } from "./blocks.js";
import { WORLD_H } from "./worldgen.js";
import { FACE_DIR } from "./shapes.js";

const P = 18;
const P2 = P * P;
const PAD_SIZE = P * P * P;
const pi = (x, y, z) => ((y + 1) * P + (z + 1)) * P + (x + 1);

const pBlk = new Uint8Array(PAD_SIZE);
const pMeta = new Uint8Array(PAD_SIZE);
const pLight = new Uint8Array(PAD_SIZE);
const pOpq = new Uint8Array(PAD_SIZE);

const FACE_VERTS = [
    [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]
];
const FACE_AXIS = [0, 0, 1, 1, 2, 2];
const FACE_SIGN = [1, -1, 1, -1, 1, -1];
export const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const FACE_OFF = [1, -1, P2, -P2, P, -P];
const AO_LEVEL = [0.5, 0.68, 0.84, 1.0];

const offs = (d) => d[1] * P2 + d[2] * P + d[0];

//AO_TABLE[f][v] = [front, side1, side2, corner] padded offsets
const AO_TABLE = FACE_VERTS.map((verts, f) => {
    const axis = FACE_AXIS[f];
    const n = [0, 0, 0];
    n[axis] = FACE_SIGN[f];
    const tAxes = [0, 1, 2].filter((a) => a !== axis);
    return verts.map((corner) => {
        const t1 = [0, 0, 0], t2 = [0, 0, 0];
        t1[tAxes[0]] = corner[tAxes[0]] ? 1 : -1;
        t2[tAxes[1]] = corner[tAxes[1]] ? 1 : -1;
        const s1 = [n[0] + t1[0], n[1] + t1[1], n[2] + t1[2]];
        const s2 = [n[0] + t2[0], n[1] + t2[1], n[2] + t2[2]];
        const c = [n[0] + t1[0] + t2[0], n[1] + t1[1] + t2[1], n[2] + t1[2] + t2[2]];
        return [offs(n), offs(s1), offs(s2), offs(c)];
    });
});

function faceUV(f, x, y, z) {
    switch (f) {
        case 0: return [1 - z, y];
        case 1: return [z, y];
        case 2: return [x, 1 - z];
        case 3: return [x, z];
        case 4: return [x, y];
        default: return [1 - x, y];
    }
}

/* ---------------- growable vertex buffer ---------------- */

class GeoBuf {
    constructor(cap = 8192) {
        this.alloc(cap);
    }
    alloc(cap) {
        const old = this.pos ? this : null;
        this.cap = cap;
        const pos = new Float32Array(cap * 3), uv = new Float32Array(cap * 2), layer = new Float32Array(cap);
        const light = new Float32Array(cap * 2), color = new Float32Array(cap * 3), index = new Uint32Array(cap * 1.5);
        if (old) {
            pos.set(old.pos);
            uv.set(old.uv);
            layer.set(old.layer);
            light.set(old.light);
            color.set(old.color);
            index.set(old.index);
        }
        this.pos = pos; this.uv = uv; this.layer = layer; this.light = light; this.color = color; this.index = index;
    }
    reset() {
        this.vc = 0;
        this.ic = 0;
    }
    vert(x, y, z, u, v, layer, sky, blk, r, g, b) {
        if (this.vc >= this.cap) {
            this.alloc(this.cap * 2);
        }
        const i = this.vc++;
        this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
        this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
        this.layer[i] = layer;
        this.light[i * 2] = sky; this.light[i * 2 + 1] = blk;
        this.color[i * 3] = r; this.color[i * 3 + 1] = g; this.color[i * 3 + 2] = b;
        return i;
    }
    quad(flip) {
        const b = this.vc - 4;
        if (this.ic + 6 > this.index.length) {
            this.alloc(this.cap * 2);
        }
        const ix = this.index;
        if (flip) {
            ix[this.ic++] = b + 1; ix[this.ic++] = b + 2; ix[this.ic++] = b + 3;
            ix[this.ic++] = b + 1; ix[this.ic++] = b + 3; ix[this.ic++] = b;
        } else {
            ix[this.ic++] = b; ix[this.ic++] = b + 1; ix[this.ic++] = b + 2;
            ix[this.ic++] = b; ix[this.ic++] = b + 2; ix[this.ic++] = b + 3;
        }
    }
    //Same four vertices again with reversed winding (double sided planes)
    backQuad() {
        const b = this.vc - 4;
        for (let k = 3; k >= 0; k--) {
            const s = b + k;
            this.vert(this.pos[s * 3], this.pos[s * 3 + 1], this.pos[s * 3 + 2], this.uv[s * 2], this.uv[s * 2 + 1],
                this.layer[s], this.light[s * 2], this.light[s * 2 + 1], this.color[s * 3], this.color[s * 3 + 1], this.color[s * 3 + 2]);
        }
        this.quad(false);
    }
    take() {
        if (this.vc === 0) {
            return null;
        }
        return {
            pos: this.pos.slice(0, this.vc * 3),
            uv: this.uv.slice(0, this.vc * 2),
            layer: this.layer.slice(0, this.vc),
            light: this.light.slice(0, this.vc * 2),
            color: this.color.slice(0, this.vc * 3),
            index: this.index.slice(0, this.ic)
        };
    }
}

const solidBuf = new GeoBuf(16384);
const waterBuf = new GeoBuf(4096);

/* ---------------- padded copy ---------------- */

function fillPadded(world, chunk, sy) {
    const y0 = sy * 16;
    const bx = chunk.cx * 16, bz = chunk.cz * 16;
    for (let pz = -1; pz <= 16; pz++) {
        for (let px = -1; px <= 16; px++) {
            const inside = px >= 0 && px < 16 && pz >= 0 && pz < 16;
            const wx = bx + px, wz = bz + pz;
            const c = inside ? chunk : world.chunkAt(wx >> 4, wz >> 4);
            const ok = c !== undefined && c.generated;
            const colBase = ((wx & 15) << 11) | ((wz & 15) << 7);
            for (let py = -1; py <= 16; py++) {
                const y = y0 + py;
                const p = ((py + 1) * P + (pz + 1)) * P + (px + 1);
                if (y < 0) {
                    pBlk[p] = B.BEDROCK; pMeta[p] = 0; pLight[p] = 0; pOpq[p] = 1;
                    continue;
                }
                if (y >= WORLD_H || !ok) {
                    pBlk[p] = 0; pMeta[p] = 0; pLight[p] = 0xf0; pOpq[p] = 0;
                    continue;
                }
                const i = colBase | y;
                const id = c.blocks[i];
                const m = c.meta[i];
                pBlk[p] = id;
                pMeta[p] = m;
                pLight[p] = c.light[i];
                pOpq[p] = OPAQUE[id] === 1 || (SHAPE[id] === "slab" && m === 2) ? 1 : 0;
            }
        }
    }
}

/* ---------------- section mesh ---------------- */

export function meshSection(world, chunk, sy, opts) {
    fillPadded(world, chunk, sy);
    solidBuf.reset();
    waterBuf.reset();
    const fancy = opts.fancyLeaves;
    const y0 = sy * 16;
    let any = false;
    for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                const p = pi(x, y, z);
                const id = pBlk[p];
                if (id === 0) {
                    continue;
                }
                any = true;
                const meta = pMeta[p];
                const shape = SHAPE[id];
                const tint = BLOCKS[id].tint;
                const col = (z * 16 + x) * 6 + (tint === "foliage" ? 3 : 0);
                const tr = tint ? chunk.tint[col] : 1, tg = tint ? chunk.tint[col + 1] : 1, tb = tint ? chunk.tint[col + 2] : 1;
                if (shape === "cube" || (shape === "slab" && meta === 2)) {
                    cubeFaces(solidBuf, p, x, y, z, id, meta, fancy, tr, tg, tb, tint);
                } else if (shape === "liquid") {
                    liquidFaces(waterBuf, p, x, y, z, id, meta);
                } else if (shape === "cross") {
                    crossPlant(solidBuf, p, x, y, z, id, meta, tr, tg, tb);
                } else if (shape === "crop") {
                    cropPlant(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "torch") {
                    torch(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "ladder") {
                    ladder(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "slab") {
                    const y1 = meta === 1 ? 1 : 0.5, ya = meta === 1 ? 0.5 : 0;
                    boxFaces(solidBuf, p, x, y, z, id, meta, 0, ya, 0, 1, y1, 1, (f, np) => {
                        const nid = pBlk[np];
                        if (f === 2 && meta === 0) {
                            return false;
                        }
                        if (f === 3 && meta === 1) {
                            return false;
                        }
                        if (pOpq[np]) {
                            return true;
                        }
                        if (SHAPE[nid] === "slab" && pMeta[np] === meta && f !== 2 && f !== 3) {
                            return true;
                        }
                        if (f === 2 && SHAPE[nid] === "slab" && pMeta[np] === 0) {
                            return true;
                        }
                        if (f === 3 && SHAPE[nid] === "slab" && pMeta[np] === 1) {
                            return true;
                        }
                        return false;
                    });
                } else if (shape === "cactus") {
                    const e = 1 / 16;
                    boxFaces(solidBuf, p, x, y, z, id, meta, e, 0, e, 1 - e, 1, 1 - e, (f, np) => {
                        if (f === 2 || f === 3) {
                            return pOpq[np] === 1 || pBlk[np] === B.CACTUS;
                        }
                        return false;
                    });
                } else if (shape === "farmland") {
                    boxFaces(solidBuf, p, x, y, z, id, meta, 0, 0, 0, 1, 15 / 16, 1, (f, np) => f !== 2 && pOpq[np] === 1);
                }
            }
        }
    }
    if (!any) {
        return { solid: null, water: null, empty: true };
    }
    return { solid: solidBuf.take(), water: waterBuf.take(), empty: false, y0 };
}

function cubeFaces(buf, p, x, y, z, id, meta, fancy, tr, tg, tb, tint) {
    for (let f = 0; f < 6; f++) {
        const np = p + FACE_OFF[f];
        if (pOpq[np]) {
            continue;
        }
        const nid = pBlk[np];
        if (nid === id && (id === B.GLASS || (id === B.LEAVES && !fancy))) {
            continue;
        }
        //Slabs that cover this face completely
        if (f === 2 && SHAPE[nid] === "slab" && pMeta[np] === 0) {
            continue;
        }
        if (f === 3 && SHAPE[nid] === "slab" && pMeta[np] === 1) {
            continue;
        }
        const layer = blockFaceLayer(id, f, meta);
        const tinted = tint === "foliage" || (tint === "grass" && f === 2);
        const shade = FACE_SHADE[f];
        const r = (tinted ? tr : 1) * shade, g = (tinted ? tg : 1) * shade, b = (tinted ? tb : 1) * shade;
        const verts = FACE_VERTS[f];
        const ao = AO_TABLE[f];
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
        for (let v = 0; v < 4; v++) {
            const t = ao[v];
            const pF = p + t[0], pS1 = p + t[1], pS2 = p + t[2], pC = p + t[3];
            const o1 = pOpq[pS1], o2 = pOpq[pS2], oc = pOpq[pC];
            let ls = pLight[pF] >> 4, lb = pLight[pF] & 15, n = 1;
            if (!o1) {
                ls += pLight[pS1] >> 4; lb += pLight[pS1] & 15; n++;
            }
            if (!o2) {
                ls += pLight[pS2] >> 4; lb += pLight[pS2] & 15; n++;
            }
            if (!(o1 && o2) && !oc) {
                ls += pLight[pC] >> 4; lb += pLight[pC] & 15; n++;
            }
            const occ = (o1 && o2) ? 0 : 3 - (o1 + o2 + oc);
            const k = AO_LEVEL[occ];
            const vx = verts[v][0], vy = verts[v][1], vz = verts[v][2];
            const uv = faceUV(f, vx, vy, vz);
            buf.vert(x + vx, y + vy, z + vz, uv[0], uv[1], layer, ls / (n * 15), lb / (n * 15), r * k, g * k, b * k);
            const bright = occ * 16 + ls + lb;
            if (v === 0) {
                a0 = bright;
            } else if (v === 1) {
                a1 = bright;
            } else if (v === 2) {
                a2 = bright;
            } else {
                a3 = bright;
            }
        }
        buf.quad(a0 + a2 < a1 + a3);
    }
}

//Axis aligned box with flat light; cull(f, neighbourPadded) skips faces
function boxFaces(buf, p, x, y, z, id, meta, x0, y0, z0, x1, y1, z1, cull) {
    const mins = [x0, y0, z0], maxs = [x1, y1, z1];
    for (let f = 0; f < 6; f++) {
        const np = p + FACE_OFF[f];
        if (cull(f, np)) {
            continue;
        }
        const axis = FACE_AXIS[f];
        const onEdge = FACE_SIGN[f] > 0 ? maxs[axis] >= 1 : mins[axis] <= 0;
        const lp = onEdge && !pOpq[np] ? np : p;
        const ls = (pLight[lp] >> 4) / 15, lb = (pLight[lp] & 15) / 15;
        const layer = blockFaceLayer(id, f, meta);
        const s = FACE_SHADE[f];
        for (const c of FACE_VERTS[f]) {
            const vx = c[0] ? x1 : x0, vy = c[1] ? y1 : y0, vz = c[2] ? z1 : z0;
            const uv = faceUV(f, vx, vy, vz);
            buf.vert(x + vx, y + vy, z + vz, uv[0], uv[1], layer, ls, lb, s, s, s);
        }
        buf.quad(false);
    }
}

function selfLight(p) {
    return [(pLight[p] >> 4) / 15, (pLight[p] & 15) / 15];
}

function crossPlant(buf, p, x, y, z, id, meta, tr, tg, tb) {
    const [ls, lb] = selfLight(p);
    const layer = blockFaceLayer(id, 4, meta);
    const a = 0.15, b = 0.85;
    const s = 0.92;
    const planes = [[a, a, b, b], [a, b, b, a]];
    for (const [xa, za, xb, zb] of planes) {
        buf.vert(x + xa, y, z + za, 0, 0, layer, ls, lb, tr * s, tg * s, tb * s);
        buf.vert(x + xb, y, z + zb, 1, 0, layer, ls, lb, tr * s, tg * s, tb * s);
        buf.vert(x + xb, y + 1, z + zb, 1, 1, layer, ls, lb, tr * s, tg * s, tb * s);
        buf.vert(x + xa, y + 1, z + za, 0, 1, layer, ls, lb, tr * s, tg * s, tb * s);
        buf.quad(false);
        buf.backQuad();
    }
}

function cropPlant(buf, p, x, y, z, id, meta) {
    const [ls, lb] = selfLight(p);
    const layer = blockFaceLayer(id, 4, meta);
    const yb = y - 1 / 16, yt = y + 15 / 16;
    for (const k of [0.25, 0.75]) {
        //Plane along z at x = k
        buf.vert(x + k, yb, z, 0, 0, layer, ls, lb, 0.9, 0.9, 0.9);
        buf.vert(x + k, yb, z + 1, 1, 0, layer, ls, lb, 0.9, 0.9, 0.9);
        buf.vert(x + k, yt, z + 1, 1, 1, layer, ls, lb, 0.9, 0.9, 0.9);
        buf.vert(x + k, yt, z, 0, 1, layer, ls, lb, 0.9, 0.9, 0.9);
        buf.quad(false);
        buf.backQuad();
        //Plane along x at z = k
        buf.vert(x, yb, z + k, 0, 0, layer, ls, lb, 0.8, 0.8, 0.8);
        buf.vert(x + 1, yb, z + k, 1, 0, layer, ls, lb, 0.8, 0.8, 0.8);
        buf.vert(x + 1, yt, z + k, 1, 1, layer, ls, lb, 0.8, 0.8, 0.8);
        buf.vert(x, yt, z + k, 0, 1, layer, ls, lb, 0.8, 0.8, 0.8);
        buf.quad(false);
        buf.backQuad();
    }
}

function torch(buf, p, x, y, z, id, meta) {
    const ls = (pLight[p] >> 4) / 15;
    const layer = blockFaceLayer(id, 4, meta);
    const x0 = 7 / 16, x1 = 9 / 16, h = 10 / 16;
    const wall = meta !== 2 && meta !== 3 && FACE_DIR[meta];
    const tf = (vx, vy, vz) => {
        if (!wall) {
            return [x + vx, y + vy, z + vz];
        }
        const lean = vy * 0.42 - 0.36;
        return [x + vx + wall[0] * lean, y + vy + 0.2, z + vz + wall[2] * lean];
    };
    for (let f = 0; f < 6; f++) {
        if (f === 3) {
            continue;
        }
        const s = FACE_SHADE[f] * 0.5 + 0.5;
        for (const c of FACE_VERTS[f]) {
            const vx = c[0] ? x1 : x0, vy = c[1] ? h : 0, vz = c[2] ? x1 : x0;
            const uv = faceUV(f, vx, vy, vz);
            const q = tf(vx, vy, vz);
            buf.vert(q[0], q[1], q[2], uv[0], uv[1], layer, ls, 1, s, s, s);
        }
        buf.quad(false);
    }
}

function ladder(buf, p, x, y, z, id, meta) {
    const [ls, lb] = selfLight(p);
    const layer = blockFaceLayer(id, 4, meta);
    const d = FACE_DIR[meta] || FACE_DIR[4];
    const e = 1 / 16;
    let pts;
    if (d[0] !== 0) {
        const px = d[0] > 0 ? e : 1 - e;
        pts = [[px, 0, 0], [px, 0, 1], [px, 1, 1], [px, 1, 0]];
    } else {
        const pz = d[2] > 0 ? e : 1 - e;
        pts = [[0, 0, pz], [1, 0, pz], [1, 1, pz], [0, 1, pz]];
    }
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let k = 0; k < 4; k++) {
        buf.vert(x + pts[k][0], y + pts[k][1], z + pts[k][2], uvs[k][0], uvs[k][1], layer, ls, lb, 0.85, 0.85, 0.85);
    }
    buf.quad(false);
    buf.backQuad();
}

export function waterHeight(meta, waterAbove) {
    if (waterAbove) {
        return 1;
    }
    if (meta === 0 || meta === 8) {
        return 0.875;
    }
    return Math.max(0.125, (8 - meta) / 9);
}

function liquidFaces(buf, p, x, y, z, id, meta) {
    const above = pBlk[p + P2] === B.WATER;
    const h = waterHeight(meta, above);
    const layer = blockFaceLayer(id, 2, meta);
    for (let f = 0; f < 6; f++) {
        const np = p + FACE_OFF[f];
        const nid = pBlk[np];
        if (nid === B.WATER) {
            continue;
        }
        if (f !== 2 && pOpq[np]) {
            continue;
        }
        if (f === 2 && pOpq[np] && h >= 1) {
            continue;
        }
        const lp = pOpq[np] ? p : np;
        const ls = (pLight[lp] >> 4) / 15, lb = (pLight[lp] & 15) / 15;
        const s = FACE_SHADE[f];
        for (const c of FACE_VERTS[f]) {
            const vx = c[0], vy = c[1] ? h : 0, vz = c[2];
            const uv = faceUV(f, vx, vy, vz);
            buf.vert(x + vx, y + vy, z + vz, uv[0], uv[1], layer, ls, lb, s, s, s);
        }
        buf.quad(false);
        buf.backQuad();
    }
}

/* ---------------- item models ---------------- */

//Geometry for held items and dropped items, centred on the origin.
//Blocks are unit cubes (slabs half height), everything else a flat card.
export function itemGeometry(id) {
    const buf = new GeoBuf(64);
    buf.reset();
    const it = ITEMS[id];
    const blockId = it && it.block;
    const shape = blockId ? SHAPE[blockId] : null;
    const cubeLike = blockId && (shape === "cube" || shape === "slab" || shape === "cactus" || shape === "farmland");
    if (cubeLike) {
        const def = BLOCKS[blockId];
        const meta = def.orient ? 4 : 0;
        const top = shape === "slab" ? 0.5 : 1;
        const inset = shape === "cactus" ? 1 / 16 : 0;
        const tintC = def.tint === "foliage" ? [0.48, 0.86, 0.32] : def.tint === "grass" ? [0.62, 1.0, 0.43] : null;
        for (let f = 0; f < 6; f++) {
            const layer = blockFaceLayer(blockId, f, meta);
            const s = FACE_SHADE[f];
            const tinted = tintC && (def.tint === "foliage" || f === 2);
            const r = (tinted ? tintC[0] : 1) * s, g = (tinted ? tintC[1] : 1) * s, b = (tinted ? tintC[2] : 1) * s;
            for (const c of FACE_VERTS[f]) {
                const vx = c[0] ? 1 - inset : inset, vy = c[1] ? top : 0, vz = c[2] ? 1 - inset : inset;
                const uv = faceUV(f, vx, vy, vz);
                buf.vert(vx - 0.5, vy - 0.5, vz - 0.5, uv[0], uv[1], layer, 1, 0, r, g, b);
            }
            buf.quad(false);
        }
        return { geo: buf.take(), cube: true };
    }
    let tile;
    if (it && it.icon && it.icon.flat) {
        tile = it.icon.flat;
    } else {
        tile = "stone";
    }
    const layer = layerOfTile(tile);
    const tint = it && it.icon && it.icon.tint === "grass" ? [0.62, 1.0, 0.43] : [1, 1, 1];
    buf.vert(-0.5, -0.5, 0, 0, 0, layer, 1, 0, tint[0], tint[1], tint[2]);
    buf.vert(0.5, -0.5, 0, 1, 0, layer, 1, 0, tint[0], tint[1], tint[2]);
    buf.vert(0.5, 0.5, 0, 1, 1, layer, 1, 0, tint[0], tint[1], tint[2]);
    buf.vert(-0.5, 0.5, 0, 0, 1, layer, 1, 0, tint[0], tint[1], tint[2]);
    buf.quad(false);
    buf.backQuad();
    return { geo: buf.take(), cube: false };
}
