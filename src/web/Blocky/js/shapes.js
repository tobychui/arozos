/*
    Blocky - shapes.js

    Collision and selection boxes of the non-cube block shapes, in block
    local coordinates [x0, y0, z0, x1, y1, z1]. Fences look at their
    neighbours, so the box functions take the world and the position too.
*/

import { B, SHAPE, SOLID, isOpaqueAt } from "./blocks.js";

const FULL = [0, 0, 0, 1, 1, 1];
const NONE = [];

//Direction of a face index (0:+x 1:-x 2:+y 3:-y 4:+z 5:-z)
export const FACE_DIR = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

const DOOR_T = 3 / 16;
//Closed door panel along the edge the door faces (0 +x, 1 +z, 2 -x, 3 -z)
const DOOR_PANEL = [
    [1 - DOOR_T, 0, 0, 1, 1, 1],
    [0, 0, 1 - DOOR_T, 1, 1, 1],
    [0, 0, 0, DOOR_T, 1, 1],
    [0, 0, 0, 1, 1, DOOR_T]
];

//Door meta: bits 0-1 facing, bit 2 open, bit 3 upper half
export function doorBox(meta) {
    const f = meta & 3;
    return DOOR_PANEL[meta & 4 ? (f + 1) & 3 : f];
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
        default:
            return FULL;
    }
}

//True when an entity box overlaps a ladder in this block
export function isClimbable(id) {
    return id === B.LADDER;
}
