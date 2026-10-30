/*
    Blocky - player.js

    Player movement and survival stats.

    Movement: walking, sprinting, sneaking (which keeps you from walking off
    edges), jumping, swimming, ladder climbing and creative flight, with a
    0.6 block auto-step so slabs can be walked up.

    Survival: 20 health points, 20 food points with a hidden saturation
    buffer and exhaustion counter. Exhaustion comes from actions and from a
    slow constant drain whose speed depends on the difficulty. A full food
    bar regenerates health; an empty one starves you (how far depends on the
    difficulty again).
*/

import { B, isOpaqueAt } from "./blocks.js";
import { moveAxis, regionBlocked, gatherBoxes } from "./physics.js";
import { waterHeight } from "./mesher.js";
import { clamp } from "./util.js";

export const DIFFICULTY = [
    //drain: exhaustion per second while idle; mult: multiplier on action exhaustion
    { name: "Peaceful", drain: 0, mult: 0, starveFloor: 20 },
    { name: "Easy", drain: 0.012, mult: 0.75, starveFloor: 10 },
    { name: "Normal", drain: 0.025, mult: 1.0, starveFloor: 1 },
    { name: "Hard", drain: 0.045, mult: 1.5, starveFloor: 0 }
];

const HALF_W = 0.3, HEIGHT = 1.8, EYE = 1.62, STEP = 0.6;

export class Player {
    constructor(world) {
        this.world = world;
        this.x = 0; this.y = 80; this.z = 0;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.yaw = 0; this.pitch = 0;
        this.onGround = false;
        this.inWater = false;
        this.headInWater = false;
        this.onLadder = false;
        this.flying = false;
        this.sneaking = false;
        this.sprinting = false;
        this.horizontalHit = false;
        this.fallDistance = 0;
        this.walkDist = 0;
        this.creative = false;
        this.difficulty = 2;
        this.health = 20;
        this.food = 20;
        this.saturation = 5;
        this.exhaustion = 0;
        this.air = 15;
        this.regenTimer = 0;
        this.starveTimer = 0;
        this.drownTimer = 0;
        this.cactusTimer = 0;
        this.hurtTime = 0;
        this.dead = false;
        this.events = [];
    }

    get eyeY() {
        return this.y + EYE - (this.sneaking && !this.flying ? 0.12 : 0);
    }

    box() {
        return [this.x - HALF_W, this.y, this.z - HALF_W, this.x + HALF_W, this.y + HEIGHT, this.z + HALF_W];
    }

    setPos(x, y, z) {
        this.x = x; this.y = y; this.z = z;
        this.vx = this.vy = this.vz = 0;
        this.fallDistance = 0;
    }

    //Does the voxel at (x, y, z) contain the given world point under water?
    waterAt(px, py, pz) {
        const w = this.world;
        const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
        if (w.getBlock(x, y, z) !== B.WATER) {
            return false;
        }
        const h = waterHeight(w.getMeta(x, y, z), w.getBlock(x, y + 1, z) === B.WATER);
        return py - y < h + 0.02;
    }

    sense() {
        const w = this.world;
        this.inWater = this.waterAt(this.x, this.y + 0.25, this.z) || this.waterAt(this.x, this.y + 0.9, this.z);
        this.headInWater = this.waterAt(this.x, this.eyeY, this.z);
        this.onLadder = false;
        const b = this.box();
        for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++) {
            for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) {
                for (let y = Math.floor(b[1]); y <= Math.floor(b[4]); y++) {
                    if (w.getBlock(x, y, z) === B.LADDER) {
                        this.onLadder = true;
                    }
                }
            }
        }
    }

    //input: forward, strafe (-1..1), jump, sneak, sprint (bools)
    update(dt, input) {
        this.sense();
        const w = this.world;
        if (!this.creative) {
            this.flying = false;
        }
        this.sneaking = !!input.sneak && !this.flying;
        const canSprint = this.creative || this.food > 6 || this.difficulty === 0;
        if (input.sprint && input.forward > 0 && !this.sneaking && canSprint) {
            this.sprinting = true;
        }
        if (input.forward <= 0 || this.sneaking || !canSprint || (this.horizontalHit && !this.flying)) {
            this.sprinting = false;
        }

        //Horizontal intent
        let fx = input.forward, sx = input.strafe;
        const len = Math.hypot(fx, sx);
        if (len > 1) {
            fx /= len;
            sx /= len;
        }
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const wx = -sin * fx + cos * sx;
        const wz = -cos * fx - sin * sx;
        let speed;
        if (this.flying) {
            speed = this.sprinting ? 21.6 : 10.9;
        } else if (this.inWater) {
            speed = this.sprinting ? 3.2 : 2.2;
        } else if (this.sneaking) {
            speed = 1.3;
        } else {
            speed = this.sprinting ? 5.6 : 4.3;
        }
        let accel;
        if (this.flying) {
            accel = 7;
        } else if (this.inWater) {
            accel = 6;
        } else if (this.onGround) {
            accel = 16;
        } else {
            accel = 2.6;
        }
        const k = 1 - Math.exp(-accel * dt);
        this.vx += (wx * speed - this.vx) * k;
        this.vz += (wz * speed - this.vz) * k;

        //Vertical
        if (this.flying) {
            const ty = (input.jump ? 8.5 : 0) - (input.sneak ? 8.5 : 0);
            this.vy += (ty - this.vy) * (1 - Math.exp(-10 * dt));
        } else if (this.inWater) {
            this.vy -= 10 * dt;
            this.vy *= Math.exp(-2.2 * dt);
            if (input.jump) {
                this.vy = Math.min(this.vy + 26 * dt, 3.2);
                if (this.horizontalHit) {
                    this.vy = 4.5;
                }
            }
            this.vy = Math.max(this.vy, -3.5);
        } else {
            this.vy -= 32 * dt;
            this.vy = Math.max(this.vy, -60);
            if (input.jump && this.onGround) {
                this.vy = 9.0;
                if (this.sprinting) {
                    this.vx += -sin * 2.0;
                    this.vz += -cos * 2.0;
                    this.exhaust(0.2);
                } else {
                    this.exhaust(0.05);
                }
            }
        }
        if (this.onLadder && !this.flying) {
            this.fallDistance = 0;
            this.vy = Math.max(this.vy, -2.4);
            if (this.horizontalHit || input.jump) {
                this.vy = 2.4;
            } else if (this.sneaking) {
                this.vy = Math.max(this.vy, 0);
            }
        }

        //Move and collide
        const box = this.box();
        const dx = this.vx * dt, dy = this.vy * dt, dz = this.vz * dt;
        const wasGround = this.onGround;
        const my = moveAxis(w, box, 1, dy);
        this.onGround = dy < 0 && my > dy + 1e-6;
        if (my !== dy) {
            this.vy = 0;
        }
        let mx = dx, mz = dz;
        //Sneaking keeps you on the block you stand on
        if (this.sneaking && this.onGround) {
            const below = (b, ox, oz) => regionBlocked(w, b[0] + ox, b[1] - 0.6, b[2] + oz, b[3] + ox, b[1] - 0.001, b[5] + oz);
            if (mx !== 0 && !below(box, mx, 0)) {
                mx = 0;
                this.vx = 0;
            }
            if (mz !== 0 && !below(box, mx, mz)) {
                mz = 0;
                this.vz = 0;
            }
        }
        const start = box.slice();
        const rx = moveAxis(w, box, 0, mx);
        const rz = moveAxis(w, box, 2, mz);
        let hitX = Math.abs(rx - mx) > 1e-6, hitZ = Math.abs(rz - mz) > 1e-6;
        //Auto step for half blocks
        if ((hitX || hitZ) && (this.onGround || wasGround) && !this.flying) {
            const alt = start.slice();
            const up = moveAxis(w, alt, 1, STEP);
            const ax = moveAxis(w, alt, 0, mx);
            const az = moveAxis(w, alt, 2, mz);
            moveAxis(w, alt, 1, -up);
            if (ax * ax + az * az > rx * rx + rz * rz + 1e-6) {
                for (let i = 0; i < 6; i++) {
                    box[i] = alt[i];
                }
                hitX = Math.abs(ax - mx) > 1e-6;
                hitZ = Math.abs(az - mz) > 1e-6;
            }
        }
        if (hitX) {
            this.vx = 0;
        }
        if (hitZ) {
            this.vz = 0;
        }
        this.horizontalHit = hitX || hitZ;
        const oldY = this.y;
        this.x = (box[0] + box[3]) / 2;
        this.y = box[1];
        this.z = (box[2] + box[5]) / 2;

        //Distance based effects
        const moved = Math.hypot(this.x - (start[0] + start[3]) / 2, this.z - (start[2] + start[5]) / 2);
        if (this.onGround || this.inWater) {
            this.walkDist += moved;
        }
        if (!this.flying) {
            if (this.inWater) {
                this.exhaust(0.012 * moved);
            } else if (this.sprinting) {
                this.exhaust(0.1 * moved);
            }
        }

        //Falling
        if (this.flying || this.inWater || this.onLadder) {
            this.fallDistance = 0;
        } else if (this.y < oldY) {
            this.fallDistance += oldY - this.y;
        }
        if (this.onGround && !wasGround) {
            if (this.fallDistance > 3 && !this.creative) {
                const dmg = Math.floor(this.fallDistance - 3);
                if (dmg > 0) {
                    this.hurt(dmg, "fall");
                }
            }
            this.events.push({ type: "land", fall: this.fallDistance });
            this.fallDistance = 0;
        }
        if (this.onGround) {
            this.fallDistance = 0;
        }
        if (this.y < -40) {
            this.hurt(4, "void");
            this.vy = Math.max(this.vy, 0);
        }
    }

    /* ---------------- survival ---------------- */

    exhaust(v) {
        if (this.creative) {
            return;
        }
        this.exhaustion += v * DIFFICULTY[this.difficulty].mult;
    }

    hurt(amount, cause) {
        if (this.creative || this.dead || amount <= 0) {
            return;
        }
        if (this.hurtTime > 0 && cause !== "starve" && cause !== "drown") {
            return;
        }
        this.health = Math.max(0, this.health - amount);
        this.hurtTime = 0.5;
        this.exhaust(0.1);
        this.events.push({ type: "hurt", amount, cause });
        if (this.health <= 0) {
            this.dead = true;
            this.events.push({ type: "death", cause });
        }
    }

    kill(cause) {
        if (this.dead) {
            return;
        }
        this.health = 0;
        this.dead = true;
        this.events.push({ type: "death", cause });
    }

    eat(food) {
        this.food = Math.min(20, this.food + food.hunger);
        this.saturation = Math.min(this.food, this.saturation + food.sat);
    }

    //Called 20 times a second
    tick() {
        const dt = 0.05;
        if (this.hurtTime > 0) {
            this.hurtTime = Math.max(0, this.hurtTime - dt);
        }
        if (this.creative || this.dead) {
            this.air = 15;
            return;
        }
        const diff = DIFFICULTY[this.difficulty];
        //Constant drain, scaled by difficulty
        this.exhaustion += diff.drain * dt;
        while (this.exhaustion >= 4) {
            this.exhaustion -= 4;
            if (this.saturation > 0) {
                this.saturation = Math.max(0, this.saturation - 1);
            } else {
                this.food = Math.max(0, this.food - 1);
            }
        }
        if (this.difficulty === 0) {
            this.food = 20;
            this.regenTimer += dt;
            if (this.regenTimer >= 1 && this.health < 20) {
                this.regenTimer = 0;
                this.health = Math.min(20, this.health + 1);
            }
        } else if (this.food >= 18 && this.health < 20) {
            this.regenTimer += dt;
            if (this.regenTimer >= 4) {
                this.regenTimer = 0;
                this.health = Math.min(20, this.health + 1);
                this.exhaustion += 3;
            }
        } else {
            this.regenTimer = 0;
        }
        if (this.food <= 0) {
            this.starveTimer += dt;
            if (this.starveTimer >= 4) {
                this.starveTimer = 0;
                if (this.health > diff.starveFloor) {
                    this.hurt(1, "starve");
                }
            }
        } else {
            this.starveTimer = 0;
        }
        //Breath
        if (this.headInWater) {
            this.air -= dt;
            if (this.air <= -1) {
                this.air = 0;
                this.hurt(2, "drown");
            }
        } else {
            this.air = Math.min(15, this.air + dt * 5);
        }
        //Cactus prickles; a block in your head (fallen sand) suffocates
        this.cactusTimer = Math.max(0, this.cactusTimer - dt);
        if (this.cactusTimer === 0 && this.touching(B.CACTUS)) {
            this.cactusTimer = 0.5;
            this.hurt(1, "cactus");
        }
        const hx = Math.floor(this.x), hy = Math.floor(this.eyeY), hz = Math.floor(this.z);
        if (this.world.isLoaded(hx, hz) && isOpaqueAt(this.world.getBlock(hx, hy, hz), this.world.getMeta(hx, hy, hz))) {
            this.suffocateTimer = (this.suffocateTimer || 0) + dt;
            if (this.suffocateTimer >= 0.5) {
                this.suffocateTimer = 0;
                this.hurt(1, "suffocate");
            }
        } else {
            this.suffocateTimer = 0;
        }
    }

    touching(id) {
        const b = this.box();
        const e = 0.05;
        for (let x = Math.floor(b[0] - e); x <= Math.floor(b[3] + e); x++) {
            for (let z = Math.floor(b[2] - e); z <= Math.floor(b[5] + e); z++) {
                for (let y = Math.floor(b[1] - e); y <= Math.floor(b[4]); y++) {
                    if (this.world.getBlock(x, y, z) !== id) {
                        continue;
                    }
                    const cx0 = x + 0.0625, cx1 = x + 0.9375, cz0 = z + 0.0625, cz1 = z + 0.9375;
                    if (b[0] - e < cx1 && b[3] + e > cx0 && b[2] - e < cz1 && b[5] + e > cz0 && b[1] - e < y + 1 && b[4] > y) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    //Would a solid block at (x, y, z) intersect the player?
    intersectsBlock(x, y, z) {
        const b = this.box();
        return b[0] < x + 1 && b[3] > x && b[1] < y + 1 && b[4] > y && b[2] < z + 1 && b[5] > z;
    }

    respawn(spawn) {
        this.setPos(spawn.x, spawn.y, spawn.z);
        this.health = 20;
        this.food = 20;
        this.saturation = 5;
        this.exhaustion = 0;
        this.air = 15;
        this.dead = false;
        this.hurtTime = 0;
    }

    serialize() {
        return {
            x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
            health: this.health, food: this.food, saturation: this.saturation, exhaustion: this.exhaustion,
            air: this.air, flying: this.flying
        };
    }

    load(d) {
        if (!d) {
            return;
        }
        this.setPos(d.x, d.y, d.z);
        this.yaw = d.yaw || 0;
        this.pitch = clamp(d.pitch || 0, -1.55, 1.55);
        this.health = d.health ?? 20;
        this.food = d.food ?? 20;
        this.saturation = d.saturation ?? 5;
        this.exhaustion = d.exhaustion ?? 0;
        this.air = d.air ?? 15;
        this.flying = !!d.flying;
    }
}

export { gatherBoxes };
