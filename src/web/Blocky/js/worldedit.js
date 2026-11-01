/*
    Blocky - worldedit.js

    WorldEdit style building tools for creative mode, switched on in
    Settings > WorldEdit. A cuboid selection (//pos1 //pos2, or the wand:
    a wooden axe, left click / right click), region operations, generated
    shapes, a clipboard that rotates and flips, and undo / redo. The chat
    commands that drive all this are in wecommands.js.

    Edits do not go through world.setBlock (which drops chest contents,
    reshapes rails and runs physics). An EditSession writes straight into
    the chunk arrays and logs every change - chunk, index, old and new
    block - so an operation can be undone as a whole. The first
    IMMEDIATE_CELLS changes are relit one by one like setBlock; past that
    the session switches to bulk mode and relights at the end: every lit
    chunk touched or next to a touched one has its light cleared and
    computed again, then the light of the lit chunks around them flows back
    in. Light travels at most 15 blocks, less than a chunk, so nothing
    further away can change.

    Edited blocks get no physics of their own (pasted sand floats, as in
    the original tool), but unchanged blocks next to an edit are told about
    it, so water flows into a hole and sand above it falls. Liquids at the
    edge of an edit, fire and spark parts are scheduled so they carry on.
*/

import { B, I, BLOCKS, SHAPE, SOLID, HDIR, toolId, facingFromYaw } from "./blocks.js";
import { Chunk, WORLD_H, TE_SLOTS } from "./world.js";
import { FACE_DIR, doorHinge, selectionBox } from "./shapes.js";
import { POWER } from "./power.js";
import { chunkKey, clamp } from "./util.js";
import { compileExpression, ExprError } from "./weexpr.js";

export class EditError extends Error {}

export const fail = (msg) => {
    throw new EditError(msg);
};

//The selection wand is the wooden axe
export const WAND = toolId(0, 1);
export const DEFAULT_LIMIT = 1000000;
export const MAX_LIMIT = 8000000;
const IMMEDIATE_CELLS = 2048;
//Compass and navigation commands: how far a jump reaches and how thick a
//wall, floor or ceiling can be passed through
export const JUMP_RANGE = 128;
export const THRU_DEPTH = 12;
const HISTORY_STEPS = 25;
const HISTORY_CELLS = 12000000;
const CHUNK_CELLS = 16 * 16 * WORLD_H;

export const fmt = (n) => Number(n).toLocaleString("en-US");
export const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

/* ---------------- tile entities ---------------- */

const TE_TYPE = new Array(256).fill(null);
TE_TYPE[B.FURNACE] = TE_TYPE[B.FURNACE_LIT] = "furnace";
TE_TYPE[B.CHEST] = "chest";
TE_TYPE[B.DISPENSER] = "dispenser";
TE_TYPE[B.FEEDER] = "feeder";
TE_TYPE[B.SIGN] = TE_TYPE[B.WALL_SIGN] = "sign";

//Blocks whose position may be a key in the world's power maps
const KEYED = new Uint8Array(256);
for (const id of [B.DOOR, B.TRAPDOOR, B.BUTTON, B.PLATE_WOOD, B.PLATE_STONE, B.RETIMER, B.RETIMER_ON, B.DETECTOR_RAIL]) {
    KEYED[id] = 1;
}

//Sign text planes redraw when `ver` changes; every sign written here gets a new one
let signVer = 1000000;

function defaultTE(type) {
    if (type === "furnace") {
        return { type, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
    }
    if (TE_SLOTS[type]) {
        return { type, slots: new Array(TE_SLOTS[type]).fill(null) };
    }
    return { type, lines: ["", "", "", ""], ver: 0 };
}

export function cloneTE(te) {
    return te ? JSON.parse(JSON.stringify(te)) : te;
}

const NB = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];

/* ---------------- edit sessions ---------------- */

export class EditSession {
    constructor(world, opts = {}) {
        this.world = world;
        this.limit = opts.limit || Infinity;
        //Replaying history: tile entities are restored separately
        this.raw = !!opts.raw;
        this.n = 0;
        this.cap = 0;
        this.refs = null;
        this.idx = null;
        this.oid = null;
        this.om = null;
        this.nid = null;
        this.nm = null;
        this.refOf = new Map();
        this.chunks = [];
        this.teLog = [];
        this.bulk = false;
        this.skipped = 0;
        this.lastC = null;
        this.lastRef = -1;
    }

    grow() {
        const cap = Math.max(4096, this.cap * 2);
        const up = (a, T) => {
            const b = new T(cap);
            if (a) {
                b.set(a);
            }
            return b;
        };
        this.refs = up(this.refs, Uint16Array);
        this.idx = up(this.idx, Uint16Array);
        this.oid = up(this.oid, Uint8Array);
        this.om = up(this.om, Uint8Array);
        this.nid = up(this.nid, Uint8Array);
        this.nm = up(this.nm, Uint8Array);
        this.cap = cap;
    }

    //Write one block. te: the tile entity to give it (cloned), or
    //undefined for the default (a container keeps its contents when the
    //same kind of block replaces it, otherwise starts empty)
    set(x, y, z, id, meta = 0, te) {
        if (y < 0 || y >= WORLD_H) {
            return false;
        }
        const cx = x >> 4, cz = z >> 4;
        let c = this.lastC;
        if (c === null || c.cx !== cx || c.cz !== cz) {
            c = this.world.chunkAt(cx, cz);
            if (c === undefined || !c.generated) {
                this.skipped++;
                return false;
            }
            let ref = this.refOf.get(c.key);
            if (ref === undefined) {
                ref = this.chunks.length;
                this.refOf.set(c.key, ref);
                this.chunks.push(c);
            }
            this.lastC = c;
            this.lastRef = ref;
        }
        const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
        const oldId = c.blocks[i], oldMeta = c.meta[i];
        if (oldId === id && oldMeta === meta && !te) {
            return false;
        }
        if (this.n >= this.limit) {
            fail(`Stopped at the limit of ${fmt(this.limit)} changed blocks (//limit).`);
        }
        if (this.n === this.cap) {
            this.grow();
        }
        const n = this.n++;
        this.refs[n] = this.lastRef;
        this.idx[n] = i;
        this.oid[n] = oldId;
        this.om[n] = oldMeta;
        this.nid[n] = id;
        this.nm[n] = meta;
        c.blocks[i] = id;
        c.meta[i] = meta;
        c.modified = true;
        const w = this.world;
        if (oldId !== id) {
            if (oldId === B.WHEAT) {
                c.crops.delete(i);
                w.cropProgress.delete(x + "," + y + "," + z);
            }
            if (id === B.WHEAT) {
                c.crops.add(i);
            }
            if (KEYED[oldId]) {
                const k = x + "," + y + "," + z;
                w.doorPowered.delete(k);
                w.buttonDue.delete(k);
                w.retimerDue.delete(k);
            }
        }
        if (!this.raw && (TE_TYPE[oldId] || TE_TYPE[id] || te)) {
            this.tile(x, y, z, id, te);
        }
        if (!this.bulk) {
            w.updateHeightmaps(c, x & 15, y, z & 15);
            if (c.lit) {
                w.relight(x, y, z, oldId, oldMeta, id, meta);
            }
            w.markDirtyAround(x, y, z, c);
            if (this.n >= IMMEDIATE_CELLS) {
                this.bulk = true;
            }
        }
        return true;
    }

    tile(x, y, z, id, te) {
        const w = this.world, key = w.teKey(x, y, z);
        const before = w.tileEntities.get(key);
        const type = TE_TYPE[id];
        let after;
        if (!type) {
            after = undefined;
        } else if (te && te.type === type) {
            after = cloneTE(te);
        } else if (before && before.type === type) {
            return;
        } else {
            after = defaultTE(type);
        }
        if (after === undefined && before === undefined) {
            return;
        }
        if (after && after.type === "sign") {
            after.ver = ++signVer;
        }
        if (after) {
            w.tileEntities.set(key, after);
        } else {
            w.tileEntities.delete(key);
        }
        this.teLog.push({ key, before, after });
    }

    replayTE(key, te) {
        const w = this.world;
        const before = w.tileEntities.get(key);
        if (te) {
            if (te.type === "sign") {
                te.ver = ++signVer;
            }
            w.tileEntities.set(key, te);
        } else {
            w.tileEntities.delete(key);
        }
        this.teLog.push({ key, before, after: te });
    }

    //Finish: relight, tell the neighbours, and return the undo record
    commit() {
        const w = this.world, n = this.n;
        if (n > 0) {
            if (this.bulk) {
                for (const c of this.chunks) {
                    w.computeHeightmaps(c);
                }
                relightChunks(w, this.chunks);
            }
            this.afterEffects();
        }
        const cut = (a, T) => (a ? a.slice(0, n) : new T(0));
        return {
            n,
            keys: this.chunks.map((c) => c.key),
            refs: cut(this.refs, Uint16Array),
            idx: cut(this.idx, Uint16Array),
            oid: cut(this.oid, Uint8Array),
            om: cut(this.om, Uint8Array),
            nid: cut(this.nid, Uint8Array),
            nm: cut(this.nm, Uint8Array),
            te: this.teLog
        };
    }

    afterEffects() {
        const w = this.world, chunks = this.chunks;
        const marks = chunks.map(() => new Uint8Array(CHUNK_CELLS));
        for (let k = 0; k < this.n; k++) {
            marks[this.refs[k]][this.idx[k]] = 1;
        }
        const marked = (x, y, z, c, r) => {
            const cx = x >> 4, cz = z >> 4;
            let m = marks[r];
            if (cx !== c.cx || cz !== c.cz) {
                const nr = this.refOf.get(chunkKey(cx, cz));
                if (nr === undefined) {
                    return 0;
                }
                m = marks[nr];
            }
            return m[((x & 15) << 11) | ((z & 15) << 7) | y];
        };
        for (let k = 0; k < this.n; k++) {
            const r = this.refs[k], i = this.idx[k], m = marks[r];
            if (m[i] !== 1) {
                continue;
            }
            m[i] = 2;
            const c = chunks[r];
            const x = c.cx * 16 + (i >> 11), y = i & 127, z = c.cz * 16 + ((i >> 7) & 15);
            const id = c.blocks[i];
            let edge = false;
            for (let d = 0; d < 18; d += 3) {
                const nx = x + NB[d], ny = y + NB[d + 1], nz = z + NB[d + 2];
                if (ny < 0 || ny >= WORLD_H || marked(nx, ny, nz, c, r)) {
                    continue;
                }
                edge = true;
                w.neighborChanged(nx, ny, nz);
            }
            if (id === B.FIRE) {
                w.schedule(x, y, z, 30 + Math.floor(w.rng() * 10));
            } else if ((id === B.WATER || id === B.LAVA) && (edge || c.meta[i] !== 0)) {
                w.schedule(x, y, z, id === B.WATER ? 5 : 30);
            } else if (POWER[id]) {
                w.schedule(x, y, z, 2);
            }
        }
    }
}

//Recompute the light of the touched chunks and the lit chunks around them
function relightChunks(w, touched) {
    const area = new Map();
    for (const c of touched) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const n = w.chunkAt(c.cx + dx, c.cz + dz);
                if (n !== undefined && n.lit) {
                    area.set(n.key, n);
                }
            }
        }
    }
    for (const c of area.values()) {
        c.light.fill(0);
    }
    for (const c of area.values()) {
        w.lightChunk(c);
    }
    //Light coming in from the lit chunks just outside
    const sky = [], blk = [];
    for (const c of area.values()) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = w.chunkAt(c.cx + dx, c.cz + dz);
            if (n === undefined || !n.lit || area.has(n.key)) {
                continue;
            }
            for (let t = 0; t < 16; t++) {
                const ax = dx === 1 ? 0 : dx === -1 ? 15 : t;
                const az = dz === 1 ? 0 : dz === -1 ? 15 : t;
                const gx = n.cx * 16 + ax, gz = n.cz * 16 + az;
                const base = (ax << 11) | (az << 7);
                for (let y = 0; y < WORLD_H; y++) {
                    const l = n.light[base | y];
                    if ((l >> 4) > 1) {
                        sky.push(gx, y, gz);
                    }
                    if ((l & 15) > 1) {
                        blk.push(gx, y, gz);
                    }
                }
            }
        }
    }
    w.propagate(sky, true);
    w.propagate(blk, false);
    for (const c of touched) {
        if (!c.lit) {
            c.dirty.fill(1);
        }
    }
}

//Apply a record backwards; returns the record that undoes this again
function replay(world, rec) {
    const chunks = rec.keys.map((k) => world.chunks.get(k));
    if (chunks.some((c) => !c || !c.generated)) {
        fail("Part of that edit is not loaded any more. Go back there first.");
    }
    const s = new EditSession(world, { raw: true });
    for (let k = rec.n - 1; k >= 0; k--) {
        const c = chunks[rec.refs[k]], i = rec.idx[k];
        s.set(c.cx * 16 + (i >> 11), i & 127, c.cz * 16 + ((i >> 7) & 15), rec.oid[k], rec.om[k]);
    }
    for (let k = rec.te.length - 1; k >= 0; k--) {
        s.replayTE(rec.te[k].key, rec.te[k].before);
    }
    return s.commit();
}

/* ---------------- boxes ---------------- */

export class Box {
    constructor(x0, y0, z0, x1, y1, z1) {
        this.x0 = Math.min(x0, x1);
        this.y0 = Math.min(y0, y1);
        this.z0 = Math.min(z0, z1);
        this.x1 = Math.max(x0, x1);
        this.y1 = Math.max(y0, y1);
        this.z1 = Math.max(z0, z1);
    }

    static of(a, b) {
        return new Box(a[0], a[1], a[2], b[0], b[1], b[2]);
    }

    get sx() {
        return this.x1 - this.x0 + 1;
    }

    get sy() {
        return this.y1 - this.y0 + 1;
    }

    get sz() {
        return this.z1 - this.z0 + 1;
    }

    get volume() {
        return this.sx * this.sy * this.sz;
    }

    //Clipped to the world's height
    clipped() {
        return new Box(this.x0, clamp(this.y0, 0, WORLD_H - 1), this.z0, this.x1, clamp(this.y1, 0, WORLD_H - 1), this.z1);
    }

    contains(x, y, z) {
        return x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1 && z >= this.z0 && z <= this.z1;
    }
}

/* ---------------- block names, patterns and masks ---------------- */

const keyOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const BLOCK_ALIASES = {
    grass: B.GRASS, crafting_table: B.WORKBENCH, table: B.WORKBENCH, cobble: B.COBBLE, wood: B.LOG,
    sugar_cane: B.REEDS, mossy_cobble: B.MOSSY_COBBLE, white_wool: B.WOOL, lit_furnace: B.FURNACE_LIT,
    furnace_lit: B.FURNACE_LIT, standing_sign: B.SIGN, wall_sign: B.WALL_SIGN, spark_torch_off: B.SPARK_TORCH_OFF,
    spark_lamp_on: B.SPARK_LAMP_ON, retimer_on: B.RETIMER_ON, piston_head: B.PISTON_HEAD,
    plank_stairs: B.PLANK_STAIRS, wood_stairs: B.PLANK_STAIRS, cobble_stairs: B.COBBLE_STAIRS,
    iron_block: B.IRON_BLOCK, gold_block: B.GOLD_BLOCK, crystal_block: B.CRYSTAL_BLOCK, spark_block: B.SPARK_BLOCK
};

let blockKeys = null;

export function blockNames() {
    if (!blockKeys) {
        blockKeys = new Map();
        for (let id = 0; id < 256; id++) {
            const b = BLOCKS[id];
            if (b && b.name !== "Unknown") {
                const k = keyOf(b.name);
                if (!blockKeys.has(k)) {
                    blockKeys.set(k, id);
                }
            }
        }
        for (const [k, id] of Object.entries(BLOCK_ALIASES)) {
            if (!blockKeys.has(k)) {
                blockKeys.set(k, id);
            }
        }
    }
    return blockKeys;
}

function blockByName(text) {
    const raw = String(text).trim();
    if (/^\d+$/.test(raw)) {
        const id = Number(raw);
        return id < 256 && BLOCKS[id].name !== "Unknown" ? id : null;
    }
    if (!/^[a-z0-9_ -]+$/i.test(raw)) {
        return null;
    }
    const t = keyOf(raw);
    const map = blockNames();
    if (map.has(t)) {
        return map.get(t);
    }
    const hits = [...map.keys()].filter((k) => k.startsWith(t) || k.endsWith("_" + t));
    const ids = [...new Set(hits.map((k) => map.get(k)))];
    return ids.length === 1 ? ids[0] : null;
}

//"name", "name:meta", a block id, or "hand" (the held block). meta is -1
//when not given.
export function parseBlock(text, game) {
    const m = String(text).match(/^(.*?)(?::(\d+))?$/);
    const name = m[1], meta = m[2] === undefined ? -1 : Number(m[2]);
    if (meta > 255) {
        fail(`Block data "${m[2]}" is out of range (0-255)`);
    }
    let id;
    if (name.toLowerCase() === "hand") {
        id = game.inventory.heldId();
        if (!(id > 0 && id < 256)) {
            fail("You are not holding a block");
        }
    } else {
        id = blockByName(name);
        if (id === null) {
            fail(`Unknown block "${name}"`);
        }
    }
    return { id, meta };
}

//A pattern: "stone", "stone,dirt" (even mix) or "30%dirt,70%grass".
//Returns a function giving the next block as id | meta << 8.
export function parsePattern(text, game) {
    if (!text) {
        fail("Give a block pattern, e.g. stone or 30%dirt,70%grass_block");
    }
    const entries = String(text).split(",").filter(Boolean).map((part) => {
        if (/%$/.test(part)) {
            fail(`"${part}" needs a block after the %, e.g. 50%stone`);
        }
        const m = part.match(/^(\d+(?:\.\d+)?)%(.+)$/);
        const b = parseBlock(m ? m[2] : part, game);
        return { v: b.id | (Math.max(0, b.meta) << 8), weight: m ? Number(m[1]) : 1 };
    });
    if (!entries.length) {
        fail(`"${text}" is not a pattern`);
    }
    if (entries.length === 1) {
        const v = entries[0].v;
        return () => v;
    }
    const total = entries.reduce((a, e) => a + e.weight, 0);
    if (!(total > 0)) {
        fail("The pattern's percentages add up to nothing");
    }
    return () => {
        let r = Math.random() * total;
        for (const e of entries) {
            r -= e.weight;
            if (r < 0) {
                return e.v;
            }
        }
        return entries[entries.length - 1].v;
    };
}

const NATURAL = new Set([B.STONE, B.GRASS, B.DIRT]);

//A mask: block names (any of them), "!" in front negates the whole list,
//and #existing (not air), #solid, #liquid, #natural (stone, dirt, grass).
//Returns (id, meta) => boolean.
export function parseMask(text, game) {
    let src = String(text || "");
    const neg = src.startsWith("!");
    if (neg) {
        src = src.slice(1);
    }
    const tests = src.split(",").filter(Boolean).map((term) => {
        switch (term.toLowerCase()) {
            case "#existing":
                return (id) => id !== B.AIR;
            case "#solid":
                return (id) => SOLID[id] === 1;
            case "#liquid":
                return (id) => id === B.WATER || id === B.LAVA;
            case "#natural":
                return (id) => NATURAL.has(id);
            default: {
                const b = parseBlock(term, game);
                return b.meta < 0 ? (id) => id === b.id : (id, meta) => id === b.id && meta === b.meta;
            }
        }
    });
    if (!tests.length) {
        fail(`"${text}" is not a mask`);
    }
    const any = tests.length === 1 ? tests[0] : (id, meta) => tests.some((t) => t(id, meta));
    return neg ? (id, meta) => !any(id, meta) : any;
}

export function compile(src) {
    try {
        return compileExpression(src);
    } catch (e) {
        if (e instanceof ExprError) {
            fail("Expression: " + e.message);
        }
        throw e;
    }
}

/* ---------------- turning blocks with the clipboard ---------------- */

//3 x 3 integer matrices, row major; p' = M p
const ROT_Y = [0, 0, -1, 0, 1, 0, 1, 0, 0];  //clockwise seen from above: north -> east
const ROT_X = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const ROT_Z = [0, -1, 0, 1, 0, 0, 0, 0, 1];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function mul(M, x, y, z) {
    return [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
}

function matMul(A, Bm) {
    const out = new Array(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            out[r * 3 + c] = A[r * 3] * Bm[c] + A[r * 3 + 1] * Bm[3 + c] + A[r * 3 + 2] * Bm[6 + c];
        }
    }
    return out;
}

function power(M, steps) {
    let out = IDENTITY;
    for (let i = 0; i < steps; i++) {
        out = matMul(M, out);
    }
    return out;
}

//Rotation in degrees (multiples of 90) about y, then x, then z
export function rotationMatrix(ry, rx, rz) {
    const steps = (deg) => {
        if (!Number.isFinite(deg) || deg % 90 !== 0) {
            fail("Rotations must be multiples of 90 degrees");
        }
        return (((deg / 90) % 4) + 4) % 4;
    };
    return matMul(power(ROT_Z, steps(rz)), matMul(power(ROT_X, steps(rx)), power(ROT_Y, steps(ry))));
}

export function flipMatrix(dir) {
    return [dir[0] ? -1 : 1, 0, 0, 0, dir[1] ? -1 : 1, 0, 0, 0, dir[2] ? -1 : 1];
}

//Meta kinds: a face index in bits 0-2 (1: any face, 2: sides only, 3: not
//hanging from a ceiling, 4: never up - a feeder's spout), or a horizontal
//facing (HDIR) in bits 0-1
const FACE_KIND = new Uint8Array(256);
FACE_KIND[B.FEEDER] = 4;
for (const id of [B.LEVER, B.BUTTON, B.PISTON, B.STICKY_PISTON, B.PISTON_HEAD, B.DISPENSER]) {
    FACE_KIND[id] = 1;
}
for (const id of [B.LADDER, B.WALL_SIGN, B.FURNACE, B.FURNACE_LIT, B.CHEST]) {
    FACE_KIND[id] = 2;
}
for (const id of [B.TORCH, B.SPARK_TORCH, B.SPARK_TORCH_OFF]) {
    FACE_KIND[id] = 3;
}
const HDIR_KIND = new Uint8Array(256);
for (let id = 0; id < 256; id++) {
    if (SHAPE[id] === "stairs" || [B.FENCE_GATE, B.RETIMER, B.RETIMER_ON, B.BED, B.DOOR, B.TRAPDOOR].includes(id)) {
        HDIR_KIND[id] = 1;
    }
}

//Rail shapes (power.js): the FLAT sides each leads out of; 2-5 rise toward 2 + side
const FLAT = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const RAIL_ENDS = [[2, 3], [0, 1], [0, 1], [0, 1], [2, 3], [2, 3], [2, 0], [2, 1], [3, 1], [3, 0]];

const faceIndex = (v) => FACE_DIR.findIndex((d) => d[0] === v[0] && d[1] === v[1] && d[2] === v[2]);
const hdirIndex = (x, z) => HDIR.findIndex((d) => d[0] === x && d[1] === z);
const flatIndex = (x, z) => FLAT.findIndex((d) => d[0] === x && d[1] === z);

//A block's meta after the clipboard is turned or mirrored by M. Facings
//that cannot be expressed (a stair lying on its side) are left alone.
export function transformMeta(id, meta, M) {
    const yStays = M[4] !== 0, flipY = M[4] === -1;
    const fk = FACE_KIND[id];
    if (fk) {
        const f = meta & 7;
        if (f > 5) {
            return meta;
        }
        const nf = faceIndex(mul(M, ...FACE_DIR[f]));
        if (nf < 0 || (fk === 2 && (nf === 2 || nf === 3)) || (fk === 3 && nf === 3) || (fk === 4 && nf === 2)) {
            return meta;
        }
        return (meta & ~7) | nf;
    }
    if (HDIR_KIND[id]) {
        if (!yStays) {
            return meta;
        }
        const h = HDIR[meta & 3], v = mul(M, h[0], 0, h[1]);
        const nh = hdirIndex(v[0], v[2]);
        if (nh < 0) {
            return meta;
        }
        let m = (meta & ~3) | nh;
        if (SHAPE[id] === "stairs" && flipY) {
            m ^= 4;
        }
        if (id === B.TRAPDOOR && flipY) {
            m ^= 8;
        }
        if (id === B.DOOR) {
            //The hinge goes where M takes it: a mirror swaps its side
            const hv = HDIR[doorHinge(meta)], r = mul(M, hv[0], 0, hv[1]);
            const hinge = hdirIndex(r[0], r[2]);
            m &= ~16;
            if (doorHinge(m) !== hinge) {
                m |= 16;
            }
            if (flipY) {
                m ^= 8;
            }
        }
        return m;
    }
    if (SHAPE[id] === "slab") {
        return flipY && meta < 2 ? meta ^ 1 : meta;
    }
    if (id === B.SIGN) {
        if (!yStays) {
            return meta;
        }
        const a = (meta & 15) * Math.PI / 8;
        const v = mul(M, Math.sin(a), 0, Math.cos(a));
        const step = Math.round(Math.atan2(v[0], v[2]) / (Math.PI / 8));
        return (meta & ~15) | (((step % 16) + 16) % 16);
    }
    if (SHAPE[id] === "rail") {
        if (!yStays) {
            return meta;
        }
        const bits = id === B.RAIL ? 15 : 7;
        const shape = meta & bits, keep = meta & ~bits;
        const turn = (k) => {
            const v = mul(M, FLAT[k][0], 0, FLAT[k][1]);
            return flatIndex(v[0], v[2]);
        };
        if (shape >= 2 && shape <= 5) {
            let up = turn(shape - 2);
            if (flipY) {
                up ^= 1;
            }
            return keep | (2 + up);
        }
        const ends = (RAIL_ENDS[shape] || RAIL_ENDS[0]).map(turn);
        for (const s of [0, 1, 6, 7, 8, 9]) {
            const e = RAIL_ENDS[s];
            if (e.includes(ends[0]) && e.includes(ends[1])) {
                return keep | s;
            }
        }
        return meta;
    }
    return meta;
}

/* ---------------- directions ---------------- */

const NAMED_DIRS = {
    north: [0, 0, -1], n: [0, 0, -1], south: [0, 0, 1], s: [0, 0, 1], east: [1, 0, 0], e: [1, 0, 0],
    west: [-1, 0, 0], w: [-1, 0, 0], up: [0, 1, 0], u: [0, 1, 0], down: [0, -1, 0], d: [0, -1, 0]
};
export const DIRECTION_WORDS = ["me", "forward", "back", "left", "right", "up", "down", "north", "south", "east", "west"];

//The way the player looks, snapped to an axis (up / down past 67.5 degrees)
export function facingVector(player, vertical = true) {
    if (vertical && player.pitch > Math.PI * 3 / 8) {
        return [0, 1, 0];
    }
    if (vertical && player.pitch < -Math.PI * 3 / 8) {
        return [0, -1, 0];
    }
    const h = HDIR[facingFromYaw(player.yaw)];
    return [h[0], 0, h[1]];
}

//A direction word, or "x,y,z" (vector: true)
export function parseDirection(token, player) {
    const t = String(token || "me").toLowerCase();
    if (/^-?\d+,-?\d+,-?\d+$/.test(t)) {
        return { v: t.split(",").map(Number), vector: true };
    }
    if (NAMED_DIRS[t]) {
        return { v: NAMED_DIRS[t].slice(), vector: false };
    }
    const f = facingVector(player);
    switch (t) {
        case "me": case "forward": case "f": case "ahead":
            return { v: f, vector: false };
        case "back": case "b": case "backward":
            return { v: f.map((c) => -c), vector: false };
        case "left": case "l": case "right": case "r": {
            const h = facingVector(player, false);
            const right = [-h[2], 0, h[0]];
            return { v: t[0] === "r" ? right : right.map((c) => -c), vector: false };
        }
        default:
            fail(`Unknown direction "${token}". Use north, south, east, west, up, down, me, back, left, right or x,y,z`);
    }
    return null;
}

/* ---------------- shapes ---------------- */

//Ellipsoid cells around the origin (the original tool's rounding: radii + 0.5)
function sphereCells(rx, ry, rz, filled, emit) {
    rx += 0.5;
    ry += 0.5;
    rz += 0.5;
    const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz;
    const cx = Math.ceil(rx), cy = Math.ceil(ry), cz = Math.ceil(rz);
    const len = (a, b, c) => a * a + b * b + c * c;
    let nextXn = 0;
    forX: for (let x = 0; x <= cx; x++) {
        const xn = nextXn;
        nextXn = (x + 1) * ix;
        let nextYn = 0;
        forY: for (let y = 0; y <= cy; y++) {
            const yn = nextYn;
            nextYn = (y + 1) * iy;
            let nextZn = 0;
            for (let z = 0; z <= cz; z++) {
                const zn = nextZn;
                nextZn = (z + 1) * iz;
                if (len(xn, yn, zn) > 1) {
                    if (z === 0) {
                        if (y === 0) {
                            break forX;
                        }
                        break forY;
                    }
                    break;
                }
                if (!filled && len(nextXn, yn, zn) <= 1 && len(xn, nextYn, zn) <= 1 && len(xn, yn, nextZn) <= 1) {
                    continue;
                }
                for (const sx of x ? [1, -1] : [1]) {
                    for (const sy of y ? [1, -1] : [1]) {
                        for (const sz of z ? [1, -1] : [1]) {
                            emit(x * sx, y * sy, z * sz);
                        }
                    }
                }
            }
        }
    }
}

function circleCells(rx, rz, filled, emit) {
    rx += 0.5;
    rz += 0.5;
    const ix = 1 / rx, iz = 1 / rz;
    const cx = Math.ceil(rx), cz = Math.ceil(rz);
    let nextXn = 0;
    forX: for (let x = 0; x <= cx; x++) {
        const xn = nextXn;
        nextXn = (x + 1) * ix;
        let nextZn = 0;
        for (let z = 0; z <= cz; z++) {
            const zn = nextZn;
            nextZn = (z + 1) * iz;
            if (xn * xn + zn * zn > 1) {
                if (z === 0) {
                    break forX;
                }
                break;
            }
            if (!filled && nextXn * nextXn + zn * zn <= 1 && xn * xn + nextZn * nextZn <= 1) {
                continue;
            }
            for (const sx of x ? [1, -1] : [1]) {
                for (const sz of z ? [1, -1] : [1]) {
                    emit(x * sx, z * sz);
                }
            }
        }
    }
}

/* ---------------- the per-world tool ---------------- */

export class WorldEdit {
    constructor(game) {
        this.game = game;
        this.pos1 = null;
        this.pos2 = null;
        this.clipboard = null;
        this.undoStack = [];
        this.redoStack = [];
        this.limit = DEFAULT_LIMIT;
        this.wandOn = true;
        this.drawn = "";
    }

    get world() {
        return this.game.world;
    }

    //Commands and the wand work in creative with the setting on
    get active() {
        return !!this.game.settings.worldEdit && this.game.creative;
    }

    blockPos() {
        const p = this.game.player;
        return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    }

    say(text, kind = "ok") {
        this.game.app.chat.add(text, kind);
    }

    /* ---------- selection ---------- */

    setPos(n, pos) {
        const v = [Math.floor(pos[0]), clamp(Math.floor(pos[1]), 0, WORLD_H - 1), Math.floor(pos[2])];
        if (n === 1) {
            this.pos1 = v;
        } else {
            this.pos2 = v;
        }
        const size = this.pos1 && this.pos2 ? ` (${plural(this.region().volume, "block")})` : "";
        return `${n === 1 ? "First" : "Second"} position set to (${v.join(", ")})${size}.`;
    }

    clearSelection() {
        this.pos1 = null;
        this.pos2 = null;
    }

    region() {
        if (!this.pos1 || !this.pos2) {
            fail("Make a selection first: //pos1 and //pos2, or the wand (//wand: left click, right click).");
        }
        return Box.of(this.pos1, this.pos2);
    }

    //The block the player looks at, up to 160 blocks away
    targetBlock(range = 160) {
        const g = this.game, w = this.world;
        const [ox, oy, oz, dx, dy, dz] = g.eyeRay();
        return w.raycast(ox, oy, oz, dx, dy, dz, range, (id, m, x, y, z) => selectionBox(id, m, w, x, y, z));
    }

    wandHeld() {
        return this.active && this.wandOn && this.game.inventory.heldId() === WAND;
    }

    //A wand click: the block under the crosshair, or further away
    wandClick(n, hit) {
        const h = hit || this.targetBlock(128);
        if (!h) {
            this.say("No block in sight", "error");
            return;
        }
        this.say(this.setPos(n, [h.x, h.y, h.z]));
    }

    /* ---------- navigation (the compass, /jumpto, /thru ...) ---------- */

    compassHeld() {
        return this.active && this.game.inventory.heldId() === I.COMPASS;
    }

    compassClick(right, hit) {
        try {
            if (right && hit) {
                this.thru(hit);
            } else {
                this.jumpTo();
            }
        } catch (e) {
            if (!(e instanceof EditError)) {
                throw e;
            }
            this.say(e.message, "error");
        }
    }

    //Room for the player: feet and head cells without collision
    fits(x, y, z) {
        const w = this.world;
        return y >= 0 && y + 1 < WORLD_H && !SOLID[w.getBlock(x, y, z)] && !SOLID[w.getBlock(x, y + 1, z)];
    }

    moveTo(x, y, z) {
        const g = this.game;
        if (g.riding || g.boat) {
            fail("Get out of the cart or boat first.");
        }
        g.teleport(x + 0.5, y, z + 0.5);
        return `Moved to (${x}, ${y}, ${z}).`;
    }

    //Onto the block in sight: the first spot with room to stand from it up,
    //so aiming at a wall lands on top of it
    jumpTo() {
        const hit = this.targetBlock(JUMP_RANGE);
        if (!hit) {
            fail(`No block in sight within ${JUMP_RANGE} blocks.`);
        }
        for (let y = SOLID[hit.id] ? hit.y + 1 : hit.y; y < WORLD_H - 1; y++) {
            if (this.fits(hit.x, y, hit.z)) {
                return this.moveTo(hit.x, y, hit.z);
            }
        }
        fail("There is no room to stand there.");
        return "";
    }

    //Through the wall, floor or ceiling of the block hit, away from the face
    //looked at: walls at your own height, floors down to the floor below,
    //ceilings up onto the roof
    thru(hit) {
        const n = FACE_DIR[hit.face], d = [-n[0], -n[1], -n[2]];
        if (d[1] === 0) {
            const y = this.blockPos()[1];
            let x = hit.x, z = hit.z;
            for (let i = 0; i < THRU_DEPTH; i++) {
                x += d[0];
                z += d[2];
                if (this.fits(x, y, z)) {
                    return this.moveTo(x, y, z);
                }
            }
        } else {
            let y = hit.y;
            for (let i = 0; i <= THRU_DEPTH; i++) {
                y += d[1];
                if (y < 0 || y >= WORLD_H - 1) {
                    break;
                }
                if (this.fits(hit.x, y, hit.z)) {
                    //Below a floor, drop to the ground of the room under it
                    while (d[1] < 0 && y > 0 && !SOLID[this.world.getBlock(hit.x, y - 1, hit.z)]) {
                        y--;
                    }
                    return this.moveTo(hit.x, y, hit.z);
                }
            }
        }
        fail(`No room to stand within ${THRU_DEPTH} blocks behind that.`);
        return "";
    }

    //The next floor above (levels > 0) or below with room to stand
    climb(levels, up) {
        const [x, y0, z] = this.blockPos();
        const w = this.world;
        const floor = (y) => this.fits(x, y, z) && y > 0 && SOLID[w.getBlock(x, y - 1, z)];
        let found = -1, left = levels;
        if (up) {
            for (let y = y0 + 1; y < WORLD_H - 1 && left > 0; y++) {
                if (floor(y)) {
                    found = y;
                    left--;
                }
            }
        } else {
            for (let y = y0 - 3; y > 0 && left > 0; y--) {
                if (floor(y)) {
                    found = y;
                    left--;
                    y -= 2;
                }
            }
        }
        if (found < 0) {
            fail(`No free spot ${up ? "above" : "below"} you.`);
        }
        return this.moveTo(x, found, z);
    }

    //Straight up, onto a glass block put under you when there is nothing
    up(dist) {
        const [x, y0, z] = this.blockPos();
        const y = y0 + dist;
        if (!this.fits(x, y, z)) {
            fail("Something is in the way.");
        }
        for (let yy = y0; yy < y; yy++) {
            if (SOLID[this.world.getBlock(x, yy + 2, z)]) {
                fail("Something is in the way.");
            }
        }
        if (this.world.getBlock(x, y - 1, z) === B.AIR) {
            this.world.setBlock(x, y - 1, z, B.GLASS, 0);
        }
        return this.moveTo(x, y, z);
    }

    ensureLoaded(box) {
        const w = this.world;
        for (let cx = box.x0 >> 4; cx <= box.x1 >> 4; cx++) {
            for (let cz = box.z0 >> 4; cz <= box.z1 >> 4; cz++) {
                if (!w.isLoaded(cx * 16, cz * 16)) {
                    fail("Part of that area is not loaded. Move closer to it first.");
                }
            }
        }
    }

    //Draw the selection when it or the setting changes
    update() {
        const on = this.active && (this.pos1 || this.pos2);
        const key = on ? String(this.pos1) + "|" + String(this.pos2) : "";
        if (key === this.drawn) {
            return;
        }
        this.drawn = key;
        if (!on) {
            this.game.renderer.setRegion(null);
            return;
        }
        const box = this.pos1 && this.pos2 ? this.region() : null;
        this.game.renderer.setRegion({ box, p1: this.pos1, p2: this.pos2 });
    }

    /* ---------- running edits ---------- */

    //Run fn(session) as one undoable step; returns the summary line
    edit(estimate, fn) {
        if (estimate > this.limit) {
            fail(`That could change ${fmt(estimate)} blocks; the limit is ${fmt(this.limit)} (//limit).`);
        }
        const s = new EditSession(this.world, { limit: this.limit });
        const t0 = performance.now();
        let err = null;
        try {
            fn(s);
        } catch (e) {
            err = e;
        }
        const rec = s.commit();
        if (rec.n > 0 || rec.te.length) {
            this.remember(rec);
        }
        if (err) {
            if (err instanceof EditError && rec.n) {
                err.message += ` ${fmt(rec.n)} blocks changed before that; //undo reverts them.`;
            }
            throw err;
        }
        const ms = performance.now() - t0;
        return `${plural(rec.n, "block")} changed` + (ms >= 100 ? ` in ${(ms / 1000).toFixed(2)} s` : "") + ".";
    }

    remember(rec) {
        this.undoStack.push(rec);
        this.redoStack = [];
        let cells = this.undoStack.reduce((a, r) => a + r.n, 0);
        while (this.undoStack.length > 1 && (this.undoStack.length > HISTORY_STEPS || cells > HISTORY_CELLS)) {
            cells -= this.undoStack.shift().n;
        }
    }

    undo(times) {
        return this.stepHistory(times, this.undoStack, this.redoStack, "Undid");
    }

    redo(times) {
        return this.stepHistory(times, this.redoStack, this.undoStack, "Redid");
    }

    stepHistory(times, from, to, verb) {
        if (!from.length) {
            fail(verb === "Undid" ? "Nothing left to undo." : "Nothing left to redo.");
        }
        let done = 0, cells = 0;
        while (done < times && from.length) {
            const back = replay(this.world, from[from.length - 1]);
            from.pop();
            to.push(back);
            done++;
            cells += back.n;
        }
        return `${verb} ${plural(done, "edit")} (${plural(cells, "block")}).`;
    }

    clearHistory() {
        this.undoStack = [];
        this.redoStack = [];
    }

    /* ---------- region operations ---------- */

    opSet(box, pat) {
        this.ensureLoaded(box);
        return this.edit(box.volume, (s) => {
            for (let x = box.x0; x <= box.x1; x++) {
                for (let z = box.z0; z <= box.z1; z++) {
                    for (let y = box.y0; y <= box.y1; y++) {
                        const v = pat();
                        s.set(x, y, z, v & 255, v >> 8);
                    }
                }
            }
        });
    }

    opReplace(box, mask, pat) {
        this.ensureLoaded(box);
        const w = this.world;
        return this.edit(box.volume, (s) => {
            for (let x = box.x0; x <= box.x1; x++) {
                for (let z = box.z0; z <= box.z1; z++) {
                    for (let y = box.y0; y <= box.y1; y++) {
                        if (mask(w.getBlock(x, y, z), w.getMeta(x, y, z))) {
                            const v = pat();
                            s.set(x, y, z, v & 255, v >> 8);
                        }
                    }
                }
            }
        });
    }

    //A layer on the highest block of every column
    opOverlay(box, pat) {
        this.ensureLoaded(box);
        const w = this.world;
        return this.edit(box.sx * box.sz, (s) => {
            for (let x = box.x0; x <= box.x1; x++) {
                for (let z = box.z0; z <= box.z1; z++) {
                    for (let y = box.y1; y >= box.y0; y--) {
                        if (w.getBlock(x, y, z) !== B.AIR) {
                            const v = pat();
                            s.set(x, y + 1, z, v & 255, v >> 8);
                            break;
                        }
                    }
                }
            }
        });
    }

    //Every cell of the box that passes test(x, y, z)
    opWhere(box, pat, test) {
        this.ensureLoaded(box);
        return this.edit(box.volume, (s) => {
            for (let x = box.x0; x <= box.x1; x++) {
                for (let z = box.z0; z <= box.z1; z++) {
                    for (let y = box.y0; y <= box.y1; y++) {
                        if (test(x, y, z)) {
                            const v = pat();
                            s.set(x, y, z, v & 255, v >> 8);
                        }
                    }
                }
            }
        });
    }

    opWalls(box, pat) {
        return this.opWhere(box, pat, (x, y, z) => x === box.x0 || x === box.x1 || z === box.z0 || z === box.z1);
    }

    opOutline(box, pat) {
        return this.opWhere(box, pat, (x, y, z) => x === box.x0 || x === box.x1 || z === box.z0 || z === box.z1 || y === box.y0 || y === box.y1);
    }

    //1 to 2 blocks across on each axis
    opCenter(box, pat) {
        const mid = (a, b) => [...new Set([Math.floor((a + b) / 2), Math.ceil((a + b) / 2)])];
        const xs = mid(box.x0, box.x1), ys = mid(box.y0, box.y1), zs = mid(box.z0, box.z1);
        return this.edit(8, (s) => {
            for (const x of xs) {
                for (const y of ys) {
                    for (const z of zs) {
                        const v = pat();
                        s.set(x, y, z, v & 255, v >> 8);
                    }
                }
            }
        });
    }

    //Height map smoothing: a gaussian blur (radius 5, sigma 1) of the
    //highest ground block per column, then each column is stretched or
    //squashed to its new height keeping its top block on top
    opSmooth(box, iterations, mask) {
        this.ensureLoaded(box);
        const w = this.world, W = box.sx, L = box.sz;
        const ground = mask || ((id) => SOLID[id] === 1 && id !== B.LOG && id !== B.LEAVES && id !== B.CACTUS);
        const heights = new Int32Array(W * L);
        for (let z = 0; z < L; z++) {
            for (let x = 0; x < W; x++) {
                let h = box.y0;
                for (let y = box.y1; y >= box.y0; y--) {
                    if (ground(w.getBlock(box.x0 + x, y, box.z0 + z), w.getMeta(box.x0 + x, y, box.z0 + z))) {
                        h = y;
                        break;
                    }
                }
                heights[z * W + x] = h;
            }
        }
        const R = 5, size = R * 2 + 1, kernel = new Float64Array(size * size);
        let sum = 0;
        for (let ky = -R; ky <= R; ky++) {
            for (let kx = -R; kx <= R; kx++) {
                const v = Math.exp(-(kx * kx + ky * ky) / 2);
                kernel[(ky + R) * size + kx + R] = v;
                sum += v;
            }
        }
        let data = heights;
        for (let it = 0; it < iterations; it++) {
            const out = new Int32Array(W * L);
            for (let z = 0; z < L; z++) {
                for (let x = 0; x < W; x++) {
                    let acc = 0;
                    for (let ky = -R; ky <= R; ky++) {
                        const zz = clamp(z + ky, 0, L - 1) * W;
                        for (let kx = -R; kx <= R; kx++) {
                            acc += kernel[(ky + R) * size + kx + R] * data[zz + clamp(x + kx, 0, W - 1)];
                        }
                    }
                    out[z * W + x] = Math.floor(acc / sum + 0.5);
                }
            }
            data = out;
        }
        const oy = box.y0;
        return this.edit(box.volume, (s) => {
            const copy = (x, y, z, fy) => s.set(x, y, z, w.getBlock(x, fy, z), w.getMeta(x, fy, z));
            for (let z = 0; z < L; z++) {
                for (let x = 0; x < W; x++) {
                    const cur = heights[z * W + x], next = Math.min(box.y1, data[z * W + x]);
                    const xr = box.x0 + x, zr = box.z0 + z;
                    const scale = (cur - oy) / (next - oy);
                    if (next > cur) {
                        const top = w.getBlock(xr, cur, zr);
                        if (top === B.WATER || top === B.LAVA) {
                            continue;
                        }
                        copy(xr, next, zr, cur);
                        for (let y = next - 1 - oy; y >= 0; y--) {
                            copy(xr, oy + y, zr, oy + Math.floor(y * scale));
                        }
                    } else if (cur > next) {
                        for (let y = 0; y < next - oy; y++) {
                            copy(xr, oy + y, zr, oy + Math.floor(y * scale));
                        }
                        copy(xr, next, zr, cur);
                        for (let y = next + 1; y <= cur; y++) {
                            s.set(xr, y, zr, B.AIR, 0);
                        }
                    }
                }
            }
        });
    }

    //x, y, z of every block run through the expression; the block found
    //at the result moves there. mode: "norm" (-1..1 over the selection),
    //"raw" (world coordinates) or "offset" (blocks from where you stand)
    opDeform(box, expr, mode) {
        this.ensureLoaded(box);
        const w = this.world;
        const fn = compile(expr);
        let zero, unit;
        if (mode === "raw") {
            zero = [0, 0, 0];
            unit = [1, 1, 1];
        } else if (mode === "offset") {
            zero = this.blockPos();
            unit = [1, 1, 1];
        } else {
            zero = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2];
            unit = [box.x1 - zero[0] || 1, box.y1 - zero[1] || 1, box.z1 - zero[2] || 1];
        }
        const V = box.volume;
        const ids = new Uint8Array(V), metas = new Uint8Array(V), keep = new Uint8Array(V), tiles = new Map();
        const env = {};
        let k = 0;
        for (let x = box.x0; x <= box.x1; x++) {
            for (let z = box.z0; z <= box.z1; z++) {
                for (let y = box.y0; y <= box.y1; y++, k++) {
                    env.x = (x - zero[0]) / unit[0];
                    env.y = (y - zero[1]) / unit[1];
                    env.z = (z - zero[2]) / unit[2];
                    fn(env);
                    const sx = Math.floor(env.x * unit[0] + zero[0] + 0.5);
                    const sy = Math.floor(env.y * unit[1] + zero[1] + 0.5);
                    const sz = Math.floor(env.z * unit[2] + zero[2] + 0.5);
                    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) {
                        continue;
                    }
                    keep[k] = 1;
                    ids[k] = sy < 0 ? B.BEDROCK : sy >= WORLD_H ? B.AIR : w.getBlock(sx, sy, sz);
                    metas[k] = w.getMeta(sx, sy, sz);
                    if (TE_TYPE[ids[k]]) {
                        const te = w.getTileEntity(sx, sy, sz);
                        if (te) {
                            tiles.set(k, te);
                        }
                    }
                }
            }
        }
        return this.edit(V, (s) => {
            let i = 0;
            for (let x = box.x0; x <= box.x1; x++) {
                for (let z = box.z0; z <= box.z1; z++) {
                    for (let y = box.y0; y <= box.y1; y++, i++) {
                        if (keep[i]) {
                            s.set(x, y, z, ids[i], metas[i], tiles.get(i));
                        }
                    }
                }
            }
        });
    }

    //Back to what the world seed generates
    opRegen(box) {
        this.ensureLoaded(box);
        const gen = this.world.gen;
        return this.edit(box.volume, (s) => {
            for (let cx = box.x0 >> 4; cx <= box.x1 >> 4; cx++) {
                for (let cz = box.z0 >> 4; cz <= box.z1 >> 4; cz++) {
                    const fresh = new Chunk(cx, cz);
                    gen.generate(fresh);
                    const x0 = Math.max(box.x0, cx * 16), x1 = Math.min(box.x1, cx * 16 + 15);
                    const z0 = Math.max(box.z0, cz * 16), z1 = Math.min(box.z1, cz * 16 + 15);
                    for (let x = x0; x <= x1; x++) {
                        for (let z = z0; z <= z1; z++) {
                            for (let y = box.y0; y <= box.y1; y++) {
                                const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
                                s.set(x, y, z, fresh.blocks[i], fresh.meta[i]);
                            }
                        }
                    }
                }
            }
        });
    }

    //Fill the inside of the solid things in the selection, keeping a
    //shell `thickness` thick. Outside is what the faces of the selection
    //reach through open blocks; the selection's edge counts as outside.
    opHollow(box, thickness, pat) {
        this.ensureLoaded(box);
        const w = this.world, X = box.sx, Y = box.sy, Z = box.sz, V = box.volume;
        const at = (x, y, z) => (y * Z + z) * X + x;
        const solid = new Uint8Array(V), out = new Uint8Array(V);
        for (let y = 0; y < Y; y++) {
            for (let z = 0; z < Z; z++) {
                for (let x = 0; x < X; x++) {
                    solid[at(x, y, z)] = SOLID[w.getBlock(box.x0 + x, box.y0 + y, box.z0 + z)];
                }
            }
        }
        const q = [];
        const onFace = (x, y, z) => x === 0 || y === 0 || z === 0 || x === X - 1 || y === Y - 1 || z === Z - 1;
        for (let y = 0; y < Y; y++) {
            for (let z = 0; z < Z; z++) {
                for (let x = 0; x < X; x++) {
                    const i = at(x, y, z);
                    if (onFace(x, y, z) && !solid[i]) {
                        out[i] = 1;
                        q.push(x, y, z);
                    }
                }
            }
        }
        for (let h = 0; h < q.length; h += 3) {
            for (let d = 0; d < 18; d += 3) {
                const nx = q[h] + NB[d], ny = q[h + 1] + NB[d + 1], nz = q[h + 2] + NB[d + 2];
                if (nx < 0 || ny < 0 || nz < 0 || nx >= X || ny >= Y || nz >= Z) {
                    continue;
                }
                const ni = at(nx, ny, nz);
                if (!out[ni] && !solid[ni]) {
                    out[ni] = 1;
                    q.push(nx, ny, nz);
                }
            }
        }
        const nearOut = (x, y, z) => {
            for (let d = 0; d < 18; d += 3) {
                const nx = x + NB[d], ny = y + NB[d + 1], nz = z + NB[d + 2];
                if (nx < 0 || ny < 0 || nz < 0 || nx >= X || ny >= Y || nz >= Z || out[at(nx, ny, nz)] === 1) {
                    return true;
                }
            }
            return false;
        };
        for (let t = 1; t < thickness; t++) {
            for (let y = 0; y < Y; y++) {
                for (let z = 0; z < Z; z++) {
                    for (let x = 0; x < X; x++) {
                        const i = at(x, y, z);
                        if (!out[i] && nearOut(x, y, z)) {
                            out[i] = 2;
                        }
                    }
                }
            }
            for (let i = 0; i < V; i++) {
                if (out[i] === 2) {
                    out[i] = 1;
                }
            }
        }
        return this.edit(V, (s) => {
            for (let y = 0; y < Y; y++) {
                for (let z = 0; z < Z; z++) {
                    for (let x = 0; x < X; x++) {
                        if (!out[at(x, y, z)] && !nearOut(x, y, z)) {
                            const v = pat();
                            s.set(box.x0 + x, box.y0 + y, box.z0 + z, v & 255, v >> 8);
                        }
                    }
                }
            }
        });
    }

    //Top layer grass, three dirt under it, stone below (stone, dirt and grass only)
    opNaturalize(box) {
        this.ensureLoaded(box);
        const w = this.world;
        return this.edit(box.volume, (s) => {
            for (let x = box.x0; x <= box.x1; x++) {
                for (let z = box.z0; z <= box.z1; z++) {
                    let depth = 0;
                    for (let y = box.y1; y >= box.y0; y--) {
                        if (NATURAL.has(w.getBlock(x, y, z))) {
                            s.set(x, y, z, depth === 0 ? B.GRASS : depth <= 3 ? B.DIRT : B.STONE, 0);
                            depth++;
                        }
                    }
                }
            }
        });
    }

    //Shape from an expression: blocks where it is above 0
    opGenerate(box, pat, expr, mode, hollow) {
        this.ensureLoaded(box);
        const fn = compile(expr);
        let zero, unit;
        if (mode === "raw") {
            zero = [0, 0, 0];
            unit = [1, 1, 1];
        } else if (mode === "offset") {
            zero = this.blockPos();
            unit = [1, 1, 1];
        } else if (mode === "center") {
            zero = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2];
            unit = [1, 1, 1];
        } else {
            zero = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2];
            unit = [box.x1 - zero[0] || 1, box.y1 - zero[1] || 1, box.z1 - zero[2] || 1];
        }
        const X = box.sx, Y = box.sy, Z = box.sz;
        const at = (x, y, z) => (y * Z + z) * X + x;
        const inside = new Uint8Array(box.volume);
        const env = {};
        for (let y = 0; y < Y; y++) {
            for (let z = 0; z < Z; z++) {
                for (let x = 0; x < X; x++) {
                    env.x = (box.x0 + x - zero[0]) / unit[0];
                    env.y = (box.y0 + y - zero[1]) / unit[1];
                    env.z = (box.z0 + z - zero[2]) / unit[2];
                    inside[at(x, y, z)] = fn(env) > 0 ? 1 : 0;
                }
            }
        }
        const edgeCell = (x, y, z) => {
            for (let d = 0; d < 18; d += 3) {
                const nx = x + NB[d], ny = y + NB[d + 1], nz = z + NB[d + 2];
                if (nx < 0 || ny < 0 || nz < 0 || nx >= X || ny >= Y || nz >= Z || !inside[at(nx, ny, nz)]) {
                    return true;
                }
            }
            return false;
        };
        return this.edit(box.volume, (s) => {
            for (let y = 0; y < Y; y++) {
                for (let z = 0; z < Z; z++) {
                    for (let x = 0; x < X; x++) {
                        if (inside[at(x, y, z)] && (!hollow || edgeCell(x, y, z))) {
                            const v = pat();
                            s.set(box.x0 + x, box.y0 + y, box.z0 + z, v & 255, v >> 8);
                        }
                    }
                }
            }
        });
    }

    //A line between the two corners, optionally thickened to spheres
    opLine(a, b, pat, thickness, hollow) {
        const pts = [];
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const steps = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
        for (let i = 0; i <= steps; i++) {
            const t = steps ? i / steps : 0;
            pts.push([Math.round(a[0] + d[0] * t), Math.round(a[1] + d[1] * t), Math.round(a[2] + d[2] * t)]);
        }
        const cells = new Map();
        const add = (x, y, z) => cells.set(x + "," + y + "," + z, [x, y, z]);
        for (const p of pts) {
            if (thickness > 0) {
                sphereCells(thickness, thickness, thickness, !hollow, (x, y, z) => add(p[0] + x, p[1] + y, p[2] + z));
            } else {
                add(p[0], p[1], p[2]);
            }
        }
        const r = thickness + 1;
        this.ensureLoaded(new Box(Math.min(a[0], b[0]) - r, 0, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, 0, Math.max(a[2], b[2]) + r));
        return this.edit(cells.size, (s) => {
            for (const [x, y, z] of cells.values()) {
                const v = pat();
                s.set(x, y, z, v & 255, v >> 8);
            }
        });
    }

    opSphere(pat, center, rx, ry, rz, filled) {
        this.ensureLoaded(new Box(center[0] - rx - 1, 0, center[2] - rz - 1, center[0] + rx + 1, 0, center[2] + rz + 1));
        const est = Math.ceil(4.2 * (rx + 1) * (ry + 1) * (rz + 1));
        return this.edit(est, (s) => {
            sphereCells(rx, ry, rz, filled, (x, y, z) => {
                const v = pat();
                s.set(center[0] + x, center[1] + y, center[2] + z, v & 255, v >> 8);
            });
        });
    }

    opCylinder(pat, base, rx, rz, height, filled) {
        this.ensureLoaded(new Box(base[0] - rx - 1, 0, base[2] - rz - 1, base[0] + rx + 1, 0, base[2] + rz + 1));
        let y0 = base[1];
        if (height < 0) {
            height = -height;
            y0 -= height - 1;
        }
        return this.edit(Math.ceil(3.2 * (rx + 1) * (rz + 1) * height), (s) => {
            circleCells(rx, rz, filled, (x, z) => {
                for (let y = 0; y < height; y++) {
                    const v = pat();
                    s.set(base[0] + x, y0 + y, base[2] + z, v & 255, v >> 8);
                }
            });
        });
    }

    opPyramid(pat, base, size, filled) {
        this.ensureLoaded(new Box(base[0] - size, 0, base[2] - size, base[0] + size, 0, base[2] + size));
        return this.edit(4 * size * size * size, (s) => {
            let half = size;
            for (let y = 0; y <= size; y++) {
                half--;
                for (let x = 0; x <= half; x++) {
                    for (let z = 0; z <= half; z++) {
                        if (filled || z === half || x === half) {
                            for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
                                const v = pat();
                                s.set(base[0] + x * sx, base[1] + y, base[2] + z * sz, v & 255, v >> 8);
                            }
                        }
                    }
                }
            }
        });
    }

    /* ---------- clipboard data ---------- */

    //The blocks (and tile entities) of a box; keep marks the cells a mask let through
    capture(box, mask) {
        const w = this.world, V = box.volume;
        const ids = new Uint8Array(V), metas = new Uint8Array(V), tiles = new Map();
        const keep = mask ? new Uint8Array(V) : null;
        let k = 0;
        for (let y = box.y0; y <= box.y1; y++) {
            for (let z = box.z0; z <= box.z1; z++) {
                for (let x = box.x0; x <= box.x1; x++, k++) {
                    const id = w.getBlock(x, y, z), meta = w.getMeta(x, y, z);
                    if (keep) {
                        if (!mask(id, meta)) {
                            continue;
                        }
                        keep[k] = 1;
                    }
                    ids[k] = id;
                    metas[k] = meta;
                    if (TE_TYPE[id]) {
                        const te = w.getTileEntity(x, y, z);
                        if (te) {
                            tiles.set(k, cloneTE(te));
                        }
                    }
                }
            }
        }
        return { sx: box.sx, sy: box.sy, sz: box.sz, ids, metas, keep, tiles };
    }

    //Write captured data with its low corner at (bx, by, bz)
    place(s, data, bx, by, bz, skipAir) {
        let k = 0;
        for (let y = 0; y < data.sy; y++) {
            for (let z = 0; z < data.sz; z++) {
                for (let x = 0; x < data.sx; x++, k++) {
                    if (data.keep && !data.keep[k]) {
                        continue;
                    }
                    const id = data.ids[k];
                    if (skipAir && id === B.AIR) {
                        continue;
                    }
                    s.set(bx + x, by + y, bz + z, id, data.metas[k], data.tiles.get(k));
                }
            }
        }
    }

    //Fill the cells of captured data (all, or those its mask kept) with a pattern
    clearCaptured(s, box, data, pat) {
        let k = 0;
        for (let y = box.y0; y <= box.y1; y++) {
            for (let z = box.z0; z <= box.z1; z++) {
                for (let x = box.x0; x <= box.x1; x++, k++) {
                    if (data.keep && !data.keep[k]) {
                        continue;
                    }
                    const v = pat();
                    s.set(x, y, z, v & 255, v >> 8);
                }
            }
        }
    }

    /* ---------- entities (carts, boats, animals) ---------- */

    entitiesIn(box) {
        const g = this.game, out = [];
        const inBox = (e) => e.x >= box.x0 && e.x < box.x1 + 1 && e.y >= box.y0 && e.y < box.y1 + 1 && e.z >= box.z0 && e.z < box.z1 + 1;
        for (const c of g.carts.list) {
            if (!c.rider && inBox(c)) {
                out.push({ kind: "cart", ref: c, x: c.x, y: c.y, z: c.z, yaw: c.yaw, data: { kind: c.kind, slots: c.slots, fuel: c.fuel } });
            }
        }
        for (const b of g.boats.list) {
            if (!b.rider && inBox(b)) {
                out.push({ kind: "boat", ref: b, x: b.x, y: b.y, z: b.z, yaw: b.yaw, data: {} });
            }
        }
        for (const m of g.mobs.list) {
            if (inBox(m)) {
                out.push({ kind: "mob", ref: m, x: m.x, y: m.y, z: m.z, yaw: m.yaw, data: { type: m.type, health: m.health } });
            }
        }
        return out;
    }

    //Entity copies relative to an origin, safe to keep in the clipboard
    copyEntities(box, origin) {
        return this.entitiesIn(box).map((e) => ({
            kind: e.kind, x: e.x - origin[0], y: e.y - origin[1], z: e.z - origin[2], yaw: e.yaw, data: cloneTE(e.data)
        }));
    }

    spawnEntities(list, base) {
        const g = this.game;
        for (const e of list) {
            const x = base[0] + e.x, y = base[1] + e.y, z = base[2] + e.z, data = cloneTE(e.data);
            if (e.kind === "cart") {
                g.carts.spawn(data.kind, x, y, z, { yaw: e.yaw, slots: data.slots, fuel: data.fuel });
            } else if (e.kind === "boat") {
                g.boats.spawn(x, y, z, { yaw: e.yaw });
            } else {
                const m = g.mobs.spawn(data.type, x, y, z);
                m.yaw = e.yaw;
                m.health = data.health;
            }
        }
        return list.length;
    }

    removeEntities(list) {
        const g = this.game;
        for (const e of list) {
            if (e.kind === "cart") {
                g.carts.disposeCart(e.ref);
                g.carts.list.splice(g.carts.list.indexOf(e.ref), 1);
            } else if (e.kind === "boat") {
                g.boats.disposeBoat(e.ref);
                g.boats.list.splice(g.boats.list.indexOf(e.ref), 1);
            } else {
                g.mobs.disposeMob(e.ref);
                g.mobs.list.splice(g.mobs.list.indexOf(e.ref), 1);
            }
        }
    }

    /* ---------- move and stack ---------- */

    opMove(box, offset, leave, opts) {
        const target = new Box(box.x0 + offset[0], box.y0 + offset[1], box.z0 + offset[2], box.x1 + offset[0], box.y1 + offset[1], box.z1 + offset[2]);
        if (target.y0 < 0 || target.y1 >= WORLD_H) {
            fail("That would move the selection out of the world.");
        }
        this.ensureLoaded(box);
        this.ensureLoaded(target);
        const data = this.capture(box, opts.mask);
        const ents = opts.entities ? this.entitiesIn(box) : [];
        const msg = this.edit(box.volume * 2, (s) => {
            this.clearCaptured(s, box, data, leave);
            this.place(s, data, target.x0, target.y0, target.z0, opts.skipAir);
        });
        for (const e of ents) {
            e.ref.x += offset[0];
            e.ref.y += offset[1];
            e.ref.z += offset[2];
        }
        if (opts.shift) {
            this.shiftSelection(offset);
        }
        return msg;
    }

    opStack(box, count, step, opts) {
        const end = [step[0] * count, step[1] * count, step[2] * count];
        const last = new Box(box.x0 + end[0], box.y0 + end[1], box.z0 + end[2], box.x1 + end[0], box.y1 + end[1], box.z1 + end[2]);
        this.ensureLoaded(box);
        this.ensureLoaded(last);
        const data = this.capture(box, opts.mask);
        const ents = opts.entities ? this.copyEntities(box, [box.x0, box.y0, box.z0]) : [];
        const msg = this.edit(box.volume * count, (s) => {
            for (let i = 1; i <= count; i++) {
                const bx = box.x0 + step[0] * i, by = box.y0 + step[1] * i, bz = box.z0 + step[2] * i;
                if (by + box.sy - 1 < 0 || by >= WORLD_H) {
                    break;
                }
                this.place(s, data, bx, by, bz, opts.skipAir);
                this.spawnEntities(ents, [bx, by, bz]);
            }
        });
        if (opts.shift) {
            this.shiftSelection(end);
        }
        return msg;
    }

    shiftSelection(v) {
        for (const p of [this.pos1, this.pos2]) {
            p[0] += v[0];
            p[1] = clamp(p[1] + v[1], 0, WORLD_H - 1);
            p[2] += v[2];
        }
    }

    /* ---------- clipboard ---------- */

    //The clipboard keeps the blocks relative to where you stood
    opCopy(box, opts) {
        this.ensureLoaded(box);
        if (box.volume > this.limit) {
            fail(`That selection has ${fmt(box.volume)} blocks; the limit is ${fmt(this.limit)} (//limit).`);
        }
        const origin = this.blockPos();
        const data = this.capture(box, opts.mask);
        this.clipboard = Object.assign(data, {
            ox: box.x0 - origin[0], oy: box.y0 - origin[1], oz: box.z0 - origin[2],
            origin,
            entities: opts.entities ? this.copyEntities(box, origin) : []
        });
        const kept = data.keep ? data.keep.reduce((a, v) => a + v, 0) : box.volume;
        const ents = this.clipboard.entities.length;
        return `${plural(kept, "block")} copied` + (ents ? ` with ${ents} entit${ents === 1 ? "y" : "ies"}` : "") + ".";
    }

    opCut(box, leave, opts) {
        const msg = this.opCopy(box, opts);
        const data = this.clipboard;
        const ents = opts.entities ? this.entitiesIn(box) : [];
        const changed = this.edit(box.volume, (s) => this.clearCaptured(s, box, data, leave));
        this.removeEntities(ents);
        return msg.replace("copied", "cut") + " " + changed;
    }

    needClipboard() {
        if (!this.clipboard) {
            fail("Your clipboard is empty. Use //copy first.");
        }
        return this.clipboard;
    }

    opPaste(opts) {
        const cb = this.needClipboard();
        const at = opts.atOrigin ? cb.origin : this.blockPos();
        const bx = at[0] + cb.ox, by = at[1] + cb.oy, bz = at[2] + cb.oz;
        const box = new Box(bx, by, bz, bx + cb.sx - 1, by + cb.sy - 1, bz + cb.sz - 1);
        this.ensureLoaded(box);
        const msg = this.edit(box.volume, (s) => this.place(s, cb, bx, by, bz, opts.skipAir));
        let ents = 0;
        if (opts.entities) {
            ents = this.spawnEntities(cb.entities, at);
        }
        if (opts.select) {
            this.pos1 = [box.x0, clamp(box.y0, 0, WORLD_H - 1), box.z0];
            this.pos2 = [box.x1, clamp(box.y1, 0, WORLD_H - 1), box.z1];
        }
        return `Pasted at (${at.join(", ")}): ` + msg.charAt(0).toLowerCase() + msg.slice(1) +
            (ents ? ` ${ents} entit${ents === 1 ? "y" : "ies"} added.` : "");
    }

    //Turn or mirror the clipboard about the block you copied it from
    transformClipboard(M) {
        const cb = this.needClipboard();
        const a = mul(M, cb.ox, cb.oy, cb.oz), b = mul(M, cb.ox + cb.sx - 1, cb.oy + cb.sy - 1, cb.oz + cb.sz - 1);
        const nox = Math.min(a[0], b[0]), noy = Math.min(a[1], b[1]), noz = Math.min(a[2], b[2]);
        const nsx = Math.abs(b[0] - a[0]) + 1, nsy = Math.abs(b[1] - a[1]) + 1, nsz = Math.abs(b[2] - a[2]) + 1;
        const V = nsx * nsy * nsz;
        const ids = new Uint8Array(V), metas = new Uint8Array(V), tiles = new Map();
        const keep = cb.keep ? new Uint8Array(V) : null;
        let k = 0;
        for (let y = 0; y < cb.sy; y++) {
            for (let z = 0; z < cb.sz; z++) {
                for (let x = 0; x < cb.sx; x++, k++) {
                    const r = mul(M, cb.ox + x, cb.oy + y, cb.oz + z);
                    const nk = ((r[1] - noy) * nsz + (r[2] - noz)) * nsx + (r[0] - nox);
                    ids[nk] = cb.ids[k];
                    metas[nk] = transformMeta(cb.ids[k], cb.metas[k], M);
                    if (keep) {
                        keep[nk] = cb.keep[k];
                    }
                    if (cb.tiles.has(k)) {
                        tiles.set(nk, cb.tiles.get(k));
                    }
                }
            }
        }
        //Entities turn about the middle of the origin block
        for (const e of cb.entities) {
            const p = mul(M, e.x - 0.5, e.y - 0.5, e.z - 0.5);
            e.x = p[0] + 0.5;
            e.y = p[1] + 0.5;
            e.z = p[2] + 0.5;
            const f = mul(M, -Math.sin(e.yaw), 0, -Math.cos(e.yaw));
            if (Math.abs(f[1]) < 0.5) {
                e.yaw = Math.atan2(-f[0], -f[2]);
            }
        }
        Object.assign(cb, { sx: nsx, sy: nsy, sz: nsz, ox: nox, oy: noy, oz: noz, ids, metas, keep, tiles });
    }

    /* ---------- around the player ---------- */

    //Fill holes: open cells reached from your feet sideways and down
    opFill(pat, radius, depth) {
        const w = this.world, o = this.blockPos();
        this.ensureLoaded(new Box(o[0] - radius, 0, o[2] - radius, o[0] + radius, 0, o[2] + radius));
        const seen = new Set(), q = [o];
        const open = (id) => id === B.AIR || id === B.WATER || id === B.LAVA || id === B.FIRE;
        return this.edit(Math.ceil(Math.PI * (radius + 1) * (radius + 1) * depth), (s) => {
            while (q.length) {
                const [x, y, z] = q.pop();
                const key = x + "," + y + "," + z;
                if (seen.has(key) || y < 0 || y > o[1] || y <= o[1] - depth) {
                    continue;
                }
                if ((x - o[0]) ** 2 + (z - o[2]) ** 2 > radius * radius || !open(w.getBlock(x, y, z))) {
                    continue;
                }
                seen.add(key);
                const v = pat();
                s.set(x, y, z, v & 255, v >> 8);
                q.push([x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1], [x, y - 1, z]);
            }
        });
    }

    //Remove liquids touching you within a radius
    opDrain(radius) {
        const w = this.world, o = this.blockPos();
        this.ensureLoaded(new Box(o[0] - radius, 0, o[2] - radius, o[0] + radius, 0, o[2] + radius));
        const liquid = (id) => id === B.WATER || id === B.LAVA;
        const seen = new Set(), q = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    q.push([o[0] + dx, o[1] + dy, o[2] + dz]);
                }
            }
        }
        return this.edit(Math.ceil(4.2 * (radius + 1) ** 3), (s) => {
            while (q.length) {
                const [x, y, z] = q.pop();
                const key = x + "," + y + "," + z;
                if (seen.has(key) || (x - o[0]) ** 2 + (y - o[1]) ** 2 + (z - o[2]) ** 2 > radius * radius) {
                    continue;
                }
                seen.add(key);
                if (!liquid(w.getBlock(x, y, z))) {
                    continue;
                }
                s.set(x, y, z, B.AIR, 0);
                q.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
            }
        });
    }

    //A cube of side 2 * size - 1 around you, from the given heights
    aroundBox(size, y0, y1) {
        const o = this.blockPos();
        return new Box(o[0] - size + 1, y0, o[2] - size + 1, o[0] + size - 1, y1, o[2] + size - 1).clipped();
    }
}
