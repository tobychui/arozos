/*
    Blocky - carts.js

    Minecarts. A cart on a rail moves along the rail's path (straight,
    rising or curved, see the shapes in power.js), speeds up downhill, is
    boosted by powered rails (and braked by unpowered ones), stops at the end
    of the track and bumps into other carts. Off the rails it just slides
    to a halt.

    Kinds: "cart" (right click to ride, W pushes, Shift to get out), "chest"
    (right click for 27 slots of storage) and "furnace" (right click with
    fuel to drive it away from you while the fuel lasts). Carts are saved
    with the world.
*/

import * as THREE from "three";
import { B, I, BLOCKS, ITEMS, isOpaqueAt, fuelTicks } from "./blocks.js";
import { moveAxis } from "./physics.js";

//Two exits of each rail shape, block local (0 NS, 1 EW, 2-5 rising +x -x +z -z, 6-9 curves SE SW NW NE)
const RAIL_EXITS = [
    [[0.5, 0, 0], [0.5, 0, 1]],
    [[0, 0, 0.5], [1, 0, 0.5]],
    [[0, 0, 0.5], [1, 1, 0.5]],
    [[0, 1, 0.5], [1, 0, 0.5]],
    [[0.5, 0, 0], [0.5, 1, 1]],
    [[0.5, 1, 0], [0.5, 0, 1]],
    [[0.5, 0, 1], [1, 0, 0.5]],
    [[0.5, 0, 1], [0, 0, 0.5]],
    [[0.5, 0, 0], [0, 0, 0.5]],
    [[0.5, 0, 0], [1, 0, 0.5]]
];

export const CART_ITEM = { cart: I.MINECART, chest: I.CHEST_MINECART, furnace: I.FURNACE_MINECART };
const MAX_SPEED = 8;
//How a cart rolls, by what it carries: [coast, roll, brake]. coast: blocks
//it keeps full speed for before it starts to slow; roll: its deceleration
//on plain rails after that (blocks / s^2); brake: its deceleration on an
//unpowered powered rail (stronger than a slope's pull, so a braked cart
//stops and stays put). From full speed on level track that comes to:
//          stops on plain rails  (coast + 64 / 2 roll)   on brakes
//  ridden  309 blocks            (176 + 133)             1.5 blocks
//  empty   165                   (65 + 100)              1
//  chest with 5 stacks  101      (45 + 56)               1.5
//  full chest  40                (0 + 40)                1
const LOAD_RIDDEN = [176, 0.24, 21];
const LOAD_EMPTY = [65, 0.32, 32];
const LOAD_SOME = [45, 0.57, 21];
const LOAD_FULL = [0, 0.8, 32];
const SOME_STACKS = 5;
//Pace of a cart a player pushes along an unpowered powered rail
const BRAKE_PUSH = 1.5;
const HALF = 0.49;

export class Carts {
    constructor(game) {
        this.game = game;
        this.renderer = game.renderer;
        this.list = [];
    }

    clear() {
        for (const c of this.list) {
            this.disposeCart(c);
        }
        this.list = [];
    }

    railAt(x, y, z) {
        const w = this.game.world;
        const bx = Math.floor(x), bz = Math.floor(z), fy = Math.floor(y + 0.02);
        //One above too: a fast cart running off the foot of a slope dips
        //a little below the flat rail that follows it
        for (const by of [fy, fy - 1, fy + 1]) {
            const id = w.getBlock(bx, by, bz);
            if (id === B.RAIL || id === B.POWERED_RAIL) {
                const m = w.getMeta(bx, by, bz);
                return { id, bx, by, bz, shape: id === B.POWERED_RAIL ? m & 7 : Math.min(9, m & 15), powered: (m & 8) !== 0 };
            }
        }
        return null;
    }

    //[coast, roll, brake] for what the cart carries (see LOAD_RIDDEN): a
    //chest cart goes from empty to full by how many stacks fill its slots
    loadOf(c) {
        if (c.rider) {
            return LOAD_RIDDEN;
        }
        if (c.kind !== "chest") {
            return LOAD_EMPTY;
        }
        let stacks = 0;
        for (const s of c.slots) {
            if (s) {
                stacks += s.count / ((ITEMS[s.id] && ITEMS[s.id].stack) || 64);
            }
        }
        const k0 = SOME_STACKS, k1 = c.slots.length;
        const [a, b, f] = stacks <= k0 ? [LOAD_EMPTY, LOAD_SOME, stacks / k0] : [LOAD_SOME, LOAD_FULL, Math.min(1, (stacks - k0) / (k1 - k0))];
        return a.map((v, i) => v + (b[i] - v) * f);
    }

    //Where a cart sits on a rail block: the middle of its path
    railSeat(bx, by, bz) {
        const r = this.railAt(bx + 0.5, by + 0.1, bz + 0.5);
        if (!r) {
            return [bx + 0.5, by, bz + 0.5];
        }
        const [a, b] = RAIL_EXITS[r.shape];
        return [r.bx + (a[0] + b[0]) / 2, r.by + (a[1] + b[1]) / 2, r.bz + (a[2] + b[2]) / 2];
    }

    buildModel(kind) {
        const group = new THREE.Group();
        const metal = new THREE.MeshBasicMaterial({ color: 0x8a8d94 });
        const dark = new THREE.MeshBasicMaterial({ color: 0x4a4c52 });
        metal.userData.base = new THREE.Color(0x8a8d94);
        dark.userData.base = new THREE.Color(0x4a4c52);
        const box = (w, h, d, m, x, y, z) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
            mesh.position.set(x, y, z);
            group.add(mesh);
        };
        box(0.9, 0.08, 1.2, dark, 0, 0.16, 0);
        box(0.06, 0.46, 1.2, metal, -0.45, 0.39, 0);
        box(0.06, 0.46, 1.2, metal, 0.45, 0.39, 0);
        box(0.84, 0.46, 0.06, metal, 0, 0.39, -0.57);
        box(0.84, 0.46, 0.06, metal, 0, 0.39, 0.57);
        for (const [x, z] of [[-0.4, -0.42], [0.4, -0.42], [-0.4, 0.42], [0.4, 0.42]]) {
            box(0.08, 0.14, 0.18, dark, x, 0.08, z);
        }
        let cargo = null;
        if (kind !== "cart") {
            cargo = this.renderer.makeItemMesh(kind === "chest" ? B.CHEST : B.FURNACE);
            cargo.scale.setScalar(0.74);
            cargo.position.set(0, 0.56, 0);
            group.add(cargo);
        }
        this.renderer.scene.add(group);
        this.renderer.castShadows(group);
        return { group, mats: [metal, dark], cargo };
    }

    spawn(kind, x, y, z, data = {}) {
        const c = {
            kind, x, y, z, vx: data.vx || 0, vy: 0, vz: data.vz || 0, yaw: data.yaw || 0,
            slots: data.slots || (kind === "chest" ? new Array(27).fill(null) : null),
            fuel: data.fuel || 0, pushX: data.pushX || 0, pushZ: data.pushZ || 0,
            hits: 0, hitCd: 0, smoke: 0, rider: false, lit: false
        };
        c.model = this.buildModel(kind);
        this.list.push(c);
        return c;
    }

    disposeCart(c) {
        const g = c.model.group;
        this.renderer.scene.remove(g);
        g.traverse((o) => {
            if (o.geometry && o !== c.model.cargo) {
                o.geometry.dispose();
            }
        });
        for (const m of c.model.mats) {
            m.dispose();
        }
        if (c.model.cargo) {
            this.renderer.disposeItemMesh(c.model.cargo);
        }
    }

    box(c) {
        return [c.x - HALF, c.y, c.z - HALF, c.x + HALF, c.y + 0.7, c.z + HALF];
    }

    raycast(ox, oy, oz, dx, dy, dz, reach) {
        let best = null;
        for (const c of this.list) {
            if (c.rider) {
                continue;
            }
            const b = this.box(c);
            let tmin = 0, tmax = Infinity, miss = false;
            const o = [ox, oy, oz], d = [dx, dy, dz];
            for (let a = 0; a < 3 && !miss; a++) {
                if (Math.abs(d[a]) < 1e-9) {
                    miss = o[a] < b[a] || o[a] > b[a + 3];
                    continue;
                }
                let t1 = (b[a] - o[a]) / d[a], t2 = (b[a + 3] - o[a]) / d[a];
                if (t1 > t2) {
                    [t1, t2] = [t2, t1];
                }
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                miss = tmin > tmax;
            }
            if (!miss && tmin <= reach && (!best || tmin < best.t)) {
                best = { cart: c, t: tmin };
            }
        }
        return best;
    }

    /* ---------------- player actions ---------------- */

    //Left click: two hits break a cart (one in creative)
    hit(c) {
        const g = this.game;
        if (c.hitCd > 0) {
            return;
        }
        c.hitCd = 0.25;
        c.hits++;
        g.sound.block("dig", "metal");
        if (c.hits >= 2 || g.creative) {
            this.breakCart(c, !g.creative);
        }
    }

    breakCart(c, drop) {
        const g = this.game;
        if (c.rider) {
            this.dismount();
        }
        if (drop) {
            g.entities.spawnItem(c.x, c.y + 0.5, c.z, CART_ITEM[c.kind], 1);
            for (const s of c.slots || []) {
                if (s) {
                    g.entities.spawnItem(c.x, c.y + 0.5, c.z, s.id, s.count, s.dmg || 0);
                }
            }
        }
        g.sound.block("break", "metal");
        this.disposeCart(c);
        this.list.splice(this.list.indexOf(c), 1);
    }

    //Right click: ride, open the chest, or fuel the furnace
    use(c) {
        const g = this.game, p = g.player, inv = g.inventory;
        if (c.kind === "cart") {
            if (!c.rider && !g.riding) {
                c.rider = true;
                g.riding = c;
                g.ui.toast("Press Shift to get out");
            }
        } else if (c.kind === "chest") {
            g.openScreen("chest", c);
        } else {
            const held = inv.held;
            const ticks = held ? fuelTicks(held.id) : 0;
            if (ticks > 0) {
                const leaves = ITEMS[held.id].fuelLeaves;
                if (!g.creative) {
                    inv.consumeHeld(1);
                    if (leaves) {
                        if (inv.held) {
                            inv.add(leaves, 1);
                        } else {
                            inv.slots[inv.selected] = { id: leaves, count: 1, dmg: 0 };
                        }
                    }
                }
                c.fuel = Math.min(600, c.fuel + ticks / 20 * 2.25);
                //Drive away from the player
                const dx = c.x - p.x, dz = c.z - p.z, l = Math.hypot(dx, dz) || 1;
                c.pushX = dx / l;
                c.pushZ = dz / l;
                g.sound.play("fizz");
                g.ui.hudKey = "";
            } else {
                g.ui.toast("Right click with fuel (coal, wood...) to drive it");
            }
        }
    }

    dismount() {
        const g = this.game, c = g.riding;
        if (!c) {
            return;
        }
        c.rider = false;
        g.riding = null;
        const w = g.world, p = g.player;
        //Step off to the side if there is room, else onto the cart
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = Math.floor(c.x) + dx, y = Math.floor(c.y + 0.1), z = Math.floor(c.z) + dz;
            if (!BLOCKS[w.getBlock(x, y, z)].solid && !BLOCKS[w.getBlock(x, y + 1, z)].solid && BLOCKS[w.getBlock(x, y - 1, z)].solid) {
                p.setPos(x + 0.5, y, z + 0.5);
                return;
            }
        }
        p.setPos(c.x, c.y + 0.8, c.z);
    }

    /* ---------------- per frame ---------------- */

    //input: the rider's movement input (forward)
    update(dt, input) {
        const g = this.game;
        if (g.riding && input && input.sneak) {
            this.dismount();
        }
        let rem = Math.min(dt, 0.1);
        while (rem > 1e-4) {
            const h = Math.min(rem, 1 / 60);
            rem -= h;
            for (const c of this.list) {
                c.hitCd = Math.max(0, c.hitCd - h);
                this.step(c, h, input);
            }
            this.collide();
        }
        for (const c of this.list) {
            this.pose(c, dt);
        }
    }

    step(c, h, input) {
        const g = this.game, w = g.world;
        if (!w.isLoaded(Math.floor(c.x), Math.floor(c.z))) {
            return;
        }
        let r = this.railAt(c.x, c.y, c.z);
        if (r && c.air) {
            //Off the rails it only lands on a rail it has come down onto
            if (c.vy > 0.01 || c.y > r.by + 0.55 || c.y < r.by - 0.2) {
                r = null;
            } else {
                c.air = false;
                c.vy = 0;
            }
        }
        if (!r) {
            //Loose: it keeps its speed through the air and falls; a block
            //in the way stops it sideways but not its fall; on the ground
            //it slides to a stop (and sits level)
            c.air = true;
            c.slopeY = 0;
            c.vy -= 20 * h;
            const box = this.box(c);
            const my = moveAxis(w, box, 1, c.vy * h);
            const ground = c.vy < 0 && my > c.vy * h + 1e-6;
            if (my !== c.vy * h) {
                c.vy = 0;
            }
            //Sliding only with a block under its middle: a cart leaving a
            //track end grazes the last block without slowing
            if (ground && BLOCKS[w.getBlock(Math.floor(c.x), Math.floor(box[1] - 0.05), Math.floor(c.z))].solid) {
                c.vx *= Math.exp(-4 * h);
                c.vz *= Math.exp(-4 * h);
            }
            if (moveAxis(w, box, 0, c.vx * h) !== c.vx * h) {
                c.vx = 0;
            }
            if (moveAxis(w, box, 2, c.vz * h) !== c.vz * h) {
                c.vz = 0;
            }
            c.x = (box[0] + box[3]) / 2;
            c.y = box[1];
            c.z = (box[2] + box[5]) / 2;
            return;
        }
        const [a, b] = RAIL_EXITS[r.shape];
        const ax = r.bx + a[0], ay = r.by + a[1], az = r.bz + a[2];
        let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const len = Math.hypot(dx, dy, dz);
        dx /= len;
        dy /= len;
        dz /= len;
        let s = c.vx * dx + c.vy * dy + c.vz * dz;
        //Bends and slopes turn the cart without slowing it down
        const speed = Math.hypot(c.vx, c.vy, c.vz);
        if (Math.abs(s) > speed * 0.3) {
            s = Math.sign(s) * speed;
        }
        //Entering another rail block: carry on away from the end it came in
        //by. Two curves in a row (a U-turn) meet at a right angle, where
        //the speed would not carry over by projection.
        const key = r.bx + "," + r.by + "," + r.bz;
        let enter = 0;
        if (key !== c.railKey) {
            c.railKey = key;
            const t0 = ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / len;
            if (speed > 0.05 && (t0 < 0.25 || t0 > 0.75)) {
                enter = t0 < 0.5 ? 1 : -1;
                s = enter * speed;
            }
        }
        //Downhill pull
        s -= 12 * dy * h;
        if (r.id === B.POWERED_RAIL) {
            if (r.powered) {
                if (Math.abs(s) < 0.4) {
                    //Launch away from a wall at either end
                    const solidAt = (px, pz) => isOpaqueAt(w.getBlock(Math.floor(px), r.by, Math.floor(pz)), 0);
                    if (solidAt(ax - dx * 0.5, az - dz * 0.5)) {
                        s = 2;
                    } else if (solidAt(r.bx + b[0] + dx * 0.5, r.bz + b[2] + dz * 0.5)) {
                        s = -2;
                    }
                } else {
                    s += Math.sign(s) * 14 * h;
                }
            }
        }
        if (c.kind === "furnace" && c.fuel > 0) {
            const want = enter || (c.pushX * dx + c.pushZ * dz >= 0 ? 1 : -1);
            if (Math.abs(s) < 4 || Math.sign(s) !== want) {
                s += want * 7 * h;
            }
            c.fuel = Math.max(0, c.fuel - h);
            //Keep pushing along the track, through curves
            c.pushX = dx * want;
            c.pushZ = dz * want;
        }
        if (c.rider && input && input.forward > 0) {
            const p = g.player;
            const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
            if (Math.abs(s) < 4) {
                s += (lx * dx + lz * dz) * 4 * h;
            }
        }
        //Rolling and braking come last, after anything pushing: steady
        //decelerations, so the stopping distance grows with the speed
        const [coast, roll, brake] = this.loadOf(c);
        const slow = (dec) => (Math.abs(s) <= dec * h ? 0 : s - Math.sign(s) * dec * h);
        if (r.id === B.POWERED_RAIL && !r.powered) {
            //A player leaning on it moves it at a slow pace
            s = c.shove ? c.shove * BRAKE_PUSH : slow(brake);
            c.shove = 0;
            c.coast = 0;
            c.cruising = false;
        } else {
            c.shove = 0;
            //Reaching full speed it keeps going a while before it slows
            if (Math.abs(s) >= MAX_SPEED - 0.05) {
                if (!c.cruising) {
                    c.cruising = true;
                    c.coast = coast;
                }
            } else if (Math.abs(s) < MAX_SPEED - 1) {
                c.cruising = false;
                c.coast = 0;
            }
            if (c.coast > 0) {
                c.coast -= Math.abs(s) * h;
            } else {
                s = slow(roll);
            }
        }
        s = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, s));
        //The slope it runs on, for tilting the model (pose)
        c.slopeX = dx;
        c.slopeY = dy;
        c.slopeZ = dz;
        //Advance along the path of this rail block
        const px = c.x - ax, py = c.y - ay, pz = c.z - az;
        let t = (px * dx + py * dy + pz * dz) / len + s * h / len;
        let nx = ax + dx * len * t, ny = ay + dy * len * t, nz = az + dz * len * t;
        if ((t < 0 || t > 1) && !this.railAt(nx, ny, nz)) {
            //The rail ends. Into open space the cart carries on with its
            //speed off the rails (and falls if nothing is below); into a
            //block it stops at the buffer.
            const end = t > 1 ? b : a, out = t > 1 ? 0.01 : -0.01;
            const beyond = w.getBlock(Math.floor(r.bx + end[0] + dx * out), Math.floor(r.by + end[1] + 0.01), Math.floor(r.bz + end[2] + dz * out));
            if (!BLOCKS[beyond].solid && Math.abs(s) > 0.05) {
                c.x = nx;
                c.y = ny;
                c.z = nz;
                c.vx = dx * s;
                c.vy = dy * s;
                c.vz = dz * s;
                c.air = true;
                c.railKey = null;
                return;
            }
            //(just inside the end, so the cart is still found on this rail)
            t = Math.max(0.001, Math.min(0.999, t));
            nx = ax + dx * len * t;
            ny = ay + dy * len * t;
            nz = az + dz * len * t;
            s = 0;
        }
        c.x = nx;
        c.y = ny;
        c.z = nz;
        c.vx = dx * s;
        c.vy = dy * s;
        c.vz = dz * s;
        if (Math.abs(s) > 0.02) {
            c.yaw = Math.atan2(dx * Math.sign(s), dz * Math.sign(s));
        }
        //Lift the rider's step: a player walking into a cart gives it a nudge
        const p = g.player;
        if (!c.rider && !p.dead && Math.abs(p.x - c.x) < 0.8 && Math.abs(p.z - c.z) < 0.8 && p.y < c.y + 0.7 && p.y + 1.8 > c.y) {
            const ex = c.x - p.x, ez = c.z - p.z, l = Math.hypot(ex, ez) || 1;
            const dot = (ex / l) * dx + (ez / l) * dz;
            if (r.id === B.POWERED_RAIL && !r.powered) {
                //On a brake the push sets a slow pace (next step) instead,
                //and the cart holds the player back to it so they lean on it
                //rather than walk through it
                c.shove = Math.sign(dot);
                const along = (p.x - c.x) * dx + (p.z - c.z) * dz;
                const side = Math.abs((p.x - c.x) * dz - (p.z - c.z) * dx);
                if (c.shove && side < 0.6 && Math.abs(along) < 0.75) {
                    const fix = -c.shove * 0.75 - along;
                    p.x += dx * fix;
                    p.z += dz * fix;
                }
            } else {
                const push = dot * 3 * h;
                c.vx += dx * push;
                c.vz += dz * push;
            }
        }
    }

    //Carts bump into each other (equal masses swap their speeds)
    collide() {
        const L = this.list;
        for (let i = 0; i < L.length; i++) {
            for (let j = i + 1; j < L.length; j++) {
                const a = L[i], b = L[j];
                const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
                if (d >= 1.0 || d < 1e-4 || Math.abs(a.y - b.y) > 0.9) {
                    continue;
                }
                const nx = dx / d, nz = dz / d;
                const va = a.vx * nx + a.vz * nz, vb = b.vx * nx + b.vz * nz;
                if (va - vb > 0) {
                    a.vx += (vb - va) * nx;
                    a.vz += (vb - va) * nz;
                    b.vx += (va - vb) * nx;
                    b.vz += (va - vb) * nz;
                }
                const push = (1.0 - d) / 2;
                a.x -= nx * push;
                a.z -= nz * push;
                b.x += nx * push;
                b.z += nz * push;
            }
        }
    }

    pose(c, dt) {
        const g = c.model.group;
        g.position.set(c.x, c.y, c.z);
        //Tilt with the slope: how much the rail rises along the way the
        //cart faces (its model points along local +z)
        const along = (c.slopeX || 0) * Math.sin(c.yaw) + (c.slopeZ || 0) * Math.cos(c.yaw);
        const run = Math.hypot(c.slopeX || 0, c.slopeZ || 0) || 1;
        const want = c.slopeY ? -Math.atan2(c.slopeY * (along < 0 ? -1 : 1), run) : 0;
        c.pitch = (c.pitch || 0) + (want - (c.pitch || 0)) * Math.min(1, dt * 14);
        g.rotation.set(c.pitch, c.yaw, 0, "YXZ");
        const w = this.game.world;
        const fx = Math.floor(c.x), fy = Math.floor(c.y + 0.5), fz = Math.floor(c.z);
        const sky = w.getSky(fx, fy, fz) / 15, blk = Math.max(w.getBlockLight(fx, fy, fz), this.renderer.dyn.at(fx, fy, fz)) / 15;
        const bright = this.renderer.objectLight(sky, blk);
        for (const m of c.model.mats) {
            m.color.copy(m.userData.base).multiplyScalar(bright);
        }
        if (c.model.cargo) {
            this.renderer.setMeshLight(c.model.cargo, sky, Math.max(blk, c.fuel > 0 ? 0.8 : 0));
        }
        if (c.kind === "furnace" && c.fuel > 0) {
            c.smoke -= dt;
            if (c.smoke <= 0) {
                c.smoke = 0.15;
                this.renderer.spawnParticles(c.x, c.y + 1.0, c.z, [70, 70, 74], 2, 0.15, 1);
            }
        }
    }

    /* ---------------- save data ---------------- */

    serialize() {
        return this.list.map((c) => ({
            kind: c.kind, x: c.x, y: c.y, z: c.z, vx: c.vx, vz: c.vz, yaw: c.yaw,
            slots: c.slots, fuel: c.fuel, pushX: c.pushX, pushZ: c.pushZ
        }));
    }

    load(list) {
        if (!Array.isArray(list)) {
            return;
        }
        for (const d of list) {
            if (CART_ITEM[d.kind]) {
                this.spawn(d.kind, d.x, d.y, d.z, d);
            }
        }
    }
}
