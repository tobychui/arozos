/*
    Blocky - wecommands.js

    The WorldEdit chat commands, typed with two slashes (//set stone); the
    navigation ones (/jumpto, /thru, /ascend, /descend, /up) take one. They
    work in creative mode while Settings > WorldEdit is on; the engine is
    worldedit.js. Entries have the shape of the commands in commands.js,
    plus `we: true`, a help `group` and `hint`: what each argument is, for
    Tab completion (pattern, mask, dir).

    Patterns: stone, stone,dirt (even mix), 30%dirt,70%grass_block,
    name:meta, hand (the held block). Masks: block lists, !list,
    #existing, #solid, #liquid, #natural. Directions: me (where you look),
    back, left, right, up, down, north, south, east, west.
*/

import { BLOCKS } from "./blocks.js";
import { WORLD_H } from "./world.js";
import {
    fail, fmt, plural, WAND, MAX_LIMIT, JUMP_RANGE, THRU_DEPTH, parsePattern, parseMask, parseDirection, rotationMatrix,
    flipMatrix
} from "./worldedit.js";

/* ---------------- argument helpers ---------------- */

//Split flags (-a, -as, -m <mask>) from the other arguments
function parseArgs(args, letters = "", valued = "") {
    const flags = new Set(), values = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
        const m = /^-([a-z]+)$/i.exec(args[i]);
        const word = m ? m[1].toLowerCase() : "";
        if (m && [...word].every((c) => letters.includes(c) || valued.includes(c))) {
            for (const c of word) {
                if (valued.includes(c)) {
                    if (args[i + 1] === undefined) {
                        fail(`-${c} needs a value`);
                    }
                    values[c] = args[++i];
                } else {
                    flags.add(c);
                }
            }
            continue;
        }
        rest.push(args[i]);
    }
    return { flags, values, rest };
}

function int(token, name, min, max, def) {
    if (token === undefined) {
        if (def !== undefined) {
            return def;
        }
        fail(`${name} is missing`);
    }
    const v = Number(token);
    if (!Number.isInteger(v) || v < min || v > max) {
        fail(`${name} must be a whole number from ${min} to ${fmt(max)}`);
    }
    return v;
}

const isInt = (t) => t !== undefined && /^-?\d+$/.test(t);

//"x,y,z" or "x y z", ~ for your own position
function position(game, args) {
    const p = game.player;
    const parts = args.length === 1 ? args[0].split(",") : args;
    if (parts.length !== 3) {
        fail("Give a position as x,y,z or x y z (~ means your own)");
    }
    const base = [p.x, p.y, p.z];
    return parts.map((t, i) => {
        if (t.startsWith("~")) {
            const off = t.length > 1 ? Number(t.slice(1)) : 0;
            if (!Number.isFinite(off)) {
                fail(`"${t}" is not a coordinate`);
            }
            return Math.floor(base[i] + off);
        }
        const v = Number(t);
        if (!Number.isFinite(v)) {
            fail(`"${t}" is not a coordinate`);
        }
        return Math.floor(v);
    });
}

//"5" or "5,3,5"
function radii(token, count, max = 128) {
    if (token === undefined) {
        fail("The radius is missing");
    }
    const parts = String(token).split(",").map(Number);
    if (parts.length !== 1 && parts.length !== count) {
        fail(`Give one radius or ${count} separated by commas`);
    }
    for (const r of parts) {
        if (!Number.isFinite(r) || r < 0 || r > max) {
            fail(`Radii go from 0 to ${max}`);
        }
    }
    while (parts.length < count) {
        parts.push(parts[0]);
    }
    return parts;
}

const pattern = (game, t) => parsePattern(t, game);

//Cell counts of the selection, most common first
function distribution(game, box) {
    const w = game.world, counts = new Map();
    for (let x = box.x0; x <= box.x1; x++) {
        for (let z = box.z0; z <= box.z1; z++) {
            for (let y = box.y0; y <= box.y1; y++) {
                const id = w.getBlock(x, y, z);
                counts.set(id, (counts.get(id) || 0) + 1);
            }
        }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

//Move a corner of the selection the way the original tool does: a
//positive change moves whichever corner is further along that axis
function growSelection(we, v, shrink) {
    for (let a = 0; a < 3; a++) {
        const c = v[a];
        if (!c) {
            continue;
        }
        const p1 = we.pos1, p2 = we.pos2;
        const moveMax = shrink ? c < 0 : c > 0;
        const target = moveMax ? (p1[a] >= p2[a] ? p1 : p2) : (p1[a] <= p2[a] ? p1 : p2);
        target[a] += c;
        if (a === 1) {
            target[1] = Math.max(0, Math.min(WORLD_H - 1, target[1]));
        }
    }
}

function changeSize(game, args, shrink) {
    const we = game.we;
    we.region();
    if (!shrink && (args[0] || "").toLowerCase() === "vert") {
        we.pos1[1] = 0;
        we.pos2[1] = WORLD_H - 1;
        return [`Selection now runs the full height of the world (${fmt(we.region().volume)} blocks).`];
    }
    const amount = int(args[0], "Amount", 0, 100000);
    let reverse = 0, dirTok = args[1];
    if (isInt(args[1])) {
        reverse = int(args[1], "Reverse amount", 0, 100000);
        dirTok = args[2];
    }
    const d = parseDirection(dirTok, game.player).v;
    const before = we.region().volume;
    growSelection(we, d.map((c) => c * amount), shrink);
    if (reverse) {
        growSelection(we, d.map((c) => -c * reverse), shrink);
    }
    const after = we.region().volume;
    return [`Selection ${shrink ? "contracted" : "expanded"} by ${plural(Math.abs(after - before), "block")} (now ${fmt(after)}).`];
}

function outset(game, args, sign) {
    const we = game.we;
    const { flags, rest } = parseArgs(args, "hv");
    const n = int(rest[0], "Amount", 0, 100000) * sign;
    const box = we.region();
    const h = !flags.has("v"), v = !flags.has("h");
    we.pos1 = [box.x0 - (h ? n : 0), Math.max(0, box.y0 - (v ? n : 0)), box.z0 - (h ? n : 0)];
    we.pos2 = [box.x1 + (h ? n : 0), Math.min(WORLD_H - 1, box.y1 + (v ? n : 0)), box.z1 + (h ? n : 0)];
    const b = we.region();
    if (b.x0 > b.x1 || b.y0 > b.y1 || b.z0 > b.z1) {
        fail("That would turn the selection inside out");
    }
    return [`Selection ${sign > 0 ? "outset" : "inset"} (now ${fmt(we.region().volume)} blocks).`];
}

const sphereCmd = (filled) => ({
    group: "Generation",
    usage: `//${filled ? "" : "h"}sphere <pattern> <radius>[,<ry>,<rz>] [raised] [-r]`,
    desc: `A ${filled ? "solid" : "hollow"} sphere around you; raised (or -r) sets it on the ground instead`,
    hint: ["pattern"],
    run(game, args) {
        const { flags, rest } = parseArgs(args, "r");
        const [rx, ry, rz] = radii(rest[1], 3);
        const raised = flags.has("r") || /^(yes|true|raised|y|1)$/i.test(rest[2] || "");
        const c = game.we.blockPos();
        if (raised) {
            c[1] += Math.round(ry);
        }
        return [game.we.opSphere(pattern(game, rest[0]), c, rx, ry, rz, filled)];
    }
});

const cylCmd = (filled) => ({
    group: "Generation",
    usage: `//${filled ? "" : "h"}cyl <pattern> <radius>[,<rz>] [height]`,
    desc: `A ${filled ? "solid" : "hollow"} cylinder from where you stand (a negative height goes down)`,
    hint: ["pattern"],
    run(game, args) {
        const [rx, rz] = radii(args[1], 2);
        const height = int(args[2], "Height", -WORLD_H, WORLD_H, 1) || 1;
        return [game.we.opCylinder(pattern(game, args[0]), game.we.blockPos(), rx, rz, height, filled)];
    }
});

const pyramidCmd = (filled) => ({
    group: "Generation",
    usage: `//${filled ? "" : "h"}pyramid <pattern> <size>`,
    desc: `A ${filled ? "solid" : "hollow"} pyramid on where you stand`,
    hint: ["pattern"],
    run(game, args) {
        const size = int(args[1], "Size", 1, 100);
        return [game.we.opPyramid(pattern(game, args[0]), game.we.blockPos(), size, filled)];
    }
});

const setPosCmd = (n) => ({
    group: "Selection",
    usage: `//pos${n} [x,y,z]`,
    desc: `${n === 1 ? "First" : "Second"} corner: where you stand, or the position given`,
    run(game, args) {
        return [game.we.setPos(n, args.length ? position(game, args) : game.we.blockPos())];
    }
});

const hitPosCmd = (n) => ({
    group: "Selection",
    usage: `//hpos${n}`,
    desc: `${n === 1 ? "First" : "Second"} corner: the block you look at`,
    run(game) {
        const h = game.we.targetBlock();
        if (!h) {
            fail("No block in sight");
        }
        return [game.we.setPos(n, [h.x, h.y, h.z])];
    }
});

const removeVertical = (up) => ({
    group: "Utility",
    usage: `//remove${up ? "above" : "below"} [size] [height]`,
    desc: `Clear the blocks ${up ? "above" : "below"} you (size 1 is just your column)`,
    run(game, args) {
        const we = game.we, size = int(args[0], "Size", 1, 100, 1);
        const y = we.blockPos()[1];
        const height = int(args[1], "Height", 1, WORLD_H, WORLD_H);
        const box = up ? we.aroundBox(size, y, y + height) : we.aroundBox(size, y - height, y);
        return [we.opSet(box, () => 0)];
    }
});

const historyCmd = (redo) => ({
    group: "History",
    usage: `//${redo ? "redo" : "undo"} [times]`,
    desc: redo ? "Do the last undone edit again" : "Take back the last edit (up to 25 are kept)",
    run(game, args) {
        const n = int(args[0], "Times", 1, 100, 1);
        return [redo ? game.we.redo(n) : game.we.undo(n)];
    }
});

/* ---------------- the commands ---------------- */

const DEFS = {
    /* ---------- selection ---------- */
    "/pos1": setPosCmd(1),
    "/pos2": setPosCmd(2),
    "/hpos1": hitPosCmd(1),
    "/hpos2": hitPosCmd(2),
    "/wand": {
        group: "Selection",
        usage: "//wand",
        desc: "Get the wand (a wooden axe): left click a block for the first corner, right click for the second",
        run(game) {
            const inv = game.inventory;
            if (inv.count(WAND) === 0 && inv.add(WAND, 1) > 0) {
                game.dropStack({ id: WAND, count: 1 });
            }
            game.ui.hudKey = "";
            game.we.wandOn = true;
            return ["Wand: left click a block for the first position, right click for the second."];
        }
    },
    "/toggleeditwand": {
        group: "Selection",
        usage: "//toggleeditwand",
        desc: "Switch the wand's clicks off (the wooden axe works normally again) or back on",
        run(game) {
            game.we.wandOn = !game.we.wandOn;
            return [game.we.wandOn ? "The wand selects blocks again." : "The wand is an ordinary axe now."];
        }
    },
    "/sel": {
        group: "Selection",
        usage: "//sel [cuboid]",
        desc: "Clear the selection (cuboid is the only shape there is)",
        run(game, args) {
            if (args[0] && args[0].toLowerCase() !== "cuboid") {
                fail("Only cuboid selections are supported");
            }
            game.we.clearSelection();
            return [args[0] ? "Cuboid selection: left click for the first corner, right click for the second." : "Selection cleared."];
        }
    },
    "/desel": { alias: "/sel" },
    "/size": {
        group: "Selection",
        usage: "//size",
        desc: "Size and corners of the selection",
        run(game) {
            const we = game.we, b = we.region();
            return [
                `Size: ${b.sx} x ${b.sy} x ${b.sz} (${fmt(b.volume)} blocks)`,
                `First (${we.pos1.join(", ")}), second (${we.pos2.join(", ")})`
            ];
        }
    },
    "/count": {
        group: "Selection",
        usage: "//count <mask>",
        desc: "Count the blocks in the selection that match, e.g. //count stone,dirt",
        hint: ["mask"],
        run(game, args) {
            const box = game.we.region(), w = game.world;
            const mask = parseMask(args[0] || "#existing", game);
            let n = 0;
            for (let x = box.x0; x <= box.x1; x++) {
                for (let z = box.z0; z <= box.z1; z++) {
                    for (let y = box.y0; y <= box.y1; y++) {
                        if (mask(w.getBlock(x, y, z), w.getMeta(x, y, z))) {
                            n++;
                        }
                    }
                }
            }
            return [`${plural(n, "block")} match.`];
        }
    },
    "/distr": {
        group: "Selection",
        usage: "//distr",
        desc: "Which blocks the selection is made of",
        run(game) {
            const box = game.we.region(), list = distribution(game, box);
            const out = list.slice(0, 10).map(([id, n]) =>
                `${(n / box.volume * 100).toFixed(1).padStart(5)}%  ${fmt(n)}  ${id === 0 ? "Air" : BLOCKS[id].name}`);
            if (list.length > 10) {
                out.push(`... and ${list.length - 10} more kinds`);
            }
            return [`${fmt(box.volume)} blocks:`].concat(out);
        }
    },
    "/expand": {
        group: "Selection",
        usage: "//expand <amount> [reverse] [direction], or //expand vert",
        desc: "Grow the selection where you look (or the direction given)",
        hint: ["", "dir", "dir"],
        run(game, args) {
            return changeSize(game, args, false);
        }
    },
    "/contract": {
        group: "Selection",
        usage: "//contract <amount> [reverse] [direction]",
        desc: "Shrink the selection from the side opposite the direction",
        hint: ["", "dir", "dir"],
        run(game, args) {
            return changeSize(game, args, true);
        }
    },
    "/shift": {
        group: "Selection",
        usage: "//shift <amount> [direction]",
        desc: "Move the selection (not the blocks)",
        hint: ["", "dir"],
        run(game, args) {
            const we = game.we;
            we.region();
            const n = int(args[0], "Amount", -100000, 100000);
            we.shiftSelection(parseDirection(args[1], game.player).v.map((c) => c * n));
            return [`Selection shifted to (${we.pos1.join(", ")}) - (${we.pos2.join(", ")}).`];
        }
    },
    "/outset": {
        group: "Selection",
        usage: "//outset [-h|-v] <amount>",
        desc: "Grow the selection on every side (-h sideways only, -v up and down only)",
        run(game, args) {
            return outset(game, args, 1);
        }
    },
    "/inset": {
        group: "Selection",
        usage: "//inset [-h|-v] <amount>",
        desc: "Shrink the selection on every side",
        run(game, args) {
            return outset(game, args, -1);
        }
    },
    "/chunk": {
        group: "Selection",
        usage: "//chunk",
        desc: "Select the chunk you stand in, top to bottom",
        run(game) {
            const [x, , z] = game.we.blockPos();
            const cx = x >> 4, cz = z >> 4;
            game.we.pos1 = [cx * 16, 0, cz * 16];
            game.we.pos2 = [cx * 16 + 15, WORLD_H - 1, cz * 16 + 15];
            return [`Chunk ${cx}, ${cz} selected.`];
        }
    },

    /* ---------- region ---------- */
    "/set": {
        group: "Region",
        usage: "//set <pattern>",
        desc: "Fill the selection, e.g. //set stone or //set 50%stone,50%cobblestone",
        hint: ["pattern"],
        run(game, args) {
            return [game.we.opSet(game.we.region(), pattern(game, args[0]))];
        }
    },
    "/replace": {
        group: "Region",
        usage: "//replace [from] <to>",
        desc: "Replace blocks in the selection (every non-air block when from is left out)",
        hint: ["mask", "pattern"],
        run(game, args) {
            if (!args.length) {
                fail("Usage: //replace [from] <to>");
            }
            const from = args.length >= 2 ? args[0] : "#existing", to = args.length >= 2 ? args[1] : args[0];
            return [game.we.opReplace(game.we.region(), parseMask(from, game), pattern(game, to))];
        }
    },
    "/re": { alias: "/replace" },
    "/rep": { alias: "/replace" },
    "/overlay": {
        group: "Region",
        usage: "//overlay <pattern>",
        desc: "Lay the pattern on the top block of every column",
        hint: ["pattern"],
        run(game, args) {
            return [game.we.opOverlay(game.we.region(), pattern(game, args[0]))];
        }
    },
    "/walls": {
        group: "Region",
        usage: "//walls <pattern>",
        desc: "Build the four side walls of the selection",
        hint: ["pattern"],
        run(game, args) {
            return [game.we.opWalls(game.we.region(), pattern(game, args[0]))];
        }
    },
    "/outline": {
        group: "Region",
        usage: "//outline <pattern>",
        desc: "Cover all six faces of the selection",
        hint: ["pattern"],
        run(game, args) {
            return [game.we.opOutline(game.we.region(), pattern(game, args[0]))];
        }
    },
    "/faces": { alias: "/outline" },
    "/center": {
        group: "Region",
        usage: "//center <pattern>",
        desc: "Mark the middle of the selection (1 or 2 blocks per axis)",
        hint: ["pattern"],
        run(game, args) {
            return [game.we.opCenter(game.we.region(), pattern(game, args[0]))];
        }
    },
    "/middle": { alias: "/center" },
    "/smooth": {
        group: "Region",
        usage: "//smooth [iterations] [mask]",
        desc: "Even out the terrain's height (mask: the blocks that count as ground)",
        hint: ["", "mask"],
        run(game, args) {
            const n = int(args[0], "Iterations", 1, 50, 1);
            const mask = args[1] ? parseMask(args[1], game) : null;
            return [game.we.opSmooth(game.we.region(), n, mask)];
        }
    },
    "/deform": {
        group: "Region",
        usage: "//deform [-r] [-o] <expression>",
        desc: "Move blocks by an expression on x, y, z (-1..1 across the selection; -r world, -o from you), e.g. //deform y-=0.2*sin(x*5)",
        run(game, args) {
            const { flags, rest } = parseArgs(args, "ro");
            if (!rest.length) {
                fail("Give an expression, e.g. //deform y-=0.2*sin(x*5)");
            }
            const mode = flags.has("r") ? "raw" : flags.has("o") ? "offset" : "norm";
            return [game.we.opDeform(game.we.region(), rest.join(" "), mode)];
        }
    },
    "/regen": {
        group: "Region",
        usage: "//regen",
        desc: "Put the selection back the way the world seed made it",
        run(game) {
            return [game.we.opRegen(game.we.region())];
        }
    },
    "/hollow": {
        group: "Region",
        usage: "//hollow [thickness] [pattern]",
        desc: "Hollow out solid things in the selection, keeping a shell (pattern fills the inside, air by default)",
        hint: ["", "pattern"],
        run(game, args) {
            const t = int(args[0], "Thickness", 1, 64, 1);
            return [game.we.opHollow(game.we.region(), t, args[1] ? pattern(game, args[1]) : () => 0)];
        }
    },
    "/move": {
        group: "Region",
        usage: "//move [count] [direction] [leave] [-s] [-a] [-e] [-m <mask>]",
        desc: "Move the blocks; -s moves the selection along, -a skips air, -e takes carts, boats and animals, leave fills the gap",
        hint: ["", "dir", "pattern"],
        run(game, args) {
            const { flags, values, rest } = parseArgs(args, "sae", "m");
            let i = 0;
            const count = isInt(rest[0]) ? int(rest[i++], "Count", 1, 10000) : 1;
            const dir = parseDirection(rest[i++], game.player);
            const leave = rest[i] ? pattern(game, rest[i]) : () => 0;
            const v = dir.v.map((c) => c * count);
            return [game.we.opMove(game.we.region(), v, leave, {
                shift: flags.has("s"), skipAir: flags.has("a"), entities: flags.has("e"),
                mask: values.m ? parseMask(values.m, game) : null
            })];
        }
    },
    "/stack": {
        group: "Region",
        usage: "//stack [count] [direction | x,y,z] [-s] [-a] [-e] [-r] [-m <mask>]",
        desc: "Repeat the selection next to itself; x,y,z is a step in blocks (-r: in selection sizes), -s selects the last copy, -a skips air",
        hint: ["", "dir"],
        run(game, args) {
            const { flags, values, rest } = parseArgs(args, "saebr", "m");
            let i = 0;
            const count = isInt(rest[0]) ? int(rest[i++], "Count", 1, 10000) : 1;
            const dir = parseDirection(rest[i], game.player);
            const box = game.we.region(), size = [box.sx, box.sy, box.sz];
            const step = dir.vector && !flags.has("r") ? dir.v : dir.v.map((c, a) => c * size[a]);
            if (!step[0] && !step[1] && !step[2]) {
                fail("The step is zero");
            }
            return [game.we.opStack(box, count, step, {
                shift: flags.has("s"), skipAir: flags.has("a"), entities: flags.has("e"),
                mask: values.m ? parseMask(values.m, game) : null
            })];
        }
    },
    "/naturalize": {
        group: "Region",
        usage: "//naturalize",
        desc: "Grass on top, three dirt below, stone under that (changes only stone, dirt and grass)",
        run(game) {
            return [game.we.opNaturalize(game.we.region())];
        }
    },
    "/line": {
        group: "Region",
        usage: "//line <pattern> [thickness] [-h]",
        desc: "A line from the first to the second corner; -h makes a thick line hollow",
        hint: ["pattern"],
        run(game, args) {
            const { flags, rest } = parseArgs(args, "h");
            const we = game.we;
            we.region();
            const t = int(rest[1], "Thickness", 0, 16, 0);
            return [we.opLine(we.pos1, we.pos2, pattern(game, rest[0]), t, flags.has("h"))];
        }
    },
    "/generate": {
        group: "Region",
        usage: "//generate [-h] [-r] [-o] [-c] <pattern> <expression>",
        desc: "Fill where the expression is above 0, e.g. //g stone x^2+y^2+z^2<1 (a ball); -h hollow, -r world, -o from you, -c from the middle",
        hint: ["pattern"],
        run(game, args) {
            const { flags, rest } = parseArgs(args, "hroc");
            if (rest.length < 2) {
                fail("Usage: //generate <pattern> <expression>");
            }
            const mode = flags.has("r") ? "raw" : flags.has("o") ? "offset" : flags.has("c") ? "center" : "norm";
            return [game.we.opGenerate(game.we.region(), pattern(game, rest[0]), rest.slice(1).join(" "), mode, flags.has("h"))];
        }
    },
    "/gen": { alias: "/generate" },
    "/g": { alias: "/generate" },

    /* ---------- generation ---------- */
    "/sphere": sphereCmd(true),
    "/hsphere": sphereCmd(false),
    "/cyl": cylCmd(true),
    "/hcyl": cylCmd(false),
    "/pyramid": pyramidCmd(true),
    "/hpyramid": pyramidCmd(false),

    /* ---------- clipboard ---------- */
    "/copy": {
        group: "Clipboard",
        usage: "//copy [-e] [-m <mask>]",
        desc: "Copy the selection, relative to where you stand; -e takes carts, boats and animals, -m only matching blocks",
        run(game, args) {
            const { flags, values } = parseArgs(args, "e", "m");
            return [game.we.opCopy(game.we.region(), { entities: flags.has("e"), mask: values.m ? parseMask(values.m, game) : null })];
        }
    },
    "/cut": {
        group: "Clipboard",
        usage: "//cut [leave] [-e] [-m <mask>]",
        desc: "Copy the selection and clear it (leave fills the hole, air by default)",
        hint: ["pattern"],
        run(game, args) {
            const { flags, values, rest } = parseArgs(args, "e", "m");
            return [game.we.opCut(game.we.region(), rest[0] ? pattern(game, rest[0]) : () => 0, {
                entities: flags.has("e"), mask: values.m ? parseMask(values.m, game) : null
            })];
        }
    },
    "/paste": {
        group: "Clipboard",
        usage: "//paste [-a] [-s] [-o] [-e]",
        desc: "Paste relative to where you stand; -a skips air, -s selects the result, -o pastes where it was copied, -e adds the entities",
        run(game, args) {
            const { flags } = parseArgs(args, "asoe");
            return [game.we.opPaste({ skipAir: flags.has("a"), select: flags.has("s"), atOrigin: flags.has("o"), entities: flags.has("e") })];
        }
    },
    "/rotate": {
        group: "Clipboard",
        usage: "//rotate <y> [x] [z]",
        desc: "Turn the clipboard in steps of 90 degrees (y: clockwise seen from above)",
        run(game, args) {
            const deg = (t, name) => {
                const v = t === undefined ? 0 : Number(t);
                if (!Number.isFinite(v)) {
                    fail(`${name} must be a number of degrees`);
                }
                return v;
            };
            if (args[0] === undefined) {
                fail("Usage: //rotate <y> [x] [z], e.g. //rotate 90");
            }
            game.we.transformClipboard(rotationMatrix(deg(args[0], "y"), deg(args[1], "x"), deg(args[2], "z")));
            return ["The clipboard has been rotated."];
        }
    },
    "/flip": {
        group: "Clipboard",
        usage: "//flip [direction]",
        desc: "Mirror the clipboard along the way you look (or the direction given)",
        hint: ["dir"],
        run(game, args) {
            const d = parseDirection(args[0], game.player).v;
            game.we.transformClipboard(flipMatrix(d));
            return [`The clipboard has been flipped ${d[1] ? "upside down" : d[0] ? "east to west" : "north to south"}.`];
        }
    },
    "/clearclipboard": {
        group: "Clipboard",
        usage: "//clearclipboard",
        desc: "Empty the clipboard",
        run(game) {
            game.we.clipboard = null;
            return ["Clipboard cleared."];
        }
    },

    /* ---------- history ---------- */
    "/undo": historyCmd(false),
    "/redo": historyCmd(true),
    "/clearhistory": {
        group: "History",
        usage: "//clearhistory",
        desc: "Forget the undo history",
        run(game) {
            game.we.clearHistory();
            return ["History cleared."];
        }
    },

    /* ---------- navigation ---------- */
    "jumpto": {
        group: "Navigation",
        usage: "/jumpto",
        desc: `Jump onto the block you look at, up to ${JUMP_RANGE} blocks away (also the compass's left click)`,
        run(game) {
            return [game.we.jumpTo()];
        }
    },
    "j": { alias: "jumpto" },
    "thru": {
        group: "Navigation",
        usage: "/thru",
        desc: `Pass through the wall, floor or ceiling you look at, up to ${THRU_DEPTH} blocks thick (also the compass's right click)`,
        run(game) {
            const h = game.we.targetBlock(6);
            if (!h) {
                fail("Look at a wall, floor or ceiling within reach.");
            }
            return [game.we.thru(h)];
        }
    },
    "ascend": {
        group: "Navigation",
        usage: "/ascend [levels]",
        desc: "Go up to the next floor above you",
        run(game, args) {
            return [game.we.climb(int(args[0], "Levels", 1, 100, 1), true)];
        }
    },
    "asc": { alias: "ascend" },
    "descend": {
        group: "Navigation",
        usage: "/descend [levels]",
        desc: "Go down to the next floor below you",
        run(game, args) {
            return [game.we.climb(int(args[0], "Levels", 1, 100, 1), false)];
        }
    },
    "desc": { alias: "descend" },
    "up": {
        group: "Navigation",
        usage: "/up <distance>",
        desc: "Go straight up, onto a glass block when there is nothing under you",
        run(game, args) {
            return [game.we.up(int(args[0], "Distance", 1, WORLD_H))];
        }
    },

    /* ---------- around you ---------- */
    "/fill": {
        group: "Utility",
        usage: "//fill <pattern> <radius> [depth]",
        desc: "Fill the hole you stand in, sideways and down",
        hint: ["pattern"],
        run(game, args) {
            const r = int(args[1], "Radius", 1, 128);
            return [game.we.opFill(pattern(game, args[0]), r, int(args[2], "Depth", 1, WORLD_H, WORLD_H))];
        }
    },
    "/drain": {
        group: "Utility",
        usage: "//drain <radius>",
        desc: "Remove the water or lava you are in",
        run(game, args) {
            return [game.we.opDrain(int(args[0], "Radius", 1, 128))];
        }
    },
    "/removeabove": removeVertical(true),
    "/removebelow": removeVertical(false),
    "/removenear": {
        group: "Utility",
        usage: "//removenear <mask> [radius]",
        desc: "Remove matching blocks around you (radius 50 when left out)",
        hint: ["mask"],
        run(game, args) {
            const r = int(args[1], "Radius", 1, 128, 50);
            const box = game.we.aroundBox(r, game.we.blockPos()[1] - r + 1, game.we.blockPos()[1] + r - 1);
            return [game.we.opReplace(box, parseMask(args[0], game), () => 0)];
        }
    },
    "/replacenear": {
        group: "Utility",
        usage: "//replacenear <radius> [from] <to>",
        desc: "Replace blocks around you",
        hint: ["", "mask", "pattern"],
        run(game, args) {
            const r = int(args[0], "Radius", 1, 128);
            if (args.length < 2) {
                fail("Usage: //replacenear <radius> [from] <to>");
            }
            const from = args.length >= 3 ? args[1] : "#existing", to = args.length >= 3 ? args[2] : args[1];
            const y = game.we.blockPos()[1];
            return [game.we.opReplace(game.we.aroundBox(r, y - r + 1, y + r - 1), parseMask(from, game), pattern(game, to))];
        }
    },
    "/extinguish": {
        group: "Utility",
        usage: "//extinguish [radius]",
        desc: "Put out fires around you (radius 40 when left out)",
        run(game, args) {
            const r = int(args[0], "Radius", 1, 128, 40);
            const y = game.we.blockPos()[1];
            return [game.we.opReplace(game.we.aroundBox(r, y - r + 1, y + r - 1), parseMask("fire", game), () => 0)];
        }
    },
    "/ext": { alias: "/extinguish" },
    "/limit": {
        group: "Utility",
        usage: "//limit [blocks]",
        desc: `How many blocks one edit may change (default 1,000,000, up to ${fmt(MAX_LIMIT)})`,
        run(game, args) {
            if (args[0] === undefined) {
                return [`The limit is ${fmt(game.we.limit)} blocks per edit.`];
            }
            game.we.limit = int(args[0].replace(/,/g, ""), "Limit", 1, MAX_LIMIT);
            return [`Limit set to ${fmt(game.we.limit)} blocks per edit.`];
        }
    },
    "/help": {
        group: "Utility",
        usage: "//help [command]",
        desc: "List the WorldEdit commands, or explain one",
        run(game, args) {
            if (args[0]) {
                const name = args[0].replace(/^\/+/, "").toLowerCase();
                const c = WE_COMMANDS["/" + name] || WE_COMMANDS[name];
                if (!c) {
                    fail(`There is no WorldEdit command called ${name}`);
                }
                return [`${c.usage} - ${c.desc}`];
            }
            const groups = new Map();
            for (const [k, c] of Object.entries(WE_COMMANDS)) {
                if (!c.alias) {
                    groups.set(c.group, (groups.get(c.group) || []).concat("/" + k));
                }
            }
            return [...groups].map(([g, list]) => `${g}: ${list.join(" ")}`).concat("Type //help <command> for details.");
        }
    }
};

//Resolve aliases into full entries that point at their target
export const WE_COMMANDS = {};
for (const [k, c] of Object.entries(DEFS)) {
    WE_COMMANDS[k] = c.alias ? Object.assign({}, DEFS[c.alias], { alias: c.alias }) : c;
    WE_COMMANDS[k].we = true;
}
