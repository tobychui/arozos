/*
    Blocky - power.js

    The spark (signal) system: power sources (levers, buttons, spark torches,
    blocks of spark), spark wire that carries a level 0-15 losing one per
    block, and the parts that react: spark lamps, pistons, powered rails and
    torches (which switch off when the block they hang on is powered, so they
    work as inverters). Also lays out rail shapes.

    Rules, kept simple:
    - a source powers the wire, lamps, pistons and rails right next to it,
      and the solid block it is attached to (a torch powers the block above)
    - wire powers what it touches; a solid block touched by powered wire or a
      source passes the power to the parts next to it
    - wire is recalculated at once; the reacting parts update two ticks later,
      so torch loops make clocks instead of hanging the game
*/

import { B, BLOCKS, isOpaqueAt, HDIR } from "./blocks.js";
import { FACE_DIR } from "./shapes.js";

//1 wire, 2 source, 4 reacts, 8 rail
export const POWER = new Uint8Array(256);
POWER[B.SPARK_WIRE] = 1;
for (const id of [B.LEVER, B.BUTTON, B.SPARK_TORCH, B.SPARK_BLOCK, B.PLATE_WOOD, B.PLATE_STONE, B.RETIMER_ON]) {
    POWER[id] |= 2;
}
for (const id of [B.SPARK_LAMP, B.SPARK_LAMP_ON, B.PISTON, B.STICKY_PISTON, B.SPARK_TORCH, B.SPARK_TORCH_OFF, B.POWERED_RAIL, B.BUTTON,
    B.PLATE_WOOD, B.PLATE_STONE, B.DOOR, B.RETIMER, B.RETIMER_ON]) {
    POWER[id] |= 4;
}
POWER[B.RAIL] |= 8;
POWER[B.POWERED_RAIL] |= 8;

const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FLAT = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const isPlate = (id) => id === B.PLATE_WOOD || id === B.PLATE_STONE;

//The block a retimer sends its signal into
function retimerFront(meta, x, y, z) {
    const d = HDIR[meta & 3];
    return [x + d[0], y, z + d[1]];
}

//Is the block at n a lit retimer pointing at t?
function retimerInto(w, nx, ny, nz, t) {
    return w.getBlock(nx, ny, nz) === B.RETIMER_ON && same(retimerFront(w.getMeta(nx, ny, nz), nx, ny, nz), t);
}

//Block a lever, button or torch hangs on
export function attachedTo(meta, x, y, z) {
    const n = FACE_DIR[meta & 7] || FACE_DIR[2];
    return [x - n[0], y - n[1], z - n[2]];
}

function sourceOn(id, meta) {
    if (id === B.LEVER || id === B.BUTTON) {
        return (meta & 8) !== 0;
    }
    if (isPlate(id)) {
        return (meta & 1) !== 0;
    }
    return id === B.SPARK_TORCH || id === B.SPARK_BLOCK;
}

//A solid block powered by a source mounted on it, or a lit torch below it
export function blockPoweredBySource(w, x, y, z) {
    for (const [dx, dy, dz] of SIDES) {
        const id = w.getBlock(x + dx, y + dy, z + dz);
        if (id === B.LEVER || id === B.BUTTON) {
            const m = w.getMeta(x + dx, y + dy, z + dz);
            if ((m & 8) && same(attachedTo(m, x + dx, y + dy, z + dz), [x, y, z])) {
                return true;
            }
        }
        if (id === B.RETIMER_ON && retimerInto(w, x + dx, y + dy, z + dz, [x, y, z])) {
            return true;
        }
    }
    //A pressed plate powers the block it lies on
    if (isPlate(w.getBlock(x, y + 1, z)) && (w.getMeta(x, y + 1, z) & 1)) {
        return true;
    }
    return w.getBlock(x, y - 1, z) === B.SPARK_TORCH;
}

//A solid block powered at all: by a source, or by powered wire touching it
export function blockPowered(w, x, y, z) {
    if (blockPoweredBySource(w, x, y, z)) {
        return true;
    }
    for (const [dx, dy, dz] of SIDES) {
        if (dy === -1) {
            continue;
        }
        if (w.getBlock(x + dx, y + dy, z + dz) === B.SPARK_WIRE && w.getMeta(x + dx, y + dy, z + dz) > 0) {
            return true;
        }
    }
    return false;
}

//Does a lamp / piston / rail at (x, y, z) receive power?
export function isPowered(w, x, y, z) {
    for (const [dx, dy, dz] of SIDES) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const id = w.getBlock(nx, ny, nz), m = w.getMeta(nx, ny, nz);
        if (id === B.SPARK_TORCH) {
            if (!same(attachedTo(m, nx, ny, nz), [x, y, z])) {
                return true;
            }
            continue;
        }
        if (id === B.RETIMER_ON) {
            if (retimerInto(w, nx, ny, nz, [x, y, z])) {
                return true;
            }
            continue;
        }
        if (sourceOn(id, m)) {
            return true;
        }
        if (id === B.SPARK_WIRE && m > 0) {
            return true;
        }
        if (isOpaqueAt(id, m) && blockPowered(w, nx, ny, nz)) {
            return true;
        }
    }
    return false;
}

//The level a wire should carry
function wireTarget(w, x, y, z) {
    let best = 0;
    for (const [dx, dy, dz] of SIDES) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const id = w.getBlock(nx, ny, nz), m = w.getMeta(nx, ny, nz);
        if (sourceOn(id, m) || (id === B.RETIMER_ON && retimerInto(w, nx, ny, nz, [x, y, z]))) {
            return 15;
        }
        if (isOpaqueAt(id, m) && blockPoweredBySource(w, nx, ny, nz)) {
            return 15;
        }
    }
    const coveredAbove = isOpaqueAt(w.getBlock(x, y + 1, z), w.getMeta(x, y + 1, z));
    for (const [dx, dz] of FLAT) {
        const nx = x + dx, nz = z + dz;
        if (w.getBlock(nx, y, nz) === B.SPARK_WIRE) {
            best = Math.max(best, w.getMeta(nx, y, nz) - 1);
        }
        if (!coveredAbove && w.getBlock(nx, y + 1, nz) === B.SPARK_WIRE) {
            best = Math.max(best, w.getMeta(nx, y + 1, nz) - 1);
        }
        if (!isOpaqueAt(w.getBlock(nx, y, nz), w.getMeta(nx, y, nz)) && w.getBlock(nx, y - 1, nz) === B.SPARK_WIRE) {
            best = Math.max(best, w.getMeta(nx, y - 1, nz) - 1);
        }
    }
    return Math.max(0, best);
}

//Settle the wire networks touching the given positions
export function updateWires(w, seeds) {
    const q = seeds.slice();
    const changed = [];
    let steps = 0;
    while (q.length && steps++ < 20000) {
        const [x, y, z] = q.shift();
        if (w.getBlock(x, y, z) !== B.SPARK_WIRE) {
            continue;
        }
        const t = wireTarget(w, x, y, z);
        if (t === w.getMeta(x, y, z)) {
            continue;
        }
        w.powerBusy = true;
        w.setBlock(x, y, z, B.SPARK_WIRE, t, false);
        w.powerBusy = false;
        changed.push([x, y, z]);
        for (const [dx, dz] of FLAT) {
            for (const dy of [0, 1, -1]) {
                if (w.getBlock(x + dx, y + dy, z + dz) === B.SPARK_WIRE) {
                    q.push([x + dx, y + dy, z + dz]);
                }
            }
        }
    }
    for (const [x, y, z] of changed) {
        scheduleParts(w, x, y, z);
    }
}

//Ask every reacting part within two blocks to re-check its power
function scheduleParts(w, x, y, z) {
    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) {
                    continue;
                }
                const id = w.getBlock(x + dx, y + dy, z + dz);
                if ((POWER[id] & 4) && id !== B.BUTTON && !isPlate(id)) {
                    w.schedule(x + dx, y + dy, z + dz, 2);
                }
            }
        }
    }
}

//Something power related changed at (x, y, z)
export function powerChanged(w, x, y, z) {
    const seeds = [];
    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) {
                    continue;
                }
                if (w.getBlock(x + dx, y + dy, z + dz) === B.SPARK_WIRE) {
                    seeds.push([x + dx, y + dy, z + dz]);
                }
            }
        }
    }
    if (seeds.length) {
        updateWires(w, seeds);
    }
    scheduleParts(w, x, y, z);
}

/* ---------------- pistons ---------------- */

const FRAGILE = new Set(["cross", "crop", "torch", "wire", "lever", "button", "ladder", "rail", "fire", "plate", "retimer"]);

function movable(id, meta) {
    if (id === B.BEDROCK || id === B.OBSIDIAN || id === B.PISTON_HEAD || id === B.FURNACE || id === B.FURNACE_LIT ||
        id === B.CHEST || id === B.DOOR || id === B.BED || BLOCKS[id].hardness < 0) {
        return false;
    }
    if ((id === B.PISTON || id === B.STICKY_PISTON) && (meta & 8)) {
        return false;
    }
    return true;
}

function extend(w, x, y, z, id, meta, onSound) {
    const f = meta & 7, d = FACE_DIR[f];
    const line = [];
    for (let k = 1; k <= 13; k++) {
        const px = x + d[0] * k, py = y + d[1] * k, pz = z + d[2] * k;
        if (py < 1 || py > 126) {
            return;
        }
        const bid = w.getBlock(px, py, pz), bm = w.getMeta(px, py, pz);
        if (bid === B.AIR || bid === B.WATER || bid === B.LAVA || FRAGILE.has(BLOCKS[bid].shape)) {
            if (bid !== B.AIR && bid !== B.WATER && bid !== B.LAVA) {
                w.breakNaturally(px, py, pz);
            }
            break;
        }
        if (k === 13 || !movable(bid, bm)) {
            return;
        }
        line.push([px, py, pz, bid, bm]);
    }
    w.pistonMoving = true;
    for (let i = line.length - 1; i >= 0; i--) {
        const [px, py, pz, bid, bm] = line[i];
        w.setBlock(px + d[0], py + d[1], pz + d[2], bid, bm);
    }
    w.setBlock(x, y, z, id, meta | 8);
    w.setBlock(x + d[0], y + d[1], z + d[2], B.PISTON_HEAD, f | (id === B.STICKY_PISTON ? 8 : 0));
    w.pistonMoving = false;
    onSound(true);
}

function retract(w, x, y, z, id, meta, onSound) {
    const f = meta & 7, d = FACE_DIR[f];
    const hx = x + d[0], hy = y + d[1], hz = z + d[2];
    w.pistonMoving = true;
    if (w.getBlock(hx, hy, hz) === B.PISTON_HEAD) {
        w.setBlock(hx, hy, hz, B.AIR, 0);
    }
    w.setBlock(x, y, z, id, meta & 7);
    if (id === B.STICKY_PISTON) {
        const px = hx + d[0], py = hy + d[1], pz = hz + d[2];
        const bid = w.getBlock(px, py, pz), bm = w.getMeta(px, py, pz);
        if (bid !== B.AIR && !FRAGILE.has(BLOCKS[bid].shape) && bid !== B.WATER && bid !== B.LAVA && movable(bid, bm)) {
            w.setBlock(px, py, pz, B.AIR, 0);
            w.setBlock(hx, hy, hz, bid, bm);
        }
    }
    w.pistonMoving = false;
    onSound(false);
}

/* ---------------- rails ---------------- */

//Rail shape from the rails around it (see mesher.js for the numbering)
function railLinks(w, x, y, z) {
    const out = [];
    FLAT.forEach(([dx, dz], k) => {
        for (const dy of [0, 1, -1]) {
            if (POWER[w.getBlock(x + dx, y + dy, z + dz)] & 8) {
                out.push([k, dy]);
                break;
            }
        }
    });
    return out;
}

const CURVES = { "2,0": 6, "2,1": 7, "3,1": 8, "3,0": 9 };

export function shapeRail(w, x, y, z, preferX) {
    const id = w.getBlock(x, y, z);
    const links = railLinks(w, x, y, z);
    let shape = preferX ? 1 : 0;
    const dirOf = (k) => (k === 0 ? 2 : k === 1 ? 3 : k === 2 ? 4 : 5);
    if (links.length >= 2) {
        const [a, b] = links;
        if ((a[0] ^ 1) === b[0]) {
            shape = a[0] < 2 ? 1 : 0;
            if (a[1] === 1) {
                shape = dirOf(a[0]);
            } else if (b[1] === 1) {
                shape = dirOf(b[0]);
            }
        } else if (id === B.RAIL) {
            const zs = a[0] >= 2 ? a : b, xs = a[0] < 2 ? a : b;
            shape = CURVES[zs[0] + "," + xs[0]];
        } else {
            shape = a[0] < 2 ? 1 : 0;
        }
    } else if (links.length === 1) {
        const [k, dy] = links[0];
        shape = dy === 1 ? dirOf(k) : (k < 2 ? 1 : 0);
    } else {
        return;
    }
    const meta = w.getMeta(x, y, z);
    const keep = id === B.POWERED_RAIL ? meta & 8 : 0;
    if ((id === B.POWERED_RAIL ? meta & 7 : meta) !== shape) {
        w.setBlock(x, y, z, id, shape | keep, false);
    }
}

//A new rail: shape it, then let loose neighbours bend toward it
export function railPlaced(w, x, y, z, preferX) {
    shapeRail(w, x, y, z, preferX);
    FLAT.forEach(([dx, dz]) => {
        for (const dy of [0, 1, -1]) {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            if ((POWER[w.getBlock(nx, ny, nz)] & 8) && railLinks(w, nx, ny, nz).length <= 2) {
                shapeRail(w, nx, ny, nz, dx !== 0);
            }
        }
    });
}

//Axis a rail shape runs along: [dx, dz]
export function railAxis(shape) {
    return shape === 1 || shape === 2 || shape === 3 ? [1, 0] : [0, 1];
}

function railChainPowered(w, x, y, z, shape) {
    const [ax, az] = railAxis(shape);
    for (const s of [1, -1]) {
        for (let k = 1; k <= 8; k++) {
            let found = false;
            for (const dy of [0, 1, -1]) {
                const px = x + ax * k * s, py = y + dy, pz = z + az * k * s;
                if (w.getBlock(px, py, pz) === B.POWERED_RAIL) {
                    if (isPowered(w, px, py, pz)) {
                        return true;
                    }
                    found = true;
                    break;
                }
            }
            if (!found) {
                break;
            }
        }
    }
    return false;
}

/* ---------------- ticks ---------------- */

//Scheduled tick of a power related block (support already checked)
//A pressed button stays down for 20 ticks, whatever else ticks it meanwhile
export function pressButton(w, x, y, z, meta) {
    w.setBlock(x, y, z, B.BUTTON, (meta & 7) | 8);
    w.buttonDue.set(x + "," + y + "," + z, w.tickCount + 20);
    w.schedule(x, y, z, 20);
}

//Something is on a plate: press it, and keep it down for 20 ticks after
//the last time anything was on it. True when it was just pressed.
export function pressPlate(w, x, y, z) {
    w.buttonDue.set(x + "," + y + "," + z, w.tickCount + 20);
    const id = w.getBlock(x, y, z);
    if (w.getMeta(x, y, z) & 1) {
        return false;
    }
    w.setBlock(x, y, z, id, 1);
    w.schedule(x, y, z, 20);
    return true;
}

//Is the block behind a retimer giving it power?
function retimerInput(w, x, y, z, meta) {
    const d = HDIR[meta & 3];
    const bx = x - d[0], bz = z - d[1];
    const id = w.getBlock(bx, y, bz), m = w.getMeta(bx, y, bz);
    if (id === B.SPARK_WIRE) {
        return m > 0;
    }
    if (id === B.RETIMER_ON) {
        return retimerInto(w, bx, y, bz, [x, y, z]);
    }
    if (sourceOn(id, m)) {
        return true;
    }
    return isOpaqueAt(id, m) && blockPowered(w, bx, y, bz);
}

export function powerTick(w, x, y, z, id, meta, sound) {
    switch (id) {
        case B.SPARK_WIRE:
            updateWires(w, [[x, y, z]]);
            break;
        case B.SPARK_LAMP:
            if (isPowered(w, x, y, z)) {
                w.setBlock(x, y, z, B.SPARK_LAMP_ON, 0);
            }
            break;
        case B.SPARK_LAMP_ON:
            if (!isPowered(w, x, y, z)) {
                w.setBlock(x, y, z, B.SPARK_LAMP, 0);
            }
            break;
        case B.SPARK_TORCH:
        case B.SPARK_TORCH_OFF: {
            const [ax, ay, az] = attachedTo(meta, x, y, z);
            const on = !blockPowered(w, ax, ay, az);
            if (on !== (id === B.SPARK_TORCH)) {
                w.setBlock(x, y, z, on ? B.SPARK_TORCH : B.SPARK_TORCH_OFF, meta);
            }
            break;
        }
        case B.PISTON:
        case B.STICKY_PISTON: {
            const powered = isPowered(w, x, y, z);
            if (powered && !(meta & 8)) {
                extend(w, x, y, z, id, meta, (out) => sound(out));
            } else if (!powered && (meta & 8)) {
                retract(w, x, y, z, id, meta, (out) => sound(out));
            }
            break;
        }
        case B.BUTTON:
            if (meta & 8) {
                const key = x + "," + y + "," + z;
                const due = w.buttonDue.get(key);
                if (due > w.tickCount) {
                    w.schedule(x, y, z, due - w.tickCount);
                    break;
                }
                w.buttonDue.delete(key);
                w.setBlock(x, y, z, B.BUTTON, meta & 7);
                sound(false);
            }
            break;
        case B.PLATE_WOOD:
        case B.PLATE_STONE:
            if (meta & 1) {
                const key = x + "," + y + "," + z;
                const due = w.buttonDue.get(key);
                if (due > w.tickCount) {
                    w.schedule(x, y, z, due - w.tickCount);
                    break;
                }
                w.buttonDue.delete(key);
                w.setBlock(x, y, z, id, 0);
                sound(false);
            }
            break;
        case B.RETIMER:
        case B.RETIMER_ON: {
            //A change at the input reaches the output after the delay; a
            //pulse shorter than the delay is stretched to it
            const key = x + "," + y + "," + z;
            const pend = w.retimerDue.get(key);
            let on = id === B.RETIMER_ON;
            if (pend) {
                if (pend.due > w.tickCount) {
                    w.schedule(x, y, z, pend.due - w.tickCount);
                    break;
                }
                w.retimerDue.delete(key);
                if (pend.on !== on) {
                    on = pend.on;
                    w.setBlock(x, y, z, on ? B.RETIMER_ON : B.RETIMER, meta);
                }
            }
            if (retimerInput(w, x, y, z, meta) !== on) {
                const delay = (((meta >> 2) & 3) + 1) * 2;
                w.retimerDue.set(key, { due: w.tickCount + delay, on: !on });
                w.schedule(x, y, z, delay);
            }
            break;
        }
        case B.DOOR: {
            //A door opens when power arrives and shuts when it goes; in
            //between it can still be opened by hand
            const ly = meta & 8 ? y - 1 : y;
            if (w.getBlock(x, ly, z) !== B.DOOR || w.getBlock(x, ly + 1, z) !== B.DOOR) {
                break;
            }
            const powered = isPowered(w, x, ly, z) || isPowered(w, x, ly + 1, z);
            const key = x + "," + ly + "," + z;
            if (powered === w.doorPowered.has(key)) {
                break;
            }
            if (powered) {
                w.doorPowered.add(key);
            } else {
                w.doorPowered.delete(key);
            }
            if (((w.getMeta(x, ly, z) & 4) !== 0) !== powered) {
                for (const yy of [ly, ly + 1]) {
                    const m = w.getMeta(x, yy, z);
                    w.setBlock(x, yy, z, B.DOOR, powered ? m | 4 : m & ~4, false);
                }
                sound(powered);
            }
            break;
        }
        case B.RAIL:
        case B.POWERED_RAIL: {
            if (railLinks(w, x, y, z).length < 2) {
                shapeRail(w, x, y, z, false);
            }
            if (id === B.POWERED_RAIL) {
                const m = w.getMeta(x, y, z);
                const shape = m & 7;
                const on = isPowered(w, x, y, z) || railChainPowered(w, x, y, z, shape);
                if (on !== ((m & 8) !== 0)) {
                    w.setBlock(x, y, z, B.POWERED_RAIL, shape | (on ? 8 : 0), false);
                    const [ax, az] = railAxis(shape);
                    for (const s of [1, -1]) {
                        for (const dy of [0, 1, -1]) {
                            if (w.getBlock(x + ax * s, y + dy, z + az * s) === B.POWERED_RAIL) {
                                w.schedule(x + ax * s, y + dy, z + az * s, 1);
                            }
                        }
                    }
                }
            }
            break;
        }
        default:
            break;
    }
}

export { HDIR };
