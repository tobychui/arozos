/*
    Blocky - main.js

    Boots the game: paints the textures, builds the renderer, runs the start
    screen (with a slowly turning view of a generated world behind it), the
    world list and world creation, settings, and hands over to a Game once a
    world is opened.
*/

import { buildTextures, ICON } from "./textures.js";
import { resolveBlockTextures } from "./blocks.js";
import { buildIcons } from "./icons.js";
import { Renderer } from "./render.js";
import { Sound } from "./audio.js";
import { Storage, newWorldId } from "./storage.js";
import { UI } from "./ui.js";
import { Input } from "./input.js";
import { Game } from "./game.js";
import { World } from "./world.js";
import { DIFFICULTY } from "./player.js";
import { setupTouch } from "./touch.js";
import { Chat } from "./chat.js";
import { COMMANDS } from "./commands.js";
import { seedFromString, inflateString, escapeHtml, mulberry32 } from "./util.js";

const SETTINGS_KEY = "blocky.settings";
const DEFAULT_SETTINGS = {
    renderDistance: 6,
    fov: 75,
    sensitivity: 1,
    brightness: 0.5,
    volume: 0.7,
    pixelRatio: 1,
    fancyLeaves: true,
    clouds: true,
    viewBobbing: true,
    invertY: false,
    showFps: false
};
const PREVIEW_SEED = 734011;

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle("hidden", !on);

const DIFF_HINTS = [
    "No hunger, health refills on its own.",
    "Hunger drains slowly; starving stops at half health.",
    "Hunger drains at the usual pace; starving leaves you at half a heart.",
    "Hunger drains fast and starving can kill you."
];

class App {
    constructor() {
        this.state = "menu";
        this.game = null;
        this.preview = null;
        this.worlds = [];
        this.selectedWorld = null;
        this.newMode = "survival";
        this.newDiff = 2;
        this.touchMode = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;
    }

    loadSettings() {
        let s = {};
        try {
            s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        } catch (e) {
            s = {};
        }
        this.settings = Object.assign({}, DEFAULT_SETTINGS, s);
        if (this.touchMode && !s.renderDistance) {
            this.settings.renderDistance = 4;
        }
    }

    saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (e) {
            //Settings simply do not persist
        }
    }

    boot() {
        this.loadSettings();
        this.tex = buildTextures();
        resolveBlockTextures(this.tex.layerOf);
        this.icons = buildIcons(this.tex);
        this.canvas = $("view");
        this.renderer = new Renderer(this.canvas, this.tex);
        this.renderer.applySettings(this.settings);
        this.sound = new Sound();
        this.sound.setVolume(this.settings.volume);
        this.storage = new Storage();
        this.input = new Input(this.canvas);
        this.ui = new UI(this);
        this.chat = new Chat(this);
        this.drawLogo();
        this.bindMenu();
        this.bindOverlays();
        this.bindSettings();
        if (this.touchMode) {
            setupTouch(this);
        }
        window.addEventListener("resize", () => this.renderer.resize());
        this.input.onLockChange = (locked) => this.onLockChange(locked);
        this.startPreview();
        this.storage.init().then(() => {
            $("storageNote").textContent = "Worlds are saved to " + this.storage.where + ".";
        });
        document.addEventListener("pointerdown", () => this.sound.ensure(), { capture: true });
        document.addEventListener("keydown", () => this.sound.ensure(), { capture: true });
        if (typeof ao_module_setWindowTitle === "function") {
            try {
                ao_module_setWindowTitle("Blocky");
            } catch (e) {
                //Not inside a desktop window
            }
        }
        this.last = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    }

    loop(now) {
        requestAnimationFrame((t) => this.loop(t));
        const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        try {
            if (this.state === "playing" && this.game) {
                this.game.frame(dt, now);
            } else if (this.preview) {
                this.previewFrame(dt, now);
            }
        } catch (e) {
            console.error(e);
            this.fatal(e);
        }
    }

    fatal(e) {
        if (this.failed) {
            return;
        }
        this.failed = true;
        $("errorText").textContent = String(e && e.message ? e.message : e);
        show("error");
    }

    /* ---------------- logo ---------------- */

    drawLogo() {
        const glyphs = {
            B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
            L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
            O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
            C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
            K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
            Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."]
        };
        const c = $("logo");
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        const cell = 20, depth = 6;
        const word = "BLOCKY";
        const width = word.length * 6 * cell - cell;
        const ox = (c.width - width) / 2, oy = 20;
        const side = this.tex.canvases.get("grass_side");
        const top = this.tex.canvases.get("stone");
        const rng = mulberry32(7);
        const cells = [];
        [...word].forEach((ch, i) => {
            glyphs[ch].forEach((row, y) => {
                [...row].forEach((v, x) => {
                    if (v === "#") {
                        cells.push([ox + (i * 6 + x) * cell, oy + y * cell + (i % 2 ? 4 : 0), y]);
                    }
                });
            });
        });
        //Extruded shadow first, then the faces
        for (const [x, y] of cells) {
            ctx.fillStyle = "#1d2a14";
            ctx.fillRect(x + depth, y + depth, cell, cell);
        }
        for (const [x, y, row] of cells) {
            const tile = row === 0 ? side : top;
            ctx.drawImage(tile, 0, row === 0 ? 0 : Math.floor(rng() * 8), 16, 8, x, y, cell, cell);
            ctx.fillStyle = row === 0 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0," + (0.05 + row * 0.03) + ")";
            ctx.fillRect(x, y, cell, cell);
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.fillRect(x, y, cell, 2);
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.fillRect(x, y + cell - 2, cell, 2);
        }
    }

    /* ---------------- preview world ---------------- */

    startPreview() {
        if (this.preview) {
            return;
        }
        const world = new World(PREVIEW_SEED);
        const s = world.gen.findSpawn();
        this.renderer.attachWorld(world);
        //Start out looking at the most land
        let yaw = 0, best = -1;
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            let land = 0;
            for (let d = 12; d <= 60; d += 12) {
                const c = world.gen.column(Math.floor(s.x - Math.sin(a) * d), Math.floor(s.z - Math.cos(a) * d));
                land += c.h >= 62 ? 1 : 0;
            }
            if (land > best) {
                best = land;
                yaw = a;
            }
        }
        this.preview = { world, x: s.x, z: s.z, y: Math.max(s.h + 14, 80), yaw: yaw + 0.5, t: 0 };
        this.renderer.camera.fov = 70;
        this.renderer.camera.updateProjectionMatrix();
    }

    stopPreview() {
        if (!this.preview) {
            return;
        }
        this.renderer.detachWorld();
        this.preview = null;
    }

    previewFrame(dt, now) {
        const pv = this.preview, r = this.renderer;
        pv.t += dt;
        pv.yaw -= dt * 0.035;
        const pcx = Math.floor(pv.x / 16), pcz = Math.floor(pv.z / 16);
        const R = Math.min(5, this.settings.renderDistance);
        pv.world.stream(pcx, pcz, R, now + 10);
        r.updateMeshes(pv.world, pv.x, pv.z, R, performance.now() + 8);
        r.camera.position.set(pv.x, pv.y, pv.z);
        r.camera.rotation.set(-0.22, pv.yaw, 0);
        r.applyEnvironment({ time: 1200 + pv.t * 4, day: 2, rain: 0, thunder: 0, flash: 0, underwater: false, renderDistance: R });
        r.updateRain(dt, 0, r.camera.position, pv.world);
        r.updateParticles(dt, pv.world);
        r.render(dt, false);
    }

    /* ---------------- menu ---------------- */

    showPage(id) {
        for (const p of ["pageMain", "pageWorlds", "pageCreate"]) {
            show(p, p === id);
        }
    }

    bindMenu() {
        $("btnPlay").onclick = () => {
            this.showPage("pageWorlds");
            this.refreshWorlds();
        };
        $("btnSettings").onclick = () => this.openSettings();
        $("btnHelp").onclick = () => show("help");
        $("btnHelpDone").onclick = () => show("help", false);
        const inDesktop = typeof ao_module_virtualDesktop !== "undefined" && ao_module_virtualDesktop;
        if (!inDesktop) {
            show("btnQuit", false);
        }
        $("btnQuit").onclick = () => {
            if (typeof ao_module_close === "function") {
                ao_module_close();
            }
        };
        $("btnWorldsBack").onclick = () => this.showPage("pageMain");
        $("btnNewWorld").onclick = () => {
            $("newName").value = "New World";
            $("newSeed").value = "";
            this.showPage("pageCreate");
            $("newName").focus();
            $("newName").select();
        };
        $("btnCreateCancel").onclick = () => this.showPage("pageWorlds");
        $("btnPlayWorld").onclick = () => {
            if (this.selectedWorld) {
                this.openWorld(this.selectedWorld);
            }
        };
        $("btnDeleteWorld").onclick = () => {
            const w = this.worlds.find((x) => x.id === this.selectedWorld);
            if (!w) {
                return;
            }
            this.confirm(`"${w.name}" will be lost forever. This cannot be undone.`, async () => {
                try {
                    await this.storage.remove(w.id);
                } catch (e) {
                    alert("Could not delete the world: " + e.message);
                }
                this.selectedWorld = null;
                this.refreshWorlds();
            });
        };
        $("newMode").addEventListener("click", (e) => {
            const b = e.target.closest("[data-mode]");
            if (!b) {
                return;
            }
            this.newMode = b.dataset.mode;
            this.markToggle("newMode", "mode", this.newMode);
            $("modeHint").textContent = this.newMode === "creative"
                ? "Unlimited blocks, instant mining and flight. No hunger or damage."
                : "Gather resources, craft tools and keep yourself fed.";
        });
        $("newDiff").addEventListener("click", (e) => {
            const b = e.target.closest("[data-diff]");
            if (!b) {
                return;
            }
            this.newDiff = Number(b.dataset.diff);
            this.markToggle("newDiff", "diff", String(this.newDiff));
            $("diffHint").textContent = DIFF_HINTS[this.newDiff];
        });
        $("diffHint").textContent = DIFF_HINTS[this.newDiff];
        $("btnCreate").onclick = () => this.createWorld();
        $("newName").addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                this.createWorld();
            }
        });
    }

    markToggle(groupId, attr, value) {
        $(groupId).querySelectorAll("[data-" + attr + "]").forEach((b) => {
            b.classList.toggle("on", b.dataset[attr] === value);
        });
    }

    confirm(text, onYes) {
        $("confirmText").textContent = text;
        show("confirm");
        $("btnConfirmYes").onclick = () => {
            show("confirm", false);
            onYes();
        };
        $("btnConfirmNo").onclick = () => show("confirm", false);
    }

    async refreshWorlds() {
        const list = $("worldList");
        list.innerHTML = "<div class=\"empty\">Loading worlds...</div>";
        try {
            await (this.storage.ready || (this.storage.ready = this.storage.init()));
            this.worlds = await this.storage.list();
        } catch (e) {
            list.innerHTML = `<div class="empty">Could not read your worlds: ${escapeHtml(e.message)}</div>`;
            return;
        }
        if (!this.worlds.length) {
            list.innerHTML = "<div class=\"empty\">No worlds yet. Create one to start playing.</div>";
        } else {
            list.innerHTML = this.worlds.map((w) => {
                const when = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : "never";
                const mode = w.mode === "creative" ? "Creative" : "Survival";
                const diff = (DIFFICULTY[w.difficulty] || DIFFICULTY[2]).name;
                const size = w.size ? (w.size / 1024 < 1024 ? Math.ceil(w.size / 1024) + " KB" : (w.size / 1048576).toFixed(1) + " MB") : "";
                return `<div class="world ${w.id === this.selectedWorld ? "sel" : ""}" data-id="${escapeHtml(w.id)}">
                    <div><b>${escapeHtml(w.name || "World")}</b><span>${mode}, ${diff}${w.cheats ? ", cheats" : ""}</span></div>
                    <div class="wmeta"><span>${escapeHtml(when)}</span><br><span>${size}</span></div></div>`;
            }).join("");
        }
        list.querySelectorAll(".world").forEach((el) => {
            el.onclick = () => {
                this.selectedWorld = el.dataset.id;
                list.querySelectorAll(".world").forEach((x) => x.classList.toggle("sel", x === el));
                this.updateWorldButtons();
            };
            el.ondblclick = () => this.openWorld(el.dataset.id);
        });
        if (!this.worlds.find((w) => w.id === this.selectedWorld)) {
            this.selectedWorld = null;
        }
        this.updateWorldButtons();
    }

    updateWorldButtons() {
        $("btnPlayWorld").disabled = !this.selectedWorld;
        $("btnDeleteWorld").disabled = !this.selectedWorld;
    }

    async createWorld() {
        const name = $("newName").value.trim() || "New World";
        const seedText = $("newSeed").value.trim();
        const meta = {
            id: newWorldId(name),
            name,
            seed: seedFromString(seedText),
            seedText,
            mode: this.newMode,
            difficulty: this.newDiff,
            cheats: $("newCheats").checked,
            created: Date.now(),
            lastPlayed: Date.now(),
            gen: 0,
            version: 1
        };
        await this.startGame(meta, null);
    }

    async openWorld(id) {
        this.showLoading("Loading world", "Reading save data...");
        let meta, state;
        try {
            const res = await this.storage.load(id);
            meta = res.meta;
            const packed = JSON.parse(res.payload);
            state = JSON.parse(await inflateString(packed.encoding, packed.data));
        } catch (e) {
            show("loading", false);
            alert("Could not open the world: " + e.message);
            return;
        }
        await this.startGame(meta, state);
    }

    showLoading(title, text) {
        $("loadTitle").textContent = title;
        $("loadText").textContent = text;
        $("loadBar").style.width = "0%";
        show("loading");
    }

    async startGame(meta, state) {
        this.sound.ensure();
        this.showLoading(state ? "Loading world" : "Generating terrain", "Building the area around you...");
        show("menu", false);
        this.stopPreview();
        this.state = "loading";
        const game = new Game(this, meta, state);
        this.game = game;
        game.touchActive = this.touchMode;
        try {
            await game.load((f) => {
                $("loadBar").style.width = Math.round(f * 100) + "%";
            });
        } catch (e) {
            console.error(e);
            this.fatal(e);
            return;
        }
        if (!state) {
            //Write the new world straight away so it shows up in the list
            await game.save(true);
        }
        show("loading", false);
        show("hud");
        this.state = "playing";
        this.input.active = true;
        this.input.reset();
        if (typeof ao_module_setWindowTitle === "function") {
            try {
                ao_module_setWindowTitle("Blocky - " + meta.name);
            } catch (e) {
                //Not inside a desktop window
            }
        }
        if (this.touchMode) {
            show("touch");
        } else {
            //Straight into the game: grab the mouse now if the browser still
            //counts the Play click, otherwise the first click on the view does
            this.input.lock();
        }
    }

    async quitToTitle() {
        const game = this.game;
        if (!game) {
            return;
        }
        show("pause", false);
        show("death", false);
        this.showLoading("Saving world", "Writing your world to " + this.storage.where + "...");
        $("loadBar").style.width = "100%";
        if (game.player.dead) {
            game.respawn();
        }
        await game.save(true);
        game.dispose();
        this.game = null;
        this.state = "menu";
        this.input.active = false;
        this.input.unlock();
        show("hud", false);
        show("touch", false);
        this.showSleep(false);
        show("loading", false);
        show("menu");
        this.ui.close();
        this.chat.clear();
        this.startPreview();
        this.showPage("pageWorlds");
        this.refreshWorlds();
        if (typeof ao_module_setWindowTitle === "function") {
            try {
                ao_module_setWindowTitle("Blocky");
            } catch (e) {
                //Not inside a desktop window
            }
        }
    }

    /* ---------------- in-game overlays ---------------- */

    bindOverlays() {
        //Clicking the game view captures the mouse again
        this.canvas.addEventListener("mousedown", () => {
            const g = this.game;
            if (this.state === "playing" && g && !this.input.locked && !g.paused && !g.player.dead && !this.ui.isOpen() && !this.chat.open && !this.touchMode) {
                this.input.lock();
            }
        });
        $("btnLeaveBed").onclick = () => this.game && this.game.wake(false);
        $("btnResume").onclick = () => this.resumePlay();
        $("btnPauseSettings").onclick = () => this.openSettings();
        $("btnSaveQuit").onclick = () => this.quitToTitle();
        $("btnRespawn").onclick = () => {
            this.game.respawn();
            show("death", false);
            this.resumePlay();
        };
        $("btnDeathTitle").onclick = () => this.quitToTitle();
        $("btnDiff").onclick = () => {
            this.game.setDifficulty((this.game.player.difficulty + 1) % 4);
            this.refreshPause();
        };
        $("btnCheats").onclick = () => {
            this.game.meta.cheats = !this.game.meta.cheats;
            this.refreshPause();
        };
        $("btnMode").onclick = () => {
            this.game.setMode(!this.game.creative);
            this.refreshPause();
        };
        $("btnTime").onclick = () => {
            //Jump ahead to the next of sunrise, noon, sunset and midnight
            const tod = this.game.ticks % 24000;
            const next = [0, 6000, 12000, 18000].find((t) => t > tod + 100);
            this.game.setTime(next === undefined ? 0 : next);
            this.refreshPause();
        };
        $("btnWeather").onclick = () => {
            const order = ["clear", "rain", "thunder"];
            const g = this.game;
            g.setWeather(order[(order.indexOf(g.weather.state) + 1) % 3]);
            this.refreshPause();
        };
        $("btnCommands").onclick = () => this.showCommands();
        $("btnCmdDone").onclick = () => show("cmdhelp", false);
        $("btnPauseHelp").onclick = () => show("help");
        window.addEventListener("keydown", (e) => {
            if (this.state !== "playing") {
                return;
            }
            //Esc first closes whatever sits on top of the pause menu
            if (e.code === "Escape" && this.game && this.game.paused) {
                for (const id of ["settings", "cmdhelp", "help"]) {
                    if (!$(id).classList.contains("hidden")) {
                        show(id, false);
                        this.pausedAt = performance.now();
                        return;
                    }
                }
            }
            //The Esc that released the pointer lock must not also resume
            if (e.code === "Escape" && this.game && this.game.paused && performance.now() - this.pausedAt > 400) {
                e.preventDefault();
                this.resumePlay();
            }
        });
        window.addEventListener("beforeunload", () => {
            if (this.game && this.state === "playing") {
                this.game.save(true);
            }
        });
    }

    onLockChange(locked) {
        if (this.state !== "playing" || !this.game) {
            return;
        }
        if (locked) {
            return;
        }
        const g = this.game;
        if (!this.ui.isOpen() && !g.player.dead && !g.paused && !this.chat.open) {
            this.pause();
        }
    }

    pause() {
        const g = this.game;
        g.paused = true;
        this.pausedAt = performance.now();
        this.input.active = true;
        this.refreshPause();
        show("pause");
        g.save(true);
    }

    refreshPause() {
        const g = this.game;
        const tod = g.ticks % 24000;
        const phase = tod < 1000 || tod >= 23000 ? "Sunrise" : tod < 5000 ? "Morning" : tod < 7000 ? "Noon"
            : tod < 11000 ? "Afternoon" : tod < 13500 ? "Sunset" : tod < 16500 || tod >= 19500 ? "Night" : "Midnight";
        const cap = (t) => t[0].toUpperCase() + t.slice(1);
        $("btnDiff").textContent = "Difficulty: " + DIFFICULTY[g.player.difficulty].name;
        $("btnCheats").textContent = "Cheats: " + (g.meta.cheats ? "On" : "Off");
        $("btnMode").textContent = "Game Mode: " + (g.creative ? "Creative" : "Survival");
        $("btnTime").textContent = "Time: " + phase;
        $("btnWeather").textContent = "Weather: " + cap(g.weather.state);
        document.querySelectorAll("#pause .cheat").forEach((b) => {
            b.disabled = !g.meta.cheats;
            b.title = g.meta.cheats ? "" : "Turn cheats on first";
        });
    }

    showCommands() {
        $("cmdlist").innerHTML = Object.values(COMMANDS).map((c) =>
            `<div><code>${escapeHtml(c.usage)}</code><span>${escapeHtml(c.desc)}${c.cheat ? "" : " (always allowed)"}</span></div>`).join("");
        show("cmdhelp");
    }

    async resumePlay() {
        const g = this.game;
        if (!g || this.state !== "playing") {
            return;
        }
        for (const id of ["pause", "settings", "cmdhelp", "help"]) {
            show(id, false);
        }
        g.paused = false;
        this.input.active = true;
        this.input.reset();
        if (!this.touchMode) {
            //If the browser refuses (too soon after Esc), a click on the view retries
            await this.input.lock();
        }
    }

    //Darken the screen while the player sleeps (fade 0-1)
    showSleep(on, fade = 0) {
        show("sleep", on);
        if (on) {
            $("sleep").style.background = `rgba(4, 6, 16, ${0.25 + fade * 0.7})`;
        }
    }

    showDeath(text) {
        $("deathText").textContent = text;
        this.input.unlock();
        show("pause", false);
        show("death");
    }

    /* ---------------- settings ---------------- */

    bindSettings() {
        const s = () => this.settings;
        const ranges = [
            ["setRender", "renderDistance", (v) => v + " chunks"],
            ["setFov", "fov", (v) => v + "\u00b0"],
            ["setSens", "sensitivity", (v) => Math.round(v * 100) + "%"],
            ["setBright", "brightness", (v) => (v < 0.2 ? "Moody" : v > 0.8 ? "Bright" : Math.round(v * 100) + "%")],
            ["setVolume", "volume", (v) => Math.round(v * 100) + "%"],
            ["setScale", "pixelRatio", (v) => Math.round(v * 100) + "%"]
        ];
        const checks = [
            ["setLeaves", "fancyLeaves"], ["setClouds", "clouds"], ["setBob", "viewBobbing"],
            ["setInvert", "invertY"], ["setFps", "showFps"]
        ];
        this.syncSettingsForm = () => {
            for (const [id, key, fmt] of ranges) {
                $(id).value = s()[key];
                $("val" + id.slice(3)).textContent = fmt(Number(s()[key]));
            }
            for (const [id, key] of checks) {
                $(id).checked = !!s()[key];
            }
        };
        for (const [id, key, fmt] of ranges) {
            $(id).addEventListener("input", () => {
                const v = Number($(id).value);
                s()[key] = v;
                $("val" + id.slice(3)).textContent = fmt(v);
                this.applySettings(key);
            });
        }
        for (const [id, key] of checks) {
            $(id).addEventListener("change", () => {
                s()[key] = $(id).checked;
                this.applySettings(key);
            });
        }
        $("btnSettingsDone").onclick = () => {
            show("settings", false);
            this.saveSettings();
        };
    }

    openSettings() {
        this.syncSettingsForm();
        show("settings");
    }

    applySettings(key) {
        const st = this.settings;
        this.renderer.applySettings(st);
        this.sound.setVolume(st.volume);
        if (key === "fancyLeaves") {
            const w = this.game ? this.game.world : this.preview && this.preview.world;
            if (w) {
                this.renderer.remeshAll(w);
            }
        }
        this.saveSettings();
    }
}

const app = new App();
window.blocky = app;
try {
    app.boot();
} catch (e) {
    console.error(e);
    app.fatal(e);
}
