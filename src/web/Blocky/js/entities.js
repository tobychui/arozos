/*
    Blocky - entities.js

    Dropped items (small spinning blocks or flat sprites that the player
    picks up) and falling blocks (sand and gravel that lost their support).
    There are no creatures in Blocky.
*/

import { B, BLOCKS } from "./blocks.js";
import { moveAxis } from "./physics.js";

const ITEM_HALF = 0.125;
const DESPAWN = 300;

export class Entities {
    constructor(renderer) {
        this.renderer = renderer;
        this.items = [];
        this.falling = [];
    }

    clear() {
        for (const e of this.items) {
            this.renderer.disposeItemMesh(e.mesh);
        }
        for (const e of this.falling) {
            this.renderer.disposeItemMesh(e.mesh);
        }
        this.items = [];
        this.falling = [];
    }

    spawnItem(x, y, z, id, count, dmg = 0, vel = null, pickupDelay = 0.5) {
        if (this.items.length > 300) {
            const old = this.items.shift();
            this.renderer.disposeItemMesh(old.mesh);
        }
        const mesh = this.renderer.makeItemMesh(id);
        mesh.scale.setScalar(mesh.userData.cube ? 0.25 : 0.42);
        this.renderer.scene.add(mesh);
        const v = vel || [(Math.random() - 0.5) * 2.4, 2.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2.4];
        this.items.push({
            x, y, z, vx: v[0], vy: v[1], vz: v[2], id, count, dmg, age: 0, delay: pickupDelay,
            spin: Math.random() * Math.PI * 2, mesh
        });
    }

    spawnFalling(x, y, z, id, meta) {
        const mesh = this.renderer.makeItemMesh(id);
        mesh.scale.setScalar(0.999);
        this.renderer.scene.add(mesh);
        this.falling.push({ x: x + 0.5, y: y, z: z + 0.5, vy: 0, id, meta, mesh, age: 0 });
    }

    update(dt, world, player, inventory, onPickup) {
        const r = this.renderer;
        for (let i = this.items.length - 1; i >= 0; i--) {
            const e = this.items[i];
            e.age += dt;
            const here = world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
            if (e.age > DESPAWN || here === B.LAVA || here === B.FIRE) {
                r.disposeItemMesh(e.mesh);
                this.items.splice(i, 1);
                continue;
            }
            //Attraction to the player
            const px = player.x, py = player.y + 0.8, pz = player.z;
            const dx = px - e.x, dy = py - e.y, dz = pz - e.z;
            const dist = Math.hypot(dx, dy, dz);
            const canPick = e.age > e.delay && !player.dead;
            if (canPick && dist < 1.8) {
                const k = 10 * dt / Math.max(0.3, dist);
                e.vx += dx * k * 3;
                e.vy += dy * k * 3;
                e.vz += dz * k * 3;
                if (dist < 0.7) {
                    const left = inventory.add(e.id, e.count, e.dmg);
                    if (left < e.count) {
                        onPickup(e.id, e.count - left);
                    }
                    if (left === 0) {
                        r.disposeItemMesh(e.mesh);
                        this.items.splice(i, 1);
                        continue;
                    }
                    e.count = left;
                }
            }
            const inWater = world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === B.WATER;
            e.vy -= (inWater ? 4 : 18) * dt;
            if (inWater) {
                e.vy = Math.max(e.vy, -1.5);
                if (world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.3), Math.floor(e.z)) === B.WATER) {
                    e.vy += 8 * dt;
                }
            }
            const box = [e.x - ITEM_HALF, e.y - ITEM_HALF, e.z - ITEM_HALF, e.x + ITEM_HALF, e.y + ITEM_HALF, e.z + ITEM_HALF];
            //Pushed out of blocks it ended up inside of
            const inside = BLOCKS[world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))];
            if (inside.solid && inside.shape === "cube") {
                e.y += 4 * dt;
                e.vy = 0;
            } else {
                const my = moveAxis(world, box, 1, e.vy * dt);
                const onGround = e.vy < 0 && my > e.vy * dt + 1e-6;
                if (my !== e.vy * dt) {
                    e.vy = 0;
                }
                if (moveAxis(world, box, 0, e.vx * dt) !== e.vx * dt) {
                    e.vx = 0;
                }
                if (moveAxis(world, box, 2, e.vz * dt) !== e.vz * dt) {
                    e.vz = 0;
                }
                const fr = Math.exp(-(onGround ? 8 : 1) * dt);
                e.vx *= fr;
                e.vz *= fr;
                e.x = (box[0] + box[3]) / 2;
                e.y = (box[1] + box[4]) / 2;
                e.z = (box[2] + box[5]) / 2;
            }
            e.spin += dt * 1.6;
            const bob = Math.sin(e.age * 2.5) * 0.06 + 0.1;
            e.mesh.position.set(e.x, e.y + bob, e.z);
            e.mesh.rotation.y = e.spin;
            const lx = Math.floor(e.x), ly = Math.floor(e.y), lz = Math.floor(e.z);
            r.setMeshLight(e.mesh, world.getSky(lx, ly, lz) / 15, world.getBlockLight(lx, ly, lz) / 15);
        }

        for (let i = this.falling.length - 1; i >= 0; i--) {
            const e = this.falling[i];
            e.age += dt;
            e.vy = Math.max(-40, e.vy - 30 * dt);
            const ny = e.y + e.vy * dt;
            const bx = Math.floor(e.x), bz = Math.floor(e.z);
            const below = world.getBlock(bx, Math.floor(ny), bz);
            const landed = !world.canFallInto(below) || ny <= 0 || e.age > 20;
            if (landed) {
                const ty = Math.floor(ny) + 1;
                r.disposeItemMesh(e.mesh);
                this.falling.splice(i, 1);
                const cur = world.getBlock(bx, ty, bz);
                if (world.canFallInto(cur) && ty < 128) {
                    if (cur !== B.AIR && cur !== B.WATER) {
                        world.breakNaturally(bx, ty, bz);
                    }
                    world.setBlock(bx, ty, bz, e.id, e.meta);
                } else {
                    this.spawnItem(e.x, ty + 0.5, e.z, e.id, 1);
                }
                continue;
            }
            e.y = ny;
            e.mesh.position.set(e.x, e.y + 0.5, e.z);
            r.setMeshLight(e.mesh, world.getSky(bx, Math.floor(e.y), bz) / 15, world.getBlockLight(bx, Math.floor(e.y), bz) / 15);
        }
    }

    serialize() {
        return this.items.map((e) => ({ x: e.x, y: e.y, z: e.z, id: e.id, count: e.count, dmg: e.dmg, age: e.age }));
    }

    load(list) {
        if (!Array.isArray(list)) {
            return;
        }
        for (const e of list) {
            this.spawnItem(e.x, e.y, e.z, e.id, e.count, e.dmg || 0, [0, 0, 0], 0);
            this.items[this.items.length - 1].age = e.age || 0;
        }
    }
}
