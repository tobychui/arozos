/*
    Blocky - physics.js

    Axis aligned box movement against the block grid, shared by the player
    and the item / falling block entities. Unloaded chunks count as solid so
    nothing falls out of the world while the terrain streams in.
*/

import { B } from "./blocks.js";
import { collisionBoxes } from "./shapes.js";

const FULL = [0, 0, 0, 1, 1, 1];

//Collect world boxes overlapping [min, max]
export function gatherBoxes(world, minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX);
    const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
    for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
            const loaded = world.isLoaded(x, z);
            for (let y = y0; y <= y1; y++) {
                let boxes;
                if (!loaded && y >= 0) {
                    boxes = [FULL];
                } else {
                    const id = world.getBlock(x, y, z);
                    if (id === B.AIR) {
                        continue;
                    }
                    boxes = collisionBoxes(id, world.getMeta(x, y, z));
                }
                for (const b of boxes) {
                    out.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
                }
            }
        }
    }
    return out;
}

const tmp = [];

//Move box (array [minX,minY,minZ,maxX,maxY,maxZ], mutated) by d along axis.
//Returns the distance actually travelled.
export function moveAxis(world, box, axis, d) {
    if (d === 0) {
        return 0;
    }
    const lo = [box[0], box[1], box[2]], hi = [box[3], box[4], box[5]];
    if (d < 0) {
        lo[axis] += d;
    } else {
        hi[axis] += d;
    }
    const list = gatherBoxes(world, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], tmp);
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    const eps = 1e-7;
    for (let i = 0; i < list.length; i += 6) {
        //Overlap on the other two axes?
        if (list[i + a1] >= box[3 + a1] - eps || list[i + 3 + a1] <= box[a1] + eps) {
            continue;
        }
        if (list[i + a2] >= box[3 + a2] - eps || list[i + 3 + a2] <= box[a2] + eps) {
            continue;
        }
        if (d > 0 && list[i + axis] >= box[3 + axis] - eps) {
            const gap = list[i + axis] - box[3 + axis];
            if (gap < d) {
                d = Math.max(0, gap);
            }
        } else if (d < 0 && list[i + 3 + axis] <= box[axis] + eps) {
            const gap = list[i + 3 + axis] - box[axis];
            if (gap > d) {
                d = Math.min(0, gap);
            }
        }
    }
    box[axis] += d;
    box[3 + axis] += d;
    return d;
}

//True when any solid box overlaps the given region
export function regionBlocked(world, minX, minY, minZ, maxX, maxY, maxZ) {
    const list = gatherBoxes(world, minX, minY, minZ, maxX, maxY, maxZ, tmp);
    for (let i = 0; i < list.length; i += 6) {
        if (list[i] < maxX && list[i + 3] > minX && list[i + 1] < maxY && list[i + 4] > minY && list[i + 2] < maxZ && list[i + 5] > minZ) {
            return true;
        }
    }
    return false;
}
