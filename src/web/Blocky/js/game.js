/*
    Blocky - game.js

    One running world: ties together the world simulation, the player, the
    inventory, entities, weather and the day / night cycle, and turns input
    into actions (mining, placing, using items, eating).

    Time runs at 20 ticks per second; a full day is 24000 ticks (20 real
    minutes). Tick 0 is sunrise.
*/

import {
    B, BLOCKS, ITEMS, I, SHAPE, SOLID, blockDrops, breakSeconds, blockFaceLayer
} from "./blocks.js";
import { World, WORLD_H } from "./world.js";
import { BIOME, BIOME_NAMES } from "./worldgen.js";
import { Player, DIFFICULTY } from "./player.js";
import { Inventory } from "./inventory.js";
import { Entities } from "./entities.js";
import { selectionBox, collisionBoxes, FACE_DIR } from "./shapes.js";
import { deflateString, mulberry32, clamp, lerp } from "./util.js";

const TICK = 0.05;
const DAY = 24000;
const AUTOSAVE_SECONDS = 120;

const DEATH_TEXT = {
    fall: "You hit the ground too hard",
    drown: "You drowned",
    starve: "You starved to death",
    cactus: "You were pricked to death by a cactus",
    lightning: "You were struck by lightning",
    suffocate: "You suffocated in a wall",
    command: "You ended it with a command",
    void: "You fell out of the world"
};

export class Game {
    constructor(app, meta, state) {
        this.app = app;
        this.renderer = app.renderer;
        this.sound = app.sound;
        this.ui = app.ui;
        this.input = app.input;
        this.meta = meta;
        this.state = state;
        this.rng = mulberry32((Date.now() ^ meta.seed) | 0);
        this.paused = false;
        this.hideHud = false;
        this.debug = false;
        this.accum = 0;
        this.breaking = null;
        this.breakCooldown = 0;
        this.useCooldown = 0;
        this.eatT = 0;
        this.eatSound = 0;
        this.swing = 1;
        this.equip = 0;
        this.lastHeld = -1;
        this.lastSelected = -1;
        this.stepDist = 0;
        this.saving = false;
        this.saveTimer = AUTOSAVE_SECONDS;
        this.fovNow = 75;
        this.frameNo = 0;
        this.fps = 0;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
        this.placeOnGround = false;
        this.wasInWater = false;
        this.pickupSoundAt = 0;
        this.hit = null;
    }

    get settings() {
        return this.app.settings;
    }

    get creative() {
        return this.player.creative;
    }

    /* ---------------- setup ---------------- */

    async load(progress) {
        const meta = this.meta, state = this.state || {};
        this.world = new World(meta.seed, {
            onDrop: (x, y, z, id, n, dmg) => this.entities.spawnItem(x, y, z, id, n, dmg || 0),
            onFalling: (x, y, z, id, meta2) => this.entities.spawnFalling(x, y, z, id, meta2),
            onBlockBroken: (x, y, z, id) => this.blockParticles(x, y, z, id, 0, 10)
        });
        this.renderer.attachWorld(this.world);
        this.entities = new Entities(this.renderer);
        this.player = new Player(this.world);
        this.inventory = new Inventory();
        this.player.creative = meta.mode === "creative";
        this.player.difficulty = clamp(meta.difficulty ?? 2, 0, 3);
        this.ticks = state.ticks ?? 1000;
        //Every session starts with clear skies for 10-20 minutes
        this.weather = {
            state: "clear",
            timer: 12000 + Math.floor(this.rng() * 12000),
            rain: 0,
            thunder: 0,
            strikeIn: 4,
            flash: 0
        };
        this.world.load(state.world);
        if (state.spawn) {
            this.spawn = state.spawn;
        } else {
            const s = this.world.gen.findSpawn();
            this.spawn = { x: s.x, y: s.h + 1, z: s.z };
        }
        if (state.player) {
            this.player.load(state.player);
        } else {
            this.player.setPos(this.spawn.x, this.spawn.y, this.spawn.z);
            this.player.yaw = Math.PI * 0.75;
            this.placeOnGround = true;
        }
        this.inventory.load(state.inventory);
        if (!state.player && this.player.creative) {
            //A starter hotbar for creative worlds
            [B.GRASS, B.STONE, B.PLANKS, B.LOG, B.GLASS, B.BRICKS, B.TORCH, B.LAMP, B.WORKBENCH].forEach((id, i) => {
                this.inventory.slots[i] = { id, count: ITEMS[id].stack, dmg: 0 };
            });
        }

        //Stream the spawn area before showing it
        const R = this.settings.renderDistance;
        const pcx = Math.floor(this.player.x / 16), pcz = Math.floor(this.player.z / 16);
        const need = Math.min(R, 3);
        await new Promise((resolve) => {
            const step = () => {
                const t0 = performance.now();
                this.world.stream(pcx, pcz, R, t0 + 40);
                this.renderer.updateMeshes(this.world, this.player.x, this.player.z, need, t0 + 60);
                let ready = 0, total = 0;
                for (let dx = -need; dx <= need; dx++) {
                    for (let dz = -need; dz <= need; dz++) {
                        total++;
                        const c = this.world.chunkAt(pcx + dx, pcz + dz);
                        if (c && c.meshes && !c.dirty.some((d) => d)) {
                            ready++;
                        }
                    }
                }
                progress(ready / total);
                if (ready >= total) {
                    resolve();
                } else {
                    setTimeout(step, 0);
                }
            };
            step();
        });
        if (this.placeOnGround) {
            this.dropToGround();
        }
        this.entities.load(state.entities);
        this.ui.hudKey = "";
    }

    //Put the player on top of the column it stands in
    dropToGround() {
        const x = Math.floor(this.player.x), z = Math.floor(this.player.z);
        if (!this.world.isLoaded(x, z)) {
            return false;
        }
        let y = WORLD_H - 2;
        while (y > 1 && !SOLID[this.world.getBlock(x, y - 1, z)] && this.world.getBlock(x, y - 1, z) !== B.WATER) {
            y--;
        }
        this.player.setPos(this.player.x, y, this.player.z);
        this.placeOnGround = false;
        return true;
    }

    dispose() {
        this.entities.clear();
        this.renderer.detachWorld();
        this.renderer.setHeldItem(0);
        this.sound.setRain(0, false);
    }

    /* ---------------- per frame ---------------- */

    frame(dt, now) {
        const p = this.player, r = this.renderer, input = this.input;
        this.frameNo++;
        this.fpsAcc += dt;
        this.fpsFrames++;
        if (this.fpsAcc >= 0.5) {
            this.fps = Math.round(this.fpsFrames / this.fpsAcc);
            this.fpsAcc = 0;
            this.fpsFrames = 0;
        }
        this.handleKeys();
        const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
        const here = this.world.chunkAt(pcx, pcz);
        const ready = here && here.lit;

        if (!this.paused) {
            this.accum += dt;
            let n = 0;
            while (this.accum >= TICK && n < 5) {
                this.tick();
                this.accum -= TICK;
                n++;
            }
            if (n === 5) {
                this.accum = 0;
            }
            //Look
            const [mx, my] = input.consumeLook();
            if (input.locked && !this.ui.isOpen() && !p.dead) {
                const s = 0.0022 * this.settings.sensitivity;
                p.yaw -= mx * s;
                p.pitch -= my * s * (this.settings.invertY ? -1 : 1);
                p.pitch = clamp(p.pitch, -1.55, 1.55);
            }
            if (this.touchLook) {
                p.yaw -= this.touchLook[0];
                p.pitch = clamp(p.pitch - this.touchLook[1], -1.55, 1.55);
                this.touchLook = null;
            }
            //Move
            if (this.placeOnGround && ready) {
                this.dropToGround();
            }
            if (ready && !this.placeOnGround) {
                const mv = this.movementInput();
                let rem = Math.min(dt, 0.1);
                while (rem > 1e-4) {
                    const s = Math.min(rem, 1 / 60);
                    p.update(s, mv);
                    rem -= s;
                }
            }
            this.handlePlayerEvents();
            this.updateInteraction(dt);
            this.entities.update(dt, this.world, p, this.inventory, (id, count) => this.onPickup(id, count));
            r.updateParticles(dt, this.world);
            r.updateLightning(dt);
            this.updateWeather(dt);
            this.saveTimer -= dt;
            if (this.saveTimer <= 0) {
                this.saveTimer = AUTOSAVE_SECONDS;
                this.save(true);
            }
        } else {
            input.consumeLook();
        }

        //Streaming
        const R = this.settings.renderDistance;
        this.world.stream(pcx, pcz, R, now + 7);
        if (this.frameNo % 60 === 0) {
            for (const c of this.world.unloadFar(pcx, pcz, R)) {
                r.disposeChunk(c);
            }
        }
        this.pendingMeshes = r.updateMeshes(this.world, p.x, p.z, R, performance.now() + 7);

        this.updateCamera(dt);
        const env = r.applyEnvironment({
            time: this.ticks % DAY,
            day: Math.floor(this.ticks / DAY),
            rain: this.weather.rain,
            thunder: this.weather.thunder,
            flash: this.weather.flash,
            underwater: p.headInWater,
            renderDistance: R
        });
        this.world.skyDarken = Math.round((1 - env.day) * 11 + this.weather.rain * 2);
        this.world.raining = this.weather.rain > 0.5;
        const exposure = r.updateRain(dt, this.weather.rain, r.camera.position, this.world);
        this.sound.setRain(this.paused ? 0 : this.weather.rain * (0.2 + 0.8 * exposure), exposure < 0.25);

        //Held item
        const held = this.inventory.heldId();
        if (held !== this.lastHeld || this.inventory.selected !== this.lastSelected) {
            if (this.lastSelected !== -1) {
                this.equip = 1;
                this.ui.showItemName(held);
            }
            this.lastHeld = held;
            this.lastSelected = this.inventory.selected;
        }
        this.equip = Math.max(0, this.equip - dt * 6);
        this.swing = Math.min(1, this.swing + dt * 4);
        r.setHeldItem(held);
        const ex = Math.floor(p.x), ey = Math.floor(p.eyeY), ez = Math.floor(p.z);
        const bobOn = this.settings.viewBobbing && p.onGround && !p.flying;
        const phase = p.walkDist * Math.PI * 0.75;
        const amp = bobOn ? Math.min(1, Math.hypot(p.vx, p.vz) / 4.3) : 0;
        r.updateHand({
            swing: this.swing >= 1 ? 0 : this.swing,
            equip: this.equip,
            bobX: Math.sin(phase) * 0.03 * amp,
            bobY: -Math.abs(Math.cos(phase)) * 0.03 * amp,
            eat: this.eatT > 0 ? 1 : 0,
            eatT: this.eatT,
            sky: this.world.getSky(ex, ey, ez) / 15,
            blk: this.world.getBlockLight(ex, ey, ez) / 15
        });
        r.render(dt, !this.hideHud && !p.dead);

        this.ui.updateHud(this);
        document.getElementById("underwater").classList.toggle("on", p.headInWater);
        document.getElementById("hurt").classList.toggle("on", p.hurtTime > 0.3);
        this.updateDebug();
        input.endFrame();
    }

    movementInput() {
        const k = (c) => this.input.down(c);
        if (this.ui.isOpen() || this.player.dead || this.paused || this.app.chat.open) {
            return { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
        }
        const t = this.input.touchMove;
        let forward = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0) + t.forward;
        let strafe = (k("KeyD") || k("ArrowRight") ? 1 : 0) - (k("KeyA") || k("ArrowLeft") ? 1 : 0) + t.strafe;
        if (!k("KeyW") && !k("ArrowUp") && t.forward <= 0.7) {
            this.sprintTap = false;
        }
        return {
            forward: clamp(forward, -1, 1),
            strafe: clamp(strafe, -1, 1),
            jump: k("Space") || this.input.touchJump,
            sneak: k("ShiftLeft") || k("ShiftRight") || this.input.touchSneak,
            sprint: k("ControlLeft") || k("ControlRight") || this.sprintTap
        };
    }

    handleKeys() {
        const input = this.input, ui = this.ui, p = this.player;
        for (const code of input.pressed) {
            if (code === "KeyE") {
                if (ui.isOpen()) {
                    this.closeScreen();
                } else if (!this.paused && !p.dead) {
                    this.openScreen("inventory");
                }
            } else if (code === "Escape") {
                if (ui.isOpen()) {
                    this.closeScreen();
                }
            } else if ((code === "KeyT" || code === "Slash") && !ui.isOpen() && !this.paused && !p.dead) {
                this.app.chat.show(code === "Slash" ? "/" : "");
            } else if (code.startsWith("Digit")) {
                const n = Number(code.slice(5)) - 1;
                if (n >= 0 && n < 9) {
                    if (ui.isOpen()) {
                        ui.hotkey(n);
                    } else {
                        this.inventory.selected = n;
                    }
                }
            } else if (code === "KeyQ" && !ui.isOpen() && !this.paused && !p.dead) {
                this.dropHeld(input.down("ControlLeft") || input.down("ControlRight"));
            } else if (code === "F3") {
                this.debug = !this.debug;
            } else if (code === "F1") {
                this.hideHud = !this.hideHud;
                document.getElementById("hud").classList.toggle("bare", this.hideHud);
            }
        }
        if (input.doubleTaps.has("Space") && this.creative && !ui.isOpen()) {
            p.flying = !p.flying;
            p.vy = 0;
        }
        if (input.doubleTaps.has("KeyW")) {
            this.sprintTap = true;
        }
        const wheel = input.consumeWheel();
        if (wheel !== 0 && !ui.isOpen()) {
            this.inventory.selected = (this.inventory.selected + (wheel > 0 ? 1 : -1) + 9) % 9;
        }
    }

    /* ---------------- ticks ---------------- */

    tick() {
        this.ticks++;
        const p = this.player;
        this.world.tick(Math.floor(p.x / 16), Math.floor(p.z / 16));
        p.tick();
        const w = this.weather;
        w.timer--;
        if (w.timer <= 0) {
            if (w.state === "clear") {
                w.state = this.rng() < 0.7 ? "rain" : "thunder";
                w.timer = 3600 + Math.floor(this.rng() * 6000);
            } else if (w.state === "thunder" && this.rng() < 0.35) {
                w.state = "rain";
                w.timer = 2400 + Math.floor(this.rng() * 3600);
            } else {
                w.state = "clear";
                w.timer = 6000 + Math.floor(this.rng() * 14000);
            }
        }
        if (this.ui.isOpen() && this.ui.screen.kind === "furnace" && this.ticks % 2 === 0) {
            this.ui.renderScreen(false);
        }
    }

    updateWeather(dt) {
        const w = this.weather;
        const rainTarget = w.state === "clear" ? 0 : 1;
        const thunderTarget = w.state === "thunder" ? 1 : 0;
        const step = dt * 0.12;
        w.rain += clamp(rainTarget - w.rain, -step, step);
        w.thunder += clamp(thunderTarget - w.thunder, -step, step);
        w.flash = Math.max(0, w.flash - dt * 3.5);
        if (w.state === "thunder" && w.thunder > 0.6) {
            w.strikeIn -= dt;
            if (w.strikeIn <= 0) {
                w.strikeIn = 3 + this.rng() * 14;
                this.lightningStrike();
            }
        }
    }

    lightningStrike() {
        const p = this.player;
        const ang = this.rng() * Math.PI * 2, d = 6 + this.rng() * 70;
        const x = Math.floor(p.x + Math.cos(ang) * d), z = Math.floor(p.z + Math.sin(ang) * d);
        if (!this.world.isLoaded(x, z) || this.world.biomeAt(x, z) === BIOME.DESERT) {
            return;
        }
        const y = this.world.rainTop(x, z);
        this.renderer.strikeLightning(x + 0.5, y, z + 0.5);
        this.weather.flash = 1;
        const dist = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z, y - p.y);
        this.sound.play("thunder", { distance: dist });
        if (dist < 3.5) {
            p.hurt(5, "lightning");
        }
    }

    setWeather(state) {
        this.weather.state = state;
        this.weather.timer = state === "clear" ? 12000 : 6000;
        if (state === "thunder") {
            this.weather.strikeIn = 2;
        }
    }

    setTime(t) {
        this.ticks = Math.floor(this.ticks / DAY) * DAY + t + (t < this.ticks % DAY ? DAY : 0);
    }

    setMode(creative) {
        this.player.creative = creative;
        if (!creative) {
            this.player.flying = false;
        }
        this.meta.mode = creative ? "creative" : "survival";
        this.ui.hudKey = "";
    }

    setDifficulty(d) {
        this.player.difficulty = d;
        this.meta.difficulty = d;
    }

    /* ---------------- interaction ---------------- */

    eyeRay() {
        const p = this.player;
        const cp = Math.cos(p.pitch);
        return [p.x, p.eyeY, p.z, -Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
    }

    updateInteraction(dt) {
        const p = this.player, input = this.input, r = this.renderer;
        this.breakCooldown = Math.max(0, this.breakCooldown - dt);
        this.useCooldown = Math.max(0, this.useCooldown - dt);
        const active = !this.ui.isOpen() && !p.dead && !this.paused && !this.app.chat.open && (input.locked || this.touchActive);
        if (!active) {
            this.breaking = null;
            this.eatT = 0;
            r.setSelection(null);
            r.setCrack(null, 0);
            this.hit = null;
            return;
        }
        const [ox, oy, oz, dx, dy, dz] = this.eyeRay();
        const reach = this.creative ? 5.5 : 4.5;
        const hit = this.world.raycast(ox, oy, oz, dx, dy, dz, reach, selectionBox);
        this.hit = hit;
        r.setSelection(this.hideHud ? null : hit);

        const leftDown = input.buttons.has(0) || this.touchBreak;
        const rightDown = input.buttons.has(2);
        const rightClick = input.clicked.has(2) || this.touchUse;
        this.touchUse = false;

        //Mining
        if (leftDown) {
            if (input.clicked.has(0) || this.swing >= 1) {
                this.swing = 0;
            }
            if (this.creative) {
                if (hit && this.breakCooldown <= 0) {
                    this.breakBlock(hit, false);
                    this.breakCooldown = 0.22;
                }
                this.breaking = null;
            } else if (!hit) {
                this.breaking = null;
            } else {
                const same = this.breaking && this.breaking.x === hit.x && this.breaking.y === hit.y && this.breaking.z === hit.z && this.breaking.id === hit.id;
                if (!same) {
                    this.breaking = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, progress: 0, sound: 0 };
                }
                if (this.breakCooldown <= 0) {
                    const def = BLOCKS[hit.id];
                    let t = breakSeconds(def, this.inventory.heldId());
                    if (p.headInWater) {
                        t *= 5;
                    }
                    if (!p.onGround && !p.inWater && !p.onLadder) {
                        t *= 5;
                    }
                    const b = this.breaking;
                    b.progress = t <= 0 ? 1 : b.progress + dt / t;
                    b.sound -= dt;
                    if (b.sound <= 0 && b.progress < 1) {
                        b.sound = 0.24;
                        this.sound.block("dig", def.sound);
                        this.blockParticles(hit.x, hit.y, hit.z, hit.id, hit.meta, 2, hit.point);
                    }
                    if (b.progress >= 1) {
                        this.breakBlock(hit, true);
                        this.breaking = null;
                        this.breakCooldown = 0.25;
                    }
                }
            }
        } else {
            this.breaking = null;
        }
        r.setCrack(hit, this.breaking ? this.breaking.progress : 0);

        //Eating
        const held = this.inventory.held;
        const heldDef = held && ITEMS[held.id];
        if (rightDown && heldDef && heldDef.food && !this.creative && p.food < 20 && !(hit && BLOCKS[hit.id].interact && !p.sneaking)) {
            this.eatT += dt;
            this.eatSound -= dt;
            if (this.eatSound <= 0) {
                this.eatSound = 0.22;
                this.sound.play("eat");
            }
            if (this.eatT >= 1.6) {
                p.eat(heldDef.food);
                this.inventory.consumeHeld(1);
                if (heldDef.food.leaves) {
                    const left = this.inventory.add(heldDef.food.leaves, 1);
                    if (left) {
                        this.dropStack({ id: heldDef.food.leaves, count: 1 });
                    }
                }
                this.sound.play("burp");
                this.eatT = 0;
            }
            return;
        }
        this.eatT = 0;

        //Using / placing
        if (rightClick || (rightDown && this.useCooldown <= 0)) {
            if (this.useCooldown <= 0 || rightClick) {
                this.useCooldown = 0.25;
                this.useItem(hit);
            }
        }
    }

    blockParticles(x, y, z, id, meta, count, point) {
        const tex = this.app.tex;
        const layer = blockFaceLayer(id, 4, meta || 0);
        const name = tex.names[layer];
        let col = tex.avgColor.get(name) || [128, 128, 128];
        const def = BLOCKS[id];
        if (def.tint) {
            col = [col[0] * 0.55, col[1] * 0.9, col[2] * 0.4];
        }
        const light = Math.max(this.world.getSky(x, y + 1, z) / 15 * this.renderer.shared.uDaylight.value, this.world.getBlockLight(x, y + 1, z) / 15);
        const px = point ? point[0] : x + 0.5, py = point ? point[1] : y + 0.5, pz = point ? point[2] : z + 0.5;
        this.renderer.spawnParticles(px, py, pz, col, count, point ? 0.08 : 0.4, point ? 2 : 3, Math.max(0.15, light));
    }

    breakBlock(hit, survival) {
        const { x, y, z, id, meta } = hit;
        const def = BLOCKS[id];
        if (def.hardness < 0 && !this.creative) {
            return;
        }
        if (id === B.BEDROCK && !this.creative) {
            return;
        }
        this.world.setBlock(x, y, z, B.AIR, 0);
        this.sound.block("break", def.sound);
        this.blockParticles(x, y, z, id, meta, 18);
        if (survival) {
            const heldId = this.inventory.heldId();
            for (const [did, n] of blockDrops(id, meta, this.rng, heldId)) {
                this.entities.spawnItem(x + 0.5, y + 0.4, z + 0.5, did, n);
            }
            if (def.hardness > 0 && this.inventory.damageHeld(1)) {
                this.sound.play("toolBreak");
            }
            this.player.exhaust(0.005);
        }
    }

    useItem(hit) {
        const p = this.player, inv = this.inventory, w = this.world;
        const held = inv.held;
        const it = held && ITEMS[held.id];
        if (hit && BLOCKS[hit.id].interact && !p.sneaking) {
            this.interactBlock(hit);
            return;
        }
        //Buckets look for water too
        if (held && held.id === I.BUCKET) {
            const [ox, oy, oz, dx, dy, dz] = this.eyeRay();
            const wh = w.raycast(ox, oy, oz, dx, dy, dz, 4.5, (bid, m) => (bid === B.WATER && m === 0 ? [0, 0, 0, 1, 0.875, 1] : selectionBox(bid, m)));
            if (wh && wh.id === B.WATER && wh.meta === 0) {
                w.setBlock(wh.x, wh.y, wh.z, B.AIR, 0);
                this.sound.play("splash");
                this.swing = 0;
                if (!this.creative) {
                    inv.consumeHeld(1);
                    if (inv.held) {
                        if (inv.add(I.WATER_BUCKET, 1)) {
                            this.dropStack({ id: I.WATER_BUCKET, count: 1 });
                        }
                    } else {
                        inv.slots[inv.selected] = { id: I.WATER_BUCKET, count: 1, dmg: 0 };
                    }
                }
            }
            return;
        }
        if (!hit || !held) {
            return;
        }
        if (it.tool && it.tool.kind === "hoe") {
            if ((hit.id === B.GRASS || hit.id === B.DIRT) && hit.face !== 3 && w.getBlock(hit.x, hit.y + 1, hit.z) === B.AIR) {
                w.setBlock(hit.x, hit.y, hit.z, B.FARMLAND, 0);
                this.sound.block("step", "gravel");
                this.swing = 0;
                if (!this.creative && inv.damageHeld(1)) {
                    this.sound.play("toolBreak");
                }
            }
            return;
        }
        if (held.id === I.WATER_BUCKET) {
            const t = this.placeTarget(hit);
            if (t && (w.getBlock(t[0], t[1], t[2]) === B.AIR || BLOCKS[w.getBlock(t[0], t[1], t[2])].replaceable)) {
                const cur = w.getBlock(t[0], t[1], t[2]);
                if (cur !== B.AIR && cur !== B.WATER) {
                    w.breakNaturally(t[0], t[1], t[2]);
                }
                w.setBlock(t[0], t[1], t[2], B.WATER, 0);
                w.schedule(t[0], t[1], t[2], 5);
                this.sound.play("splash");
                this.swing = 0;
                if (!this.creative) {
                    inv.slots[inv.selected] = { id: I.BUCKET, count: 1, dmg: 0 };
                }
            }
            return;
        }
        if (it.plant) {
            if (hit.id === B.FARMLAND && hit.face === 2 && w.getBlock(hit.x, hit.y + 1, hit.z) === B.AIR) {
                w.setBlock(hit.x, hit.y + 1, hit.z, it.plant, 0);
                this.sound.block("place", "grass");
                this.swing = 0;
                if (!this.creative) {
                    inv.consumeHeld(1);
                }
            }
            return;
        }
        if (it.block) {
            this.placeBlock(hit, it.block);
        }
    }

    placeTarget(hit) {
        const def = BLOCKS[hit.id];
        if (def.replaceable && hit.id !== B.WATER) {
            return [hit.x, hit.y, hit.z];
        }
        const d = FACE_DIR[hit.face];
        return [hit.x + d[0], hit.y + d[1], hit.z + d[2]];
    }

    placeBlock(hit, bid) {
        const w = this.world, p = this.player, inv = this.inventory;
        const def = BLOCKS[bid];
        const face = hit.face;
        //Completing a slab into a double slab
        if (SHAPE[bid] === "slab" && hit.id === bid && ((hit.meta === 0 && face === 2) || (hit.meta === 1 && face === 3))) {
            this.finishPlace(hit.x, hit.y, hit.z, bid, 2);
            return;
        }
        const t = this.placeTarget(hit);
        const [x, y, z] = t;
        if (y < 0 || y >= WORLD_H) {
            return;
        }
        const cur = w.getBlock(x, y, z);
        const curMeta = w.getMeta(x, y, z);
        let meta = 0;
        if (SHAPE[bid] === "slab") {
            if (cur === bid && curMeta !== 2) {
                this.finishPlace(x, y, z, bid, 2);
                return;
            }
            meta = face === 3 ? 1 : face === 2 ? 0 : (hit.point[1] - hit.y > 0.5 ? 1 : 0);
        }
        if (!BLOCKS[cur].replaceable) {
            return;
        }
        if (bid === B.TORCH) {
            if (face === 3) {
                return;
            }
            meta = face;
        } else if (bid === B.LADDER) {
            if (face === 2 || face === 3) {
                return;
            }
            meta = face;
        } else if (def.orient) {
            const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
            if (Math.abs(lx) > Math.abs(lz)) {
                meta = lx > 0 ? 1 : 0;
            } else {
                meta = lz > 0 ? 5 : 4;
            }
        } else if (bid === B.LEAVES) {
            meta = 1;
        }
        if (def.support && !w.hasSupport(x, y, z, bid, meta)) {
            return;
        }
        if (SOLID[bid]) {
            const pb = p.box();
            for (const b of collisionBoxes(bid, meta)) {
                if (pb[0] < x + b[3] && pb[3] > x + b[0] && pb[1] < y + b[4] && pb[4] > y + b[1] && pb[2] < z + b[5] && pb[5] > z + b[2]) {
                    return;
                }
            }
        }
        if (cur !== B.AIR && cur !== B.WATER) {
            w.breakNaturally(x, y, z);
        }
        this.finishPlace(x, y, z, bid, meta);
    }

    finishPlace(x, y, z, bid, meta) {
        const w = this.world;
        if (!w.setBlock(x, y, z, bid, meta)) {
            return;
        }
        if (bid === B.FURNACE) {
            w.createTileEntity(x, y, z, "furnace");
        } else if (bid === B.CHEST) {
            w.createTileEntity(x, y, z, "chest");
        }
        this.sound.block("place", BLOCKS[bid].sound);
        this.swing = 0;
        if (!this.creative) {
            this.inventory.consumeHeld(1);
        }
    }

    interactBlock(hit) {
        const w = this.world;
        const kind = BLOCKS[hit.id].interact;
        if (kind === "workbench") {
            this.openScreen("workbench");
        } else {
            let te = w.getTileEntity(hit.x, hit.y, hit.z);
            if (!te) {
                te = w.createTileEntity(hit.x, hit.y, hit.z, kind);
            }
            this.openScreen(kind, te);
        }
    }

    /* ---------------- items ---------------- */

    dropHeld(whole) {
        const inv = this.inventory;
        const s = inv.held;
        if (!s) {
            return;
        }
        const n = whole ? s.count : 1;
        this.dropStack({ id: s.id, count: n, dmg: s.dmg || 0 });
        inv.consumeHeld(n);
        this.swing = 0;
    }

    dropStack(stack) {
        const p = this.player;
        const [, , , dx, dy, dz] = this.eyeRay();
        this.entities.spawnItem(p.x + dx * 0.4, p.eyeY - 0.3, p.z + dz * 0.4, stack.id, stack.count, stack.dmg || 0,
            [dx * 5, dy * 5 + 1.5, dz * 5], 1.5);
    }

    onPickup() {
        const now = performance.now();
        if (now - this.pickupSoundAt > 60) {
            this.pickupSoundAt = now;
            this.sound.play("pop");
        }
        this.ui.hudKey = "";
        if (this.ui.isOpen()) {
            this.ui.renderScreen(false);
        }
    }

    /* ---------------- screens ---------------- */

    openScreen(kind, te = null) {
        this.ui.open(kind, te);
        this.input.unlock();
    }

    closeScreen() {
        this.ui.close();
        this.app.resumePlay();
    }

    /* ---------------- player events ---------------- */

    handlePlayerEvents() {
        const p = this.player;
        for (const e of p.events) {
            if (e.type === "hurt") {
                this.sound.play("hurt");
            } else if (e.type === "death") {
                this.onDeath(e.cause);
            } else if (e.type === "land" && e.fall > 1.2) {
                const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
                this.sound.block("step", BLOCKS[id].sound);
            }
        }
        p.events.length = 0;
        //Footsteps
        if (p.onGround && !p.sneaking && p.walkDist - this.stepDist > 2.1) {
            this.stepDist = p.walkDist;
            const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
            if (id !== B.AIR) {
                this.sound.block("step", BLOCKS[id].sound);
            }
        } else if (p.walkDist - this.stepDist > 4) {
            this.stepDist = p.walkDist;
        }
        if (p.inWater && !this.wasInWater && p.vy < -3) {
            this.sound.play("splash");
        }
        this.wasInWater = p.inWater;
    }

    onDeath(cause) {
        const p = this.player;
        if (!this.creative) {
            for (const s of this.inventory.slots) {
                if (s) {
                    this.entities.spawnItem(p.x, p.y + 1, p.z, s.id, s.count, s.dmg || 0,
                        [(this.rng() - 0.5) * 5, 2 + this.rng() * 3, (this.rng() - 0.5) * 5], 1);
                }
            }
            this.inventory.clear();
        }
        this.ui.close();
        this.app.showDeath(DEATH_TEXT[cause] || "You died");
    }

    //Move the player; y null lands on the ground once the terrain is there
    teleport(x, y, z) {
        const p = this.player;
        if (y === null) {
            const fx = Math.floor(x), fz = Math.floor(z);
            const top = this.world.isLoaded(fx, fz) ? this.world.rainTop(fx, fz) : this.world.gen.column(fx, fz).h + 1;
            p.setPos(x, top, z);
            this.placeOnGround = true;
        } else {
            p.setPos(x, y, z);
        }
        this.breaking = null;
    }

    respawn() {
        const p = this.player;
        p.respawn({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
        this.placeOnGround = true;
        this.dropToGround();
        this.ui.hudKey = "";
    }

    /* ---------------- camera ---------------- */

    updateCamera(dt) {
        const p = this.player, cam = this.renderer.camera;
        let bx = 0, by = 0, roll = 0;
        if (this.settings.viewBobbing && p.onGround && !p.flying) {
            const phase = p.walkDist * Math.PI * 0.75;
            const amp = Math.min(1, Math.hypot(p.vx, p.vz) / 4.3);
            bx = Math.sin(phase) * 0.035 * amp;
            by = -Math.abs(Math.cos(phase)) * 0.06 * amp;
            roll = Math.sin(phase) * 0.006 * amp;
        }
        if (p.hurtTime > 0) {
            roll += Math.sin(p.hurtTime * 40) * 0.04 * p.hurtTime;
        }
        const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
        cam.position.set(p.x + cos * bx, p.eyeY + by, p.z - sin * bx);
        cam.rotation.set(p.pitch, p.yaw, roll);
        let fov = this.settings.fov;
        if (p.sprinting) {
            fov *= p.flying ? 1.15 : 1.1;
        }
        if (this.eatT > 0) {
            fov *= 0.98;
        }
        this.fovNow = lerp(this.fovNow, fov, 1 - Math.exp(-10 * dt));
        if (Math.abs(cam.fov - this.fovNow) > 0.01) {
            cam.fov = this.fovNow;
            cam.updateProjectionMatrix();
        }
    }

    updateDebug() {
        const el = document.getElementById("debug");
        const showFps = this.settings.showFps;
        if (!this.debug && !showFps) {
            el.classList.add("hidden");
            return;
        }
        el.classList.remove("hidden");
        if (!this.debug) {
            el.textContent = this.fps + " fps";
            return;
        }
        const p = this.player, w = this.world;
        const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
        const deg = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
        const facing = ["north (-Z)", "east (+X)", "south (+Z)", "west (-X)"][Math.round(deg / 90) % 4];
        const tod = this.ticks % DAY;
        const hours = Math.floor((tod / 1000 + 6) % 24), mins = Math.floor((tod % 1000) * 0.06);
        const lines = [
            `Blocky - ${this.fps} fps`,
            `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
            `Block: ${bx} ${by} ${bz}   Chunk: ${bx >> 4} ${bz >> 4}`,
            `Facing: ${facing}`,
            `Biome: ${BIOME_NAMES[w.biomeAt(bx, bz)]}`,
            `Light: sky ${w.getSky(bx, Math.floor(p.eyeY), bz)}, block ${w.getBlockLight(bx, Math.floor(p.eyeY), bz)}`,
            `Day ${Math.floor(this.ticks / DAY) + 1}, ${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
            `Weather: ${this.weather.state} (rain ${this.weather.rain.toFixed(2)})`,
            `Chunks: ${w.chunks.size} loaded, ${this.pendingMeshes || 0} sections queued`,
            `Entities: ${this.entities.items.length} items, ${this.entities.falling.length} falling`,
            `Mode: ${this.creative ? "Creative" : "Survival"} - ${DIFFICULTY[p.difficulty].name}`
        ];
        if (!this.creative) {
            lines.push(`Food ${p.food}  Saturation ${p.saturation.toFixed(1)}  Exhaustion ${p.exhaustion.toFixed(2)}`);
        }
        if (this.hit) {
            lines.push(`Looking at: ${BLOCKS[this.hit.id].name} (${this.hit.x}, ${this.hit.y}, ${this.hit.z}) meta ${this.hit.meta}`);
        }
        el.textContent = lines.join("\n");
    }

    /* ---------------- saving ---------------- */

    snapshot() {
        return {
            version: 1,
            ticks: this.ticks,
            weather: { state: this.weather.state, timer: this.weather.timer },
            spawn: this.spawn,
            player: this.player.serialize(),
            inventory: this.inventory.serialize(),
            world: this.world.serialize(),
            entities: this.entities.serialize()
        };
    }

    async save(quiet) {
        if (this.saving) {
            return false;
        }
        this.saving = true;
        const ind = document.getElementById("saving");
        ind.classList.remove("hidden");
        try {
            const packed = await deflateString(JSON.stringify(this.snapshot()));
            this.meta.lastPlayed = Date.now();
            this.meta.mode = this.creative ? "creative" : "survival";
            this.meta.difficulty = this.player.difficulty;
            await this.app.storage.save(this.meta, JSON.stringify(packed));
            if (!quiet) {
                this.ui.toast("World saved");
            }
            return true;
        } catch (e) {
            this.ui.toast("Could not save the world: " + e.message);
            return false;
        } finally {
            this.saving = false;
            ind.classList.add("hidden");
        }
    }
}
