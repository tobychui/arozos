/*
    Blocky - shapes.js

    Collision and selection boxes of the non-cube block shapes, in block
    local coordinates [x0, y0, z0, x1, y1, z1]. Fences and stairs look at
    their neighbours, so the box functions take the world and the position
    too.
*/

import { B, SHAPE, SOLID, HDIR, isOpaqueAt } from "./blocks.js";

const FULL = [0, 0, 0, 1, 1, 1];
const NONE = [];

//Direction of a face index (0:+x 1:-x 2:+y 3:-y 4:+z 5:-z)
export const FACE_DIR = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

//Turn a point of a shape modelled facing up (+y) to face `face`
export function rotatePoint(face, x, y, z) {
    switch (face) {
        case 3: return [x, 1 - y, 1 - z];
        case 4: return [x, 1 - z, y];
        case 5: return [x, z, 1 - y];
        case 0: return [y, 1 - x, z];
        case 1: return [1 - y, x, z];
        default: return [x, y, z];
    }
}

//The same for a whole box (corners re-sorted)
export function rotateBox(face, b) {
    const a = rotatePoint(face, b[0], b[1], b[2]), c = rotatePoint(face, b[3], b[4], b[5]);
    return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2]), Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
}

const U = 1 / 16;
//Canonical (floor mounted / facing up) shapes of the spark parts
export const LEVER_BASE = [5 * U, 0, 4 * U, 11 * U, 3 * U, 12 * U];
export const BUTTON_BOX = [5 * U, 0, 6 * U, 11 * U, 2 * U, 10 * U];
export const BUTTON_PRESSED = [5 * U, 0, 6 * U, 11 * U, 1 * U, 10 * U];
export const PISTON_BASE = [0, 0, 0, 1, 12 * U, 1];
export const HEAD_PLATE = [0, 12 * U, 0, 1, 1, 1];
export const HEAD_ROD = [6 * U, -4 * U, 6 * U, 10 * U, 12 * U, 10 * U];

//Which sides (+x, -x, +z, -z) a glass pane links to
export function paneLinks(getId, getMeta, x, y, z) {
    const link = (nx, nz) => {
        const id = getId(nx, y, nz);
        return SHAPE[id] === "pane" || id === B.GLASS || isOpaqueAt(id, getMeta(nx, y, nz));
    };
    return [link(x + 1, z), link(x - 1, z), link(x, z + 1), link(x, z - 1)];
}

//Sign parts in sign space: u across the board, v up, w toward the front
//(the side with the writing), the block centre at u = w = 0.5; turned by
//signAngle about the vertical axis (the front then faces (sin a, cos a))
const SIGN_T = 2 / 16;
export const SIGN_BOARD = [0, 0.5, 0.5 - SIGN_T / 2, 1, 1, 0.5 + SIGN_T / 2];
export const SIGN_POST = [7 / 16, 0, 0.5 - 1 / 16, 9 / 16, 0.5, 0.5 + 1 / 16];
export const SIGN_WALL_BOARD = [0, 4 / 16, 0, 1, 12 / 16, SIGN_T];
const WALL_SIGN_ANGLE = { 0: Math.PI / 2, 1: -Math.PI / 2, 4: 0, 5: Math.PI };

export function signAngle(id, meta) {
    return id === B.WALL_SIGN ? (WALL_SIGN_ANGLE[meta] || 0) : (meta & 15) * Math.PI / 8;
}

function paneBoxes(world, x, y, z) {
    const lo = 7 * U, hi = 9 * U;
    const out = [[lo, 0, lo, hi, 1, hi]];
    if (!world) {
        return out;
    }
    const l = paneLinks((a, b, c) => world.getBlock(a, b, c), (a, b, c) => world.getMeta(a, b, c), x, y, z);
    if (l[0]) {
        out.push([hi, 0, lo, 1, 1, hi]);
    }
    if (l[1]) {
        out.push([0, 0, lo, lo, 1, hi]);
    }
    if (l[2]) {
        out.push([lo, 0, hi, hi, 1, 1]);
    }
    if (l[3]) {
        out.push([lo, 0, 0, hi, 1, lo]);
    }
    return out;
}

function unionBox(boxes) {
    const u = [1, 1, 1, 0, 0, 0];
    for (const b of boxes) {
        for (let i = 0; i < 3; i++) {
            u[i] = Math.min(u[i], b[i]);
            u[i + 3] = Math.max(u[i + 3], b[i + 3]);
        }
    }
    return u;
}

//Stair meta: bits 0-1 the side the steps climb toward (HDIR), bit 2 upside
//down (the half slab on top, the step hanging under it)
export const STAIR_FLIP = 4;

//How a stair joins the stairs next to it, as kind * 4 + side: kind 0
//straight, 1 outer corner (only the quarter between the climbing side and
//`side` is raised: a stair behind it turns away), 2 inner corner (the
//climbing half and the `side` half are raised: a stair in front of it
//turns away). Only stairs of the same half join; a stair that continues a
//straight run on the far side keeps the run straight.
export function stairShape(getId, getMeta, x, y, z, meta) {
    const f = meta & 3, flip = meta & STAIR_FLIP;
    const stairMeta = (ax, az) => (SHAPE[getId(ax, y, az)] === "stairs" && (getMeta(ax, y, az) & STAIR_FLIP) === flip ? getMeta(ax, y, az) : -1);
    const sameRun = (ax, az) => {
        const m = stairMeta(ax, az);
        return m >= 0 && (m & 3) === f;
    };
    const d = HDIR[f];
    const behind = stairMeta(x + d[0], z + d[1]);
    if (behind >= 0 && ((behind & 3) & 1) !== (f & 1)) {
        const s = behind & 3;
        if (!sameRun(x - HDIR[s][0], z - HDIR[s][1])) {
            return 4 + s;
        }
    }
    const front = stairMeta(x - d[0], z - d[1]);
    if (front >= 0 && ((front & 3) & 1) !== (f & 1)) {
        const s = front & 3;
        if (!sameRun(x + HDIR[s][0], z + HDIR[s][1])) {
            return 8 + s;
        }
    }
    return f;
}

//[x0, x1, z0, z1] of the half of a block toward side
function halfToward(side) {
    const d = HDIR[side];
    return [d[0] > 0 ? 0.5 : 0, d[0] < 0 ? 0.5 : 1, d[1] > 0 ? 0.5 : 0, d[1] < 0 ? 0.5 : 1];
}

//The part of both halves, as a box between y0 and y1
function halvesBox(a, b, y0, y1) {
    return [Math.max(a[0], b[0]), y0, Math.max(a[2], b[2]), Math.min(a[1], b[1]), y1, Math.min(a[3], b[3])];
}

//Boxes of a stair: the half slab first, then the raised step (two boxes for
//an inner corner). They never overlap.
export function stairBoxes(meta, shape) {
    const flip = meta & STAIR_FLIP;
    const out = [flip ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]];
    const y0 = flip ? 0 : 0.5, y1 = flip ? 0.5 : 1;
    const kind = shape >> 2, side = shape & 3;
    const up = halfToward(meta & 3);
    if (kind === 1) {
        out.push(halvesBox(up, halfToward(side), y0, y1));
        return out;
    }
    out.push([up[0], y0, up[2], up[1], y1, up[3]]);
    if (kind === 2) {
        out.push(halvesBox(halfToward(side), halfToward((meta & 3) ^ 2), y0, y1));
    }
    return out;
}

//A stair placed in the world, joined to its neighbours
export function stairBoxesAt(world, x, y, z, meta) {
    if (!world) {
        return stairBoxes(meta, meta & 3);
    }
    return stairBoxes(meta, stairShape((a, b, c) => world.getBlock(a, b, c), (a, b, c) => world.getMeta(a, b, c), x, y, z, meta));
}

const DOOR_T = 3 / 16;
//Closed door panel along the edge the door faces (0 +x, 1 +z, 2 -x, 3 -z)
const DOOR_PANEL = [
    [1 - DOOR_T, 0, 0, 1, 1, 1],
    [0, 0, 1 - DOOR_T, 1, 1, 1],
    [0, 0, 0, DOOR_T, 1, 1],
    [0, 0, 0, 1, 1, DOOR_T]
];

//Door meta: bits 0-1 facing, bit 2 open, bit 3 upper half, bit 4 hinge on
//the other side (the second door of a double door, mirrored)
export function doorBox(meta) {
    const f = meta & 3;
    return DOOR_PANEL[meta & 4 ? (f + (meta & 16 ? 3 : 1)) & 3 : f];
}

//The side (HDIR index) a door's hinge is on
export function doorHinge(meta) {
    return (meta & 3) + (meta & 16 ? 3 : 1) & 3;
}

//Gate meta: bits 0-1 facing, bit 2 open. A gate facing x spans the z axis.
export function gateAlongZ(meta) {
    return (meta & 1) === 0;
}

//Which sides (+x, -x, +z, -z) a fence at (x, y, z) connects to
export function fenceLinks(getId, getMeta, x, y, z) {
    const link = (nx, nz) => {
        const id = getId(nx, y, nz);
        return id === B.FENCE || id === B.FENCE_GATE || isOpaqueAt(id, getMeta(nx, y, nz));
    };
    return [link(x + 1, z), link(x - 1, z), link(x, z + 1), link(x, z - 1)];
}

function fenceBoxes(world, x, y, z, top) {
    const lo = 0.375, hi = 0.625;
    const out = [[lo, 0, lo, hi, top, hi]];
    if (!world) {
        return out;
    }
    const l = fenceLinks((a, b, c) => world.getBlock(a, b, c), (a, b, c) => world.getMeta(a, b, c), x, y, z);
    if (l[0]) {
        out.push([hi, 0, lo, 1, top, hi]);
    }
    if (l[1]) {
        out.push([0, 0, lo, lo, top, hi]);
    }
    if (l[2]) {
        out.push([lo, 0, hi, hi, top, 1]);
    }
    if (l[3]) {
        out.push([lo, 0, 0, hi, top, lo]);
    }
    return out;
}

export function collisionBoxes(id, meta, world, x, y, z) {
    if (!SOLID[id]) {
        return NONE;
    }
    switch (SHAPE[id]) {
        case "slab":
            if (meta === 2) {
                return [FULL];
            }
            return [meta === 1 ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]];
        case "stairs":
            return stairBoxesAt(world, x, y, z, meta);
        case "cactus":
            return [[0.0625, 0, 0.0625, 0.9375, 1, 0.9375]];
        case "farmland":
            return [[0, 0, 0, 1, 0.9375, 1]];
        case "door":
            return [doorBox(meta)];
        case "fence":
            return fenceBoxes(world, x, y, z, 1.5);
        case "gate":
            if (meta & 4) {
                return NONE;
            }
            return [gateAlongZ(meta) ? [0.375, 0, 0, 0.625, 1.5, 1] : [0, 0, 0.375, 1, 1.5, 0.625]];
        case "bed":
            return [[0, 0, 0, 1, 0.5625, 1]];
        case "pane":
            return paneBoxes(world, x, y, z);
        case "piston":
            return [meta & 8 ? rotateBox(meta & 7, PISTON_BASE) : FULL];
        case "pistonhead":
            return [rotateBox(meta & 7, HEAD_PLATE), rotateBox(meta & 7, [6 * U, 0, 6 * U, 10 * U, 12 * U, 10 * U])];
        default:
            return [FULL];
    }
}

export function selectionBox(id, meta, world, x, y, z) {
    switch (SHAPE[id]) {
        case "none":
        case "liquid":
            return null;
        case "cross":
            return [0.15, 0, 0.15, 0.85, 0.8, 0.85];
        case "fire":
            return [0.05, 0, 0.05, 0.95, 0.85, 0.95];
        case "crop":
            return [0, 0, 0, 1, Math.min(1, 0.2 + meta * 0.1), 1];
        case "torch": {
            if (meta === 2 || meta === 3) {
                return [0.4, 0, 0.4, 0.6, 0.62, 0.6];
            }
            const d = FACE_DIR[meta];
            const cx = 0.5 - d[0] * 0.33, cz = 0.5 - d[2] * 0.33;
            return [cx - 0.12, 0.2, cz - 0.12, cx + 0.12, 0.8, cz + 0.12];
        }
        case "ladder": {
            const d = FACE_DIR[meta] || FACE_DIR[4];
            const t = 0.125;
            if (d[0] === 1) {
                return [0, 0, 0, t, 1, 1];
            }
            if (d[0] === -1) {
                return [1 - t, 0, 0, 1, 1, 1];
            }
            if (d[2] === 1) {
                return [0, 0, 0, 1, 1, t];
            }
            return [0, 0, 1 - t, 1, 1, 1];
        }
        case "slab":
            if (meta === 2) {
                return FULL;
            }
            return meta === 1 ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
        case "cactus":
            return [0.0625, 0, 0.0625, 0.9375, 1, 0.9375];
        case "farmland":
            return [0, 0, 0, 1, 0.9375, 1];
        case "door":
            return doorBox(meta);
        case "fence": {
            //One box around the post and its arms
            const boxes = fenceBoxes(world, x, y, z, 1);
            const u = [1, 0, 1, 0, 1, 0];
            for (const b of boxes) {
                for (let i = 0; i < 3; i++) {
                    u[i] = Math.min(u[i], b[i]);
                    u[i + 3] = Math.max(u[i + 3], b[i + 3]);
                }
            }
            return u;
        }
        case "gate":
            return gateAlongZ(meta) ? [0.375, 0, 0, 0.625, 1, 1] : [0, 0, 0.375, 1, 1, 0.625];
        case "bed":
            return [0, 0, 0, 1, 0.5625, 1];
        case "pane":
            return unionBox(paneBoxes(world, x, y, z));
        case "wire":
            return [0, 0, 0, 1, 1 / 16, 1];
        case "rail":
            return (meta & 7) >= 2 && (meta & 7) <= 5 ? [0, 0, 0, 1, 0.5, 1] : [0, 0, 0, 1, 2 / 16, 1];
        case "lever":
            return rotateBox(meta & 7, [4 * U, 0, 4 * U, 12 * U, 9 * U, 12 * U]);
        case "button":
            return rotateBox(meta & 7, BUTTON_BOX);
        case "sign": {
            if (id !== B.WALL_SIGN) {
                return [0.25, 0, 0.25, 0.75, 1, 0.75];
            }
            const b = SIGN_WALL_BOARD, t = b[5];
            switch (meta) {
                case 0: return [0, b[1], 0, t, b[4], 1];
                case 1: return [1 - t, b[1], 0, 1, b[4], 1];
                case 5: return [0, b[1], 1 - t, 1, b[4], 1];
                default: return [0, b[1], 0, 1, b[4], t];
            }
        }
        case "plate":
            return [U, 0, U, 15 * U, meta & 1 ? U / 2 : U, 15 * U];
        case "retimer":
            return [0, 0, 0, 1, 2 * U, 1];
        case "piston":
            return meta & 8 ? rotateBox(meta & 7, PISTON_BASE) : FULL;
        case "pistonhead":
            return rotateBox(meta & 7, [0, 0, 0, 1, 1, 1]);
        default:
            return FULL;
    }
}

//True when an entity box overlaps a ladder in this block
export function isClimbable(id) {
    return id === B.LADDER;
}
