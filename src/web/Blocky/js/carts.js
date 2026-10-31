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
        for (const by of [fy, fy - 1]) {
            const id = w.getBlock(bx, by, bz);
            if (id === B.RAIL || id === B.POWERED_RAIL) {
                const m = w.getMeta(bx, by, bz);
                return { id, bx, by, bz, shape: id === B.POWERED_RAIL ? m & 7 : Math.min(9, m & 15), powered: (m & 8) !== 0 };
            }
        }
        return null;
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
        const r = this.railAt(c.x, c.y, c.z);
        if (!r) {
            //Loose: fall and slide to a stop
            c.vy -= 20 * h;
            const box = this.box(c);
            const my = moveAxis(w, box, 1, c.vy * h);
            const ground = c.vy < 0 && my > c.vy * h + 1e-6;
            if (my !== c.vy * h) {
                c.vy = 0;
            }
            if (ground) {
                c.vx *= Math.exp(-4 * h);
                c.vz *= Math.exp(-4 * h);
            }
            moveAxis(w, box, 0, c.vx * h);
            moveAxis(w, box, 2, c.vz * h);
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
            } else {
                s *= Math.exp(-7 * h);
                if (Math.abs(s) < 0.05) {
                    s = 0;
                }
            }
        }
        if (c.kind === "furnace" && c.fuel > 0) {
            const want = c.pushX * dx + c.pushZ * dz >= 0 ? 1 : -1;
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
        s *= Math.exp(-0.3 * h);
        s = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, s));
        //Advance along the path of this rail block
        const px = c.x - ax, py = c.y - ay, pz = c.z - az;
        let t = (px * dx + py * dy + pz * dz) / len + s * h / len;
        let nx = ax + dx * len * t, ny = ay + dy * len * t, nz = az + dz * len * t;
        if ((t < 0 || t > 1) && !this.railAt(nx, ny, nz)) {
            //End of the line: stop at the buffer
            t = Math.max(0, Math.min(1, t));
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
            const push = ((ex / l) * dx + (ez / l) * dz) * 3 * h;
            c.vx += dx * push;
            c.vz += dz * push;
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
        g.rotation.y = c.yaw;
        const w = this.game.world;
        const fx = Math.floor(c.x), fy = Math.floor(c.y + 0.5), fz = Math.floor(c.z);
        const sky = w.getSky(fx, fy, fz) / 15, blk = w.getBlockLight(fx, fy, fz) / 15;
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
