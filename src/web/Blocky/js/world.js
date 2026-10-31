/*
    Blocky - world.js

    Chunk storage and the simulation of the block world:

    - chunks are 16 x 128 x 16 columns (index (x << 11) | (z << 7) | y),
      rendered as eight 16-high sections
    - light: sky light and block light (0-15 each) packed in one byte per
      voxel, filled by a breadth first flood when a chunk is first lit and
      updated incrementally (removal + refill) when a block changes
    - block updates: water flow, falling sand and gravel, plants and torches
      losing their support, leaf decay, crop / reed / cactus growth, grass
      spreading, furnaces
    - save data: only chunks that changed are stored, run-length encoded

    The world never touches the renderer; it raises dirty flags per section
    and the renderer rebuilds what it needs.
*/

import {
    B, BLOCKS, LIGHT_OPACITY, LIGHT_EMIT, SHAPE, SOLID, RAIN_BLOCKING, isOpaqueAt,
    blockDrops, SMELTING, SMELT_TICKS, fuelTicks, ITEMS, FLAME_CATCH, FLAME_BURN, HDIR
} from "./blocks.js";
import { TerrainGen, WORLD_H, SEA, idx, BIOME } from "./worldgen.js";
import { chunkKey, rleEncode, rleDecode, bytesToBase64, base64ToBytes, mulberry32, hash3 } from "./util.js";
import { FACE_DIR } from "./shapes.js";
import { POWER, powerTick, powerChanged, railPlaced, pressButton, pressPlate } from "./power.js";

export const SECTIONS = WORLD_H / 16;

const IS_SLAB = new Uint8Array(256);
const WASHABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    IS_SLAB[i] = SHAPE[i] === "slab" ? 1 : 0;
    WASHABLE[i] = (SHAPE[i] === "cross" || SHAPE[i] === "crop" || SHAPE[i] === "torch" || SHAPE[i] === "fire") && i !== B.REEDS ? 1 : 0;
}

function opacityOf(id, meta) {
    const o = LIGHT_OPACITY[id];
    if (o === 0 && IS_SLAB[id] === 1 && meta === 2) {
        return 15;
    }
    return o;
}

const DIRS = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];

//Liquid behaviour: ticks between updates, level lost per block, last level
const LIQUID = {
    [B.WATER]: { delay: 5, step: 1, max: 7, renew: true },
    [B.LAVA]: { delay: 30, step: 2, max: 6, renew: false }
};

//A wheat stage takes this long on watered farmland at tick speed 3, so a
//full grow (7 steps over 8 stages) is about 30 minutes; dry farmland halves it
export const CROP_STAGE_SECONDS = 1800 / 7;
export const DEFAULT_RULES = { tickSpeed: 3, fireSpread: true };

export class Chunk {
    constructor(cx, cz) {
        this.cx = cx;
        this.cz = cz;
        this.key = chunkKey(cx, cz);
        this.blocks = new Uint8Array(16 * 16 * WORLD_H);
        this.meta = new Uint8Array(16 * 16 * WORLD_H);
        this.light = new Uint8Array(16 * 16 * WORLD_H);
        this.biome = new Uint8Array(256);
        this.tint = new Float32Array(256 * 6);
        this.hmLight = new Uint8Array(256);
        this.hmRain = new Uint8Array(256);
        this.generated = false;
        this.lit = false;
        this.modified = false;
        this.dirty = new Uint8Array(SECTIONS).fill(1);
        this.crops = new Set();
        this.meshes = null; //owned by the renderer
    }
}

export class World {
    constructor(seed, opts = {}) {
        this.seed = seed | 0;
        this.gen = new TerrainGen(this.seed);
        this.chunks = new Map();
        this.saved = new Map();
        this.tileEntities = new Map();
        this.schedBuckets = new Map();
        this.schedSet = new Set();
        this.tickCount = 0;
        this.rng = mulberry32(this.seed ^ 0x51ed);
        this.lastChunk = null;
        this.skyDarken = 0;
        this.raining = false;
        this.order = null;
        this.orderKey = "";
        //Callbacks wired up by the game
        this.onDrop = opts.onDrop || null;
        this.onFalling = opts.onFalling || null;
        this.onBlockBroken = opts.onBlockBroken || null;
        this.onFizz = opts.onFizz || null;
        this.onPowerSound = opts.onPowerSound || null;
        this.powerBusy = false;
        this.pistonMoving = false;
        this.buttonDue = new Map();
        //Doors held open by power (lower half positions)
        this.doorPowered = new Set();
        //Retimer output changes on their way: key -> { due, on }
        this.retimerDue = new Map();
        this.railPreferX = false;
        this.rules = Object.assign({}, DEFAULT_RULES);
        this.cropProgress = new Map();
        this.quiet = false;
    }

    /* ---------------- chunk access ---------------- */

    chunkAt(cx, cz) {
        const lc = this.lastChunk;
        if (lc !== null && lc.cx === cx && lc.cz === cz) {
            return lc;
        }
        const c = this.chunks.get(chunkKey(cx, cz));
        if (c !== undefined) {
            this.lastChunk = c;
        }
        return c;
    }

    isLoaded(x, z) {
        const c = this.chunkAt(x >> 4, z >> 4);
        return c !== undefined && c.generated;
    }

    getBlock(x, y, z) {
        if (y < 0) {
            return B.BEDROCK;
        }
        if (y >= WORLD_H) {
            return B.AIR;
        }
        const c = this.chunkAt(x >> 4, z >> 4);
        if (c === undefined || !c.generated) {
            return B.AIR;
        }
        return c.blocks[((x & 15) << 11) | ((z & 15) << 7) | y];
    }

    getMeta(x, y, z) {
        if (y < 0 || y >= WORLD_H) {
            return 0;
        }
        const c = this.chunkAt(x >> 4, z >> 4);
        if (c === undefined || !c.generated) {
            return 0;
        }
        return c.meta[((x & 15) << 11) | ((z & 15) << 7) | y];
    }

    getSky(x, y, z) {
        if (y >= WORLD_H) {
            return 15;
        }
        if (y < 0) {
            return 0;
        }
        const c = this.chunkAt(x >> 4, z >> 4);
        if (c === undefined || !c.lit) {
            return 15;
        }
        return c.light[((x & 15) << 11) | ((z & 15) << 7) | y] >> 4;
    }

    getBlockLight(x, y, z) {
        if (y < 0 || y >= WORLD_H) {
            return 0;
        }
        const c = this.chunkAt(x >> 4, z >> 4);
        if (c === undefined) {
            return 0;
        }
        return c.light[((x & 15) << 11) | ((z & 15) << 7) | y] & 15;
    }

    //Light level the way plants see it (sky dims at night)
    effectiveLight(x, y, z) {
        return Math.max(this.getSky(x, y, z) - this.skyDarken, this.getBlockLight(x, y, z));
    }

    biomeAt(x, z) {
        const c = this.chunkAt(x >> 4, z >> 4);
        if (c === undefined || !c.generated) {
            return this.gen.column(x, z).biome;
        }
        return c.biome[(z & 15) * 16 + (x & 15)];
    }

    //First y above everything that stops rain in this column
    rainTop(x, z) {
        const c = this.chunkAt(x >> 4, z >> 4);
        if (c === undefined || !c.generated) {
            return -1;
        }
        return c.hmRain[(z & 15) * 16 + (x & 15)];
    }

    /* ---------------- generation & streaming ---------------- */

    getOrCreate(cx, cz) {
        let c = this.chunkAt(cx, cz);
        if (c === undefined) {
            c = new Chunk(cx, cz);
            this.chunks.set(c.key, c);
        }
        return c;
    }

    generateChunk(c) {
        const saved = this.saved.get(c.key);
        if (saved !== undefined) {
            rleDecode(base64ToBytes(saved), c.blocks, c.meta);
            for (let lz = 0; lz < 16; lz++) {
                for (let lx = 0; lx < 16; lx++) {
                    const col = this.gen.columnCached(c.cx * 16 + lx, c.cz * 16 + lz);
                    c.biome[lz * 16 + lx] = col.biome;
                    c.tint.set(col.grass, (lz * 16 + lx) * 6);
                    c.tint.set(col.leaf, (lz * 16 + lx) * 6 + 3);
                }
            }
            c.modified = true;
            this.saved.delete(c.key);
            this.resumeChunk(c);
        } else {
            this.gen.generate(c);
        }
        this.computeHeightmaps(c);
        c.generated = true;
    }

    //Pick up where a saved chunk left off: crops, fire and moving liquids
    resumeChunk(c) {
        const bx = c.cx * 16, bz = c.cz * 16;
        for (let i = 0; i < c.blocks.length; i++) {
            const id = c.blocks[i];
            if (id === B.WHEAT) {
                c.crops.add(i);
            } else if (id === B.FIRE || ((id === B.WATER || id === B.LAVA) && c.meta[i] !== 0) || (id === B.BUTTON && (c.meta[i] & 8)) ||
                ((id === B.PLATE_WOOD || id === B.PLATE_STONE) && (c.meta[i] & 1)) || id === B.RETIMER || id === B.RETIMER_ON) {
                this.schedule(bx + (i >> 11), i & 127, bz + ((i >> 7) & 15), 5 + Math.floor(this.rng() * 30));
            }
        }
    }

    computeHeightmaps(c) {
        for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
                const base = (lx << 11) | (lz << 7);
                let hl = 0, hr = 0;
                for (let y = WORLD_H - 1; y >= 0; y--) {
                    if (opacityOf(c.blocks[base | y], c.meta[base | y]) > 0) {
                        hl = y + 1;
                        break;
                    }
                }
                for (let y = WORLD_H - 1; y >= 0; y--) {
                    if (RAIN_BLOCKING[c.blocks[base | y]]) {
                        hr = y + 1;
                        break;
                    }
                }
                c.hmLight[lz * 16 + lx] = hl;
                c.hmRain[lz * 16 + lx] = hr;
            }
        }
    }

    neighborsReady(c, flag) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) {
                    continue;
                }
                const n = this.chunkAt(c.cx + dx, c.cz + dz);
                if (n === undefined || !n[flag]) {
                    return false;
                }
            }
        }
        return true;
    }

    isMeshable(c) {
        return c.lit && this.neighborsReady(c, "lit");
    }

    //Generate and light chunks around (pcx, pcz) until the deadline.
    //Returns true when everything in range is ready.
    stream(pcx, pcz, radius, deadline) {
        const key = pcx + "," + pcz + "," + radius;
        if (key !== this.orderKey) {
            this.orderKey = key;
            const list = [];
            const R = radius + 2;
            for (let dx = -R; dx <= R; dx++) {
                for (let dz = -R; dz <= R; dz++) {
                    list.push([dx, dz, dx * dx + dz * dz, Math.max(Math.abs(dx), Math.abs(dz))]);
                }
            }
            list.sort((a, b) => a[2] - b[2]);
            this.order = list;
            this.streamDone = false;
        }
        if (this.streamDone) {
            return true;
        }
        let allDone = true;
        for (const [dx, dz, , cheb] of this.order) {
            const c = this.getOrCreate(pcx + dx, pcz + dz);
            if (!c.generated) {
                if (performance.now() > deadline) {
                    return false;
                }
                this.generateChunk(c);
            }
            if (cheb <= radius + 1 && !c.lit) {
                if (this.neighborsReady(c, "generated")) {
                    if (performance.now() > deadline) {
                        return false;
                    }
                    this.lightChunk(c);
                } else {
                    allDone = false;
                }
            }
        }
        if (allDone) {
            this.streamDone = true;
        }
        return allDone;
    }

    //Drop chunks far from the player; returns the removed chunks
    unloadFar(pcx, pcz, radius) {
        const out = [];
        const R = radius + 4;
        for (const c of this.chunks.values()) {
            if (Math.abs(c.cx - pcx) > R || Math.abs(c.cz - pcz) > R) {
                if (c.modified && c.generated) {
                    this.saved.set(c.key, bytesToBase64(rleEncode(c.blocks, c.meta)));
                }
                out.push(c);
            }
        }
        for (const c of out) {
            this.chunks.delete(c.key);
        }
        if (out.length) {
            this.lastChunk = null;
            this.orderKey = "";
        }
        return out;
    }

    /* ---------------- lighting ---------------- */

    lightChunk(c) {
        const x0 = c.cx * 16, z0 = c.cz * 16;
        //Straight down sky light
        for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
                let level = 15;
                for (let y = WORLD_H - 1; y >= 0; y--) {
                    const i = (lx << 11) | (lz << 7) | y;
                    const op = opacityOf(c.blocks[i], c.meta[i]);
                    if (op >= 15) {
                        break;
                    }
                    if (!(level === 15 && op === 0)) {
                        level = level - 1 - op;
                        if (level <= 0) {
                            break;
                        }
                    }
                    if (level > (c.light[i] >> 4)) {
                        c.light[i] = (level << 4) | (c.light[i] & 15);
                    }
                }
            }
        }
        //Seeds: open sky voxels next to taller neighbouring columns
        const sky = [];
        for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
                const h = c.hmLight[lz * 16 + lx];
                let maxN = h;
                for (let d = 0; d < 4; d++) {
                    const nx = x0 + lx + (d === 0 ? 1 : d === 1 ? -1 : 0);
                    const nz = z0 + lz + (d === 2 ? 1 : d === 3 ? -1 : 0);
                    const nc = this.chunkAt(nx >> 4, nz >> 4);
                    if (nc !== undefined && nc.generated) {
                        const nh = nc.hmLight[(nz & 15) * 16 + (nx & 15)];
                        if (nh > maxN) {
                            maxN = nh;
                        }
                    }
                }
                for (let y = h; y < maxN; y++) {
                    sky.push(x0 + lx, y, z0 + lz);
                }
            }
        }
        //Block light sources
        const blk = [];
        const blocks = c.blocks;
        for (let i = 0; i < blocks.length; i++) {
            const em = LIGHT_EMIT[blocks[i]];
            if (em > 0) {
                c.light[i] = (c.light[i] & 0xf0) | em;
                blk.push(x0 + (i >> 11), i & 127, z0 + ((i >> 7) & 15));
            }
        }
        c.lit = true;
        this.propagate(sky, true);
        this.propagate(blk, false);
        c.dirty.fill(1);
    }

    propagate(q, isSky) {
        let i = 0;
        while (i < q.length) {
            const x = q[i++], y = q[i++], z = q[i++];
            const c = this.chunkAt(x >> 4, z >> 4);
            if (c === undefined || !c.generated) {
                continue;
            }
            const li = ((x & 15) << 11) | ((z & 15) << 7) | y;
            const level = isSky ? c.light[li] >> 4 : c.light[li] & 15;
            if (level <= 1) {
                continue;
            }
            for (let d = 0; d < 18; d += 3) {
                const ny = y + DIRS[d + 1];
                if (ny < 0 || ny >= WORLD_H) {
                    continue;
                }
                const nx = x + DIRS[d], nz = z + DIRS[d + 2];
                const nc = (DIRS[d] !== 0 || DIRS[d + 2] !== 0) ? this.chunkAt(nx >> 4, nz >> 4) : c;
                if (nc === undefined || !nc.generated) {
                    continue;
                }
                const ni = ((nx & 15) << 11) | ((nz & 15) << 7) | ny;
                const op = opacityOf(nc.blocks[ni], nc.meta[ni]);
                if (op >= 15) {
                    continue;
                }
                const nl = (isSky && d === 9 && level === 15 && op === 0) ? 15 : level - 1 - op;
                if (nl <= 0) {
                    continue;
                }
                const cur = isSky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
                if (nl > cur) {
                    nc.light[ni] = isSky ? (nl << 4) | (nc.light[ni] & 15) : (nc.light[ni] & 0xf0) | nl;
                    this.markDirtyAround(nx, ny, nz, nc);
                    q.push(nx, ny, nz);
                }
            }
            if (i > 300000) {
                q.splice(0, i);
                i = 0;
            }
        }
    }

    //Clear the light a voxel used to spread; refill candidates go to add
    removeLight(x, y, z, level, isSky, add) {
        const c0 = this.chunkAt(x >> 4, z >> 4);
        const li0 = ((x & 15) << 11) | ((z & 15) << 7) | y;
        c0.light[li0] = isSky ? c0.light[li0] & 15 : c0.light[li0] & 0xf0;
        const rq = [x, y, z, level];
        let i = 0;
        while (i < rq.length) {
            const cx = rq[i++], cy = rq[i++], cz = rq[i++], lv = rq[i++];
            for (let d = 0; d < 18; d += 3) {
                const ny = cy + DIRS[d + 1];
                if (ny < 0 || ny >= WORLD_H) {
                    continue;
                }
                const nx = cx + DIRS[d], nz = cz + DIRS[d + 2];
                const nc = this.chunkAt(nx >> 4, nz >> 4);
                if (nc === undefined || !nc.generated) {
                    continue;
                }
                const ni = ((nx & 15) << 11) | ((nz & 15) << 7) | ny;
                const nl = isSky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
                if (nl === 0) {
                    continue;
                }
                if (!isSky) {
                    const em = LIGHT_EMIT[nc.blocks[ni]];
                    if (em > 0) {
                        if (nl < lv && nl > em) {
                            nc.light[ni] = (nc.light[ni] & 0xf0) | em;
                            this.markDirtyAround(nx, ny, nz, nc);
                        }
                        add.push(nx, ny, nz);
                        continue;
                    }
                }
                const straightDown = isSky && d === 9 && lv === 15 && nl === 15;
                if (nl < lv || straightDown) {
                    nc.light[ni] = isSky ? nc.light[ni] & 15 : nc.light[ni] & 0xf0;
                    this.markDirtyAround(nx, ny, nz, nc);
                    rq.push(nx, ny, nz, nl);
                } else {
                    add.push(nx, ny, nz);
                }
            }
        }
    }

    relight(x, y, z, oldId, oldMeta, newId, newMeta) {
        const oldOp = opacityOf(oldId, oldMeta), newOp = opacityOf(newId, newMeta);
        const oldEm = LIGHT_EMIT[oldId], newEm = LIGHT_EMIT[newId];
        const c = this.chunkAt(x >> 4, z >> 4);
        const li = ((x & 15) << 11) | ((z & 15) << 7) | y;
        const pushNeighbors = (arr) => {
            for (let d = 0; d < 18; d += 3) {
                const ny = y + DIRS[d + 1];
                if (ny >= 0 && ny < WORLD_H) {
                    arr.push(x + DIRS[d], ny, z + DIRS[d + 2]);
                }
            }
        };
        if (oldEm !== newEm || oldOp !== newOp) {
            const add = [];
            const cur = c.light[li] & 15;
            if (cur > 0) {
                this.removeLight(x, y, z, cur, false, add);
            }
            if (newEm > 0) {
                c.light[li] = (c.light[li] & 0xf0) | newEm;
                add.push(x, y, z);
            } else if (newOp < 15) {
                pushNeighbors(add);
            }
            this.propagate(add, false);
        }
        if (oldOp !== newOp) {
            const add = [];
            const cur = c.light[li] >> 4;
            if (newOp > oldOp) {
                if (cur > 0) {
                    this.removeLight(x, y, z, cur, true, add);
                }
            } else {
                pushNeighbors(add);
            }
            this.propagate(add, true);
        }
    }

    markDirtyAround(x, y, z, c) {
        const lx = x & 15, lz = z & 15, ly = y & 15;
        const sec = y >> 4;
        c.dirty[sec] = 1;
        if (lx !== 0 && lx !== 15 && lz !== 0 && lz !== 15 && ly !== 0 && ly !== 15) {
            return;
        }
        const xa = lx === 0 ? -1 : lx === 15 ? 1 : 0;
        const za = lz === 0 ? -1 : lz === 15 ? 1 : 0;
        const ya = ly === 0 ? -1 : ly === 15 ? 1 : 0;
        for (let dx = 0; dx <= 1; dx++) {
            if (dx === 1 && xa === 0) {
                break;
            }
            for (let dz = 0; dz <= 1; dz++) {
                if (dz === 1 && za === 0) {
                    break;
                }
                for (let dy = 0; dy <= 1; dy++) {
                    if (dy === 1 && ya === 0) {
                        break;
                    }
                    const ns = sec + (dy ? ya : 0);
                    if (ns < 0 || ns >= SECTIONS) {
                        continue;
                    }
                    const nc = (dx || dz) ? this.chunkAt(c.cx + (dx ? xa : 0), c.cz + (dz ? za : 0)) : c;
                    if (nc !== undefined) {
                        nc.dirty[ns] = 1;
                    }
                }
            }
        }
    }

    /* ---------------- block changes ---------------- */

    setBlock(x, y, z, id, meta = 0, notify = true) {
        if (y < 0 || y >= WORLD_H) {
            return false;
        }
        const c = this.chunkAt(x >> 4, z >> 4);
        if (c === undefined || !c.generated) {
            return false;
        }
        const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
        const oldId = c.blocks[i], oldMeta = c.meta[i];
        if (oldId === id && oldMeta === meta) {
            return false;
        }
        c.blocks[i] = id;
        c.meta[i] = meta;
        //Grass spreading and plants growing in a chunk nobody touched are
        //not worth a save entry; the chunk simply regenerates
        if (!this.quiet) {
            c.modified = true;
        }
        this.updateHeightmaps(c, x & 15, y, z & 15);
        if (c.lit) {
            this.relight(x, y, z, oldId, oldMeta, id, meta);
        }
        this.markDirtyAround(x, y, z, c);
        if (oldId !== id) {
            if (oldId === B.WHEAT) {
                c.crops.delete(i);
                this.cropProgress.delete(x + "," + y + "," + z);
            }
            if (id === B.WHEAT) {
                c.crops.add(i);
            }
            if (id === B.FIRE) {
                this.schedule(x, y, z, 30 + Math.floor(this.rng() * 10));
            }
            //A piston and its head go together, unless the piston itself moves them
            if (!this.pistonMoving) {
                if (oldId === B.PISTON_HEAD) {
                    const d = FACE_DIR[oldMeta & 7];
                    const bx = x - d[0], by = y - d[1], bz = z - d[2];
                    const base = this.getBlock(bx, by, bz);
                    if ((base === B.PISTON || base === B.STICKY_PISTON) && (this.getMeta(bx, by, bz) & 8)) {
                        this.breakNaturally(bx, by, bz);
                    }
                } else if ((oldId === B.PISTON || oldId === B.STICKY_PISTON) && (oldMeta & 8)) {
                    const d = FACE_DIR[oldMeta & 7];
                    if (this.getBlock(x + d[0], y + d[1], z + d[2]) === B.PISTON_HEAD) {
                        this.setBlock(x + d[0], y + d[1], z + d[2], B.AIR, 0);
                    }
                }
            }
            if ((oldId === B.DOOR || oldId === B.BED) && id !== oldId) {
                this.removePartner(x, y, z, oldId, oldMeta);
            }
            if ((oldId === B.LOG || oldId === B.LEAVES) && id !== B.LOG) {
                this.scheduleLeafChecks(x, y, z);
            }
            if (oldId === B.FURNACE || oldId === B.FURNACE_LIT || oldId === B.CHEST) {
                if (id !== B.FURNACE && id !== B.FURNACE_LIT) {
                    this.dropTileEntity(x, y, z);
                }
            }
        }
        if (notify) {
            this.notifyNeighbors(x, y, z);
        }
        if (oldId !== id && (POWER[id] & 8)) {
            railPlaced(this, x, y, z, this.railPreferX);
        }
        if (!this.powerBusy && (POWER[oldId] || POWER[id])) {
            powerChanged(this, x, y, z);
        }
        return true;
    }

    //Doors and beds are two blocks; removing one half removes the other
    partnerOf(x, y, z, id, meta) {
        if (id === B.DOOR) {
            return [x, y + (meta & 8 ? -1 : 1), z];
        }
        const d = HDIR[meta & 3];
        const s = meta & 4 ? -1 : 1;
        return [x + d[0] * s, y, z + d[1] * s];
    }

    removePartner(x, y, z, id, meta) {
        const [px, py, pz] = this.partnerOf(x, y, z, id, meta);
        if (this.getBlock(px, py, pz) === id) {
            this.setBlock(px, py, pz, B.AIR, 0);
        }
    }

    setMeta(x, y, z, meta) {
        return this.setBlock(x, y, z, this.getBlock(x, y, z), meta, false);
    }

    updateHeightmaps(c, lx, y, lz) {
        const ci = lz * 16 + lx;
        const base = (lx << 11) | (lz << 7);
        const id = c.blocks[base | y];
        if (opacityOf(id, c.meta[base | y]) > 0) {
            if (y + 1 > c.hmLight[ci]) {
                c.hmLight[ci] = y + 1;
            }
        } else if (y + 1 === c.hmLight[ci]) {
            let yy = y - 1;
            while (yy >= 0 && opacityOf(c.blocks[base | yy], c.meta[base | yy]) === 0) {
                yy--;
            }
            c.hmLight[ci] = yy + 1;
        }
        if (RAIN_BLOCKING[id]) {
            if (y + 1 > c.hmRain[ci]) {
                c.hmRain[ci] = y + 1;
            }
        } else if (y + 1 === c.hmRain[ci]) {
            let yy = y - 1;
            while (yy >= 0 && !RAIN_BLOCKING[c.blocks[base | yy]]) {
                yy--;
            }
            c.hmRain[ci] = yy + 1;
        }
    }

    notifyNeighbors(x, y, z) {
        this.neighborChanged(x, y, z);
        for (let d = 0; d < 18; d += 3) {
            this.neighborChanged(x + DIRS[d], y + DIRS[d + 1], z + DIRS[d + 2]);
        }
    }

    neighborChanged(x, y, z) {
        if (y < 0 || y >= WORLD_H || !this.isLoaded(x, z)) {
            return;
        }
        const id = this.getBlock(x, y, z);
        if (id === B.AIR) {
            return;
        }
        const def = BLOCKS[id];
        if (id === B.WATER || id === B.LAVA) {
            this.schedule(x, y, z, LIQUID[id].delay);
        } else if (def.gravity) {
            if (this.canFallInto(this.getBlock(x, y - 1, z))) {
                this.schedule(x, y, z, 2);
            }
        } else if (def.support) {
            this.schedule(x, y, z, 1);
        } else if (POWER[id]) {
            this.schedule(x, y, z, 2);
        } else if (id === B.FARMLAND) {
            const above = this.getBlock(x, y + 1, z);
            if (isOpaqueAt(above, this.getMeta(x, y + 1, z))) {
                this.setBlock(x, y, z, B.DIRT);
            }
        }
    }

    canFallInto(id) {
        return id === B.AIR || id === B.WATER || id === B.LAVA || WASHABLE[id] === 1;
    }

    hasSupport(x, y, z, id, meta) {
        const below = this.getBlock(x, y - 1, z);
        const belowMeta = this.getMeta(x, y - 1, z);
        switch (BLOCKS[id].support) {
            case "soil":
                return below === B.GRASS || below === B.DIRT || below === B.FARMLAND;
            case "solid":
                return isOpaqueAt(below, belowMeta);
            case "sand":
                return below === B.SAND || below === B.GRASS || below === B.DIRT;
            case "farmland":
                return below === B.FARMLAND;
            case "reeds":
                if (below === B.REEDS) {
                    return true;
                }
                if (below !== B.GRASS && below !== B.DIRT && below !== B.SAND) {
                    return false;
                }
                return this.waterBeside(x, y - 1, z);
            case "cactus":
                if (below !== B.CACTUS && below !== B.SAND) {
                    return false;
                }
                for (let d = 0; d < 18; d += 3) {
                    if (DIRS[d + 1] !== 0) {
                        continue;
                    }
                    if (SOLID[this.getBlock(x + DIRS[d], y, z + DIRS[d + 2])]) {
                        return false;
                    }
                }
                return true;
            case "torch":
            case "wall": {
                const n = FACE_DIR[meta & 7] || FACE_DIR[2];
                const ax = x - n[0], ay = y - n[1], az = z - n[2];
                const aid = this.getBlock(ax, ay, az), am = this.getMeta(ax, ay, az);
                if (isOpaqueAt(aid, am)) {
                    return true;
                }
                //Torches also stand on top slabs and fence posts
                return BLOCKS[id].support === "torch" && meta === 2 && ((IS_SLAB[aid] === 1 && am === 1) || aid === B.FENCE);
            }
            case "door":
                if (meta & 8) {
                    return below === B.DOOR && (belowMeta & 8) === 0;
                }
                return isOpaqueAt(below, belowMeta) && this.getBlock(x, y + 1, z) === B.DOOR;
            default:
                return true;
        }
    }

    waterBeside(x, y, z) {
        for (let d = 0; d < 18; d += 3) {
            if (DIRS[d + 1] === 0 && this.getBlock(x + DIRS[d], y, z + DIRS[d + 2]) === B.WATER) {
                return true;
            }
        }
        return false;
    }

    //Break a block as if it broke by itself (drops items)
    breakNaturally(x, y, z) {
        const id = this.getBlock(x, y, z);
        const meta = this.getMeta(x, y, z);
        if (id === B.AIR || id === B.WATER || id === B.LAVA) {
            return;
        }
        const drops = blockDrops(id, meta, this.rng, 0);
        this.setBlock(x, y, z, B.AIR, 0);
        if (this.onDrop) {
            for (const [did, n] of drops) {
                this.onDrop(x + 0.5, y + 0.4, z + 0.5, did, n);
            }
        }
        if (this.onBlockBroken) {
            this.onBlockBroken(x, y, z, id, true);
        }
    }

    /* ---------------- scheduled ticks ---------------- */

    pressButton(x, y, z) {
        pressButton(this, x, y, z, this.getMeta(x, y, z));
    }

    pressPlate(x, y, z) {
        return pressPlate(this, x, y, z);
    }

    schedule(x, y, z, delay) {
        const key = x + "," + y + "," + z;
        if (this.schedSet.has(key)) {
            return;
        }
        this.schedSet.add(key);
        const t = this.tickCount + Math.max(1, delay | 0);
        let b = this.schedBuckets.get(t);
        if (b === undefined) {
            b = [];
            this.schedBuckets.set(t, b);
        }
        b.push(x, y, z);
    }

    runScheduled() {
        const b = this.schedBuckets.get(this.tickCount);
        if (b === undefined) {
            return;
        }
        this.schedBuckets.delete(this.tickCount);
        const limit = Math.min(b.length, 3 * 600);
        for (let i = 0; i < limit; i += 3) {
            const x = b[i], y = b[i + 1], z = b[i + 2];
            this.schedSet.delete(x + "," + y + "," + z);
            if (this.isLoaded(x, z)) {
                this.scheduledTick(x, y, z);
            }
        }
        if (limit < b.length) {
            //Too much at once: carry the rest over to the next tick
            const rest = b.slice(limit);
            const nb = this.schedBuckets.get(this.tickCount + 1) || [];
            this.schedBuckets.set(this.tickCount + 1, nb.concat(rest));
        }
    }

    scheduledTick(x, y, z) {
        const id = this.getBlock(x, y, z);
        const meta = this.getMeta(x, y, z);
        const def = BLOCKS[id];
        if (id === B.WATER || id === B.LAVA) {
            this.liquidTick(x, y, z, meta, id);
            if (id === B.LAVA && this.getBlock(x, y, z) === B.LAVA) {
                this.lavaHeat(x, y, z);
            }
        } else if (id === B.FIRE) {
            this.fireTick(x, y, z, meta);
        } else if (def.gravity) {
            if (this.canFallInto(this.getBlock(x, y - 1, z)) && y > 0) {
                if (this.onFalling) {
                    this.setBlock(x, y, z, B.AIR, 0);
                    this.onFalling(x, y, z, id, meta);
                }
            }
        } else if (POWER[id]) {
            if (def.support && !this.hasSupport(x, y, z, id, meta)) {
                this.breakNaturally(x, y, z);
                return;
            }
            powerTick(this, x, y, z, id, meta, (out) => {
                if (this.onPowerSound) {
                    this.onPowerSound(x, y, z, id, out);
                }
            });
        } else if (def.support) {
            if (!this.hasSupport(x, y, z, id, meta)) {
                this.breakNaturally(x, y, z);
            }
        } else if (id === B.LEAVES && (meta & 1) === 0) {
            if (!this.logNearby(x, y, z)) {
                this.breakNaturally(x, y, z);
            }
        }
    }

    /* ---------------- liquids ---------------- */

    flowInto(x, y, z, level, liquid) {
        const id = this.getBlock(x, y, z);
        if (WASHABLE[id] === 1) {
            if (liquid === B.WATER) {
                this.breakNaturally(x, y, z);
            } else {
                this.setBlock(x, y, z, B.AIR, 0, false);
            }
        }
        this.setBlock(x, y, z, liquid, level);
    }

    canFlow(id) {
        return id === B.AIR || WASHABLE[id] === 1;
    }

    //Lava next to water hardens: a source into obsidian, flowing lava into cobblestone
    lavaMeetsWater(x, y, z, m) {
        for (let d = 0; d < 18; d += 3) {
            if (DIRS[d + 1] === -1) {
                continue;
            }
            if (this.getBlock(x + DIRS[d], y + DIRS[d + 1], z + DIRS[d + 2]) === B.WATER) {
                this.setBlock(x, y, z, m === 0 ? B.OBSIDIAN : B.COBBLE, 0);
                if (this.onFizz) {
                    this.onFizz(x, y, z);
                }
                return true;
            }
        }
        return false;
    }

    liquidTick(x, y, z, m, id) {
        const L = LIQUID[id];
        if (id === B.LAVA && this.lavaMeetsWater(x, y, z, m)) {
            return;
        }
        if (m !== 0) {
            let newM;
            if (this.getBlock(x, y + 1, z) === id) {
                newM = 8;
            } else {
                let best = 99, sources = 0;
                for (let d = 0; d < 18; d += 3) {
                    if (DIRS[d + 1] !== 0) {
                        continue;
                    }
                    const nx = x + DIRS[d], nz = z + DIRS[d + 2];
                    if (this.getBlock(nx, y, nz) === id) {
                        const nm = this.getMeta(nx, y, nz);
                        if (nm === 0) {
                            sources++;
                        }
                        const eff = nm === 8 ? 0 : nm;
                        if (eff + L.step < best) {
                            best = eff + L.step;
                        }
                    }
                }
                const below = this.getBlock(x, y - 1, z);
                if (L.renew && sources >= 2 && (isOpaqueAt(below, this.getMeta(x, y - 1, z)) || (below === id && this.getMeta(x, y - 1, z) === 0))) {
                    newM = 0;
                } else {
                    newM = best <= L.max ? best : -1;
                }
            }
            if (newM === -1) {
                this.setBlock(x, y, z, B.AIR, 0);
                return;
            }
            if (newM !== m) {
                this.setBlock(x, y, z, id, newM);
                m = newM;
            }
        }
        const below = this.getBlock(x, y - 1, z);
        if (y > 0 && this.canFlow(below)) {
            this.flowInto(x, y - 1, z, 8, id);
            return;
        }
        if (below === id || below === B.WATER || below === B.LAVA) {
            return;
        }
        const next = (m === 0 || m === 8) ? L.step : m + L.step;
        if (next > L.max) {
            return;
        }
        for (let d = 0; d < 18; d += 3) {
            if (DIRS[d + 1] !== 0) {
                continue;
            }
            const nx = x + DIRS[d], nz = z + DIRS[d + 2];
            if (!this.isLoaded(nx, nz)) {
                continue;
            }
            const nid = this.getBlock(nx, y, nz);
            if (this.canFlow(nid)) {
                this.flowInto(nx, y, nz, next, id);
            } else if (nid === id) {
                const nm = this.getMeta(nx, y, nz);
                if (nm !== 0 && nm !== 8 && nm > next) {
                    this.setBlock(nx, y, nz, id, next);
                }
            }
        }
    }

    /* ---------------- fire ---------------- */

    //Highest catch chance of the blocks around a position
    flammableAround(x, y, z) {
        let best = 0;
        for (let d = 0; d < 18; d += 3) {
            const c = FLAME_CATCH[this.getBlock(x + DIRS[d], y + DIRS[d + 1], z + DIRS[d + 2])];
            if (c > best) {
                best = c;
            }
        }
        return best;
    }

    canFireStay(x, y, z) {
        return isOpaqueAt(this.getBlock(x, y - 1, z), this.getMeta(x, y - 1, z)) || this.flammableAround(x, y, z) > 0;
    }

    //Light a fire if the spot is free and something can hold it
    ignite(x, y, z) {
        const cur = this.getBlock(x, y, z);
        if ((cur !== B.AIR && WASHABLE[cur] !== 1) || !this.canFireStay(x, y, z)) {
            return false;
        }
        this.setBlock(x, y, z, B.FIRE, 0);
        return true;
    }

    //Lava sets burnable things near it alight. While anything burnable is
    //within reach it keeps ticking every few seconds (random ticks alone
    //come round too rarely); otherwise random ticks wake it again.
    lavaHeat(x, y, z) {
        if (!this.rules.fireSpread) {
            return;
        }
        let fuel = false;
        for (let dx = -2; dx <= 2 && !fuel; dx++) {
            for (let dz = -2; dz <= 2 && !fuel; dz++) {
                for (let dy = -1; dy <= 3; dy++) {
                    if (FLAME_CATCH[this.getBlock(x + dx, y + dy, z + dz)]) {
                        fuel = true;
                        break;
                    }
                }
            }
        }
        if (!fuel) {
            return;
        }
        const rng = this.rng;
        this.schedule(x, y, z, 40 + Math.floor(rng() * 60));
        if (rng() < 0.7) {
            return;
        }
        const catches = (id) => id === B.AIR || (WASHABLE[id] === 1 && FLAME_CATCH[id] > 0);
        //Heat rises: wander up to three blocks up and light the first
        //open spot that touches something burnable
        let tx = x, ty = y, tz = z;
        const steps = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < steps; i++) {
            tx += Math.floor(rng() * 3) - 1;
            ty++;
            tz += Math.floor(rng() * 3) - 1;
            const id = this.getBlock(tx, ty, tz);
            if (catches(id)) {
                if (this.flammableAround(tx, ty, tz) > 0 || FLAME_CATCH[id]) {
                    this.setBlock(tx, ty, tz, B.FIRE, 0);
                    return;
                }
            } else if (SOLID[id]) {
                break;
            }
        }
        //Burnable things beside the lava catch on top or next to it
        for (let k = 0; k < 3; k++) {
            const bx = x + Math.floor(rng() * 3) - 1, bz = z + Math.floor(rng() * 3) - 1;
            const id = this.getBlock(bx, y, bz);
            if (catches(id) && (FLAME_CATCH[id] || this.flammableAround(bx, y, bz) > 0)) {
                this.setBlock(bx, y, bz, B.FIRE, 0);
                return;
            }
            if (FLAME_CATCH[id] && catches(this.getBlock(bx, y + 1, bz))) {
                this.setBlock(bx, y + 1, bz, B.FIRE, 0);
                return;
            }
        }
    }

    fireTick(x, y, z, age) {
        if (!this.rules.fireSpread) {
            //Spreading is off: fires keep burning but touch nothing
            this.schedule(x, y, z, 40);
            return;
        }
        const rng = this.rng;
        this.schedule(x, y, z, 30 + Math.floor(rng() * 10));
        if (this.raining && this.rainTop(x, z) <= y + 1 && this.biomeAt(x, z) !== BIOME.DESERT && rng() < 0.6) {
            this.setBlock(x, y, z, B.AIR, 0);
            return;
        }
        const fuel = this.flammableAround(x, y, z);
        const belowId = this.getBlock(x, y - 1, z);
        if (!fuel && !isOpaqueAt(belowId, this.getMeta(x, y - 1, z))) {
            this.setBlock(x, y, z, B.AIR, 0);
            return;
        }
        const nextAge = Math.min(15, age + Math.floor(rng() * 3));
        if (nextAge !== age) {
            this.setBlock(x, y, z, B.FIRE, nextAge, false);
        }
        if (!fuel && nextAge > 3) {
            this.setBlock(x, y, z, B.AIR, 0);
            return;
        }
        if (nextAge >= 15 && !FLAME_BURN[belowId] && rng() < 0.25) {
            this.setBlock(x, y, z, B.AIR, 0);
            return;
        }
        //Burn the blocks it touches
        for (let d = 0; d < 18; d += 3) {
            const nx = x + DIRS[d], ny = y + DIRS[d + 1], nz = z + DIRS[d + 2];
            const nid = this.getBlock(nx, ny, nz);
            const burn = FLAME_BURN[nid];
            if (burn && rng() * (DIRS[d + 1] === 0 ? 300 : 250) < burn) {
                if (rng() < 0.55 && nextAge < 15) {
                    this.setBlock(nx, ny, nz, B.FIRE, Math.min(15, nextAge + Math.floor(rng() * 5)));
                } else {
                    this.setBlock(nx, ny, nz, B.AIR, 0);
                }
            }
        }
        //Jump to air next to something that burns
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                for (let dy = -1; dy <= 3; dy++) {
                    if (!dx && !dy && !dz) {
                        continue;
                    }
                    const tx = x + dx, ty = y + dy, tz = z + dz;
                    if (ty < 1 || ty >= WORLD_H || this.getBlock(tx, ty, tz) !== B.AIR) {
                        continue;
                    }
                    const enc = this.flammableAround(tx, ty, tz);
                    if (!enc) {
                        continue;
                    }
                    const k = dy > 1 ? 100 + (dy - 1) * 100 : 100;
                    if (rng() * k < enc * 0.35) {
                        this.setBlock(tx, ty, tz, B.FIRE, Math.min(15, nextAge + Math.floor(rng() * 5)));
                    }
                }
            }
        }
    }

    /* ---------------- crops ---------------- */

    //Runs once a second: wheat climbs one stage per CROP_STAGE_SECONDS
    cropTick() {
        const speed = this.rules.tickSpeed / 3;
        if (speed <= 0) {
            return;
        }
        for (const c of this.chunks.values()) {
            if (!c.crops.size || !c.lit) {
                continue;
            }
            for (const i of c.crops) {
                let meta = c.meta[i];
                if (meta >= 7) {
                    continue;
                }
                const x = c.cx * 16 + (i >> 11), y = i & 127, z = c.cz * 16 + ((i >> 7) & 15);
                //Crops grow day and night as long as they are open to the sky or lit
                if (Math.max(c.light[i] >> 4, c.light[i] & 15) < 9) {
                    continue;
                }
                const key = x + "," + y + "," + z;
                const wet = this.getMeta(x, y - 1, z) > 0;
                let prog = (this.cropProgress.get(key) || 0) + (wet ? 1 : 0.5) * speed;
                let grew = false;
                for (;;) {
                    const need = CROP_STAGE_SECONDS * (0.85 + 0.3 * ((hash3(this.seed, x, y * 8 + meta, z) & 255) / 255));
                    if (prog < need || meta >= 7) {
                        break;
                    }
                    prog -= need;
                    meta++;
                    grew = true;
                }
                if (grew) {
                    this.setBlock(x, y, z, B.WHEAT, meta, false);
                }
                if (meta >= 7) {
                    this.cropProgress.delete(key);
                } else {
                    this.cropProgress.set(key, prog);
                }
            }
        }
    }

    /* ---------------- leaves ---------------- */

    scheduleLeafChecks(x, y, z) {
        for (let dx = -4; dx <= 4; dx++) {
            for (let dy = -4; dy <= 4; dy++) {
                for (let dz = -4; dz <= 4; dz++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= WORLD_H) {
                        continue;
                    }
                    if (this.getBlock(x + dx, yy, z + dz) === B.LEAVES && (this.getMeta(x + dx, yy, z + dz) & 1) === 0) {
                        this.schedule(x + dx, yy, z + dz, 10 + Math.floor(this.rng() * 70));
                    }
                }
            }
        }
    }

    logNearby(x, y, z) {
        const R = 4, W = 9;
        const seen = new Uint8Array(W * W * W);
        const q = [x, y, z, 0];
        seen[(R * W + R) * W + R] = 1;
        let i = 0;
        while (i < q.length) {
            const cx = q[i++], cy = q[i++], cz = q[i++], dist = q[i++];
            for (let d = 0; d < 18; d += 3) {
                const nx = cx + DIRS[d], ny = cy + DIRS[d + 1], nz = cz + DIRS[d + 2];
                const ox = nx - x + R, oy = ny - y + R, oz = nz - z + R;
                if (ox < 0 || oy < 0 || oz < 0 || ox >= W || oy >= W || oz >= W) {
                    continue;
                }
                const si = (ox * W + oy) * W + oz;
                if (seen[si]) {
                    continue;
                }
                seen[si] = 1;
                const id = this.getBlock(nx, ny, nz);
                if (id === B.LOG) {
                    return true;
                }
                if (id === B.LEAVES && dist + 1 < R) {
                    q.push(nx, ny, nz, dist + 1);
                }
            }
        }
        return false;
    }

    /* ---------------- random ticks ---------------- */

    randomTicks(pcx, pcz, radius) {
        const rng = this.rng;
        for (const c of this.chunks.values()) {
            if (!c.lit || Math.abs(c.cx - pcx) > radius || Math.abs(c.cz - pcz) > radius) {
                continue;
            }
            const speed = this.rules.tickSpeed;
            for (let s = 0; s < SECTIONS; s++) {
                //Whole picks, plus one more with the fractional chance
                const picks = Math.floor(speed) + (rng() < speed % 1 ? 1 : 0);
                for (let k = 0; k < picks; k++) {
                    const r = (rng() * 4096) | 0;
                    const lx = r & 15, lz = (r >> 4) & 15, y = s * 16 + (r >> 8);
                    const id = c.blocks[(lx << 11) | (lz << 7) | y];
                    if (id === B.GRASS || id === B.SAPLING || id === B.FARMLAND || id === B.REEDS || id === B.CACTUS || id === B.LAVA) {
                        this.randomTick(c.cx * 16 + lx, y, c.cz * 16 + lz, id);
                    }
                }
            }
        }
    }

    randomTick(x, y, z, id) {
        if (id === B.GRASS || id === B.REEDS || id === B.CACTUS) {
            this.quiet = true;
            try {
                this.naturalTick(x, y, z, id);
            } finally {
                this.quiet = false;
            }
            return;
        }
        const rng = this.rng;
        const meta = this.getMeta(x, y, z);
        if (id === B.SAPLING) {
            if (this.effectiveLight(x, y, z) >= 9 && rng() < 0.07) {
                this.growTree(x, y, z);
            }
        } else if (id === B.LAVA) {
            this.lavaHeat(x, y, z);
        } else if (id === B.FARMLAND) {
            let wet = this.raining && this.rainTop(x, z) <= y + 1;
            if (!wet) {
                for (let dx = -4; dx <= 4 && !wet; dx++) {
                    for (let dz = -4; dz <= 4 && !wet; dz++) {
                        for (let dy = 0; dy <= 1; dy++) {
                            if (this.getBlock(x + dx, y + dy, z + dz) === B.WATER) {
                                wet = true;
                                break;
                            }
                        }
                    }
                }
            }
            if (wet) {
                if (meta !== 7) {
                    this.setBlock(x, y, z, B.FARMLAND, 7, false);
                }
            } else if (meta > 0) {
                this.setBlock(x, y, z, B.FARMLAND, meta - 1, false);
            } else if (this.getBlock(x, y + 1, z) !== B.WHEAT && rng() < 0.3) {
                this.setBlock(x, y, z, B.DIRT);
            }
        }
    }

    //Grass spreading / dying and reeds / cactus growing
    naturalTick(x, y, z, id) {
        const rng = this.rng;
        if (id === B.GRASS) {
            const above = this.getBlock(x, y + 1, z);
            if (isOpaqueAt(above, this.getMeta(x, y + 1, z)) || above === B.WATER) {
                this.setBlock(x, y, z, B.DIRT);
                return;
            }
            if (this.effectiveLight(x, y + 1, z) >= 9) {
                const tx = x + Math.floor(rng() * 3) - 1;
                const ty = y + Math.floor(rng() * 5) - 3;
                const tz = z + Math.floor(rng() * 3) - 1;
                if (this.getBlock(tx, ty, tz) === B.DIRT) {
                    const a = this.getBlock(tx, ty + 1, tz);
                    if (!isOpaqueAt(a, this.getMeta(tx, ty + 1, tz)) && a !== B.WATER && this.effectiveLight(tx, ty + 1, tz) >= 4) {
                        this.setBlock(tx, ty, tz, B.GRASS);
                    }
                }
            }
            return;
        }
        if (this.getBlock(x, y + 1, z) !== B.AIR || rng() > 0.08) {
            return;
        }
        let h = 1;
        while (h < 4 && this.getBlock(x, y - h, z) === id) {
            h++;
        }
        if (h < 3) {
            this.setBlock(x, y + 1, z, id, 0);
        }
    }

    growTree(x, y, z) {
        const plan = this.gen.treeBlocks(x, y, z, this.rng);
        if (y + plan.height >= WORLD_H - 1) {
            return false;
        }
        //Trunk needs free space
        for (const [bx, by, bz, id] of plan.blocks) {
            if (id === B.LOG && !(bx === x && by === y && bz === z)) {
                const cur = this.getBlock(bx, by, bz);
                if (cur !== B.AIR && cur !== B.LEAVES && cur !== B.TALL_GRASS) {
                    return false;
                }
            }
        }
        this.setBlock(x, y, z, B.AIR, 0, false);
        if (this.getBlock(x, y - 1, z) === B.GRASS) {
            this.setBlock(x, y - 1, z, B.DIRT, 0, false);
        }
        for (const [bx, by, bz, id] of plan.blocks) {
            const cur = this.getBlock(bx, by, bz);
            if (id === B.LOG || cur === B.AIR || cur === B.TALL_GRASS) {
                this.setBlock(bx, by, bz, id, 0, false);
            }
        }
        return true;
    }

    /* ---------------- tile entities ---------------- */

    teKey(x, y, z) {
        return x + "," + y + "," + z;
    }

    getTileEntity(x, y, z) {
        return this.tileEntities.get(this.teKey(x, y, z)) || null;
    }

    createTileEntity(x, y, z, type) {
        const te = type === "furnace"
            ? { type, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 }
            : { type, slots: new Array(27).fill(null) };
        this.tileEntities.set(this.teKey(x, y, z), te);
        return te;
    }

    dropTileEntity(x, y, z) {
        const key = this.teKey(x, y, z);
        const te = this.tileEntities.get(key);
        if (!te) {
            return;
        }
        this.tileEntities.delete(key);
        if (this.onDrop) {
            for (const s of te.slots) {
                if (s && s.count > 0) {
                    this.onDrop(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dmg || 0);
                }
            }
        }
    }

    tickFurnaces() {
        for (const [key, te] of this.tileEntities) {
            if (te.type !== "furnace") {
                continue;
            }
            const p = key.split(",").map(Number);
            if (!this.isLoaded(p[0], p[2])) {
                continue;
            }
            const [input, fuel, output] = te.slots;
            const result = input ? SMELTING.get(input.id) : undefined;
            const canSmelt = result !== undefined &&
                (!output || (output.id === result && output.count < ((ITEMS[result] && ITEMS[result].stack) || 64)));
            const wasBurning = te.burn > 0;
            if (te.burn > 0) {
                te.burn--;
            }
            if (te.burn === 0 && canSmelt && fuel && fuelTicks(fuel.id) > 0) {
                te.burn = te.burnMax = fuelTicks(fuel.id);
                const leaves = ITEMS[fuel.id].fuelLeaves;
                fuel.count--;
                if (fuel.count <= 0) {
                    te.slots[1] = leaves ? { id: leaves, count: 1 } : null;
                }
            }
            if (te.burn > 0 && canSmelt) {
                te.cook++;
                if (te.cook >= SMELT_TICKS) {
                    te.cook = 0;
                    input.count--;
                    if (input.count <= 0) {
                        te.slots[0] = null;
                    }
                    if (output) {
                        output.count++;
                    } else {
                        te.slots[2] = { id: result, count: 1 };
                    }
                }
            } else {
                te.cook = Math.max(0, te.cook - 2);
            }
            const burning = te.burn > 0;
            if (burning !== wasBurning) {
                const id = this.getBlock(p[0], p[1], p[2]);
                if (id === B.FURNACE || id === B.FURNACE_LIT) {
                    this.setBlock(p[0], p[1], p[2], burning ? B.FURNACE_LIT : B.FURNACE, this.getMeta(p[0], p[1], p[2]), false);
                }
            }
        }
    }

    /* ---------------- per tick ---------------- */

    tick(pcx, pcz) {
        this.tickCount++;
        this.runScheduled();
        if (this.tickCount % 20 === 0) {
            this.cropTick();
        }
        this.randomTicks(pcx, pcz, 6);
        this.tickFurnaces();
    }

    /* ---------------- raycast ---------------- */

    //Voxel walk from origin along dir; boxes(id, meta) gives hit boxes
    raycast(ox, oy, oz, dx, dy, dz, maxDist, boxes) {
        let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
        const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
        const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
        const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
        const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
        let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) * tDeltaX) : Infinity;
        let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) * tDeltaY) : Infinity;
        let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ) : Infinity;
        for (let guard = 0; guard < 64; guard++) {
            const id = this.getBlock(x, y, z);
            if (id !== B.AIR && y >= 0 && y < WORLD_H) {
                const box = boxes(id, this.getMeta(x, y, z), x, y, z);
                if (box) {
                    const hit = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, box);
                    if (hit && hit.t <= maxDist) {
                        return { x, y, z, id, meta: this.getMeta(x, y, z), face: hit.face, t: hit.t, box,
                            point: [ox + dx * hit.t, oy + dy * hit.t, oz + dz * hit.t] };
                    }
                }
            }
            if (tMaxX < tMaxY && tMaxX < tMaxZ) {
                if (tMaxX > maxDist) {
                    break;
                }
                x += stepX;
                tMaxX += tDeltaX;
            } else if (tMaxY < tMaxZ) {
                if (tMaxY > maxDist) {
                    break;
                }
                y += stepY;
                tMaxY += tDeltaY;
            } else {
                if (tMaxZ > maxDist) {
                    break;
                }
                z += stepZ;
                tMaxZ += tDeltaZ;
            }
        }
        return null;
    }

    /* ---------------- save data ---------------- */

    serialize() {
        const chunks = {};
        for (const [k, v] of this.saved) {
            chunks[keyName(k)] = v;
        }
        for (const c of this.chunks.values()) {
            if (c.modified && c.generated) {
                chunks[keyName(c.key)] = bytesToBase64(rleEncode(c.blocks, c.meta));
            }
        }
        const tileEntities = {};
        for (const [k, v] of this.tileEntities) {
            tileEntities[k] = v;
        }
        const crops = {};
        for (const [k, v] of this.cropProgress) {
            crops[k] = Math.round(v);
        }
        return { chunks, tileEntities, rules: Object.assign({}, this.rules), crops };
    }

    load(data) {
        this.saved.clear();
        if (data && data.chunks) {
            for (const name of Object.keys(data.chunks)) {
                const [cx, cz] = name.split(",").map(Number);
                this.saved.set(chunkKey(cx, cz), data.chunks[name]);
            }
        }
        this.rules = Object.assign({}, DEFAULT_RULES, (data && data.rules) || {});
        this.cropProgress = new Map(Object.entries((data && data.crops) || {}));
        this.tileEntities.clear();
        if (data && data.tileEntities) {
            for (const k of Object.keys(data.tileEntities)) {
                this.tileEntities.set(k, data.tileEntities[k]);
            }
        }
    }
}

function keyName(key) {
    return (Math.floor(key / 65536) - 32768) + "," + ((key % 65536) - 32768);
}

//Ray against an axis aligned box in block local space
function rayBox(ox, oy, oz, dx, dy, dz, b) {
    let tmin = -Infinity, tmax = Infinity, face = -1;
    const axes = [[ox, dx, b[0], b[3], 1, 0], [oy, dy, b[1], b[4], 3, 2], [oz, dz, b[2], b[5], 5, 4]];
    for (const [o, d, lo, hi, faceLo, faceHi] of axes) {
        if (Math.abs(d) < 1e-9) {
            if (o < lo || o > hi) {
                return null;
            }
            continue;
        }
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        let f1 = faceLo, f2 = faceHi;
        if (t1 > t2) {
            [t1, t2] = [t2, t1];
            [f1, f2] = [f2, f1];
        }
        if (t1 > tmin) {
            tmin = t1;
            face = f1;
        }
        if (t2 < tmax) {
            tmax = t2;
        }
        if (tmin > tmax) {
            return null;
        }
    }
    if (tmax < 0) {
        return null;
    }
    return { t: Math.max(0, tmin), face };
}

export { opacityOf, SEA, WORLD_H };
