/*
    Blocky - machines.js

    Feeders and dispensers, the two item handling blocks.

    A feeder (5 slots) moves one item every FEED_TICKS game ticks: out of
    its spout into what it points at (down or to a side), and in from what
    sits on top of it. It also takes in dropped items lying in its bowl or
    the block space above it, at once. Power stops it. What it can reach:
    - chests, dispensers and other feeders: any slot
    - furnaces: fed from above into the smelting slot (only things that
      smelt), from a side into the fuel slot (only fuel); a feeder under a
      furnace takes from its output slot
    - a chest cart in the block it points into (a feeder over a rail) or in
      the block above it (a rail laid on the feeder), moving or not

    A dispenser (9 slots) fires once each time power arrives (power.js
    calls world.onDispense). With storage right in front (a chest, a chest
    cart, another dispenser or a feeder, not a furnace) it moves one item
    into it, any kind of item, and keeps it when the storage is full.
    Otherwise it picks a random filled slot and
    - shoots an arrow
    - sets a cart on a rail in front of it (or one block lower), turned
      along the rail away from it
    - floats a boat on water in front of it (up to the water's surface)
    - pours a water or lava bucket into the space in front (keeping the
      empty bucket) and fills an empty bucket from a source in front
    - throws anything else out as a dropped item
*/

import { B, I, ITEMS, BLOCKS, SMELTING, fuelTicks, isRail } from "./blocks.js";
import { FACE_DIR } from "./shapes.js";
import { isPowered } from "./power.js";
import { maxStack } from "./inventory.js";

//Game ticks between two moves of a feeder: 2.5 items a second
const FEED_TICKS = 8;
//How fast a dispenser throws items and shoots arrows (blocks / s)
const THROW_SPEED = 5;
const ARROW_SPEED = 22;
const ARROW_DAMAGE = 6;

const range = (n) => Array.from({ length: n }, (_, i) => i);

//Put one of `st` (id, dmg) into the first of the slots `idxs` that takes it:
//a stack of the same item first, else an empty slot
function insertOne(slots, idxs, st) {
    for (const i of idxs) {
        const t = slots[i];
        if (t && t.id === st.id && (t.dmg || 0) === (st.dmg || 0) && t.count < maxStack(t.id)) {
            t.count++;
            return true;
        }
    }
    for (const i of idxs) {
        if (!slots[i]) {
            slots[i] = { id: st.id, count: 1, dmg: st.dmg || 0 };
            return true;
        }
    }
    return false;
}

function takeOne(slots, i) {
    const s = slots[i];
    s.count--;
    if (s.count <= 0) {
        slots[i] = null;
    }
}

export class Machines {
    constructor(game) {
        this.game = game;
    }

    /* ---------------- feeders ---------------- */

    tick() {
        const w = this.game.world;
        for (const [key, te] of w.tileEntities) {
            if (te.type !== "feeder") {
                continue;
            }
            const [x, y, z] = key.split(",").map(Number);
            if (!w.isLoaded(x, z) || w.getBlock(x, y, z) !== B.FEEDER) {
                continue;
            }
            this.collect(te, x, y, z);
            if (te.cd > 0) {
                te.cd--;
                continue;
            }
            if (isPowered(w, x, y, z)) {
                continue;
            }
            const out = this.feedOut(te, x, y, z, w.getMeta(x, y, z) & 7);
            const got = this.pullIn(te, x, y, z);
            if (out || got) {
                te.cd = FEED_TICKS;
            }
        }
    }

    //What sits at (x, y, z) to put items into or take them from: a block
    //keeping its items in a tile entity, or a chest cart in that space
    containerAt(x, y, z) {
        const g = this.game, w = g.world;
        const kind = BLOCKS[w.getBlock(x, y, z)].interact;
        if (kind === "chest" || kind === "dispenser" || kind === "feeder" || kind === "furnace") {
            const te = w.getTileEntity(x, y, z) || w.createTileEntity(x, y, z, kind);
            return { kind, slots: te.slots };
        }
        const cart = g.carts.list.find((c) => c.kind === "chest" &&
            Math.floor(c.x) === x && Math.floor(c.z) === z && Math.floor(c.y + 0.1) === y);
        return cart ? { kind: "cart", slots: cart.slots } : null;
    }

    //One item out of the spout (face: 3 down, else a side)
    feedOut(te, x, y, z, face) {
        const d = FACE_DIR[face];
        const to = this.containerAt(x + d[0], y + d[1], z + d[2]);
        if (!to) {
            return false;
        }
        let idxs = range(to.slots.length), fits = () => true;
        if (to.kind === "furnace") {
            if (face === 3) {
                idxs = [0];
                fits = (id) => SMELTING.has(id);
            } else {
                idxs = [1];
                fits = (id) => fuelTicks(id) > 0;
            }
        }
        for (let i = 0; i < te.slots.length; i++) {
            const s = te.slots[i];
            if (s && fits(s.id) && insertOne(to.slots, idxs, s)) {
                takeOne(te.slots, i);
                return true;
            }
        }
        return false;
    }

    //One item in from what sits on top (a furnace gives its output only)
    pullIn(te, x, y, z) {
        const from = this.containerAt(x, y + 1, z);
        if (!from) {
            return false;
        }
        const idxs = from.kind === "furnace" ? [2] : range(from.slots.length);
        const mine = range(te.slots.length);
        for (const i of idxs) {
            const s = from.slots[i];
            if (s && insertOne(te.slots, mine, s)) {
                takeOne(from.slots, i);
                return true;
            }
        }
        return false;
    }

    //Dropped items in the bowl or the block space above it go in whole, or
    //as many as fit
    collect(te, x, y, z) {
        const g = this.game, items = g.entities.items;
        const mine = range(te.slots.length);
        for (let i = items.length - 1; i >= 0; i--) {
            const e = items[i];
            if (e.burn !== undefined || e.x < x || e.x >= x + 1 || e.z < z || e.z >= z + 1 || e.y < y + 10 / 16 || e.y >= y + 2) {
                continue;
            }
            let n = e.count;
            while (n > 0 && insertOne(te.slots, mine, e)) {
                n--;
            }
            if (n === 0) {
                g.renderer.disposeItemMesh(e.mesh);
                items.splice(i, 1);
            } else {
                e.count = n;
            }
        }
    }

    /* ---------------- dispensers ---------------- */

    //One item into the storage in front, from a random slot that fits.
    //True when there is storage there, whether or not anything fitted.
    passOn(te, full, x, y, z) {
        const to = this.containerAt(x, y, z);
        if (!to || to.kind === "furnace") {
            return false;
        }
        const all = range(to.slots.length);
        const start = Math.floor(Math.random() * full.length);
        for (let k = 0; k < full.length; k++) {
            const i = full[(start + k) % full.length];
            if (insertOne(to.slots, all, te.slots[i])) {
                takeOne(te.slots, i);
                break;
            }
        }
        this.game.sound.play("click");
        return true;
    }

    dispense(x, y, z, face) {
        const g = this.game, w = g.world;
        const te = w.getTileEntity(x, y, z) || w.createTileEntity(x, y, z, "dispenser");
        const full = te.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
        if (!full.length) {
            g.sound.play("click");
            return;
        }
        const d = FACE_DIR[face];
        const fx = x + d[0], fy = y + d[1], fz = z + d[2];
        if (this.passOn(te, full, fx, fy, fz)) {
            return;
        }
        const i = full[Math.floor(Math.random() * full.length)];
        const s = te.slots[i];
        const front = w.getBlock(fx, fy, fz);
        //Just outside the mouth
        const ox = x + 0.5 + d[0] * 0.7, oy = y + 0.5 + d[1] * 0.7 - (d[1] === 0 ? 0.15 : 0), oz = z + 0.5 + d[2] * 0.7;
        const it = ITEMS[s.id];
        if (s.id === I.ARROW) {
            g.mobs.shootArrow(ox, oy, oz, d[0] * ARROW_SPEED, d[1] * ARROW_SPEED + (d[1] === 0 ? 1.5 : 0), d[2] * ARROW_SPEED, ARROW_DAMAGE, true);
            takeOne(te.slots, i);
            g.sound.play("bow");
            return;
        }
        if (it && it.cart) {
            for (const ry of [fy, fy - 1]) {
                if (isRail(w.getBlock(fx, ry, fz))) {
                    const [cx, cy, cz] = g.carts.railSeat(fx, ry, fz);
                    g.carts.spawn(it.cart, cx, cy, cz, { yaw: g.carts.railYaw(fx, ry, fz, d[0], d[2]) });
                    takeOne(te.slots, i);
                    g.sound.block("place", "metal");
                    return;
                }
            }
        }
        if (s.id === I.BOAT) {
            //On water in front (floated up to its surface), or on water just
            //below the space in front
            let wy = -1;
            if (front === B.WATER) {
                wy = fy;
                while (wy < fy + 128 && w.getBlock(fx, wy + 1, fz) === B.WATER) {
                    wy++;
                }
            } else if (front === B.AIR && w.getBlock(fx, fy - 1, fz) === B.WATER) {
                wy = fy - 1;
            }
            if (wy >= 0) {
                g.boats.spawn(fx + 0.5, wy + 0.875, fz + 0.5, { yaw: Math.atan2(-d[0], -d[2]) });
                takeOne(te.slots, i);
                g.sound.block("place", "wood");
                return;
            }
        }
        if (s.id === I.WATER_BUCKET || s.id === I.LAVA_BUCKET) {
            const liquid = s.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
            const isLiquid = front === B.WATER || front === B.LAVA;
            if (front === B.AIR || (isLiquid && w.getMeta(fx, fy, fz) !== 0) || (!isLiquid && BLOCKS[front].replaceable)) {
                if (front !== B.AIR && !isLiquid) {
                    w.breakNaturally(fx, fy, fz);
                }
                w.setBlock(fx, fy, fz, liquid, 0);
                w.schedule(fx, fy, fz, 5);
                te.slots[i] = { id: I.BUCKET, count: 1, dmg: 0 };
                g.sound.play(liquid === B.WATER ? "splash" : "fizz");
                return;
            }
        }
        if (s.id === I.BUCKET && (front === B.WATER || front === B.LAVA) && w.getMeta(fx, fy, fz) === 0) {
            w.setBlock(fx, fy, fz, B.AIR, 0);
            const filled = { id: front === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, count: 1, dmg: 0 };
            if (s.count === 1) {
                te.slots[i] = filled;
            } else {
                takeOne(te.slots, i);
                if (!insertOne(te.slots, range(te.slots.length), filled)) {
                    g.entities.spawnItem(ox, oy, oz, filled.id, 1, 0, [d[0] * THROW_SPEED, d[1] * THROW_SPEED + 1, d[2] * THROW_SPEED]);
                }
            }
            g.sound.play(front === B.WATER ? "splash" : "fizz");
            return;
        }
        //Anything else is thrown out, a little scattered
        const jx = (Math.random() - 0.5) * 0.8, jz = (Math.random() - 0.5) * 0.8;
        g.entities.spawnItem(ox, oy, oz, s.id, 1, s.dmg || 0,
            [d[0] * THROW_SPEED + jx, d[1] * THROW_SPEED + (d[1] === 0 ? 1.2 : 0), d[2] * THROW_SPEED + jz]);
        takeOne(te.slots, i);
        g.sound.play("click");
    }
}
