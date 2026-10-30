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
    blockDrops, SMELTING, SMELT_TICKS, fuelTicks, ITEMS
} from "./blocks.js";
import { TerrainGen, WORLD_H, SEA, idx } from "./worldgen.js";
import { chunkKey, rleEncode, rleDecode, bytesToBase64, base64ToBytes, mulberry32 } from "./util.js";
import { FACE_DIR } from "./shapes.js";

export const SECTIONS = WORLD_H / 16;

const IS_SLAB = new Uint8Array(256);
const WASHABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    IS_SLAB[i] = SHAPE[i] === "slab" ? 1 : 0;
    WASHABLE[i] = (SHAPE[i] === "cross" || SHAPE[i] === "crop" || SHAPE[i] === "torch") && i !== B.REEDS ? 1 : 0;
}

function opacityOf(id, meta) {
    const o = LIGHT_OPACITY[id];
    if (o === 0 && IS_SLAB[id] === 1 && meta === 2) {
        return 15;
    }
    return o;
}

const DIRS = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];

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
        } else {
            this.gen.generate(c);
        }
        this.computeHeightmaps(c);
        c.generated = true;
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
        return true;
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
        if (id === B.WATER) {
            this.schedule(x, y, z, 5);
        } else if (def.gravity) {
            if (this.canFallInto(this.getBlock(x, y - 1, z))) {
                this.schedule(x, y, z, 2);
            }
        } else if (def.support) {
            this.schedule(x, y, z, 1);
        } else if (id === B.FARMLAND) {
            const above = this.getBlock(x, y + 1, z);
            if (isOpaqueAt(above, this.getMeta(x, y + 1, z))) {
                this.setBlock(x, y, z, B.DIRT);
            }
        }
    }

    canFallInto(id) {
        return id === B.AIR || id === B.WATER || WASHABLE[id] === 1;
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
                const n = FACE_DIR[meta] || FACE_DIR[2];
                const ax = x - n[0], ay = y - n[1], az = z - n[2];
                const aid = this.getBlock(ax, ay, az), am = this.getMeta(ax, ay, az);
                if (isOpaqueAt(aid, am)) {
                    return true;
                }
                //Torches also stand on top slabs
                return BLOCKS[id].support === "torch" && meta === 2 && IS_SLAB[aid] === 1 && am === 1;
            }
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
        if (id === B.AIR || id === B.WATER) {
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
        if (id === B.WATER) {
            this.waterTick(x, y, z, meta);
        } else if (def.gravity) {
            if (this.canFallInto(this.getBlock(x, y - 1, z)) && y > 0) {
                if (this.onFalling) {
                    this.setBlock(x, y, z, B.AIR, 0);
                    this.onFalling(x, y, z, id, meta);
                }
            }
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

    /* ---------------- water ---------------- */

    flowInto(x, y, z, level) {
        const id = this.getBlock(x, y, z);
        if (WASHABLE[id] === 1) {
            this.breakNaturally(x, y, z);
        }
        this.setBlock(x, y, z, B.WATER, level);
    }

    canFlow(id) {
        return id === B.AIR || WASHABLE[id] === 1;
    }

    waterTick(x, y, z, m) {
        if (m !== 0) {
            let newM;
            if (this.getBlock(x, y + 1, z) === B.WATER) {
                newM = 8;
            } else {
                let best = 99, sources = 0;
                for (let d = 0; d < 18; d += 3) {
                    if (DIRS[d + 1] !== 0) {
                        continue;
                    }
                    const nx = x + DIRS[d], nz = z + DIRS[d + 2];
                    if (this.getBlock(nx, y, nz) === B.WATER) {
                        const nm = this.getMeta(nx, y, nz);
                        if (nm === 0) {
                            sources++;
                        }
                        const eff = nm === 8 ? 0 : nm;
                        if (eff + 1 < best) {
                            best = eff + 1;
                        }
                    }
                }
                const below = this.getBlock(x, y - 1, z);
                if (sources >= 2 && (isOpaqueAt(below, this.getMeta(x, y - 1, z)) || (below === B.WATER && this.getMeta(x, y - 1, z) === 0))) {
                    newM = 0;
                } else {
                    newM = best <= 7 ? best : -1;
                }
            }
            if (newM === -1) {
                this.setBlock(x, y, z, B.AIR, 0);
                return;
            }
            if (newM !== m) {
                this.setBlock(x, y, z, B.WATER, newM);
                m = newM;
            }
        }
        const below = this.getBlock(x, y - 1, z);
        if (y > 0 && this.canFlow(below)) {
            this.flowInto(x, y - 1, z, 8);
            return;
        }
        if (below === B.WATER) {
            return;
        }
        const next = (m === 0 || m === 8) ? 1 : m + 1;
        if (next > 7) {
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
                this.flowInto(nx, y, nz, next);
            } else if (nid === B.WATER) {
                const nm = this.getMeta(nx, y, nz);
                if (nm !== 0 && nm !== 8 && nm > next) {
                    this.setBlock(nx, y, nz, B.WATER, next);
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
            for (let s = 0; s < SECTIONS; s++) {
                for (let k = 0; k < 3; k++) {
                    const r = (rng() * 4096) | 0;
                    const lx = r & 15, lz = (r >> 4) & 15, y = s * 16 + (r >> 8);
                    const id = c.blocks[(lx << 11) | (lz << 7) | y];
                    if (id === B.GRASS || id === B.SAPLING || id === B.WHEAT || id === B.FARMLAND || id === B.REEDS || id === B.CACTUS) {
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
        } else if (id === B.WHEAT) {
            if (meta < 7 && this.effectiveLight(x, y, z) >= 9) {
                const wet = this.getMeta(x, y - 1, z) > 0;
                if (rng() < (wet ? 0.3 : 0.12)) {
                    this.setBlock(x, y, z, B.WHEAT, meta + 1, false);
                }
            }
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
                fuel.count--;
                if (fuel.count <= 0) {
                    te.slots[1] = null;
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
                const box = boxes(id, this.getMeta(x, y, z));
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
        return { chunks, tileEntities };
    }

    load(data) {
        this.saved.clear();
        if (data && data.chunks) {
            for (const name of Object.keys(data.chunks)) {
                const [cx, cz] = name.split(",").map(Number);
                this.saved.set(chunkKey(cx, cz), data.chunks[name]);
            }
        }
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
