/*
    Blocky - game.js

    One running world: ties together the world simulation, the player, the
    inventory, entities, weather and the day / night cycle, and turns input
    into actions (mining, placing, using items, eating).

    Time runs at 20 ticks per second; a full day is 24000 ticks (20 real
    minutes). Tick 0 is sunrise.
*/

import {
    B, BLOCKS, ITEMS, I, SHAPE, SOLID, blockDrops, breakSeconds, blockFaceLayer, isOpaqueAt, HDIR, facingFromYaw,
    attackDamage, LIGHT_EMIT
} from "./blocks.js";
import { Mobs } from "./mobs.js";
import { Carts } from "./carts.js";
import { Signs } from "./signs.js";
import { World, WORLD_H } from "./world.js";
import { BIOME, BIOME_NAMES } from "./worldgen.js";
import { Player, DIFFICULTY } from "./player.js";
import { Inventory } from "./inventory.js";
import { Entities, ITEM_HALF } from "./entities.js";
import { moveAxis, regionBlocked } from "./physics.js";
import { selectionBox, collisionBoxes, FACE_DIR, doorHinge } from "./shapes.js";
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
    lava: "You tried to swim in lava",
    fire: "You went up in flames",
    burn: "You burned to death",
    wolf: "You were mauled by wolves",
    bear: "You were mauled by a bear",
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
            onBlockBroken: (x, y, z, id) => this.blockParticles(x, y, z, id, 0, 10),
            onPowerSound: (x, y, z, id, out) => {
                if (id === B.PISTON || id === B.STICKY_PISTON) {
                    this.sound.play("piston", { out });
                } else if (id === B.DOOR) {
                    this.sound.block("place", "wood");
                } else {
                    this.sound.play("click");
                }
            },
            onPistonPush: (cells, d) => this.pistonPush(cells, d),
            onFizz: (x, y, z) => {
                this.sound.play("fizz");
                this.renderer.spawnParticles(x + 0.5, y + 1, z + 0.5, [200, 200, 200], 12, 0.4, 2);
            }
        });
        this.renderer.attachWorld(this.world);
        this.entities = new Entities(this.renderer);
        this.mobs = new Mobs(this);
        this.carts = new Carts(this);
        this.signs = new Signs(this);
        this.riding = null;
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
        this.carts.load(state.carts);
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
        this.mobs.clear();
        this.carts.clear();
        this.signs.clear();
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
            if (this.sleeping) {
                this.updateSleep(dt);
            } else if (this.riding) {
                //The cart carries the player (carts.update below)
            } else if (ready && !this.placeOnGround) {
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
            this.mobs.update(dt);
            this.carts.update(dt, this.riding ? this.movementInput() : null);
            if (this.riding) {
                const c = this.riding;
                p.x = c.x;
                p.y = c.y - 0.25;
                p.z = c.z;
                p.vx = p.vy = p.vz = 0;
                p.fallDistance = 0;
            }
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
            underlava: p.headInLava,
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
        //A drawn bow shows its string pulled back with an arrow on it
        const pull = held === I.BOW && this.bowDraw > 0 ? Math.min(1, this.bowDraw) : 0;
        r.setHeldItem(held, pull > 0 ? (pull < 0.35 ? "bow_pull_0" : pull < 0.75 ? "bow_pull_1" : "bow_pull_2") : null);
        const ex = Math.floor(p.x), ey = Math.floor(p.eyeY), ez = Math.floor(p.z);
        //A torch or other glowing thing in hand lights the area
        const glow = p.dead ? 0 : held === I.LAVA_BUCKET ? 15 : held > 0 && held < 256 ? LIGHT_EMIT[held] : 0;
        r.dyn.update(this.world, p.x, p.eyeY, p.z, glow, dt);
        const bobOn = this.settings.viewBobbing && p.onGround && !p.flying;
        const phase = p.walkDist * Math.PI * 0.75;
        const amp = bobOn ? Math.min(1, Math.hypot(p.vx, p.vz) / 4.3) : 0;
        r.updateHand({
            swing: this.swing >= 1 ? 0 : this.swing,
            equip: this.equip,
            bobX: Math.sin(phase) * 0.03 * amp,
            bobY: -Math.abs(Math.cos(phase)) * 0.03 * amp,
            eat: this.eatT > 0 ? 1 : 0,
            draw: this.bowDraw > 0 ? Math.min(1, this.bowDraw) : 0,
            eatT: this.eatT,
            sky: this.world.getSky(ex, ey, ez) / 15,
            blk: Math.max(this.world.getBlockLight(ex, ey, ez), r.dyn.at(ex, ey, ez)) / 15
        });
        this.signs.update();
        r.render(dt, !this.hideHud && !p.dead && !this.sleeping);
        if (this.shotPending) {
            //Read the canvas in the same task as the draw, before the
            //browser presents (and may clear) the drawing buffer
            this.shotPending = false;
            this.sound.play("click");
            r.canvas.toBlob((blob) => this.app.saveScreenshot(blob), "image/png");
        }

        this.ui.updateHud(this);
        document.getElementById("underwater").classList.toggle("on", p.headInWater);
        document.getElementById("hurt").classList.toggle("on", p.hurtTime > 0.3);
        document.getElementById("burning").classList.toggle("on", !this.creative && (p.burnTime > 0 || p.inLava));
        this.updateDebug();
        input.endFrame();
    }

    movementInput() {
        const k = (c) => this.input.down(c);
        if (this.ui.isOpen() || this.player.dead || this.paused || this.app.chat.open || this.sleeping) {
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
            } else if (code === "F2") {
                //Taken right after the next frame is drawn
                this.shotPending = true;
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

    //Pressure plates under the player, animals and (wooden ones only)
    //dropped items
    pressPlates() {
        const w = this.world, U = 1 / 16;
        const stand = (x, y, z, half, living) => {
            const by = Math.floor(y + 0.01);
            for (let bx = Math.floor(x - half); bx <= Math.floor(x + half); bx++) {
                for (let bz = Math.floor(z - half); bz <= Math.floor(z + half); bz++) {
                    const id = w.getBlock(bx, by, bz);
                    if ((id !== B.PLATE_WOOD && id !== B.PLATE_STONE) || (id === B.PLATE_STONE && !living)) {
                        continue;
                    }
                    if (y - by > 0.25 || x + half <= bx + U || x - half >= bx + 1 - U || z + half <= bz + U || z - half >= bz + 1 - U) {
                        continue;
                    }
                    if (w.pressPlate(bx, by, bz)) {
                        this.sound.play("click");
                    }
                }
            }
        };
        const p = this.player;
        if (!p.dead) {
            stand(p.x, p.y, p.z, 0.3, true);
        }
        for (const m of this.mobs.list) {
            stand(m.x, m.y, m.z, m.def.w / 2, true);
        }
        for (const e of this.entities.items) {
            stand(e.x, e.y, e.z, 0.125, false);
        }
    }

    tick() {
        this.ticks++;
        const p = this.player;
        this.world.tick(Math.floor(p.x / 16), Math.floor(p.z / 16));
        this.pressPlates();
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
        const active = !this.ui.isOpen() && !p.dead && !this.paused && !this.app.chat.open && !this.sleeping && (input.locked || this.touchActive);
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
        const hit = this.world.raycast(ox, oy, oz, dx, dy, dz, reach, (id, m, x, y, z) => selectionBox(id, m, this.world, x, y, z));
        this.hit = hit;
        //An animal in front of the block under the crosshair takes the click
        const mobHit = this.mobs.raycast(ox, oy, oz, dx, dy, dz, this.creative ? 5 : 3.5);
        const cartHit = this.carts.raycast(ox, oy, oz, dx, dy, dz, reach);
        const near = (h) => h && (!hit || h.t < hit.t);
        //A cart wins over the rail it stands on: in a dip the rail's box
        //sticks out a little in front of the cart's lower half
        const onRail = cartHit && hit && SHAPE[hit.id] === "rail" && cartHit.t < hit.t + 1;
        const aimCart = (near(cartHit) || onRail) && (!mobHit || cartHit.t < mobHit.t) ? cartHit.cart : null;
        const aimMob = !aimCart && near(mobHit) ? mobHit.mob : null;
        this.aimMob = aimMob;
        r.setSelection(this.hideHud || aimMob || aimCart ? null : hit);

        const leftDown = input.buttons.has(0) || this.touchBreak;
        const rightDown = input.buttons.has(2);
        const rightClick = input.clicked.has(2) || this.touchUse;
        if (input.clicked.has(1) && hit) {
            this.pickBlock(hit);
        }
        this.touchUse = false;

        //Fighting
        this.attackCd = Math.max(0, (this.attackCd || 0) - dt);
        if (aimMob && (input.clicked.has(0) || (this.touchBreak && this.attackCd === 0))) {
            this.swing = 0;
            if (this.attackCd === 0) {
                this.attackMob(aimMob);
                this.attackCd = 0.4;
            }
        }

        if (aimCart && input.clicked.has(0)) {
            this.swing = 0;
            this.carts.hit(aimCart);
        }
        //After hitting a cart or an animal, holding the button on mines
        //nothing until it is let go (the block behind would break next)
        if ((aimCart || aimMob) && leftDown) {
            this.attackHold = true;
        } else if (!leftDown) {
            this.attackHold = false;
        }

        //Mining
        if (leftDown && !aimMob && !aimCart && !this.attackHold) {
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

        const held = this.inventory.held;
        const heldDef = held && ITEMS[held.id];

        //Carts take right clicks before anything held does. The button is
        //still down for a few frames after the click: until it is let go
        //it must not place the held block where the cart was.
        if (!rightDown) {
            this.useHold = false;
        }
        if (aimCart && rightClick) {
            this.swing = 0;
            this.carts.use(aimCart);
            this.useHold = true;
            return;
        }
        if (this.useHold) {
            return;
        }

        //Bow: hold to draw, let go to shoot
        const useBlock = rightClick && hit && BLOCKS[hit.id].interact && !p.sneaking;
        if (held && held.id === I.BOW && !useBlock) {
            if (rightDown) {
                if (this.creative || this.inventory.count(I.ARROW) > 0) {
                    this.bowDraw = (this.bowDraw || 0) + dt;
                }
            } else if (this.bowDraw > 0) {
                this.fireBow(Math.min(1, this.bowDraw));
                this.bowDraw = 0;
            }
            return;
        }
        this.bowDraw = 0;

        //Eating
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

    attackMob(m) {
        const p = this.player, inv = this.inventory;
        const held = inv.heldId();
        //A hit while falling lands harder
        const crit = !p.onGround && p.vy < -1 && !p.inWater;
        const dmg = this.creative ? 100 : attackDamage(held) * (crit ? 1.5 : 1);
        this.mobs.damage(m, dmg, [p.x, p.z]);
        this.sound.play("hit");
        if (crit) {
            this.renderer.spawnParticles(m.x, m.y + m.def.h * 0.7, m.z, [255, 240, 160], 10, 0.3, 2);
        }
        if (!this.creative) {
            const it = ITEMS[held];
            if (it && it.tool && inv.damageHeld(it.tool.kind === "sword" ? 1 : 2)) {
                this.sound.play("toolBreak");
            }
            p.exhaust(0.1);
        }
    }

    fireBow(power) {
        if (power < 0.15) {
            return;
        }
        const inv = this.inventory;
        if (!this.creative) {
            if (!inv.remove(I.ARROW, 1)) {
                return;
            }
            if (inv.damageHeld(1)) {
                this.sound.play("toolBreak");
            }
        }
        const [ox, oy, oz, dx, dy, dz] = this.eyeRay();
        const sp = 12 + 30 * power;
        this.mobs.shootArrow(ox + dx * 0.5, oy - 0.1 + dy * 0.5, oz + dz * 0.5, dx * sp, dy * sp, dz * sp, Math.round(2 + 7 * power));
        this.sound.play("bow");
        this.swing = 0;
        this.ui.hudKey = "";
    }

    //Wolves and bears hit the player and knock them back
    hurtPlayerBy(amount, cause, fromX, fromZ) {
        const p = this.player;
        const before = p.health;
        p.hurt(amount, cause);
        if (p.health < before) {
            const ax = p.x - fromX, az = p.z - fromZ;
            const l = Math.hypot(ax, az) || 1;
            p.vx += ax / l * 6;
            p.vz += az / l * 6;
            p.vy = Math.max(p.vy, 5);
        }
    }

    isNight() {
        const tod = this.ticks % DAY;
        return tod >= 12800 && tod <= 23200;
    }

    //Bone meal: ripens wheat, grows saplings, sprouts grass and flowers
    applyBoneMeal(h) {
        const w = this.world, rng = this.rng;
        if (h.id === B.WHEAT && h.meta < 7) {
            w.setBlock(h.x, h.y, h.z, B.WHEAT, Math.min(7, h.meta + 2 + Math.floor(rng() * 3)), false);
        } else if (h.id === B.SAPLING) {
            if (rng() < 0.45) {
                w.growTree(h.x, h.y, h.z);
            }
        } else if (h.id === B.GRASS && w.getBlock(h.x, h.y + 1, h.z) === B.AIR) {
            for (let k = 0; k < 14; k++) {
                const x = h.x + Math.floor(rng() * 7) - 3, z = h.z + Math.floor(rng() * 7) - 3;
                if (w.getBlock(x, h.y, z) === B.GRASS && w.getBlock(x, h.y + 1, z) === B.AIR) {
                    const r = rng();
                    w.setBlock(x, h.y + 1, z, r < 0.8 ? B.TALL_GRASS : r < 0.9 ? B.FLOWER_YELLOW : B.FLOWER_RED, 0);
                }
            }
        } else {
            return false;
        }
        this.renderer.spawnParticles(h.x + 0.5, h.y + 1, h.z + 0.5, [120, 220, 90], 12, 0.5, 1.5);
        return true;
    }

    //Middle click: put the targeted block in hand. Creative fills the
    //selected slot; survival swaps it in from the inventory if owned.
    pickBlock(hit) {
        const PICK = {
            [B.DOOR]: I.DOOR, [B.BED]: I.BED, [B.FURNACE_LIT]: B.FURNACE, [B.RETIMER_ON]: B.RETIMER, [B.WALL_SIGN]: B.SIGN, [B.WHEAT]: I.SEEDS, [B.FARMLAND]: B.DIRT
        };
        const id = PICK[hit.id] ?? hit.id;
        if (!ITEMS[id]) {
            return;
        }
        const inv = this.inventory;
        const slots = inv.slots;
        const hot = slots.findIndex((st, i) => i < 9 && st && st.id === id);
        if (hot >= 0) {
            inv.selected = hot;
            return;
        }
        if (this.creative) {
            slots[inv.selected] = { id, count: ITEMS[id].stack, dmg: 0 };
        } else {
            const at = slots.findIndex((st, i) => i >= 9 && st && st.id === id);
            if (at < 0) {
                return;
            }
            const cur = slots[inv.selected];
            slots[inv.selected] = slots[at];
            slots[at] = cur;
        }
        this.ui.hudKey = "";
        this.sound.play("pop");
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
            const heldTool = ITEMS[heldId] && ITEMS[heldId].tool;
            if (def.hardness > 0 && this.inventory.damageHeld(heldTool && heldTool.kind === "sword" ? 2 : 1)) {
                this.sound.play("toolBreak");
            }
            this.player.exhaust(0.005);
        }
    }

    //Tall grass and other loose plants never get in the way: aim through
    //them at the top of the block they grow on
    throughPlant(hit) {
        if (!hit || SHAPE[hit.id] !== "cross" || !BLOCKS[hit.id].replaceable) {
            return hit;
        }
        const w = this.world, y = hit.y - 1;
        const id = w.getBlock(hit.x, y, hit.z);
        if (id === B.AIR) {
            return hit;
        }
        return {
            x: hit.x, y, z: hit.z, id, meta: w.getMeta(hit.x, y, hit.z), face: 2, t: hit.t, box: hit.box,
            point: [hit.point[0], y + 1, hit.point[2]], throughPlant: true
        };
    }

    useItem(rawHit) {
        const p = this.player, inv = this.inventory, w = this.world;
        const held = inv.held;
        const it = held && ITEMS[held.id];
        if (rawHit && BLOCKS[rawHit.id].interact && !p.sneaking) {
            this.interactBlock(rawHit);
            return;
        }
        //An empty bucket scoops up a water or lava source
        if (held && held.id === I.BUCKET) {
            const [ox, oy, oz, dx, dy, dz] = this.eyeRay();
            const wh = w.raycast(ox, oy, oz, dx, dy, dz, 4.5, (bid, m, bx, by, bz) =>
                ((bid === B.WATER || bid === B.LAVA) && m === 0 ? [0, 0, 0, 1, 0.875, 1] : selectionBox(bid, m, w, bx, by, bz)));
            if (wh && (wh.id === B.WATER || wh.id === B.LAVA) && wh.meta === 0) {
                const full = wh.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET;
                w.setBlock(wh.x, wh.y, wh.z, B.AIR, 0);
                this.sound.play(wh.id === B.WATER ? "splash" : "fizz");
                this.swing = 0;
                if (!this.creative) {
                    inv.consumeHeld(1);
                    if (inv.held) {
                        if (inv.add(full, 1)) {
                            this.dropStack({ id: full, count: 1 });
                        }
                    } else {
                        inv.slots[inv.selected] = { id: full, count: 1, dmg: 0 };
                    }
                }
            }
            return;
        }
        if (!rawHit || !held) {
            return;
        }
        if (held.id === I.BONE_MEAL) {
            if (this.applyBoneMeal(rawHit)) {
                this.swing = 0;
                if (!this.creative) {
                    inv.consumeHeld(1);
                }
            }
            return;
        }
        const hit = this.throughPlant(rawHit);
        if (it.tool && it.tool.kind === "hoe") {
            const above = w.getBlock(hit.x, hit.y + 1, hit.z);
            const free = above === B.AIR || (SHAPE[above] === "cross" && BLOCKS[above].replaceable);
            if ((hit.id === B.GRASS || hit.id === B.DIRT) && hit.face !== 3 && free) {
                if (above !== B.AIR) {
                    w.breakNaturally(hit.x, hit.y + 1, hit.z);
                }
                w.setBlock(hit.x, hit.y, hit.z, B.FARMLAND, 0);
                this.sound.block("step", "gravel");
                this.swing = 0;
                if (!this.creative && inv.damageHeld(1)) {
                    this.sound.play("toolBreak");
                }
            }
            return;
        }
        if (it.tool && it.tool.kind === "igniter") {
            const [x, y, z] = this.placeTarget(hit);
            if (w.ignite(x, y, z)) {
                this.sound.play("fizz");
                this.swing = 0;
                if (!this.creative && inv.damageHeld(1)) {
                    this.sound.play("toolBreak");
                }
            }
            return;
        }
        if (held.id === I.WATER_BUCKET || held.id === I.LAVA_BUCKET) {
            const liquid = held.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
            const [x, y, z] = this.placeTarget(hit);
            const cur = w.getBlock(x, y, z);
            if (y >= 0 && y < WORLD_H && (cur === B.AIR || BLOCKS[cur].replaceable)) {
                if (cur !== B.AIR && cur !== B.WATER && cur !== B.LAVA) {
                    w.breakNaturally(x, y, z);
                }
                w.setBlock(x, y, z, liquid, 0);
                w.schedule(x, y, z, 5);
                this.sound.play(liquid === B.WATER ? "splash" : "fizz");
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
        if (it.cart) {
            if (rawHit.id === B.RAIL || rawHit.id === B.POWERED_RAIL) {
                const [cx, cy, cz] = this.carts.railSeat(rawHit.x, rawHit.y, rawHit.z);
                this.carts.spawn(it.cart, cx, cy, cz);
                this.sound.block("place", "metal");
                this.swing = 0;
                if (!this.creative) {
                    inv.consumeHeld(1);
                }
            }
            return;
        }
        if (held.id === I.DOOR) {
            this.placeDoor(hit);
            return;
        }
        if (held.id === I.BED) {
            this.placeBed(hit);
            return;
        }
        if (it.block) {
            this.placeBlock(hit, it.block);
        }
    }

    placeTarget(hit) {
        const def = BLOCKS[hit.id];
        if (def.replaceable && hit.id !== B.WATER && hit.id !== B.LAVA) {
            return [hit.x, hit.y, hit.z];
        }
        const d = FACE_DIR[hit.face];
        return [hit.x + d[0], hit.y + d[1], hit.z + d[2]];
    }

    //Move an entity box out of the cells a piston just filled, along the
    //piston direction d, to the far face of what moved (stopped by blocks
    //beyond). Returns the distance.
    pushOut(box, cells, d) {
        const w = this.world;
        const a = d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : 2, s = d[a];
        const pos = [0, 0, 0];
        let need = 0;
        for (const [cx, cy, cz] of cells) {
            const id = w.getBlock(cx, cy, cz);
            if (!SOLID[id]) {
                continue;
            }
            for (const b of collisionBoxes(id, w.getMeta(cx, cy, cz), w, cx, cy, cz)) {
                pos[0] = cx; pos[1] = cy; pos[2] = cz;
                //The box swept over the block it moved through (the head's
                //plate crosses its whole cell)
                let hit = true;
                for (let k = 0; k < 3 && hit; k++) {
                    const lo = pos[k] + b[k] - (k === a && s > 0 ? 1 : 0), hi = pos[k] + b[k + 3] + (k === a && s < 0 ? 1 : 0);
                    hit = box[k] < hi - 1e-6 && box[k + 3] > lo + 1e-6;
                }
                if (hit) {
                    need = Math.max(need, s > 0 ? pos[a] + b[a + 3] - box[a] : box[a + 3] - (pos[a] + b[a]));
                }
            }
        }
        if (need <= 0) {
            return 0;
        }
        //Straight past the far face when there is room (the moving parts
        //push from behind, so they must not stop it); otherwise as far as
        //the blocks allow, which pins it against the head
        const shift = s * (need + 0.01);
        box[a] += shift;
        box[a + 3] += shift;
        if (!regionBlocked(w, box[0], box[1], box[2], box[3], box[4], box[5])) {
            return Math.abs(shift);
        }
        box[a] -= shift;
        box[a + 3] -= shift;
        return Math.abs(moveAxis(w, box, a, shift));
    }

    //A piston extended: push the player, animals and dropped items out of
    //the head and the blocks it moved, with a little momentum
    pistonPush(cells, d) {
        const p = this.player;
        const box = p.box();
        const moved = this.pushOut(box, cells, d);
        if (moved > 0) {
            p.x = (box[0] + box[3]) / 2;
            p.y = box[1];
            p.z = (box[2] + box[5]) / 2;
            if (d[1] !== 0) {
                p.vy = Math.max(p.vy * d[1], 0) * d[1];
                p.fallDistance = 0;
                p.eyeSmooth -= d[1] * moved;
            } else {
                p.vx = d[0] !== 0 ? d[0] * Math.max(p.vx * d[0], 5) : p.vx;
                p.vz = d[2] !== 0 ? d[2] * Math.max(p.vz * d[2], 5) : p.vz;
            }
        }
        for (const m of this.mobs.list) {
            const mb = this.mobs.box(m);
            if (this.pushOut(mb, cells, d) > 0) {
                m.x = (mb[0] + mb[3]) / 2;
                m.y = mb[1];
                m.z = (mb[2] + mb[5]) / 2;
                m.vx += d[0] * 5;
                m.vz += d[2] * 5;
                m.vy = d[1] !== 0 ? Math.max(m.vy, 0) : m.vy;
            }
        }
        for (const e of this.entities.items) {
            const ib = [e.x - ITEM_HALF, e.y - ITEM_HALF, e.z - ITEM_HALF, e.x + ITEM_HALF, e.y + ITEM_HALF, e.z + ITEM_HALF];
            if (this.pushOut(ib, cells, d) > 0) {
                e.x = (ib[0] + ib[3]) / 2;
                e.y = (ib[1] + ib[4]) / 2;
                e.z = (ib[2] + ib[5]) / 2;
                e.vx += d[0] * 3;
                e.vy = Math.max(e.vy, d[1] * 3);
                e.vz += d[2] * 3;
            }
        }
    }

    //Would this block at (x, y, z) collide with the player?
    blocksPlayer(bid, meta, x, y, z) {
        if (!SOLID[bid]) {
            return false;
        }
        const pb = this.player.box();
        for (const b of collisionBoxes(bid, meta, this.world, x, y, z)) {
            if (pb[0] < x + b[3] && pb[3] > x + b[0] && pb[1] < y + b[4] && pb[4] > y + b[1] && pb[2] < z + b[5] && pb[5] > z + b[2]) {
                return true;
            }
        }
        return false;
    }

    //Clear a replaceable block (a plant) so something can go there
    clearSpot(x, y, z) {
        const cur = this.world.getBlock(x, y, z);
        if (cur !== B.AIR && cur !== B.WATER && cur !== B.LAVA) {
            this.world.breakNaturally(x, y, z);
        }
    }

    placeBlock(hit, bid) {
        const w = this.world, p = this.player;
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
        if (bid === B.LEVER || bid === B.BUTTON) {
            meta = face;
        } else if (bid === B.PISTON || bid === B.STICKY_PISTON) {
            //The pushing face looks back at the player
            const [, , , lx, ly, lz] = this.eyeRay();
            const ax = Math.abs(lx), ay = Math.abs(ly), az = Math.abs(lz);
            if (ay >= ax && ay >= az) {
                meta = ly > 0 ? 3 : 2;
            } else if (ax >= az) {
                meta = lx > 0 ? 1 : 0;
            } else {
                meta = lz > 0 ? 5 : 4;
            }
        } else if (bid === B.SIGN) {
            //On top of a block it stands, turned to face the player; on a
            //side it hangs on the wall
            if (face === 3) {
                return;
            }
            if (face === 2) {
                meta = ((Math.round(p.yaw / (Math.PI / 8)) % 16) + 16) % 16;
            } else {
                bid = B.WALL_SIGN;
                meta = face;
            }
        } else if (bid === B.RETIMER) {
            //Signal runs away from the player
            meta = facingFromYaw(p.yaw);
        } else if (bid === B.RAIL || bid === B.POWERED_RAIL) {
            meta = Math.abs(Math.sin(p.yaw)) > Math.abs(Math.cos(p.yaw)) ? 1 : 0;
            w.railPreferX = meta === 1;
        } else if (bid === B.TORCH || bid === B.SPARK_TORCH) {
            if (face === 3) {
                return;
            }
            meta = face;
        } else if (bid === B.LADDER) {
            if (face === 2 || face === 3) {
                return;
            }
            meta = face;
        } else if (bid === B.FENCE_GATE) {
            meta = facingFromYaw(p.yaw);
        } else if (SHAPE[bid] === "stairs") {
            //The steps climb away from the player; placed under a block or
            //on the upper half of a side they hang upside down
            meta = facingFromYaw(p.yaw);
            if (face === 3 || (face !== 2 && hit.point[1] - hit.y > 0.5)) {
                meta |= 4;
            }
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
        if (this.blocksPlayer(bid, meta, x, y, z)) {
            return;
        }
        this.clearSpot(x, y, z);
        this.finishPlace(x, y, z, bid, meta);
    }

    //Doors are two blocks tall and hang on the edge nearest the player
    placeDoor(hit) {
        const w = this.world;
        const [x, y, z] = this.placeTarget(hit);
        if (y < 1 || y + 1 >= WORLD_H) {
            return;
        }
        if (!BLOCKS[w.getBlock(x, y, z)].replaceable || !BLOCKS[w.getBlock(x, y + 1, z)].replaceable) {
            return;
        }
        if (!isOpaqueAt(w.getBlock(x, y - 1, z), w.getMeta(x, y - 1, z))) {
            return;
        }
        let f = (facingFromYaw(this.player.yaw) + 2) & 3;
        //Beside a door facing the same way: become its other half of a
        //double door, hinged on the far side (mirrored when needed). A lone
        //neighbour hinged toward this door turns its hinge outward too.
        for (const side of [(f + 1) & 3, (f + 3) & 3]) {
            const nx = x + HDIR[side][0], nz = z + HDIR[side][1];
            const nm = w.getMeta(nx, y, nz);
            if (w.getBlock(nx, y, nz) !== B.DOOR || (nm & 8) || (nm & 3) !== (f & 3)) {
                continue;
            }
            if (side === ((f + 1) & 3)) {
                f |= 16;
            }
            if (doorHinge(nm) !== side && !w.doorPartner(nx, y, nz)) {
                for (const yy of [y, y + 1]) {
                    if (w.getBlock(nx, yy, nz) === B.DOOR) {
                        w.setBlock(nx, yy, nz, B.DOOR, w.getMeta(nx, yy, nz) ^ 16, false);
                    }
                }
            }
            break;
        }
        if (this.blocksPlayer(B.DOOR, f, x, y, z) || this.blocksPlayer(B.DOOR, f | 8, x, y + 1, z)) {
            return;
        }
        this.clearSpot(x, y, z);
        this.clearSpot(x, y + 1, z);
        w.setBlock(x, y, z, B.DOOR, f, false);
        this.finishPlace(x, y + 1, z, B.DOOR, f | 8);
    }

    //Beds take two blocks: the foot where you click, the head further on
    placeBed(hit) {
        const w = this.world;
        const [x, y, z] = this.placeTarget(hit);
        const f = facingFromYaw(this.player.yaw);
        const hx = x + HDIR[f][0], hz = z + HDIR[f][1];
        if (y < 1 || y >= WORLD_H) {
            return;
        }
        for (const [bx, bz] of [[x, z], [hx, hz]]) {
            if (!BLOCKS[w.getBlock(bx, y, bz)].replaceable || !isOpaqueAt(w.getBlock(bx, y - 1, bz), w.getMeta(bx, y - 1, bz))) {
                this.ui.toast("A bed needs two free blocks on solid ground");
                return;
            }
            if (this.blocksPlayer(B.BED, 0, bx, y, bz)) {
                return;
            }
        }
        this.clearSpot(x, y, z);
        this.clearSpot(hx, y, hz);
        w.setBlock(hx, y, hz, B.BED, f | 4, false);
        this.finishPlace(x, y, z, B.BED, f);
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
        } else if (bid === B.SIGN || bid === B.WALL_SIGN) {
            //Write on it straight away
            this.openScreen("sign", Signs.create(w, x, y, z));
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
        this.swing = 0;
        if (kind === "workbench") {
            this.openScreen("workbench");
        } else if (kind === "door") {
            //(a double door opens and shuts together)
            w.setDoorOpen(hit.x, hit.y, hit.z, !(hit.meta & 4));
            this.sound.block("place", "wood");
        } else if (kind === "lever") {
            w.setBlock(hit.x, hit.y, hit.z, B.LEVER, hit.meta ^ 8);
            this.sound.play("click");
        } else if (kind === "button") {
            if (!(hit.meta & 8)) {
                w.pressButton(hit.x, hit.y, hit.z);
                this.sound.play("click");
            }
        } else if (kind === "sign") {
            const te = w.getTileEntity(hit.x, hit.y, hit.z) || Signs.create(w, hit.x, hit.y, hit.z);
            this.openScreen("sign", te);
        } else if (kind === "retimer") {
            //Next delay: 1 to 4 steps of 2 ticks
            const steps = (((hit.meta >> 2) & 3) + 1) % 4;
            w.setBlock(hit.x, hit.y, hit.z, hit.id, (hit.meta & 3) | (steps << 2));
            this.sound.play("click");
        } else if (kind === "gate") {
            w.setBlock(hit.x, hit.y, hit.z, B.FENCE_GATE, hit.meta ^ 4, false);
            this.sound.block("place", "wood");
        } else if (kind === "bed") {
            this.trySleep(hit);
        } else {
            let te = w.getTileEntity(hit.x, hit.y, hit.z);
            if (!te) {
                te = w.createTileEntity(hit.x, hit.y, hit.z, kind);
            }
            this.openScreen(kind, te);
        }
    }

    /* ---------------- sleeping ---------------- */

    trySleep(hit) {
        if (this.mobs.threatNear(this.player.x, this.player.z, 10)) {
            this.ui.toast("You can't sleep now, wild animals are nearby");
            return;
        }
        const tod = this.ticks % DAY;
        if (!(tod >= 12500 && tod <= 23500) && this.weather.state !== "thunder") {
            this.ui.toast("You can only sleep at night or during a thunderstorm");
            return;
        }
        const f = hit.meta & 3, d = HDIR[f];
        const head = hit.meta & 4 ? [hit.x, hit.z] : [hit.x + d[0], hit.z + d[1]];
        const foot = hit.meta & 4 ? [hit.x - d[0], hit.z - d[1]] : [hit.x, hit.z];
        this.spawn = { x: foot[0] + 0.5, y: hit.y + 1, z: foot[1] + 0.5 };
        this.sleeping = { t: 0, head, foot, y: hit.y, f };
        this.breaking = null;
        this.ui.toast("Respawn point set");
        this.app.showSleep(true, 0);
    }

    updateSleep(dt) {
        const s = this.sleeping;
        s.t += dt;
        for (const code of ["ShiftLeft", "ShiftRight", "Space", "KeyW", "KeyA", "KeyS", "KeyD"]) {
            if (this.input.pressed.has(code)) {
                this.wake(false);
                return;
            }
        }
        this.app.showSleep(true, Math.min(1, s.t / 2.2));
        if (s.t >= 3) {
            this.wake(true);
        }
    }

    wake(skipNight) {
        const s = this.sleeping;
        if (!s) {
            return;
        }
        this.sleeping = null;
        if (skipNight) {
            this.ticks = (Math.floor(this.ticks / DAY) + 1) * DAY + 500;
            if (this.weather.state !== "clear") {
                this.setWeather("clear");
                this.weather.rain = 0;
                this.weather.thunder = 0;
            }
            this.ui.toast("Good morning!");
        }
        this.player.setPos(s.foot[0] + 0.5, s.y + 0.5625, s.foot[1] + 0.5);
        this.app.showSleep(false);
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
                this.wake(false);
                this.carts.dismount();
                this.onDeath(e.cause);
            } else if (e.type === "extinguish") {
                this.sound.play("fizz");
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
        if (this.sleeping) {
            //Lying on the pillow, looking along the bed toward the foot
            const s = this.sleeping, d = HDIR[s.f];
            cam.position.set(s.head[0] + 0.5 - d[0] * 0.2, s.y + 0.75, s.head[1] + 0.5 - d[1] * 0.2);
            cam.rotation.set(0.45, Math.atan2(d[0], d[1]), 0);
            return;
        }
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
        cam.position.set(p.x + cos * bx, p.eyeY + p.eyeSmooth + by, p.z - sin * bx);
        cam.rotation.set(p.pitch, p.yaw, roll);
        let fov = this.settings.fov;
        if (p.sprinting) {
            fov *= p.flying ? 1.15 : 1.1;
        }
        if (this.bowDraw > 0) {
            fov *= 1 - 0.15 * Math.min(1, this.bowDraw);
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
            `Entities: ${this.entities.items.length} items, ${this.entities.falling.length} falling, ${this.mobs.list.length} animals`,
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
            entities: this.entities.serialize(),
            carts: this.carts.serialize()
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
