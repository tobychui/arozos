/*
    Blocky - entities.js

    Dropped items (small spinning blocks or flat sprites that the player
    picks up) and falling blocks (sand and gravel that lost their support).
    A cactus destroys dropped items on touch (top included). Lava and fire
    burn them up: the item stops, sinks and chars under a flame for BURN_TIME
    seconds, out of reach of the player and of feeders, and is gone.
*/

import { B, BLOCKS } from "./blocks.js";
import { moveAxis, touchingBlock } from "./physics.js";
import { waterHeight } from "./shapes.js";

export const ITEM_HALF = 0.125;
const DESPAWN = 300;
//How long an item takes to burn up, how fast it sinks meanwhile, and the
//least time between two burn sounds (a chest cart's load lands all at once)
const BURN_TIME = 1.4;
const BURN_SINK = 0.2;
const BURN_SOUND_GAP = 0.15;

export class Entities {
    constructor(renderer) {
        this.renderer = renderer;
        this.items = [];
        this.falling = [];
        this.burnSoundCd = 0;
    }

    disposeItem(e) {
        this.renderer.disposeItemMesh(e.mesh);
        if (e.flame) {
            this.renderer.disposeItemMesh(e.flame);
        }
    }

    clear() {
        for (const e of this.items) {
            this.disposeItem(e);
        }
        for (const e of this.falling) {
            this.renderer.disposeItemMesh(e.mesh);
        }
        this.items = [];
        this.falling = [];
    }

    spawnItem(x, y, z, id, count, dmg = 0, vel = null, pickupDelay = 0.5) {
        if (this.items.length > 300) {
            this.disposeItem(this.items.shift());
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

    //An item has just come to lava or fire
    startBurn(e, here, world, onBurn) {
        const r = this.renderer;
        const x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
        e.burn = 0;
        e.vx = e.vy = e.vz = 0;
        e.spark = 0;
        e.size = e.mesh.scale.x;
        //The flame stands on the lava's surface, or where the item is in a fire
        e.burnY = here === B.LAVA ? y + waterHeight(world.getMeta(x, y, z), world.getBlock(x, y + 1, z) === B.LAVA) : e.y - ITEM_HALF;
        e.flame = r.makeFlameMesh();
        e.flame.rotation.y = Math.random() * Math.PI;
        r.scene.add(e.flame);
        r.spawnParticles(e.x, e.burnY + 0.05, e.z, [255, 130, 40], 8, 0.1, 2.5);
        if (this.burnSoundCd <= 0 && onBurn) {
            this.burnSoundCd = BURN_SOUND_GAP;
            onBurn(e, BURN_TIME);
        }
    }

    //One frame of burning. Returns true once the item has burnt up.
    burnStep(e, dt, world) {
        const r = this.renderer;
        e.burn += dt;
        const k = e.burn / BURN_TIME;
        if (k >= 1) {
            r.spawnParticles(e.x, e.burnY + 0.15, e.z, [70, 70, 74], 7, 0.12, 0.9, 1, -3);
            r.spawnParticles(e.x, e.burnY + 0.1, e.z, [255, 170, 60], 5, 0.1, 2);
            return true;
        }
        const sunk = e.y - BURN_SINK * dt;
        if (!BLOCKS[world.getBlock(Math.floor(e.x), Math.floor(sunk - ITEM_HALF), Math.floor(e.z))].solid) {
            e.y = sunk;
        }
        e.spin += dt * 0.8;
        e.mesh.position.set(e.x, e.y + 0.04, e.z);
        e.mesh.rotation.y = e.spin;
        e.mesh.scale.setScalar(e.size * (1 - 0.55 * k));
        r.setMeshBrightness(e.mesh, 1 - 0.88 * k);
        //Flares up, then dies down with the last of the item
        const f = Math.max(0.01, Math.min(1, k * 5, (1 - k) * 4));
        e.flame.scale.set(0.62 * f, 0.8 * f, 0.62 * f);
        e.flame.position.set(e.x, e.burnY + 0.37 * f, e.z);
        e.spark -= dt;
        if (e.spark <= 0) {
            e.spark = 0.07;
            const hot = Math.random() < 0.5 ? [255, 190, 70] : [255, 100, 25];
            r.spawnParticles(e.x, e.burnY + 0.12, e.z, hot, 2, 0.13, 1.1, 1, -6);
            if (k > 0.4) {
                r.spawnParticles(e.x, e.burnY + 0.35, e.z, [60, 60, 64], 1, 0.1, 0.8, 1, -3);
            }
        }
        return false;
    }

    //onBurn(item, seconds): an item has started to burn (not called for
    //every item of a batch landing together)
    update(dt, world, player, inventory, onPickup, onBurn) {
        const r = this.renderer;
        this.burnSoundCd = Math.max(0, this.burnSoundCd - dt);
        for (let i = this.items.length - 1; i >= 0; i--) {
            const e = this.items[i];
            e.age += dt;
            const here = world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
            if (e.age > DESPAWN) {
                this.disposeItem(e);
                this.items.splice(i, 1);
                continue;
            }
            if (e.burn === undefined && (here === B.LAVA || here === B.FIRE)) {
                this.startBurn(e, here, world, onBurn);
            }
            if (e.burn !== undefined) {
                if (this.burnStep(e, dt, world)) {
                    this.disposeItem(e);
                    this.items.splice(i, 1);
                }
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
                if (touchingBlock(world, box, B.CACTUS, 0.02)) {
                    r.disposeItemMesh(e.mesh);
                    this.items.splice(i, 1);
                    continue;
                }
            }
            e.spin += dt * 1.6;
            const bob = Math.sin(e.age * 2.5) * 0.06 + 0.1;
            e.mesh.position.set(e.x, e.y + bob, e.z);
            e.mesh.rotation.y = e.spin;
            const lx = Math.floor(e.x), ly = Math.floor(e.y), lz = Math.floor(e.z);
            r.setMeshLight(e.mesh, world.getSky(lx, ly, lz) / 15, Math.max(world.getBlockLight(lx, ly, lz), r.dyn.at(lx, ly, lz)) / 15);
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
            r.setMeshLight(e.mesh, world.getSky(bx, Math.floor(e.y), bz) / 15, Math.max(world.getBlockLight(bx, Math.floor(e.y), bz), r.dyn.at(bx, Math.floor(e.y), bz)) / 15);
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
