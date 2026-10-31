/*
    Blocky - ui.js

    The in-game HTML layer: the HUD (hotbar, health, food, air) and the
    container screens (inventory with hand crafting, workbench, furnace,
    chest, creative palette) with the usual slot mouse handling:

        left click      pick up / put down / swap / merge a stack
        right click     pick up half / put down one
        shift click     move the stack to the other part of the screen
        1-9 over a slot swap it with that hotbar slot
*/

import { ITEMS, RECIPES, SMELTING, SMELT_TICKS, fuelTicks, itemName, creativeGroups, matchRecipe, recipeLayout } from "./blocks.js";
import { iconCss } from "./icons.js";
import { maxStack, cloneStack, recipesFor } from "./inventory.js";
import { escapeHtml } from "./util.js";

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const HEART = "M9 14.6C9 14.6 1.4 9.9 1.4 5.4C1.4 3.2 3.1 1.5 5.2 1.5C6.8 1.5 8.2 2.5 9 3.9C9.8 2.5 11.2 1.5 12.8 1.5C14.9 1.5 16.6 3.2 16.6 5.4C16.6 9.9 9 14.6 9 14.6Z";
const LOAF = "M1.8 13.4L1.8 10.2C1.8 6.3 5 3.6 9 3.6C13 3.6 16.2 6.3 16.2 10.2L16.2 13.4Z";

function iconSvg(path, full, empty, stroke, extra = "") {
    const make = (fill, defs = "") => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'>${defs}<path d='${path}' fill='${fill}' stroke='${stroke}' stroke-width='1.3' stroke-linejoin='round'/>${extra}</svg>`;
    return {
        full: svgUrl(make(full)),
        half: svgUrl(make("url(#g)", `<defs><linearGradient id='g'><stop offset='0.5' stop-color='${full}'/><stop offset='0.5' stop-color='${empty}'/></linearGradient></defs>`)),
        empty: svgUrl(make(empty))
    };
}

const HEART_ICONS = iconSvg(HEART, "#e0302c", "#3a1414", "#1c0404", "<path d='M4 4.6C4.6 3.6 5.6 3.3 6.4 3.6' stroke='#ffb0a8' stroke-width='1.2' fill='none' stroke-linecap='round'/>");
const FOOD_ICONS = iconSvg(LOAF, "#d8913e", "#3b2a18", "#2a1606", "<path d='M6 6.6L7.4 8.6M9 5.7L10.4 7.8M12 6.5L13.2 8.4' stroke='#8a5418' stroke-width='1.1'/>");
const BUBBLE = svgUrl("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'><circle cx='9' cy='8' r='5.8' fill='#86bdfd' fill-opacity='0.55' stroke='#eaf5ff' stroke-width='1.3'/><path d='M6 6.4C6.6 5.4 7.6 5 8.4 5.2' stroke='#ffffff' stroke-width='1.2' fill='none' stroke-linecap='round'/></svg>");

export class UI {
    constructor(app) {
        this.app = app;
        this.icons = app.icons;
        this.cursor = null;
        this.screen = null;
        this.hover = null;
        this.hudKey = "";
        this.creativeTab = 0;
        this.onlyCraftable = false;
        this.showBook = true;
        try {
            this.showBook = localStorage.getItem("blocky.book") !== "0";
        } catch (e) {
            //Default to showing the book
        }
        this.buildHud();
        this.bindScreen();
    }

    get game() {
        return this.app.game;
    }

    /* ---------------- shared slot rendering ---------------- */

    slotHtml(ref, extraClass = "") {
        return `<div class="slot ${extraClass}" data-ref="${ref}"><div class="ic"></div><span class="cnt"></span><div class="dura"><i></i></div></div>`;
    }

    renderSlot(el, stack, size = 36) {
        const ic = el.firstElementChild;
        const cnt = ic.nextElementSibling;
        const dura = cnt.nextElementSibling;
        if (!stack) {
            ic.style.cssText = "background:none;";
            cnt.textContent = "";
            dura.style.display = "none";
            return;
        }
        ic.style.cssText = iconCss(this.icons, stack.id, size);
        cnt.textContent = stack.count > 1 ? String(stack.count) : "";
        const it = ITEMS[stack.id];
        if (it && it.tool && stack.dmg > 0) {
            const f = Math.max(0, 1 - stack.dmg / it.tool.durability);
            dura.style.display = "block";
            dura.firstElementChild.style.width = (f * 100) + "%";
            dura.firstElementChild.style.background = `hsl(${Math.round(f * 120)}, 85%, 45%)`;
        } else {
            dura.style.display = "none";
        }
    }

    /* ---------------- HUD ---------------- */

    buildHud() {
        const hotbar = document.getElementById("hotbar");
        hotbar.innerHTML = "";
        for (let i = 0; i < 9; i++) {
            hotbar.insertAdjacentHTML("beforeend", this.slotHtml("hot:" + i));
        }
        this.hotbarEls = Array.from(hotbar.children);
        const row = (id, cls) => {
            const el = document.getElementById(id);
            el.innerHTML = "";
            for (let i = 0; i < 10; i++) {
                el.insertAdjacentHTML("beforeend", `<span class="${cls}"></span>`);
            }
            return Array.from(el.children);
        };
        this.heartEls = row("hearts", "hp");
        this.foodEls = row("foodbar", "fd");
        this.airEls = row("airbar", "air");
        this.hotbarEls.forEach((el, i) => {
            el.addEventListener("mousedown", (e) => {
                if (this.game && !this.screen) {
                    this.game.inventory.selected = i;
                    e.preventDefault();
                }
            });
        });
    }

    updateHud(game) {
        const p = game.player, inv = game.inventory;
        const slots = inv.slots.slice(0, 9).map((s) => (s ? s.id + "x" + s.count + "d" + (s.dmg || 0) : "-")).join(",");
        const key = [slots, inv.selected, game.creative, Math.ceil(p.health), Math.ceil(p.food), Math.ceil(p.air), p.headInWater, p.hurtTime > 0.25].join("|");
        if (key === this.hudKey) {
            return;
        }
        this.hudKey = key;
        for (let i = 0; i < 9; i++) {
            this.renderSlot(this.hotbarEls[i], inv.slots[i]);
            this.hotbarEls[i].classList.toggle("sel", i === inv.selected);
        }
        const bars = document.getElementById("statusbars");
        bars.classList.toggle("hidden", game.creative);
        const hp = Math.ceil(p.health), fd = Math.ceil(p.food);
        this.heartEls.forEach((el, i) => {
            const v = hp - i * 2;
            el.style.backgroundImage = v >= 2 ? HEART_ICONS.full : v === 1 ? HEART_ICONS.half : HEART_ICONS.empty;
        });
        document.getElementById("hearts").classList.toggle("blink", p.hurtTime > 0.25);
        this.foodEls.forEach((el, i) => {
            const v = fd - i * 2;
            el.style.backgroundImage = v >= 2 ? FOOD_ICONS.full : v === 1 ? FOOD_ICONS.half : FOOD_ICONS.empty;
        });
        document.getElementById("foodbar").classList.toggle("starving", fd <= 6);
        const showAir = p.headInWater || p.air < 15;
        const airBar = document.getElementById("airbar");
        airBar.classList.toggle("hidden", !showAir);
        const bubbles = Math.ceil(Math.max(0, p.air) / 1.5);
        this.airEls.forEach((el, i) => {
            el.style.backgroundImage = i < bubbles ? BUBBLE : "none";
        });
    }

    showItemName(id) {
        const el = document.getElementById("itemName");
        el.textContent = id ? itemName(id) : "";
        el.classList.remove("fade");
        void el.offsetWidth;
        if (id) {
            el.classList.add("fade");
        }
    }

    toast(msg) {
        const el = document.getElementById("message");
        el.textContent = msg;
        el.classList.remove("fade");
        void el.offsetWidth;
        el.classList.add("fade");
    }

    /* ---------------- screens ---------------- */

    bindScreen() {
        const panel = document.getElementById("screenPanel");
        panel.addEventListener("mousedown", (e) => {
            const slot = e.target.closest(".slot");
            if (slot && panel.contains(slot)) {
                e.preventDefault();
                this.slotClick(slot.dataset.ref, e.button, e.shiftKey);
                //A stack picked up here may be dragged onto the palette
                this.dragging = !!this.cursor;
                return;
            }
            //Creative: whatever is held and clicked onto the palette is gone
            if (this.cursor && e.target.closest(".palette")) {
                e.preventDefault();
                this.cursor = null;
                this.after();
                this.renderCursor();
                return;
            }
            const rec = e.target.closest(".recipe");
            if (rec) {
                e.preventDefault();
                this.bookClick(RECIPES[Number(rec.dataset.r)], e.shiftKey);
                return;
            }
            if (e.target.closest(".bookbtn")) {
                e.preventDefault();
                this.showBook = !this.showBook;
                try {
                    localStorage.setItem("blocky.book", this.showBook ? "1" : "0");
                } catch (err) {
                    //Only a convenience
                }
                this.renderScreen(true);
                return;
            }
            const tab = e.target.closest(".tab");
            if (tab) {
                this.creativeTab = Number(tab.dataset.tab);
                this.renderScreen(true);
                return;
            }
            const pal = e.target.closest(".pal");
            if (pal) {
                e.preventDefault();
                this.paletteClick(Number(pal.dataset.id), e.button, e.shiftKey);
            }
        });
        panel.addEventListener("change", (e) => {
            if (e.target.id === "onlyCraftable") {
                this.onlyCraftable = e.target.checked;
                this.renderScreen(false);
            }
        });
        panel.addEventListener("contextmenu", (e) => e.preventDefault());
        document.addEventListener("mouseup", (e) => {
            //Creative: a stack dragged from a slot and let go over the
            //palette is thrown away
            if (this.dragging && this.cursor && this.screen && e.target.closest && e.target.closest(".palette")) {
                this.cursor = null;
                this.after();
                this.renderCursor();
            }
            this.dragging = false;
        });
        panel.addEventListener("mouseover", (e) => {
            const el = e.target.closest(".slot, .recipe, .pal");
            this.hover = !el ? null : el.classList.contains("slot") ? el.dataset.ref : el.classList.contains("pal") ? "pal:" + el.dataset.id : null;
            this.showTooltip(el);
        });
        panel.addEventListener("mouseleave", () => {
            this.hover = null;
            this.showTooltip(null);
        });
        document.getElementById("screen").addEventListener("mousedown", (e) => {
            //Clicking outside the panel throws the held stack
            if (e.target.id === "screen" && this.cursor) {
                const n = e.button === 2 ? 1 : this.cursor.count;
                this.game.dropStack({ id: this.cursor.id, count: n, dmg: this.cursor.dmg });
                this.cursor.count -= n;
                if (this.cursor.count <= 0) {
                    this.cursor = null;
                }
                this.renderCursor();
            }
        });
        document.addEventListener("mousemove", (e) => {
            this.mx = e.clientX;
            this.my = e.clientY;
            if (this.screen) {
                const c = document.getElementById("cursorStack");
                c.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
                const tip = document.getElementById("tooltip");
                if (!tip.classList.contains("hidden")) {
                    tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY - 8}px)`;
                }
            }
        });
    }

    isOpen() {
        return this.screen !== null;
    }

    open(kind, te = null) {
        if (kind === "inventory" && this.game.creative) {
            kind = "creative";
        }
        this.screen = { kind, te };
        if (kind === "inventory" || kind === "workbench") {
            const size = kind === "workbench" ? 3 : 2;
            Object.assign(this.screen, { size, grid: new Array(size * size).fill(null), result: null, match: null });
        }
        document.getElementById("screen").classList.remove("hidden");
        document.body.classList.add("screen-open");
        this.renderScreen(true);
    }

    close() {
        if (!this.screen) {
            return;
        }
        if (this.screen.grid) {
            this.returnGrid();
        }
        if (this.cursor) {
            this.giveBack(this.cursor);
            this.cursor = null;
        }
        this.screen = null;
        this.renderCursor();
        this.showTooltip(null);
        document.getElementById("screen").classList.add("hidden");
        document.body.classList.remove("screen-open");
        this.hudKey = "";
    }

    invSection(title) {
        let main = "", hot = "";
        for (let i = 9; i < 36; i++) {
            main += this.slotHtml("inv:" + i);
        }
        for (let i = 0; i < 9; i++) {
            hot += this.slotHtml("inv:" + i);
        }
        return `<h3>${title}</h3><div class="slots grid9">${main}</div><div class="slots grid9 hotrow">${hot}</div>`;
    }

    renderScreen(rebuild) {
        const s = this.screen;
        if (!s) {
            return;
        }
        const panel = document.getElementById("screenPanel");
        if (rebuild) {
            let html = "";
            if (s.kind === "creative") {
                const groups = creativeGroups();
                const tabs = groups.map((g, i) => `<button class="tab ${i === this.creativeTab ? "on" : ""}" data-tab="${i}">${g.name}</button>`).join("");
                const pal = groups[this.creativeTab].ids.map((id) => `<div class="pal" data-id="${id}"><div class="ic" style="${iconCss(this.icons, id, 36)}"></div></div>`).join("");
                let hot = "";
                for (let i = 0; i < 9; i++) {
                    hot += this.slotHtml("inv:" + i);
                }
                //Item grid and the hotbar only: the rest of the inventory has no use in creative
                html = `<div class="scr-col creative"><div class="tabs">${tabs}</div>
                    <div class="palette"><div class="palgrid">${pal}</div></div>
                    <div class="creativehot"><div class="slots grid9">${hot}</div>${this.slotHtml("trash", "trash")}</div>
                    <p class="hint">Click an item to pick up a stack, shift click to add it to the hotbar, or press 1-9 over it. Drop items on the bin to delete them.</p></div>`;
            } else if (s.kind === "furnace") {
                html = `<div class="scr-col"><h3>Furnace</h3><div class="furnace">
                    <div class="fcol">${this.slotHtml("te:0")}<div class="flame"><i></i></div>${this.slotHtml("te:1")}</div>
                    <div class="arrow"><i></i></div>${this.slotHtml("te:2", "big")}</div>
                    ${this.invSection("Inventory")}</div>`;
            } else if (s.kind === "chest") {
                let cs = "";
                for (let i = 0; i < 27; i++) {
                    cs += this.slotHtml("te:" + i);
                }
                html = `<div class="scr-col"><h3>Chest</h3><div class="slots grid9">${cs}</div>${this.invSection("Inventory")}</div>`;
            } else {
                const bench = s.kind === "workbench";
                let cells = "";
                for (let i = 0; i < s.size * s.size; i++) {
                    cells += this.slotHtml("craft:" + i);
                }
                const hint = bench
                    ? "Click a recipe to lay it out on the grid; shift click lays out as many as you can."
                    : "Click a recipe to lay it out. Bigger recipes need the 3 x 3 grid of a workbench.";
                html = `<div class="scr-col">
                    <h3>${bench ? "Workbench" : "Crafting"}<button class="bookbtn ${this.showBook ? "on" : ""}" title="Show or hide the recipe book">Recipe book</button></h3>
                    <div class="craftrow"><div class="cgrid s${s.size}">${cells}</div><div class="arrow"><i></i></div>${this.slotHtml("result", "big result")}</div>
                    ${this.invSection("Inventory")}</div>
                    <div class="scr-col book ${this.showBook ? "" : "hidden"}"><h3>Recipes
                    <label class="onlycan"><input type="checkbox" id="onlyCraftable" ${this.onlyCraftable ? "checked" : ""}> Only what I can make</label></h3>
                    <div class="recipes"></div><p class="hint">${hint}</p></div>`;
            }
            panel.innerHTML = html;
            panel.className = "panel kind-" + s.kind;
        }
        if (s.grid) {
            this.updateResult();
            panel.querySelector(".craftrow .arrow").classList.toggle("ready", !!s.result);
        }
        //Slots
        panel.querySelectorAll(".slot").forEach((el) => {
            this.renderSlot(el, this.getStack(el.dataset.ref));
        });
        const book = panel.querySelector(".book .recipes");
        if (book && this.showBook) {
            this.renderRecipes(book, s.size);
        }
        if (s.kind === "furnace") {
            const te = s.te;
            panel.querySelector(".arrow i").style.width = Math.round((te.cook / SMELT_TICKS) * 100) + "%";
            panel.querySelector(".flame i").style.height = te.burnMax > 0 ? Math.round((te.burn / te.burnMax) * 100) + "%" : "0%";
        }
        this.renderCursor();
    }

    //How many of an item the player can use: inventory plus the grid
    available(id) {
        let n = this.game.inventory.count(id);
        for (const st of this.screen.grid || []) {
            if (st && st.id === id) {
                n += st.count;
            }
        }
        return n;
    }

    renderRecipes(box, size) {
        const creative = this.game.creative;
        const list = recipesFor(size).map((r) => ({
            r, idx: RECIPES.indexOf(r), can: creative || r.inputs.every(([id, n]) => this.available(id) >= n)
        }));
        list.sort((a, b) => (b.can - a.can));
        const mini = (id) => `<i class="ic" style="${iconCss(this.icons, id, 16)}"></i>`;
        let html = "";
        for (const { r, idx, can } of list) {
            if (this.onlyCraftable && !can) {
                continue;
            }
            let pattern;
            if (r.items) {
                pattern = `<div class="loose">${r.items.map((id) => `<b>${mini(id)}</b>`).join("")}<span>any layout</span></div>`;
            } else {
                let cells = "";
                for (const row of r.shape) {
                    for (const ch of row) {
                        cells += ch === "." ? "<b></b>" : `<b>${mini(r.key[ch])}</b>`;
                    }
                }
                pattern = `<div class="pattern" style="grid-template-columns:repeat(${r.w}, 18px)">${cells}</div>`;
            }
            html += `<div class="recipe ${can ? "can" : ""}" data-r="${idx}"><div class="ic" style="${iconCss(this.icons, r.out, 36)}"></div>
                <div class="rinfo"><b>${escapeHtml(itemName(r.out))}${r.count > 1 ? " x" + r.count : ""}</b>${pattern}</div></div>`;
        }
        if (!html) {
            html = "<p class=\"hint\">Nothing you can make right now.</p>";
        }
        box.innerHTML = html;
    }

    renderCursor() {
        const el = document.getElementById("cursorStack");
        if (!this.cursor || !this.screen) {
            el.classList.add("hidden");
            return;
        }
        el.classList.remove("hidden");
        el.innerHTML = `<div class="ic" style="${iconCss(this.icons, this.cursor.id, 36)}"></div><span class="cnt">${this.cursor.count > 1 ? this.cursor.count : ""}</span>`;
        el.style.transform = `translate(${(this.mx || 0) - 20}px, ${(this.my || 0) - 20}px)`;
    }

    showTooltip(el) {
        const tip = document.getElementById("tooltip");
        let id = 0;
        if (el) {
            if (el.classList.contains("slot")) {
                const st = this.getStack(el.dataset.ref);
                id = st ? st.id : 0;
                if (el.dataset.ref === "trash") {
                    tip.textContent = "Delete";
                    tip.classList.remove("hidden");
                    return;
                }
            } else if (el.classList.contains("recipe")) {
                id = RECIPES[Number(el.dataset.r)].out;
            } else {
                id = Number(el.dataset.id);
            }
        }
        if (!id || this.mx === undefined) {
            tip.classList.add("hidden");
            return;
        }
        const it = ITEMS[id];
        let text = itemName(id);
        if (it && it.food) {
            text += ` (restores ${it.food.hunger / 2} food)`;
        }
        if (it && it.tool) {
            const st = el.classList.contains("slot") ? this.getStack(el.dataset.ref) : null;
            const left = it.tool.durability - ((st && st.dmg) || 0);
            text += ` (${left}/${it.tool.durability})`;
        }
        if (SMELTING.has(id) && this.screen && this.screen.kind === "furnace") {
            text += " - smelts into " + itemName(SMELTING.get(id));
        }
        tip.textContent = text;
        tip.classList.remove("hidden");
        tip.style.transform = `translate(${(this.mx || 0) + 16}px, ${(this.my || 0) - 8}px)`;
    }

    /* ---------------- slot logic ---------------- */

    getStack(ref) {
        const [kind, n] = ref.split(":");
        const s = this.screen;
        if (kind === "inv" || kind === "hot") {
            return this.game.inventory.slots[Number(n)];
        }
        if (kind === "te" && s && s.te) {
            return s.te.slots[Number(n)];
        }
        if (kind === "craft" && s && s.grid) {
            return s.grid[Number(n)];
        }
        if (kind === "result" && s) {
            return s.result || null;
        }
        return null;
    }

    setStack(ref, stack) {
        const [kind, n] = ref.split(":");
        if (stack && stack.count <= 0) {
            stack = null;
        }
        if (kind === "inv") {
            this.game.inventory.slots[Number(n)] = stack;
        } else if (kind === "te" && this.screen && this.screen.te) {
            this.screen.te.slots[Number(n)] = stack;
        } else if (kind === "craft" && this.screen && this.screen.grid) {
            this.screen.grid[Number(n)] = stack;
        }
    }

    /* ---------------- crafting grid ---------------- */

    //Put a stack back into the inventory, dropping what does not fit
    giveBack(stack) {
        const left = this.game.inventory.add(stack.id, stack.count, stack.dmg || 0);
        if (left > 0) {
            this.game.dropStack({ id: stack.id, count: left, dmg: stack.dmg });
        }
    }

    returnGrid() {
        const g = this.screen.grid;
        for (let i = 0; i < g.length; i++) {
            if (g[i]) {
                this.giveBack(g[i]);
                g[i] = null;
            }
        }
        this.updateResult();
    }

    updateResult() {
        const s = this.screen;
        if (!s || !s.grid) {
            return;
        }
        const r = matchRecipe(s.grid.map((st) => (st ? st.id : 0)), s.size);
        s.match = r;
        s.result = r ? { id: r.out, count: r.count, dmg: 0 } : null;
    }

    //Use up one item from every filled grid cell
    consumeGrid() {
        const g = this.screen.grid;
        for (let i = 0; i < g.length; i++) {
            if (g[i]) {
                g[i].count--;
                if (g[i].count <= 0) {
                    g[i] = null;
                }
            }
        }
        this.updateResult();
    }

    //Click on the result slot (shift: craft as many as the grid allows)
    takeResult(shift) {
        const s = this.screen;
        const r = s.match;
        if (!r) {
            return;
        }
        if (shift) {
            for (let n = 0; n < 64 && s.match === r; n++) {
                const left = this.game.inventory.add(r.out, r.count);
                this.consumeGrid();
                if (left > 0) {
                    this.game.dropStack({ id: r.out, count: left });
                    break;
                }
            }
        } else {
            if (this.cursor && (this.cursor.id !== r.out || this.cursor.count + r.count > maxStack(r.out))) {
                return;
            }
            if (this.cursor) {
                this.cursor.count += r.count;
            } else {
                this.cursor = { id: r.out, count: r.count, dmg: 0 };
            }
            this.consumeGrid();
        }
        this.game.sound.play("click");
    }

    //Lay a recipe out on the grid from the inventory (shift: as many as possible)
    bookClick(r, shift) {
        const s = this.screen;
        if (!s || !s.grid) {
            return;
        }
        if (!r.small && s.size < 3) {
            this.toast("That recipe needs a workbench");
            return;
        }
        const inv = this.game.inventory;
        const creative = this.game.creative;
        const layout = recipeLayout(r, s.size);
        const same = s.grid.every((st, i) => (st ? st.id : 0) === layout[i]);
        if (!same) {
            this.returnGrid();
        }
        let placed = 0;
        for (let k = 0; k < (shift ? 64 : 1); k++) {
            if (!creative && !r.inputs.every(([id, n]) => inv.count(id) >= n)) {
                break;
            }
            if (layout.some((id, i) => id && s.grid[i] && s.grid[i].count >= maxStack(id))) {
                break;
            }
            layout.forEach((id, i) => {
                if (!id) {
                    return;
                }
                if (!creative) {
                    inv.remove(id, 1);
                }
                if (s.grid[i]) {
                    s.grid[i].count++;
                } else {
                    s.grid[i] = { id, count: 1, dmg: 0 };
                }
            });
            placed++;
        }
        if (!placed) {
            this.toast("You are missing some ingredients");
        }
        this.after();
        this.game.sound.play("click");
    }

    accepts(ref, stack) {
        if (!stack) {
            return true;
        }
        if (ref === "result") {
            return false;
        }
        if (this.screen && this.screen.kind === "furnace" && ref.startsWith("te:")) {
            const n = Number(ref.slice(3));
            if (n === 2) {
                return false;
            }
            if (n === 1) {
                return fuelTicks(stack.id) > 0;
            }
        }
        return true;
    }

    slotClick(ref, button, shift) {
        const game = this.game;
        if (ref === "trash") {
            this.cursor = null;
            this.renderScreen(false);
            return;
        }
        if (ref === "result") {
            this.takeResult(shift);
            this.after();
            return;
        }
        if (shift && !this.cursor) {
            this.quickMove(ref);
            this.after();
            return;
        }
        const slot = this.getStack(ref);
        const max = (id) => maxStack(id);
        const output = this.screen.kind === "furnace" && ref === "te:2";
        if (output) {
            if (!slot) {
                return;
            }
            if (!this.cursor) {
                this.cursor = slot;
                this.setStack(ref, null);
            } else if (this.cursor.id === slot.id && this.cursor.count + slot.count <= max(slot.id)) {
                this.cursor.count += slot.count;
                this.setStack(ref, null);
            }
            this.after();
            return;
        }
        if (button === 0) {
            if (!this.cursor) {
                if (slot) {
                    this.cursor = slot;
                    this.setStack(ref, null);
                }
            } else if (!slot) {
                if (this.accepts(ref, this.cursor)) {
                    this.setStack(ref, this.cursor);
                    this.cursor = null;
                }
            } else if (slot.id === this.cursor.id && max(slot.id) > 1 && (slot.dmg || 0) === (this.cursor.dmg || 0)) {
                const n = Math.min(this.cursor.count, max(slot.id) - slot.count);
                slot.count += n;
                this.cursor.count -= n;
                if (this.cursor.count <= 0) {
                    this.cursor = null;
                }
            } else if (this.accepts(ref, this.cursor)) {
                this.setStack(ref, this.cursor);
                this.cursor = slot;
            }
        } else if (button === 2) {
            if (!this.cursor) {
                if (slot) {
                    const half = Math.ceil(slot.count / 2);
                    this.cursor = { id: slot.id, count: half, dmg: slot.dmg || 0 };
                    slot.count -= half;
                    if (slot.count <= 0) {
                        this.setStack(ref, null);
                    }
                }
            } else if (this.accepts(ref, this.cursor)) {
                if (!slot) {
                    this.setStack(ref, { id: this.cursor.id, count: 1, dmg: this.cursor.dmg || 0 });
                    this.cursor.count--;
                } else if (slot.id === this.cursor.id && slot.count < max(slot.id)) {
                    slot.count++;
                    this.cursor.count--;
                }
                if (this.cursor.count <= 0) {
                    this.cursor = null;
                }
            }
        }
        this.after();
        if (game) {
            game.sound.play("click");
        }
    }

    //Put a stack into the given refs (merge first, then empty slots)
    moveInto(stack, refs) {
        const max = maxStack(stack.id);
        if (max > 1) {
            for (const r of refs) {
                const s = this.getStack(r);
                if (s && s.id === stack.id && s.count < max && (s.dmg || 0) === (stack.dmg || 0)) {
                    const n = Math.min(stack.count, max - s.count);
                    s.count += n;
                    stack.count -= n;
                    if (stack.count === 0) {
                        return 0;
                    }
                }
            }
        }
        for (const r of refs) {
            if (!this.getStack(r) && this.accepts(r, stack)) {
                this.setStack(r, { id: stack.id, count: stack.count, dmg: stack.dmg || 0 });
                stack.count = 0;
                return 0;
            }
        }
        return stack.count;
    }

    quickMove(ref) {
        const s = this.getStack(ref);
        //Creative only shows the hotbar, so there is nowhere to move things to
        if (!s || this.screen.kind === "creative") {
            return;
        }
        const range = (p, a, b) => {
            const out = [];
            for (let i = a; i < b; i++) {
                out.push(p + i);
            }
            return out;
        };
        const kind = this.screen.kind;
        const stack = cloneStack(s);
        let targets;
        if (ref.startsWith("te:") || ref.startsWith("craft:")) {
            targets = range("inv:", 9, 36).concat(range("inv:", 0, 9));
        } else if (kind === "chest") {
            targets = range("te:", 0, 27);
        } else if (kind === "furnace" && SMELTING.has(s.id)) {
            targets = ["te:0"];
        } else if (kind === "furnace" && fuelTicks(s.id) > 0) {
            targets = ["te:1"];
        } else {
            const n = Number(ref.slice(4));
            targets = n < 9 ? range("inv:", 9, 36) : range("inv:", 0, 9);
        }
        const left = this.moveInto(stack, targets);
        if (left === 0) {
            this.setStack(ref, null);
        } else {
            s.count = left;
        }
    }

    paletteClick(id, button, shift) {
        if (this.cursor && button === 0 && this.cursor.id !== id) {
            this.cursor = null;
        } else if (shift) {
            this.game.inventory.add(id, maxStack(id));
        } else if (this.cursor && this.cursor.id === id && button === 0) {
            this.cursor.count = Math.min(maxStack(id), this.cursor.count + 1);
        } else {
            this.cursor = { id, count: button === 2 ? 1 : maxStack(id), dmg: 0 };
        }
        this.after();
    }

    hotkey(n) {
        const h = this.hover;
        if (h && h.startsWith("pal:")) {
            const id = Number(h.slice(4));
            this.game.inventory.slots[n] = { id, count: maxStack(id), dmg: 0 };
            this.after();
            return true;
        }
        if (!h || !(h.startsWith("inv:") || h.startsWith("te:") || h.startsWith("craft:"))) {
            return false;
        }
        if (this.screen.kind === "furnace" && this.hover === "te:2") {
            return false;
        }
        const a = this.getStack(this.hover);
        const b = this.game.inventory.slots[n];
        if (b && !this.accepts(this.hover, b)) {
            return true;
        }
        this.game.inventory.slots[n] = a;
        this.setStack(this.hover, b);
        this.after();
        return true;
    }

    after() {
        this.hudKey = "";
        this.renderScreen(false);
        const el = this.hover && document.querySelector(`#screenPanel .slot[data-ref="${this.hover}"]`);
        this.showTooltip(el || null);
    }
}
