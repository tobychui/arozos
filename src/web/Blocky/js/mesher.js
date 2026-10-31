/*
    Blocky - mesher.js

    Builds the geometry of one 16x16x16 chunk section. The section and a one
    block border (taken from the neighbouring chunks) are copied into padded
    arrays first, so the inner loop never has to look up a chunk.

    Cube faces get smooth lighting and ambient occlusion: every corner
    averages the light of the four voxels in front of it and darkens with
    the solid blocks around it. Everything else (plants, crops, torches,
    slabs, stairs, cactus, farmland, ladders, water) is built from boxes and planes
    with flat light.

    Vertex layout: position (3), uv (2), layer (1), light (sky, block) (2),
    colour (tint x shade x occlusion) (3).
*/

import { B, OPAQUE, SHAPE, BLOCKS, blockFaceLayer, layerOfTile, ITEMS, HDIR, FLAME_CATCH } from "./blocks.js";
import { WORLD_H } from "./worldgen.js";
import {
    FACE_DIR, doorBox, gateAlongZ, fenceLinks, rotatePoint, paneLinks, LEVER_BASE, BUTTON_BOX, BUTTON_PRESSED,
    signAngle, SIGN_BOARD, SIGN_POST, SIGN_WALL_BOARD,
    PISTON_BASE, HEAD_PLATE, HEAD_ROD, stairShape, stairBoxes
} from "./shapes.js";

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
                    liquidFaces(id === B.LAVA ? solidBuf : waterBuf, p, x, y, z, id, meta);
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
                } else if (shape === "stairs") {
                    stairs(solidBuf, p, x, y, z, id, meta);
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
                } else if (shape === "fire") {
                    firePlanes(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "door") {
                    const b = doorBox(meta);
                    boxFaces(solidBuf, p, x, y, z, id, meta, b[0], b[1], b[2], b[3], b[4], b[5], (f, np) => (f === 2 || f === 3) && pOpq[np] === 1);
                } else if (shape === "fence") {
                    fence(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "gate") {
                    for (const b of gateBoxes(meta)) {
                        boxFaces(solidBuf, p, x, y, z, id, meta, b[0], b[1], b[2], b[3], b[4], b[5], (f, np) => f === 3 && b[1] === 0 && pOpq[np] === 1);
                    }
                } else if (shape === "bed") {
                    bed(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "pane") {
                    pane(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "wire") {
                    wire(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "lever") {
                    lever(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "button") {
                    button(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "sign") {
                    sign(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "retimer") {
                    retimer(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "plate") {
                    boxFaces(solidBuf, p, x, y, z, id, meta, U, 0, U, 15 * U, meta & 1 ? U / 2 : U, 15 * U, (f, np) => f === 3 && pOpq[np] === 1);
                } else if (shape === "piston") {
                    piston(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "pistonhead") {
                    pistonHead(solidBuf, p, x, y, z, id, meta);
                } else if (shape === "rail") {
                    rail(solidBuf, p, x, y, z, id, meta);
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

//Top face texture coordinates turned to a horizontal facing (0 +x, 1 +z, 2 -x, 3 -z)
function topUV(facing, x, z) {
    switch (facing) {
        case 0: return [z, x];
        case 1: return [1 - x, z];
        case 2: return [1 - z, 1 - x];
        default: return [x, 1 - z];
    }
}

//Axis aligned box with flat light; cull(f, neighbourPadded) skips faces.
//topFacing >= 0 turns the top texture to that facing (beds).
function boxFaces(buf, p, x, y, z, id, meta, x0, y0, z0, x1, y1, z1, cull, topFacing = -1) {
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
            const uv = f === 2 && topFacing >= 0 ? topUV(topFacing, vx, vz) : faceUV(f, vx, vy, vz);
            buf.vert(x + vx, y + vy, z + vz, uv[0], uv[1], layer, ls, lb, s, s, s);
        }
        buf.quad(false);
    }
}

//Does another box of the set cover face f of box i completely (two boxes
//of one block touching inside it)?
function faceCovered(boxes, i, f) {
    const b = boxes[i];
    const axis = FACE_AXIS[f], pos = FACE_SIGN[f] > 0;
    const plane = pos ? b[axis + 3] : b[axis];
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    for (let j = 0; j < boxes.length; j++) {
        const o = boxes[j];
        if (j === i || (pos ? o[axis] : o[axis + 3]) !== plane) {
            continue;
        }
        if (o[a1] <= b[a1] && o[a1 + 3] >= b[a1 + 3] && o[a2] <= b[a2] && o[a2 + 3] >= b[a2 + 3]) {
            return true;
        }
    }
    return false;
}

//Stairs: the half slab and the raised step, joined into corners with the
//stairs around them. Faces take the light of the open cell they look
//into, since the stair itself dims light.
function stairs(buf, p, x, y, z, id, meta) {
    const boxes = stairBoxes(meta, stairShape((a, b, c) => pBlk[pi(a, b, c)], (a, b, c) => pMeta[pi(a, b, c)], x, y, z, meta));
    for (let i = 0; i < boxes.length; i++) {
        const bx = boxes[i];
        for (let f = 0; f < 6; f++) {
            const axis = FACE_AXIS[f];
            const np = p + FACE_OFF[f];
            const onEdge = FACE_SIGN[f] > 0 ? bx[axis + 3] >= 1 : bx[axis] <= 0;
            if (onEdge ? pOpq[np] === 1 : faceCovered(boxes, i, f)) {
                continue;
            }
            const lp = !pOpq[np] ? np : !pOpq[p + P2] ? p + P2 : p;
            const ls = (pLight[lp] >> 4) / 15, lb = (pLight[lp] & 15) / 15;
            const layer = blockFaceLayer(id, f, meta);
            const sh = FACE_SHADE[f];
            for (const c of FACE_VERTS[f]) {
                const vx = c[0] ? bx[3] : bx[0], vy = c[1] ? bx[4] : bx[1], vz = c[2] ? bx[5] : bx[2];
                const uv = faceUV(f, vx, vy, vz);
                buf.vert(x + vx, y + vy, z + vz, uv[0], uv[1], layer, ls, lb, sh, sh, sh);
            }
            buf.quad(false);
        }
    }
}

const U = 1 / 16;

//Bed half: a mattress on a frame, raised on two legs at its outer end, so a
//whole bed stands on four legs
function bed(buf, p, x, y, z, id, meta) {
    const f = meta & 3;
    boxFaces(buf, p, x, y, z, id, meta, 0, 3 * U, 0, 1, 9 * U, 1, () => false, f);
    const d = HDIR[f];
    const s = meta & 4 ? 1 : -1;
    const ex = d[0] * s, ez = d[1] * s;
    const near = [0, 3 * U], far = [13 * U, 1];
    let legs;
    if (ex !== 0) {
        const xr = ex > 0 ? far : near;
        legs = [[xr, near], [xr, far]];
    } else {
        const zr = ez > 0 ? far : near;
        legs = [[near, zr], [far, zr]];
    }
    for (const [xr, zr] of legs) {
        boxFaces(buf, p, x, y, z, id, meta, xr[0], 0, zr[0], xr[1], 3 * U, zr[1], (fc, np) => fc === 2 || (fc === 3 && pOpq[np] === 1));
    }
}

//Fence: a post plus two rails toward every connected neighbour
function fence(buf, p, x, y, z, id, meta) {
    const getId = (a, b, c) => pBlk[pi(a, b, c)];
    const getMeta = (a, b, c) => pMeta[pi(a, b, c)];
    const links = fenceLinks(getId, getMeta, x, y, z);
    boxFaces(buf, p, x, y, z, id, meta, 6 * U, 0, 6 * U, 10 * U, 1, 10 * U, (f, np) => (f === 2 || f === 3) && pOpq[np] === 1);
    const arms = [
        [10 * U, 7 * U, 1, 9 * U, 0], [0, 7 * U, 6 * U, 9 * U, 1],
        [7 * U, 10 * U, 9 * U, 1, 4], [7 * U, 0, 9 * U, 6 * U, 5]
    ];
    arms.forEach(([a0, b0, a1, b1, endFace], k) => {
        if (!links[k]) {
            return;
        }
        for (const [r0, r1] of [[6 * U, 9 * U], [12 * U, 15 * U]]) {
            boxFaces(buf, p, x, y, z, id, meta, a0, r0, b0, a1, r1, b1, (f) => f === endFace);
        }
    });
}

//Gate pieces in block units; built along z and swapped for gates along x
function gateBoxes(meta) {
    const open = (meta & 4) !== 0;
    const parts = [[7, 5, 0, 9, 16, 2], [7, 5, 14, 9, 16, 16]];
    if (!open) {
        parts.push([7, 6, 2, 9, 9, 14], [7, 12, 2, 9, 15, 14], [7, 9, 7, 9, 12, 9]);
    } else {
        for (const [u0, u1] of [[0, 2], [14, 16]]) {
            parts.push([9, 6, u0, 15, 9, u1], [9, 12, u0, 15, 15, u1], [13, 9, u0, 15, 12, u1]);
        }
    }
    const alongZ = gateAlongZ(meta);
    return parts.map(([w0, y0, u0, w1, y1, u1]) => (alongZ
        ? [w0 * U, y0 * U, u0 * U, w1 * U, y1 * U, u1 * U]
        : [u0 * U, y0 * U, w0 * U, u1 * U, y1 * U, w1 * U]));
}

//Fire: double sided flame sheets, always fully bright. On a floor (solid
//or burnable) they stand crossed and leaning; a fire held up only by
//burnable neighbours clings to their faces and licks the block above.
const FIRE_UV = [0, 0, 1, 0, 1, 1, 0, 1];
const FIRE_H = 1.25;
function firePlanes(buf, p, x, y, z, id, meta) {
    const ls = (pLight[p] >> 4) / 15;
    const layer = blockFaceLayer(id, 4, meta);
    //c: bottom-left, bottom-right, top-right, top-left corners
    const sheet = (c) => {
        for (let k = 0; k < 4; k++) {
            buf.vert(x + c[k * 3], y + c[k * 3 + 1], z + c[k * 3 + 2], FIRE_UV[k * 2], FIRE_UV[k * 2 + 1], layer, ls, 1, 1, 1, 1);
        }
        buf.quad(false);
        buf.backQuad();
    };
    const H = FIRE_H;
    const below = p + FACE_OFF[3];
    let clings = false;
    if (!pOpq[below] && !FLAME_CATCH[pBlk[below]]) {
        const e = 0.99, s = 0.01, lean = 0.22;
        if (FLAME_CATCH[pBlk[p + FACE_OFF[0]]]) {
            sheet([e, 0, 0, e, 0, 1, e - lean, H, 1, e - lean, H, 0]);
            clings = true;
        }
        if (FLAME_CATCH[pBlk[p + FACE_OFF[1]]]) {
            sheet([s, 0, 1, s, 0, 0, s + lean, H, 0, s + lean, H, 1]);
            clings = true;
        }
        if (FLAME_CATCH[pBlk[p + FACE_OFF[4]]]) {
            sheet([1, 0, e, 0, 0, e, 0, H, e - lean, 1, H, e - lean]);
            clings = true;
        }
        if (FLAME_CATCH[pBlk[p + FACE_OFF[5]]]) {
            sheet([0, 0, s, 1, 0, s, 1, H, s + lean, 0, H, s + lean]);
            clings = true;
        }
        if (FLAME_CATCH[pBlk[p + FACE_OFF[2]]]) {
            //A tent of flames under the burning block
            for (const [b, t] of [[0.1, 0.5], [0.9, 0.5]]) {
                sheet([b, 0.35, 0, b, 0.35, 1, t, 1, 1, t, 1, 0]);
                sheet([0, 0.35, b, 1, 0.35, b, 1, 1, t, 0, 1, t]);
            }
            clings = true;
        }
    }
    if (clings) {
        return;
    }
    //Standing fire: an inner pair crossing over and an outer pair leaning in
    for (const [b, t] of [[0.7, 0.2], [0.3, 0.8], [0.02, 0.35], [0.98, 0.65]]) {
        sheet([b, 0, 0, b, 0, 1, t, H, 1, t, H, 0]);
        sheet([0, 0, b, 1, 0, b, 1, H, t, 0, H, t]);
    }
}

/* ---------------- panes, spark parts and rails ---------------- */

//World face index a canonical (facing up) face points to after turning
const TURNED_FACE = [];
for (let face = 0; face < 6; face++) {
    TURNED_FACE[face] = [];
    const c = rotatePoint(face, 0.5, 0.5, 0.5);
    for (let f = 0; f < 6; f++) {
        const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][f];
        const q = rotatePoint(face, 0.5 + n[0] * 0.5, 0.5 + n[1] * 0.5, 0.5 + n[2] * 0.5);
        const d = [Math.round((q[0] - c[0]) * 2), Math.round((q[1] - c[1]) * 2), Math.round((q[2] - c[2]) * 2)];
        TURNED_FACE[face][f] = d[0] === 1 ? 0 : d[0] === -1 ? 1 : d[1] === 1 ? 2 : d[1] === -1 ? 3 : d[2] === 1 ? 4 : 5;
    }
}

//A box modelled facing up, turned to `face`. layerFn(f) picks the texture
//by canonical face; lean tilts the top along z (lever handles); faces on
//the block boundary are skipped against opaque neighbours.
function turnedBox(buf, p, x, y, z, b, face, layerFn, lean = 0) {
    const mins = [b[0], b[1], b[2]], maxs = [b[3], b[4], b[5]];
    for (let f = 0; f < 6; f++) {
        const wf = TURNED_FACE[face][f];
        const axis = FACE_AXIS[f];
        const onEdge = FACE_SIGN[f] > 0 ? maxs[axis] >= 1 : mins[axis] <= 0;
        const np = p + FACE_OFF[wf];
        if (onEdge && !lean && pOpq[np]) {
            continue;
        }
        //Opaque parts (pistons) hold no light themselves: light each face
        //from the space it looks into
        const lp = pOpq[np] ? p : np;
        const ls = (pLight[lp] >> 4) / 15, lb = (pLight[lp] & 15) / 15;
        const layer = layerFn(f);
        const s = FACE_SHADE[wf];
        for (const c of FACE_VERTS[f]) {
            const vx = c[0] ? b[3] : b[0], vy = c[1] ? b[4] : b[1];
            let vz = c[2] ? b[5] : b[2];
            const uv = faceUV(f, vx, vy, vz);
            if (lean) {
                vz += (vy - b[1]) * lean;
            }
            const q = rotatePoint(face, vx, vy, vz);
            buf.vert(x + q[0], y + q[1], z + q[2], uv[0], uv[1], layer, ls, lb, s, s, s);
        }
        buf.quad(false);
    }
}

function pane(buf, p, x, y, z, id, meta) {
    const getId = (a, b, c) => pBlk[pi(a, b, c)];
    const getMeta = (a, b, c) => pMeta[pi(a, b, c)];
    const links = paneLinks(getId, getMeta, x, y, z);
    if (id === B.IRON_BARS) {
        ironBars(buf, p, x, y, z, id, meta, links);
        return;
    }
    const capped = (f, np) => (f === 2 || f === 3) && (pOpq[np] === 1 || SHAPE[pBlk[np]] === "pane");
    boxFaces(buf, p, x, y, z, id, meta, 7 * U, 0, 7 * U, 9 * U, 1, 9 * U, capped);
    const arms = [
        [9 * U, 7 * U, 1, 9 * U, 0], [0, 7 * U, 7 * U, 9 * U, 1],
        [7 * U, 9 * U, 9 * U, 1, 4], [7 * U, 0, 9 * U, 7 * U, 5]
    ];
    arms.forEach(([a0, b0, a1, b1, endFace], k) => {
        if (links[k]) {
            boxFaces(buf, p, x, y, z, id, meta, a0, 0, b0, a1, 1, b1, (f, np) => f === endFace || capped(f, np));
        }
    });
}

//Iron bars: a 2 x 2 post, and toward each linked side a framed half panel
//(rails at the top and bottom, a bar in the middle of the half and a half
//bar on the edge that meets the neighbour's into a whole one), 2 px deep.
//Pieces are listed for the +x arm as [along0, y0, along1, y1].
const BAR_ARM = [
    [9, 0, 16, 1], [9, 15, 16, 16],
    [11, 1, 13, 15], [15, 1, 16, 15]
];

function ironBars(buf, p, x, y, z, id, meta, links) {
    const capped = (f, np) => (f === 2 || f === 3) && (pOpq[np] === 1 || pBlk[np] === B.IRON_BARS);
    boxFaces(buf, p, x, y, z, id, meta, 7 * U, 0, 7 * U, 9 * U, 1, 9 * U, capped);
    //Arm k (+x, -x, +z, -z): its end face and how an along range maps to x / z
    const END = [0, 1, 4, 5];
    for (let k = 0; k < 4; k++) {
        if (!links[k]) {
            continue;
        }
        for (const [a0, y0, a1, y1] of BAR_ARM) {
            //Mirror the +x layout for the arms pointing the other way
            const lo = k === 0 || k === 2 ? a0 : 16 - a1, hi = k === 0 || k === 2 ? a1 : 16 - a0;
            const box = k < 2 ? [lo, y0, 7, hi, y1, 9] : [7, y0, lo, 9, y1, hi];
            //Only faces on the block's own edge can be hidden by a neighbour
            const atEnd = a1 === 16;
            boxFaces(buf, p, x, y, z, id, meta, box[0] * U, box[1] * U, box[2] * U, box[3] * U, box[4] * U, box[5] * U,
                (f, np) => (atEnd && f === END[k]) || (((f === 2 && y1 === 16) || (f === 3 && y0 === 0)) && pOpq[np] === 1));
        }
    }
}

const WIRE_LINKS = new Set([B.SPARK_WIRE, B.LEVER, B.BUTTON, B.PLATE_WOOD, B.PLATE_STONE, B.RETIMER, B.RETIMER_ON, B.SPARK_TORCH, B.SPARK_TORCH_OFF, B.SPARK_LAMP,
    B.SPARK_LAMP_ON, B.PISTON, B.STICKY_PISTON, B.SPARK_BLOCK, B.POWERED_RAIL]);

function flatQuad(buf, x0, z0, x1, z1, yy, layer, ls, lb, r, g, b) {
    buf.vert(x0, yy, z1, 0, 0, layer, ls, lb, r, g, b);
    buf.vert(x1, yy, z1, 1, 0, layer, ls, lb, r, g, b);
    buf.vert(x1, yy, z0, 1, 1, layer, ls, lb, r, g, b);
    buf.vert(x0, yy, z0, 0, 1, layer, ls, lb, r, g, b);
    buf.quad(false);
}

//Spark wire: a dot with arms toward whatever it connects to, brighter with power
function wire(buf, p, x, y, z, id, meta) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const above = pOpq[p + P2];
    const links = dirs.map(([dx, dz]) => {
        const np = p + dx + dz * P;
        const nid = pBlk[np];
        //A retimer only takes wire at its back (input) and front (output)
        if (nid === B.RETIMER || nid === B.RETIMER_ON) {
            return (dx !== 0) === ((pMeta[np] & 1) === 0);
        }
        if (WIRE_LINKS.has(nid)) {
            return true;
        }
        if (!above && pBlk[np + P2] === B.SPARK_WIRE) {
            return true;
        }
        return !pOpq[np] && pBlk[np - P2] === B.SPARK_WIRE;
    });
    const n = links.filter(Boolean).length;
    //A lone wire is a cross and a dead end runs on straight, but never
    //into the side of a retimer
    const retimerSide = (k) => {
        const nid = pBlk[p + dirs[k][0] + dirs[k][1] * P];
        return !links[k] && (nid === B.RETIMER || nid === B.RETIMER_ON);
    };
    if (n === 0) {
        for (let k = 0; k < 4; k++) {
            links[k] = !retimerSide(k);
        }
    } else if (n === 1) {
        const k = links.indexOf(true);
        links[k ^ 1] = !retimerSide(k ^ 1);
    }
    const t = meta / 15;
    const r = 0.34 + 0.66 * t, g = 0.03 + 0.1 * t, bl = 0.03 + 0.07 * t;
    const ls = (pLight[p] >> 4) / 15, lb = Math.max((pLight[p] & 15) / 15, t * 0.7);
    const layer = blockFaceLayer(id, 2, meta);
    const yy = y + 1 / 64;
    const lo = 6 * U, hi = 10 * U;
    flatQuad(buf, x + lo, z + lo, x + hi, z + hi, yy, layer, ls, lb, r, g, bl);
    const arms = [[hi, lo, 1, hi], [0, lo, lo, hi], [lo, hi, hi, 1], [lo, 0, hi, lo]];
    arms.forEach((a, k) => {
        if (links[k]) {
            flatQuad(buf, x + a[0], z + a[1], x + a[2], z + a[3], yy, layer, ls, lb, r, g, bl);
        }
    });
}

//Retimer: a thin slab with its arrow turned to the facing, a fixed pin near
//the front and a pin that slides back with the delay
function retimer(buf, p, x, y, z, id, meta) {
    const f = meta & 3, d = HDIR[f];
    boxFaces(buf, p, x, y, z, id, meta, 0, 0, 0, 1, 2 * U, 1, (ff, np) => ff === 3 && pOpq[np] === 1, f);
    const pin = layerOfTile(id === B.RETIMER_ON ? "retimer_pin_on" : "retimer_pin_off");
    for (const s of [0.78, 0.55 - 0.1 * ((meta >> 2) & 3)]) {
        const cx = 0.5 + d[0] * (s - 0.5), cz = 0.5 + d[1] * (s - 0.5);
        turnedBox(buf, p, x, y, z, [cx - U, 2 * U, cz - U, cx + U, 7 * U, cz + U], 2, () => pin);
    }
}

//A box in sign space (see SIGN_BOARD) turned by angle a about the block's
//vertical axis, lit by the sign's own cell
//frontShade, when given, lights the two broad faces (along the box's local
//z) the same whichever way the box is turned
function yawBox(buf, p, x, y, z, b, a, layer, frontShade = 0) {
    const s = Math.sin(a), c = Math.cos(a);
    const ls = (pLight[p] >> 4) / 15, lb = (pLight[p] & 15) / 15;
    for (let f = 0; f < 6; f++) {
        //World normal of this face picks the shade
        const n = [[1, 0], [-1, 0], [0, 0], [0, 0], [0, 1], [0, -1]][f];
        const nx = n[0] * c + n[1] * s;
        const sh = f === 2 ? 1 : f === 3 ? 0.5 : frontShade && f >= 4 ? frontShade : Math.abs(nx) > 0.7 ? 0.6 : 0.8;
        for (const v of FACE_VERTS[f]) {
            const lx = v[0] ? b[3] : b[0], ly = v[1] ? b[4] : b[1], lz = v[2] ? b[5] : b[2];
            const uv = faceUV(f, lx, ly, lz);
            const du = lx - 0.5, dw = lz - 0.5;
            buf.vert(x + 0.5 + du * c + dw * s, y + ly, z + 0.5 - du * s + dw * c, uv[0], uv[1], layer, ls, lb, sh, sh, sh);
        }
        buf.quad(false);
    }
}

//Sign: a board on a post (standing) or a board on the wall behind it
function sign(buf, p, x, y, z, id, meta) {
    const a = signAngle(id, meta), layer = layerOfTile("sign_board");
    if (id === B.WALL_SIGN) {
        yawBox(buf, p, x, y, z, SIGN_WALL_BOARD, a, layer, 0.9);
    } else {
        yawBox(buf, p, x, y, z, SIGN_BOARD, a, layer, 0.9);
        yawBox(buf, p, x, y, z, SIGN_POST, a, layerOfTile("log_side"));
    }
}

function lever(buf, p, x, y, z, id, meta) {
    const face = meta & 7;
    const stone = blockFaceLayer(id, 2, meta), wood = layerOfTile("planks");
    turnedBox(buf, p, x, y, z, LEVER_BASE, face, () => stone);
    turnedBox(buf, p, x, y, z, [7 * U, 1 * U, 7 * U, 9 * U, 10 * U, 9 * U], face, () => wood, meta & 8 ? 0.55 : -0.55);
}

function button(buf, p, x, y, z, id, meta) {
    const layer = blockFaceLayer(id, 2, meta);
    turnedBox(buf, p, x, y, z, meta & 8 ? BUTTON_PRESSED : BUTTON_BOX, meta & 7, () => layer);
}

function piston(buf, p, x, y, z, id, meta) {
    const face = meta & 7;
    const front = blockFaceLayer(id, face, meta), back = blockFaceLayer(id, face ^ 1, meta), side = blockFaceLayer(id, face < 2 ? 2 : 0, meta);
    turnedBox(buf, p, x, y, z, meta & 8 ? PISTON_BASE : [0, 0, 0, 1, 1, 1], face, (f) => (f === 2 ? front : f === 3 ? back : side));
}

function pistonHead(buf, p, x, y, z, id, meta) {
    const face = meta & 7;
    const front = blockFaceLayer(id, face, meta), side = blockFaceLayer(id, face < 2 ? 2 : 0, meta);
    turnedBox(buf, p, x, y, z, HEAD_PLATE, face, (f) => (f === 2 ? front : side));
    turnedBox(buf, p, x, y, z, HEAD_ROD, face, () => side, 1e-6);
}

//Rail shapes: 0 NS, 1 EW, 2-5 rising toward +x, -x, +z, -z, 6-9 curves SE, SW, NW, NE
const RAIL_UV_FACING = [3, 0, 0, 0, 3, 3, 3, 0, 1, 2];
function rail(buf, p, x, y, z, id, meta) {
    const shape = id === B.POWERED_RAIL ? meta & 7 : meta & 15;
    const layer = blockFaceLayer(id, 2, meta);
    const [ls, lb] = selfLight(p);
    const rise = (vx, vz) => (shape === 2 ? vx : shape === 3 ? 1 - vx : shape === 4 ? vz : shape === 5 ? 1 - vz : 0);
    const facing = RAIL_UV_FACING[shape] ?? 3;
    for (const c of FACE_VERTS[2]) {
        const vx = c[0], vz = c[2];
        const uv = topUV(facing, vx, vz);
        buf.vert(x + vx, y + 1 / 16 + rise(vx, vz), z + vz, uv[0], uv[1], layer, ls, lb, 1, 1, 1);
    }
    buf.quad(false);
    if (shape >= 2 && shape <= 5) {
        buf.backQuad();
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
    const above = pBlk[p + P2] === id;
    const h = waterHeight(meta, above);
    const layer = blockFaceLayer(id, 2, meta);
    for (let f = 0; f < 6; f++) {
        const np = p + FACE_OFF[f];
        const nid = pBlk[np];
        if (nid === id) {
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

//A flat double sided card showing one tile, centred on the origin
export function cardGeometry(tile) {
    const buf = new GeoBuf(8);
    buf.reset();
    const layer = layerOfTile(tile);
    buf.vert(-0.5, -0.5, 0, 0, 0, layer, 1, 0, 1, 1, 1);
    buf.vert(0.5, -0.5, 0, 1, 0, layer, 1, 0, 1, 1, 1);
    buf.vert(0.5, 0.5, 0, 1, 1, layer, 1, 0, 1, 1, 1);
    buf.vert(-0.5, 0.5, 0, 0, 1, layer, 1, 0, 1, 1, 1);
    buf.quad(false);
    buf.backQuad();
    return buf.take();
}

//How stairs are shown in the hand, as dropped items and as icons: the step
//on the -x half
export const STAIR_ITEM_BOXES = [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 0.5, 1, 1]];

//Geometry for held items and dropped items, centred on the origin.
//Blocks are unit cubes (slabs half height, stairs two boxes), everything
//else a flat card.
export function itemGeometry(id) {
    const buf = new GeoBuf(64);
    buf.reset();
    const it = ITEMS[id];
    const blockId = it && it.block;
    const shape = blockId ? SHAPE[blockId] : null;
    const cubeLike = blockId && (shape === "cube" || shape === "slab" || shape === "stairs" || shape === "cactus" || shape === "farmland" ||
        shape === "piston" || shape === "plate" || shape === "retimer");
    if (cubeLike) {
        const def = BLOCKS[blockId];
        const meta = def.orient ? 4 : 0;
        const top = shape === "slab" ? 0.5 : shape === "plate" ? 1 / 16 : shape === "retimer" ? 2 / 16 : 1;
        const inset = shape === "cactus" ? 1 / 16 : 0;
        const boxes = shape === "stairs" ? STAIR_ITEM_BOXES : [[inset, 0, inset, 1 - inset, top, 1 - inset]];
        const tintC = def.tint === "foliage" ? [0.48, 0.86, 0.32] : def.tint === "grass" ? [0.62, 1.0, 0.43] : null;
        for (let i = 0; i < boxes.length; i++) {
            const bx = boxes[i];
            for (let f = 0; f < 6; f++) {
                if (faceCovered(boxes, i, f)) {
                    continue;
                }
                const layer = blockFaceLayer(blockId, f, meta);
                const s = FACE_SHADE[f];
                const tinted = tintC && (def.tint === "foliage" || f === 2);
                const r = (tinted ? tintC[0] : 1) * s, g = (tinted ? tintC[1] : 1) * s, b = (tinted ? tintC[2] : 1) * s;
                for (const c of FACE_VERTS[f]) {
                    const vx = c[0] ? bx[3] : bx[0], vy = c[1] ? bx[4] : bx[1], vz = c[2] ? bx[5] : bx[2];
                    const uv = faceUV(f, vx, vy, vz);
                    buf.vert(vx - 0.5, vy - 0.5, vz - 0.5, uv[0], uv[1], layer, 1, 0, r, g, b);
                }
                buf.quad(false);
            }
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
