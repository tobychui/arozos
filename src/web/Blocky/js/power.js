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
//Plain rails react too: a junction is a switch (railSwitch)
POWER[B.RAIL] |= 8 | 4;
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

const FRAGILE = new Set(["cross", "crop", "torch", "wire", "lever", "button", "ladder", "rail", "fire", "plate", "retimer", "sign"]);

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
    //The head and the moved blocks shove whatever stands in their new cells
    if (w.onPistonPush) {
        const cells = line.map(([px, py, pz]) => [px + d[0], py + d[1], pz + d[2]]);
        cells.push([x + d[0], y + d[1], z + d[2]]);
        w.onPistonPush(cells, d);
    }
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

//The sides (FLAT index) each rail shape leads out of
const RAIL_ENDS = [[2, 3], [0, 1], [0, 1], [0, 1], [2, 3], [2, 3], [2, 0], [2, 1], [3, 1], [3, 0]];

function railEnds(w, x, y, z) {
    const id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
    return RAIL_ENDS[id === B.POWERED_RAIL ? m & 7 : Math.min(9, m & 15)] || RAIL_ENDS[0];
}

//The rail beside (x, y, z) on side k (level, one up or one down)
function railBeside(w, x, y, z, k) {
    const [dx, dz] = FLAT[k];
    for (const dy of [0, 1, -1]) {
        if (POWER[w.getBlock(x + dx, y + dy, z + dz)] & 8) {
            return [x + dx, y + dy, z + dz];
        }
    }
    return null;
}

//Does the rail at n lead out toward side k?
function railPoints(w, n, k) {
    return railEnds(w, n[0], n[1], n[2]).includes(k);
}

//How many ends of the rail at (x, y, z) are joined to a rail that leads
//back into it, not counting the rail at `skip`
function railJoined(w, x, y, z, skip) {
    let n = 0;
    for (const k of railEnds(w, x, y, z)) {
        const r = railBeside(w, x, y, z, k);
        if (r && !(skip && same(r, skip)) && railPoints(w, r, k ^ 1)) {
            n++;
        }
    }
    return n;
}

//Neighbours a rail may join: ones already leading into it, and ones with a
//free end. A rail joined at both ends to others is left alone, so a track
//passing beside another is never bent into it.
function railCandidates(w, x, y, z) {
    const here = [x, y, z];
    const out = [];
    for (let k = 0; k < 4; k++) {
        const n = railBeside(w, x, y, z, k);
        if (!n) {
            continue;
        }
        const back = railPoints(w, n, k ^ 1);
        if (back || railJoined(w, n[0], n[1], n[2], here) < 2) {
            out.push({ k, dy: n[1] - y, back });
        }
    }
    return out;
}

export function shapeRail(w, x, y, z, preferX) {
    const id = w.getBlock(x, y, z);
    const cands = railCandidates(w, x, y, z);
    let links = cands.map((c) => [c.k, c.dy]);
    if (cands.length > 2 || (cands.length === 2 && id === B.POWERED_RAIL && (cands[0].k ^ 1) !== cands[1].k)) {
        //Best pair: rails leading in count most, then a straight line
        let best = null, bestScore = -1;
        for (let i = 0; i < cands.length; i++) {
            for (let j = i + 1; j < cands.length; j++) {
                const a = cands[i], b = cands[j], straight = (a.k ^ 1) === b.k;
                if (!straight && id === B.POWERED_RAIL) {
                    continue;
                }
                const score = (a.back ? 2 : 1) + (b.back ? 2 : 1) + (straight ? 0.5 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    best = [a, b];
                }
            }
        }
        if (best) {
            links = best.map((c) => [c.k, c.dy]);
        } else {
            //A powered rail with only bends on offer: run toward one of them
            const c = cands.find((v) => v.back) || cands[0];
            links = [[c.k, c.dy]];
        }
    }
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

//Two parallel lines joined into a loop end in a U-turn: two curves side by
//side, each leading on along the lines. A new rail just past one of them
//(where its line would go on) opens the U-turn: both curves run straight
//again, the new rail continues that line, and the next rail laid beside it
//closes the loop once more. So two lines laid side by side, in any order,
//grow into one long loop.
function openUTurn(w, x, y, z) {
    const isCurve = (e) => (e[0] >> 1) !== (e[1] >> 1);
    for (let k = 0; k < 4; k++) {
        //n: the rail on side k of the new one, a curve that leads on in
        //direction k (away from the new rail) and turns toward m
        const [dx, dz] = FLAT[k];
        const nx = x + dx, nz = z + dz;
        if (w.getBlock(nx, y, nz) !== B.RAIL) {
            continue;
        }
        const ne = railEnds(w, nx, y, nz);
        if (!isCurve(ne) || !ne.includes(k)) {
            continue;
        }
        const turn = ne[0] === k ? ne[1] : ne[0];
        const mx = nx + FLAT[turn][0], mz = nz + FLAT[turn][1];
        if (w.getBlock(mx, y, mz) !== B.RAIL) {
            continue;
        }
        //m: the other half of the U-turn, turning back toward n and leading
        //on in the same direction
        const me = railEnds(w, mx, y, mz);
        if (!isCurve(me) || !me.includes(turn ^ 1) || !me.includes(k)) {
            continue;
        }
        const straight = k < 2 ? 1 : 0;
        w.setBlock(nx, y, nz, B.RAIL, straight, false);
        w.setBlock(mx, y, mz, B.RAIL, straight, false);
        return;
    }
}

//A new rail: shape it, then let the neighbours it leads into turn toward
//it, unless they are already joined at both ends
export function railPlaced(w, x, y, z, preferX) {
    if (w.getBlock(x, y, z) === B.RAIL || w.getBlock(x, y, z) === B.POWERED_RAIL) {
        openUTurn(w, x, y, z);
    }
    shapeRail(w, x, y, z, preferX);
    for (const k of railEnds(w, x, y, z)) {
        const n = railBeside(w, x, y, z, k);
        //(also when it leads here already: one block lower it must slope up)
        if (n && railJoined(w, n[0], n[1], n[2], [x, y, z]) < 2) {
            shapeRail(w, n[0], n[1], n[2], FLAT[k][0] !== 0);
        }
    }
}

//A plain rail where three tracks meet is a switch. The two tracks on
//opposite sides are the through line, the third the stem; power sends the
//stem the other way along the through line, and taking it away sends it
//back. Meta bit 16: switched by power; bit 32: it lay along the through
//line before (so it goes back to that rather than to the other curve).
function railSwitch(w, x, y, z) {
    const sides = [0, 1, 2, 3].filter((k) => railBeside(w, x, y, z, k));
    if (sides.length !== 3) {
        return;
    }
    const m = w.getMeta(x, y, z);
    const powered = isPowered(w, x, y, z);
    if (powered === ((m & 16) !== 0)) {
        return;
    }
    const stem = sides.find((k) => !sides.includes(k ^ 1));
    const arms = sides.filter((k) => k !== stem);
    const curve = (a, b) => (a >= 2 ? CURVES[a + "," + b] : CURVES[b + "," + a]);
    const ends = RAIL_ENDS[Math.min(9, m & 15)];
    const onStem = ends.includes(stem) && arms.some((a) => ends.includes(a));
    let meta;
    if (powered) {
        if (onStem) {
            const arm = arms.find((a) => !ends.includes(a));
            meta = curve(stem, arm) | 16;
        } else {
            meta = curve(stem, arms[0]) | 16 | 32;
        }
    } else if (m & 32) {
        meta = arms[0] < 2 ? 1 : 0;
    } else if (onStem) {
        const arm = arms.find((a) => !ends.includes(a));
        meta = curve(stem, arm);
    } else {
        //Reshaped while switched: just forget the switch
        meta = m & 15;
    }
    w.setBlock(x, y, z, B.RAIL, meta, false);
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
            //A double door shares its power: either door powered opens both
            const partner = w.doorPartner(x, ly, z);
            const doors = partner ? [[x, z], [partner[0], partner[2]]] : [[x, z]];
            const powered = doors.some(([dx, dz]) => isPowered(w, dx, ly, dz) || isPowered(w, dx, ly + 1, dz));
            const key = x + "," + ly + "," + z;
            if (powered === w.doorPowered.has(key)) {
                break;
            }
            for (const [dx, dz] of doors) {
                if (powered) {
                    w.doorPowered.add(dx + "," + ly + "," + dz);
                } else {
                    w.doorPowered.delete(dx + "," + ly + "," + dz);
                }
            }
            if (((w.getMeta(x, ly, z) & 4) !== 0) !== powered) {
                w.setDoorOpen(x, ly, z, powered);
                sound(powered);
            }
            break;
        }
        case B.RAIL:
        case B.POWERED_RAIL: {
            if (railLinks(w, x, y, z).length < 2) {
                //Keep to the axis it lies on now
                const m = w.getMeta(x, y, z);
                shapeRail(w, x, y, z, railAxis(id === B.POWERED_RAIL ? m & 7 : m & 15)[0] === 1);
            }
            if (id === B.RAIL) {
                railSwitch(w, x, y, z);
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
