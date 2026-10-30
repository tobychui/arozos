/*
    Blocky - storage.js

    Saves and loads worlds. Inside ArozOS worlds live in the user's appdata
    folder through backend/worlds.agi, so they follow the user to any
    device. When the gateway is not reachable (the app opened standalone)
    the worlds are kept in this browser's IndexedDB instead.

    A world is { meta, payload } where payload is a string (the compressed
    world state); the server splits it into parts of PART_SIZE characters.
*/

const SCRIPT = "Blocky/backend/worlds.agi";
const PART_SIZE = 3 * 1024 * 1024;
const DB_NAME = "blocky-worlds";

function agi(data, timeout = 60000) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) {
                done = true;
                reject(new Error("timeout"));
            }
        }, timeout);
        ao_module_agirun(SCRIPT, data, (resp) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            let obj = resp;
            try {
                if (typeof resp === "string") {
                    obj = JSON.parse(resp);
                }
            } catch (e) {
                reject(new Error("bad response"));
                return;
            }
            if (!obj || obj.ok !== true) {
                reject(new Error((obj && obj.error) || "request failed"));
                return;
            }
            resolve(obj);
        }, () => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                reject(new Error("gateway unreachable"));
            }
        });
    });
}

function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore("worlds", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbOp(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("worlds", mode);
        const store = tx.objectStore("worlds");
        const req = fn(store);
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
    });
}

export class Storage {
    constructor() {
        this.mode = "local";
    }

    //Pick the server when the AGI gateway answers, else IndexedDB
    async init() {
        if (typeof ao_module_agirun === "function" && typeof $ !== "undefined") {
            try {
                await agi({ action: "list" }, 8000);
                this.mode = "server";
                return this.mode;
            } catch (e) {
                //Fall through to local storage
            }
        }
        this.mode = "local";
        return this.mode;
    }

    get where() {
        return this.mode === "server" ? "your ArozOS account" : "this browser";
    }

    async list() {
        let worlds;
        if (this.mode === "server") {
            worlds = (await agi({ action: "list" })).worlds || [];
        } else {
            const rows = await idbOp("readonly", (s) => s.getAll());
            worlds = (rows || []).map((r) => r.meta);
        }
        worlds.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
        return worlds;
    }

    async load(id) {
        if (this.mode === "server") {
            const meta = (await agi({ action: "meta", id })).meta;
            let payload = "";
            for (let i = 0; i < meta.parts; i++) {
                payload += (await agi({ action: "loadpart", id, gen: meta.gen, index: i })).data;
            }
            return { meta, payload };
        }
        const row = await idbOp("readonly", (s) => s.get(id));
        if (!row) {
            throw new Error("world not found");
        }
        return { meta: row.meta, payload: row.payload };
    }

    async save(meta, payload) {
        if (this.mode === "server") {
            const gen = (meta.gen || 0) + 1;
            const parts = Math.max(1, Math.ceil(payload.length / PART_SIZE));
            for (let i = 0; i < parts; i++) {
                await agi({ action: "savepart", id: meta.id, gen, index: i, data: payload.slice(i * PART_SIZE, (i + 1) * PART_SIZE) });
            }
            const next = Object.assign({}, meta, { gen, parts, size: payload.length });
            await agi({ action: "savemeta", id: meta.id, meta: JSON.stringify(next) });
            meta.gen = gen;
            meta.parts = parts;
            meta.size = payload.length;
            return;
        }
        meta.size = payload.length;
        await idbOp("readwrite", (s) => s.put({ id: meta.id, meta, payload }));
    }

    async remove(id) {
        if (this.mode === "server") {
            await agi({ action: "delete", id });
            return;
        }
        await idbOp("readwrite", (s) => s.delete(id));
    }
}

export function newWorldId(name) {
    const slug = String(name || "world").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "world";
    return slug + "-" + Date.now().toString(36);
}
