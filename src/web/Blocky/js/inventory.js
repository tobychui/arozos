/*
    Blocky - inventory.js

    The player inventory: 36 slots, the first 9 are the hotbar. A stack is
    { id, count, dmg } where dmg is the wear of a tool.
*/

import { ITEMS, RECIPES } from "./blocks.js";

export function maxStack(id) {
    const it = ITEMS[id];
    return it ? it.stack : 64;
}

export function cloneStack(s) {
    return s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null;
}

export class Inventory {
    constructor() {
        this.slots = new Array(36).fill(null);
        this.selected = 0;
    }

    get held() {
        return this.slots[this.selected];
    }

    heldId() {
        const s = this.slots[this.selected];
        return s ? s.id : 0;
    }

    //Add items; returns how many did not fit
    add(id, count, dmg = 0) {
        const max = maxStack(id);
        const order = [];
        for (let i = 0; i < 36; i++) {
            order.push(i);
        }
        if (max > 1) {
            for (const i of order) {
                const s = this.slots[i];
                if (s && s.id === id && s.count < max && (s.dmg || 0) === dmg) {
                    const n = Math.min(count, max - s.count);
                    s.count += n;
                    count -= n;
                    if (count === 0) {
                        return 0;
                    }
                }
            }
        }
        for (const i of order) {
            if (!this.slots[i]) {
                const n = Math.min(count, max);
                this.slots[i] = { id, count: n, dmg };
                count -= n;
                if (count === 0) {
                    return 0;
                }
            }
        }
        return count;
    }

    count(id) {
        let n = 0;
        for (const s of this.slots) {
            if (s && s.id === id) {
                n += s.count;
            }
        }
        return n;
    }

    remove(id, count) {
        for (let i = 35; i >= 0 && count > 0; i--) {
            const s = this.slots[i];
            if (s && s.id === id) {
                const n = Math.min(count, s.count);
                s.count -= n;
                count -= n;
                if (s.count <= 0) {
                    this.slots[i] = null;
                }
            }
        }
        return count === 0;
    }

    consumeHeld(n = 1) {
        const s = this.slots[this.selected];
        if (!s) {
            return;
        }
        s.count -= n;
        if (s.count <= 0) {
            this.slots[this.selected] = null;
        }
    }

    //Wear the held tool; returns true when it broke
    damageHeld(amount = 1) {
        const s = this.slots[this.selected];
        const it = s && ITEMS[s.id];
        if (!it || !it.tool) {
            return false;
        }
        s.dmg = (s.dmg || 0) + amount;
        if (s.dmg >= it.tool.durability) {
            this.slots[this.selected] = null;
            return true;
        }
        return false;
    }

    canCraft(r) {
        return r.inputs.every(([id, n]) => this.count(id) >= n);
    }

    clear() {
        this.slots.fill(null);
    }

    serialize() {
        return { slots: this.slots.map(cloneStack), selected: this.selected };
    }

    load(d) {
        this.clear();
        if (!d || !Array.isArray(d.slots)) {
            return;
        }
        d.slots.slice(0, 36).forEach((s, i) => {
            if (s && ITEMS[s.id] && s.count > 0) {
                this.slots[i] = { id: s.id, count: s.count, dmg: s.dmg || 0 };
            }
        });
        this.selected = Math.max(0, Math.min(8, d.selected | 0));
    }
}

//Recipes that fit a crafting grid of the given size (2 or 3)
export function recipesFor(size) {
    return RECIPES.filter((r) => size === 3 || r.small);
}
