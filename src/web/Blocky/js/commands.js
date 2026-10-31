/*
    Blocky - commands.js

    Slash commands typed into the chat line (T, or / to start with a
    slash). Everything that changes the world or the player needs the
    world's "Allow cheats" option; /help and /seed always work.

    Coordinates accept ~ for "where I am" and ~n for an offset, so
    "/tp ~ ~10 ~" lifts you ten blocks.
*/

import { ITEMS, BLOCKS, B, itemName } from "./blocks.js";
import { DIFFICULTY } from "./player.js";
import { maxStack } from "./inventory.js";
import { WORLD_H } from "./world.js";

class CommandError extends Error {}

const fail = (msg) => {
    throw new CommandError(msg);
};

/* ---------------- item names ---------------- */

const keyOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
let itemKeys = null;

const ALIASES = {
    crafting_table: B.WORKBENCH,
    table: B.WORKBENCH,
    cobble: B.COBBLE,
    wood: B.LOG,
    sugar_cane: B.REEDS,
    iron_block: B.IRON_BLOCK,
    gold_block: B.GOLD_BLOCK,
    crystal_block: B.CRYSTAL_BLOCK,
    mossy_cobble: B.MOSSY_COBBLE,
    double_stone_slab: B.STONE_SLAB,
    plank_stairs: B.PLANK_STAIRS,
    wood_stairs: B.PLANK_STAIRS,
    oak_stairs: B.PLANK_STAIRS,
    cobble_stairs: B.COBBLE_STAIRS
};

function names() {
    if (!itemKeys) {
        itemKeys = new Map();
        ITEMS.forEach((it, id) => {
            if (it) {
                itemKeys.set(keyOf(it.name), id);
            }
        });
        for (const [k, id] of Object.entries(ALIASES)) {
            if (!itemKeys.has(k)) {
                itemKeys.set(k, id);
            }
        }
    }
    return itemKeys;
}

//Item id from a name, an alias, a unique prefix or a number
export function findItem(text) {
    const t = keyOf(text);
    if (/^\d+$/.test(t)) {
        return ITEMS[Number(t)] ? Number(t) : null;
    }
    const map = names();
    if (map.has(t)) {
        return map.get(t);
    }
    const hits = [...map.keys()].filter((k) => k.startsWith(t) || k.endsWith("_" + t));
    const ids = [...new Set(hits.map((k) => map.get(k)))];
    return ids.length === 1 ? ids[0] : null;
}

function placeableBlock(text) {
    const t = keyOf(text);
    if (t === "air") {
        return B.AIR;
    }
    if (t === "water") {
        return B.WATER;
    }
    const id = findItem(text);
    if (id === null || id > 255 || !BLOCKS[id]) {
        fail(`Unknown block "${text}"`);
    }
    return id;
}

/* ---------------- argument helpers ---------------- */

function coord(token, base, center) {
    if (token === undefined) {
        fail("Missing coordinate");
    }
    if (token.startsWith("~")) {
        const rest = token.slice(1);
        const off = rest === "" ? 0 : Number(rest);
        if (!Number.isFinite(off)) {
            fail(`"${token}" is not a coordinate`);
        }
        return base + off;
    }
    const v = Number(token);
    if (!Number.isFinite(v)) {
        fail(`"${token}" is not a coordinate`);
    }
    return center && Number.isInteger(v) ? v + 0.5 : v;
}

function int(token, name, min, max) {
    const v = Number(token);
    if (!Number.isInteger(v) || v < min || v > max) {
        fail(`${name} must be a whole number from ${min} to ${max}`);
    }
    return v;
}

const TIMES = { sunrise: 0, day: 1000, morning: 1000, noon: 6000, sunset: 12000, evening: 12000, night: 13000, midnight: 18000 };

function timeLabel(ticks) {
    const tod = ticks % 24000;
    const h = Math.floor((tod / 1000 + 6) % 24), m = Math.floor((tod % 1000) * 0.06);
    return `day ${Math.floor(ticks / 24000) + 1}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

//Top of a column: loaded terrain if we have it, else the generator's guess
function surfaceY(game, x, z) {
    const w = game.world;
    if (w.isLoaded(Math.floor(x), Math.floor(z))) {
        return w.rainTop(Math.floor(x), Math.floor(z));
    }
    return w.gen.column(Math.floor(x), Math.floor(z)).h + 1;
}

const RULE_NAMES = {
    randomtickspeed: "tickSpeed", tickspeed: "tickSpeed",
    dofiretick: "fireSpread", firespread: "fireSpread"
};

//Show a world rule, or change it when a value is given
function setRule(game, rule, value) {
    const rules = game.world.rules;
    if (rule === "tickSpeed") {
        if (value === undefined) {
            return `Tick speed is ${rules.tickSpeed} (default 3)`;
        }
        const v = Number(value);
        if (!Number.isFinite(v) || v < 0 || v > 1000) {
            fail("Tick speed must be a number from 0 to 1000");
        }
        rules.tickSpeed = v;
        return `Tick speed set to ${v}` + (v > 3 ? ` - plants grow ${Math.round(v / 3 * 10) / 10}x faster` : "");
    }
    if (value === undefined) {
        return `Fire spread is ${rules.fireSpread ? "on" : "off"}`;
    }
    const v = String(value).toLowerCase();
    if (!["on", "off", "true", "false", "1", "0"].includes(v)) {
        fail("Use on or off");
    }
    rules.fireSpread = v === "on" || v === "true" || v === "1";
    return `Fire spread is now ${rules.fireSpread ? "on" : "off"}`;
}

/* ---------------- commands ---------------- */

export const COMMANDS = {
    help: {
        usage: "/help [command]",
        desc: "List the commands, or explain one",
        run(game, args) {
            if (args[0]) {
                const c = COMMANDS[args[0].replace(/^\//, "").toLowerCase()];
                if (!c) {
                    fail(`There is no /${args[0]} command`);
                }
                return [`${c.usage} - ${c.desc}`];
            }
            return ["Commands: " + Object.keys(COMMANDS).map((k) => "/" + k).join(", "), "Type /help <command> for details."];
        }
    },
    give: {
        usage: "/give [player] <item> [amount]",
        desc: "Put items in your inventory, e.g. /give iron_ingot 32",
        cheat: true,
        run(game, args) {
            //"/give <player> <item>": single player ignores the name
            if (args.length >= 2 && findItem(args[0]) === null && !/^\d+$/.test(args[1]) && findItem(args[1]) !== null) {
                args = args.slice(1);
            }
            if (!args[0]) {
                fail("Usage: /give [player] <item> [amount]");
            }
            const id = findItem(args[0]);
            if (id === null) {
                fail(`Unknown item "${args[0]}". Try names like stone, planks, iron_pickaxe`);
            }
            const count = args[1] === undefined ? 1 : int(args[1], "Amount", 1, 64 * 36);
            let left = count;
            const max = maxStack(id);
            let leftover = 0;
            while (left > 0) {
                const n = Math.min(left, max);
                leftover += game.inventory.add(id, n);
                left -= n;
            }
            if (leftover > 0) {
                game.dropStack({ id, count: leftover });
            }
            game.ui.hudKey = "";
            return [`Gave ${count} ${itemName(id)}`];
        }
    },
    tp: {
        usage: "/tp [player] <x> [y] <z>  or  /tp spawn",
        desc: "Teleport; leave out y to land on the ground. ~ means your own position",
        cheat: true,
        run(game, args) {
            const p = game.player;
            if (args[0] === "spawn") {
                game.teleport(game.spawn.x, null, game.spawn.z);
                return ["Teleported to the world spawn"];
            }
            if (args.length === 4) {
                args = args.slice(1);
            }
            let x, y, z;
            if (args.length === 3) {
                x = coord(args[0], p.x, true);
                y = coord(args[1], p.y, false);
                z = coord(args[2], p.z, true);
                if (y < -20 || y > 400) {
                    fail("y must be between -20 and 400");
                }
            } else if (args.length === 2) {
                x = coord(args[0], p.x, true);
                z = coord(args[1], p.z, true);
                y = null;
            } else {
                fail("Usage: /tp <x> <y> <z> or /tp <x> <z>");
            }
            if (Math.abs(x) > 1e6 || Math.abs(z) > 1e6) {
                fail("That is too far away");
            }
            game.teleport(x, y, z);
            const shown = y === null ? surfaceY(game, x, z) : y;
            return [`Teleported to ${x.toFixed(1)}, ${Number(shown).toFixed(1)}, ${z.toFixed(1)}`];
        }
    },
    time: {
        usage: "/time set <day|noon|sunset|night|midnight|ticks>, /time add <ticks>, /time query",
        desc: "Change the time of day (a day is 24000 ticks)",
        cheat: true,
        run(game, args) {
            const sub = (args[0] || "").toLowerCase();
            if (sub === "query" || sub === "") {
                return ["It is " + timeLabel(game.ticks)];
            }
            if (sub === "add") {
                const n = int(args[1], "Ticks", 1, 240000);
                game.ticks += n;
                return ["It is now " + timeLabel(game.ticks)];
            }
            const target = sub === "set" ? (args[1] || "").toLowerCase() : sub;
            let t = TIMES[target];
            if (t === undefined) {
                t = int(target, "Time", 0, 23999);
            }
            game.setTime(t);
            return ["Time set to " + timeLabel(game.ticks)];
        }
    },
    weather: {
        usage: "/weather <clear|rain|thunder> [seconds]",
        desc: "Change the weather",
        cheat: true,
        run(game, args) {
            const s = (args[0] || "").toLowerCase();
            if (!["clear", "rain", "thunder"].includes(s)) {
                fail("Usage: /weather <clear|rain|thunder> [seconds]");
            }
            game.setWeather(s);
            if (args[1] !== undefined) {
                game.weather.timer = int(args[1], "Seconds", 1, 100000) * 20;
            }
            return [`Weather set to ${s}`];
        }
    },
    gamemode: {
        usage: "/gamemode <survival|creative>",
        desc: "Switch game mode (s, c, 0 and 1 work too)",
        cheat: true,
        run(game, args) {
            const m = (args[0] || "").toLowerCase();
            const creative = ["creative", "c", "1"].includes(m);
            if (!creative && !["survival", "s", "0"].includes(m)) {
                fail("Usage: /gamemode <survival|creative>");
            }
            game.setMode(creative);
            return [`Game mode set to ${creative ? "Creative" : "Survival"}`];
        }
    },
    difficulty: {
        usage: "/difficulty <peaceful|easy|normal|hard>",
        desc: "Change how fast hunger drains",
        cheat: true,
        run(game, args) {
            const v = (args[0] || "").toLowerCase();
            let d = DIFFICULTY.findIndex((x) => x.name.toLowerCase() === v || x.name[0].toLowerCase() === v);
            if (d < 0 && /^[0-3]$/.test(v)) {
                d = Number(v);
            }
            if (d < 0) {
                fail("Usage: /difficulty <peaceful|easy|normal|hard>");
            }
            game.setDifficulty(d);
            return [`Difficulty set to ${DIFFICULTY[d].name}`];
        }
    },
    setblock: {
        usage: "/setblock <x> <y> <z> <block>",
        desc: "Place a block (air removes one)",
        cheat: true,
        run(game, args) {
            const p = game.player;
            if (args.length < 4) {
                fail("Usage: /setblock <x> <y> <z> <block>");
            }
            const x = Math.floor(coord(args[0], p.x, false));
            const y = Math.floor(coord(args[1], p.y, false));
            const z = Math.floor(coord(args[2], p.z, false));
            const id = placeableBlock(args[3]);
            if (y < 0 || y >= WORLD_H) {
                fail(`y must be between 0 and ${WORLD_H - 1}`);
            }
            if (!game.world.isLoaded(x, z)) {
                fail("That position is not loaded");
            }
            game.world.setBlock(x, y, z, id, 0);
            if (id === B.WATER) {
                game.world.schedule(x, y, z, 5);
            }
            if (id === B.FURNACE || id === B.CHEST) {
                game.world.createTileEntity(x, y, z, id === B.FURNACE ? "furnace" : "chest");
            }
            return [`Placed ${id === B.AIR ? "air" : BLOCKS[id].name} at ${x}, ${y}, ${z}`];
        }
    },
    clear: {
        usage: "/clear [item]",
        desc: "Empty your inventory, or remove one kind of item",
        cheat: true,
        run(game, args) {
            const inv = game.inventory;
            if (args[0]) {
                const id = findItem(args[0]);
                if (id === null) {
                    fail(`Unknown item "${args[0]}"`);
                }
                const n = inv.count(id);
                inv.remove(id, n);
                game.ui.hudKey = "";
                return [`Removed ${n} ${itemName(id)}`];
            }
            inv.clear();
            game.ui.hudKey = "";
            return ["Inventory cleared"];
        }
    },
    heal: {
        usage: "/heal",
        desc: "Fill your health and food",
        cheat: true,
        run(game) {
            const p = game.player;
            p.health = 20;
            p.food = 20;
            p.saturation = 5;
            p.air = 15;
            game.ui.hudKey = "";
            return ["Healed"];
        }
    },
    kill: {
        usage: "/kill",
        desc: "Die and respawn",
        cheat: true,
        run(game) {
            game.player.kill("command");
            return [];
        }
    },
    spawnpoint: {
        usage: "/spawnpoint",
        desc: "Respawn here from now on",
        cheat: true,
        run(game) {
            const p = game.player;
            game.spawn = { x: p.x, y: p.y, z: p.z };
            return [`Spawn point set to ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`];
        }
    },
    tickspeed: {
        usage: "/tickspeed [speed]",
        desc: "How fast plants grow and random block updates happen (default 3, up to 1000)",
        cheat: true,
        run(game, args) {
            return [setRule(game, "tickSpeed", args[0])];
        }
    },
    firespread: {
        usage: "/firespread [on|off]",
        desc: "Let fire spread and burn blocks (off: fires stay put)",
        cheat: true,
        run(game, args) {
            return [setRule(game, "fireSpread", args[0])];
        }
    },
    gamerule: {
        usage: "/gamerule <randomTickSpeed|doFireTick> [value]",
        desc: "Read or change a world rule",
        cheat: true,
        run(game, args) {
            const rule = RULE_NAMES[(args[0] || "").toLowerCase()];
            if (!rule) {
                fail("Rules: randomTickSpeed (number), doFireTick (true / false)");
            }
            return [setRule(game, rule, args[1])];
        }
    },
    seed: {
        usage: "/seed",
        desc: "Show the world seed",
        run(game) {
            const m = game.meta;
            return [`Seed: ${m.seed}${m.seedText && m.seedText !== String(m.seed) ? ` (from "${m.seedText}")` : ""}`];
        }
    }
};

//Run one chat line; returns [{ text, kind }]
export function runCommand(game, line) {
    const text = line.trim();
    if (!text) {
        return [];
    }
    if (!text.startsWith("/")) {
        return [{ text: "<You> " + text, kind: "say" }];
    }
    const [name, ...args] = text.slice(1).split(/\s+/);
    const cmd = COMMANDS[name.toLowerCase()];
    if (!cmd) {
        return [{ text: `Unknown command /${name}. Type /help for a list.`, kind: "error" }];
    }
    if (cmd.cheat && !game.meta.cheats) {
        return [{ text: "Cheats are off in this world. Turn them on in the pause menu to use /" + name.toLowerCase() + ".", kind: "error" }];
    }
    try {
        return cmd.run(game, args).map((t) => ({ text: t, kind: "ok" }));
    } catch (e) {
        if (e instanceof CommandError) {
            return [{ text: e.message, kind: "error" }];
        }
        throw e;
    }
}

//Tab completion of the last word: command names, then item names
export function complete(line) {
    const parts = line.split(" ");
    const last = parts[parts.length - 1];
    let pool;
    if (parts.length === 1) {
        if (!last.startsWith("/")) {
            return { line, options: [] };
        }
        pool = Object.keys(COMMANDS).map((k) => "/" + k);
    } else {
        const cmd = parts[0].slice(1).toLowerCase();
        if (cmd === "gamemode") {
            pool = ["survival", "creative"];
        } else if (cmd === "weather") {
            pool = ["clear", "rain", "thunder"];
        } else if (cmd === "difficulty") {
            pool = DIFFICULTY.map((d) => d.name.toLowerCase());
        } else if (cmd === "time") {
            pool = parts.length === 2 ? ["set", "add", "query"] : Object.keys(TIMES);
        } else if (cmd === "help") {
            pool = Object.keys(COMMANDS);
        } else if (cmd === "firespread") {
            pool = ["on", "off"];
        } else if (cmd === "gamerule") {
            pool = parts.length === 2 ? ["randomTickSpeed", "doFireTick"] : ["true", "false"];
        } else if (cmd === "tickspeed") {
            pool = ["3", "30", "300"];
        } else {
            pool = [...names().keys()];
        }
    }
    const lower = last.toLowerCase();
    const options = pool.filter((o) => o.toLowerCase().startsWith(lower)).sort();
    if (!options.length) {
        return { line, options: [] };
    }
    //Longest common prefix
    let pre = options[0];
    for (const o of options) {
        while (!o.startsWith(pre)) {
            pre = pre.slice(0, -1);
        }
    }
    parts[parts.length - 1] = options.length === 1 ? options[0] + " " : pre;
    return { line: parts.join(" "), options };
}
