/*
    Blocky - shapes.js

    Collision and selection boxes of the non-cube block shapes, in block
    local coordinates [x0, y0, z0, x1, y1, z1].
*/

import { B, SHAPE, SOLID } from "./blocks.js";

const FULL = [0, 0, 0, 1, 1, 1];
const NONE = [];

//Direction of a face index (0:+x 1:-x 2:+y 3:-y 4:+z 5:-z)
export const FACE_DIR = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

export function collisionBoxes(id, meta) {
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
        default:
            return [FULL];
    }
}

export function selectionBox(id, meta) {
    switch (SHAPE[id]) {
        case "none":
        case "liquid":
            return null;
        case "cross":
            return [0.15, 0, 0.15, 0.85, 0.8, 0.85];
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
        default:
            return FULL;
    }
}

//True when an entity box overlaps a ladder in this block
export function isClimbable(id) {
    return id === B.LADDER;
}
