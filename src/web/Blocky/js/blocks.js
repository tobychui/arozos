/*
    Blocky - blocks.js

    Block, item, recipe and smelting registry.

    Ids 0-255 are blocks (a block's inventory item shares its id), ids 256
    and up are plain items. Faces are indexed 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z
    everywhere in the engine.
*/

import { TOOL_MATERIALS, TOOL_KINDS } from "./textures.js";

export const B = {
    AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLE: 4, PLANKS: 5, SAPLING: 6, BEDROCK: 7,
    WATER: 8, SAND: 9, GRAVEL: 10, LOG: 11, LEAVES: 12, GLASS: 13, SANDSTONE: 14,
    COAL_ORE: 15, IRON_ORE: 16, GOLD_ORE: 17, CRYSTAL_ORE: 18, CLAY: 19, BRICKS: 20,
    STONE_BRICKS: 21, TORCH: 22, WORKBENCH: 23, FURNACE: 24, FURNACE_LIT: 25, CHEST: 26,
    TALL_GRASS: 27, FLOWER_YELLOW: 28, FLOWER_RED: 29, MUSHROOM_BROWN: 30, MUSHROOM_RED: 31,
    CACTUS: 32, REEDS: 33, FARMLAND: 34, WHEAT: 35, DEAD_BUSH: 36, LADDER: 37,
    STONE_SLAB: 38, PLANK_SLAB: 39, COBBLE_SLAB: 40, SANDSTONE_SLAB: 41,
    IRON_BLOCK: 42, GOLD_BLOCK: 43, CRYSTAL_BLOCK: 44, LAMP: 45, MOSSY_COBBLE: 46,
    FIRE: 47, LAVA: 48, OBSIDIAN: 49, DOOR: 50, FENCE: 51, FENCE_GATE: 52, BED: 53
};

export const I = {
    STICK: 256, COAL: 257, IRON_INGOT: 258, GOLD_INGOT: 259, CRYSTAL: 260, FLINT: 261,
    CLAY_BALL: 262, BRICK: 263, SEEDS: 264, WHEAT: 265, BREAD: 266, APPLE: 267,
    BOWL: 268, STEW: 269, BUCKET: 270, WATER_BUCKET: 271, FLINT_AND_STEEL: 272,
    LAVA_BUCKET: 273, DOOR: 274, BED: 275
};

//Horizontal facings used by doors, gates and beds: 0 +x, 1 +z, 2 -x, 3 -z
export const HDIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];

//Facing index the player looks along, from their yaw
export function facingFromYaw(yaw) {
    const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
    if (Math.abs(lx) > Math.abs(lz)) {
        return lx > 0 ? 0 : 2;
    }
    return lz > 0 ? 1 : 3;
}

//Tool ids: 280 + material * 4 + kind (kinds: pickaxe, axe, shovel, hoe)
export const TOOL_BASE = 280;
export function toolId(matIndex, kindIndex) {
    return TOOL_BASE + matIndex * 4 + kindIndex;
}

export const BLOCKS = [];
export const ITEMS = [];

const DEFAULTS = {
    shape: "cube",      //cube, cross, crop, torch, slab, cactus, liquid, farmland, ladder, fire, door, fence, gate, bed, none
    solid: true,        //has collision
    opaque: true,       //full cube that hides neighbour faces
    lightOpacity: 15,
    light: 0,
    hardness: 1,
    tool: null,         //pickaxe, axe, shovel
    tier: 0,            //minimum tool tier for drops (0: hand works)
    sound: "stone",
    replaceable: false,
    tint: null,         //grass or foliage (vertex tinted faces)
    gravity: false,
    support: null,      //what the block needs below / behind it to stay
    noItem: false,
    targetable: true,
    orient: false,      //front face follows meta
    tex: null
};

function def(id, name, props) {
    const b = Object.assign({}, DEFAULTS, props, { id, name });
    if (typeof b.tex === "string") {
        b.tex = { all: b.tex };
    }
    BLOCKS[id] = b;
    return b;
}

const NONSOLID_PLANT = {
    shape: "cross", solid: false, opaque: false, lightOpacity: 0, hardness: 0,
    sound: "grass", support: "soil"
};

def(B.AIR, "Air", { shape: "none", solid: false, opaque: false, lightOpacity: 0, hardness: 0, replaceable: true, noItem: true, targetable: false });
def(B.STONE, "Stone", { tex: "stone", hardness: 1.5, tool: "pickaxe", tier: 1, drops: () => [[B.COBBLE, 1]] });
def(B.GRASS, "Grass Block", { tex: { top: "grass_top", bottom: "dirt", side: "grass_side" }, hardness: 0.6, tool: "shovel", sound: "grass", tint: "grass", drops: () => [[B.DIRT, 1]] });
def(B.DIRT, "Dirt", { tex: "dirt", hardness: 0.5, tool: "shovel", sound: "gravel" });
def(B.COBBLE, "Cobblestone", { tex: "cobblestone", hardness: 2, tool: "pickaxe", tier: 1 });
def(B.MOSSY_COBBLE, "Mossy Cobblestone", { tex: "mossy", hardness: 2, tool: "pickaxe", tier: 1 });
def(B.PLANKS, "Planks", { tex: "planks", hardness: 2, tool: "axe", sound: "wood" });
def(B.SAPLING, "Sapling", Object.assign({}, NONSOLID_PLANT, { tex: "sapling", replaceable: true }));
def(B.BEDROCK, "Bedrock", { tex: "bedrock", hardness: -1, noItem: true });
def(B.WATER, "Water", { tex: "water", shape: "liquid", solid: false, opaque: false, lightOpacity: 1, hardness: -1, replaceable: true, noItem: true, targetable: false, sound: "water" });
def(B.SAND, "Sand", { tex: "sand", hardness: 0.5, tool: "shovel", sound: "sand", gravity: true });
def(B.GRAVEL, "Gravel", { tex: "gravel", hardness: 0.6, tool: "shovel", sound: "gravel", gravity: true, drops: (m, rng) => [[rng() < 0.12 ? I.FLINT : B.GRAVEL, 1]] });
def(B.LOG, "Log", { tex: { top: "log_top", bottom: "log_top", side: "log_side" }, hardness: 2, tool: "axe", sound: "wood" });
def(B.LEAVES, "Leaves", {
    tex: "leaves", opaque: false, lightOpacity: 1, hardness: 0.2, sound: "grass", tint: "foliage", cutout: true,
    drops: (m, rng) => {
        const out = [];
        if (rng() < 0.06) {
            out.push([B.SAPLING, 1]);
        }
        if (rng() < 0.025) {
            out.push([I.APPLE, 1]);
        }
        return out;
    }
});
def(B.GLASS, "Glass", { tex: "glass", opaque: false, lightOpacity: 0, hardness: 0.3, sound: "glass", cutout: true, drops: () => [] });
def(B.SANDSTONE, "Sandstone", { tex: { top: "sandstone_top", bottom: "sandstone_bottom", side: "sandstone_side" }, hardness: 0.8, tool: "pickaxe", tier: 1 });
def(B.COAL_ORE, "Coal Ore", { tex: "coal_ore", hardness: 3, tool: "pickaxe", tier: 1, drops: () => [[I.COAL, 1]] });
def(B.IRON_ORE, "Iron Ore", { tex: "iron_ore", hardness: 3, tool: "pickaxe", tier: 2 });
def(B.GOLD_ORE, "Gold Ore", { tex: "gold_ore", hardness: 3, tool: "pickaxe", tier: 3 });
def(B.CRYSTAL_ORE, "Crystal Ore", { tex: "crystal_ore", hardness: 3, tool: "pickaxe", tier: 3, drops: () => [[I.CRYSTAL, 1]] });
def(B.CLAY, "Clay", { tex: "clay", hardness: 0.6, tool: "shovel", sound: "gravel", drops: () => [[I.CLAY_BALL, 4]] });
def(B.BRICKS, "Bricks", { tex: "bricks", hardness: 2, tool: "pickaxe", tier: 1 });
def(B.STONE_BRICKS, "Stone Bricks", { tex: "stone_bricks", hardness: 1.5, tool: "pickaxe", tier: 1 });
def(B.TORCH, "Torch", { tex: "torch", shape: "torch", solid: false, opaque: false, lightOpacity: 0, light: 14, hardness: 0, sound: "wood", support: "torch" });
def(B.WORKBENCH, "Workbench", { tex: { top: "workbench_top", bottom: "planks", side: "workbench_side", front: "workbench_front" }, hardness: 2.5, tool: "axe", sound: "wood", interact: "workbench" });
def(B.FURNACE, "Furnace", { tex: { top: "furnace_top", bottom: "furnace_top", side: "furnace_side", front: "furnace_front" }, hardness: 3.5, tool: "pickaxe", tier: 1, orient: true, interact: "furnace" });
def(B.FURNACE_LIT, "Lit Furnace", { tex: { top: "furnace_top", bottom: "furnace_top", side: "furnace_side", front: "furnace_front_lit" }, hardness: 3.5, tool: "pickaxe", tier: 1, orient: true, light: 13, noItem: true, interact: "furnace", drops: () => [[B.FURNACE, 1]] });
def(B.CHEST, "Chest", { tex: { top: "chest_top", bottom: "chest_top", side: "chest_side", front: "chest_front" }, hardness: 2.5, tool: "axe", sound: "wood", orient: true, interact: "chest" });
def(B.TALL_GRASS, "Tall Grass", Object.assign({}, NONSOLID_PLANT, { tex: "tall_grass", tint: "grass", replaceable: true, drops: (m, rng) => (rng() < 0.125 ? [[I.SEEDS, 1]] : []) }));
//Short plants give way when a block is placed on them (they drop as items)
def(B.FLOWER_YELLOW, "Yellow Flower", Object.assign({}, NONSOLID_PLANT, { tex: "flower_yellow", replaceable: true }));
def(B.FLOWER_RED, "Red Flower", Object.assign({}, NONSOLID_PLANT, { tex: "flower_red", replaceable: true }));
def(B.MUSHROOM_BROWN, "Brown Mushroom", Object.assign({}, NONSOLID_PLANT, { tex: "mushroom_brown", support: "solid", light: 1, replaceable: true }));
def(B.MUSHROOM_RED, "Red Mushroom", Object.assign({}, NONSOLID_PLANT, { tex: "mushroom_red", support: "solid", replaceable: true }));
def(B.CACTUS, "Cactus", { tex: { top: "cactus_top", bottom: "cactus_bottom", side: "cactus_side" }, shape: "cactus", opaque: false, lightOpacity: 0, hardness: 0.4, sound: "cloth", support: "cactus" });
def(B.REEDS, "Reeds", Object.assign({}, NONSOLID_PLANT, { tex: "reeds", support: "reeds" }));
def(B.FARMLAND, "Farmland", { tex: { top: "farmland_dry", bottom: "dirt", side: "dirt" }, shape: "farmland", opaque: false, lightOpacity: 0, hardness: 0.6, tool: "shovel", sound: "gravel", noItem: true, drops: () => [[B.DIRT, 1]] });
def(B.WHEAT, "Wheat", Object.assign({}, NONSOLID_PLANT, {
    tex: "wheat_0", shape: "crop", support: "farmland", noItem: true,
    drops: (m, rng) => (m >= 7 ? [[I.WHEAT, 1], [I.SEEDS, 1 + Math.floor(rng() * 3)]] : [[I.SEEDS, 1]])
}));
def(B.DEAD_BUSH, "Dead Bush", Object.assign({}, NONSOLID_PLANT, { tex: "dead_bush", support: "sand", replaceable: true, drops: (m, rng) => (rng() < 0.5 ? [[I.STICK, 1 + Math.floor(rng() * 2)]] : []) }));
def(B.LADDER, "Ladder", { tex: "ladder", shape: "ladder", solid: false, opaque: false, lightOpacity: 0, hardness: 0.4, tool: "axe", sound: "wood", support: "wall", cutout: true });
def(B.STONE_SLAB, "Stone Slab", { tex: { top: "slab_top", bottom: "slab_top", side: "slab_side" }, shape: "slab", opaque: false, lightOpacity: 0, hardness: 2, tool: "pickaxe", tier: 1 });
def(B.PLANK_SLAB, "Plank Slab", { tex: "planks", shape: "slab", opaque: false, lightOpacity: 0, hardness: 2, tool: "axe", sound: "wood" });
def(B.COBBLE_SLAB, "Cobblestone Slab", { tex: "cobblestone", shape: "slab", opaque: false, lightOpacity: 0, hardness: 2, tool: "pickaxe", tier: 1 });
def(B.SANDSTONE_SLAB, "Sandstone Slab", { tex: { top: "sandstone_top", bottom: "sandstone_bottom", side: "sandstone_side" }, shape: "slab", opaque: false, lightOpacity: 0, hardness: 0.8, tool: "pickaxe", tier: 1 });
def(B.IRON_BLOCK, "Block of Iron", { tex: "iron_block", hardness: 5, tool: "pickaxe", tier: 2, sound: "metal" });
def(B.GOLD_BLOCK, "Block of Gold", { tex: "gold_block", hardness: 3, tool: "pickaxe", tier: 3, sound: "metal" });
def(B.CRYSTAL_BLOCK, "Block of Crystal", { tex: "crystal_block", hardness: 5, tool: "pickaxe", tier: 3, sound: "metal" });
def(B.LAMP, "Lamp", { tex: "lamp", hardness: 0.3, light: 15, sound: "glass" });
def(B.FIRE, "Fire", { tex: "fire", shape: "fire", solid: false, opaque: false, lightOpacity: 0, light: 15, hardness: 0, replaceable: true, noItem: true, sound: "fire", drops: () => [] });
def(B.LAVA, "Lava", { tex: "lava", shape: "liquid", solid: false, opaque: false, lightOpacity: 15, light: 15, hardness: -1, replaceable: true, noItem: true, targetable: false, sound: "lava" });
def(B.OBSIDIAN, "Obsidian", { tex: "obsidian", hardness: 35, tool: "pickaxe", tier: 4 });
def(B.DOOR, "Door", { tex: "door_lower", shape: "door", opaque: false, lightOpacity: 0, hardness: 3, tool: "axe", sound: "wood", noItem: true, interact: "door", support: "door", drops: () => [[I.DOOR, 1]] });
def(B.FENCE, "Fence", { tex: "planks", shape: "fence", opaque: false, lightOpacity: 0, hardness: 2, tool: "axe", sound: "wood" });
def(B.FENCE_GATE, "Fence Gate", { tex: "planks", shape: "gate", opaque: false, lightOpacity: 0, hardness: 2, tool: "axe", sound: "wood", interact: "gate" });
def(B.BED, "Bed", { tex: { top: "bed_foot_top", bottom: "planks", side: "bed_side" }, shape: "bed", opaque: false, lightOpacity: 0, hardness: 0.2, sound: "cloth", noItem: true, interact: "bed", drops: () => [[I.BED, 1]] });

//Fill the gaps so every id lookup returns something sane
for (let i = 0; i < 256; i++) {
    if (!BLOCKS[i]) {
        BLOCKS[i] = Object.assign({}, DEFAULTS, { id: i, name: "Unknown", tex: { all: "stone" }, noItem: true });
    }
}

/* ---------- Fast lookup tables used by the mesher and lighting ---------- */

export const OPAQUE = new Uint8Array(256);      //full occluding cube
export const SOLID = new Uint8Array(256);       //collides with entities
export const LIGHT_OPACITY = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const SHAPE = new Array(256);
export const RAIN_BLOCKING = new Uint8Array(256);

for (let i = 0; i < 256; i++) {
    const b = BLOCKS[i];
    OPAQUE[i] = b.opaque ? 1 : 0;
    SOLID[i] = b.solid ? 1 : 0;
    LIGHT_OPACITY[i] = b.lightOpacity;
    LIGHT_EMIT[i] = b.light;
    SHAPE[i] = b.shape;
    RAIN_BLOCKING[i] = (b.solid || i === B.WATER || i === B.LAVA || i === B.LEAVES) ? 1 : 0;
}

//Fire: how readily a block catches (spread) and burns away
export const FLAME_CATCH = new Uint8Array(256);
export const FLAME_BURN = new Uint8Array(256);
for (const [id, c, b] of [
    [B.PLANKS, 5, 20], [B.PLANK_SLAB, 5, 20], [B.LOG, 5, 5], [B.LEAVES, 30, 60], [B.WORKBENCH, 5, 20],
    [B.CHEST, 5, 20], [B.FENCE, 5, 20], [B.FENCE_GATE, 5, 20], [B.DOOR, 5, 20], [B.BED, 5, 20],
    [B.LADDER, 5, 20], [B.TALL_GRASS, 60, 100], [B.FLOWER_YELLOW, 60, 100], [B.FLOWER_RED, 60, 100],
    [B.DEAD_BUSH, 60, 100], [B.SAPLING, 60, 100], [B.WHEAT, 60, 100]
]) {
    FLAME_CATCH[id] = c;
    FLAME_BURN[id] = b;
}

//A slab with meta 2 is a double slab: a full opaque cube
export function isOpaqueAt(id, meta) {
    return OPAQUE[id] === 1 || (SHAPE[id] === "slab" && meta === 2);
}

/* ---------- Texture layer resolution ---------- */

//faceLayers[id] = Int16Array(6) resolved after the atlas is built
export const faceLayers = [];
let tileLayer = null;

export function resolveBlockTextures(layerOf) {
    tileLayer = layerOf;
    for (let i = 0; i < 256; i++) {
        const t = BLOCKS[i].tex || { all: "stone" };
        const get = (name) => (layerOf.has(name) ? layerOf.get(name) : 0);
        const side = get(t.side || t.all);
        const top = get(t.top || t.all);
        const bottom = get(t.bottom || t.all);
        const arr = new Int16Array(7);
        arr[0] = side; arr[1] = side; arr[2] = top; arr[3] = bottom; arr[4] = side; arr[5] = side;
        arr[6] = t.front ? get(t.front) : side;
        faceLayers[i] = arr;
    }
}

export function layerOfTile(name) {
    return tileLayer.get(name);
}

//Texture layer of a block face, taking meta into account
export function blockFaceLayer(id, face, meta) {
    const fl = faceLayers[id];
    if (id === B.WHEAT) {
        return tileLayer.get("wheat_" + Math.min(7, meta));
    }
    if (id === B.FARMLAND && face === 2) {
        return tileLayer.get(meta > 0 ? "farmland_wet" : "farmland_dry");
    }
    if (id === B.DOOR) {
        return tileLayer.get(meta & 8 ? "door_upper" : "door_lower");
    }
    if (id === B.BED && face === 2) {
        return tileLayer.get(meta & 4 ? "bed_head_top" : "bed_foot_top");
    }
    if (id === B.WORKBENCH) {
        return (face === 4 || face === 5) ? fl[6] : fl[face];
    }
    if (BLOCKS[id].orient) {
        return face === meta ? fl[6] : fl[face];
    }
    return fl[face];
}

/* ---------- Items ---------- */

const ITEM_DEFAULTS = { stack: 64, block: 0, tool: null, food: null, fuel: 0, icon: null };

function item(id, name, props) {
    ITEMS[id] = Object.assign({}, ITEM_DEFAULTS, props, { id, name });
    return ITEMS[id];
}

const FLAT_BLOCK_ICONS = {
    [B.SAPLING]: "sapling", [B.TORCH]: "torch", [B.TALL_GRASS]: "tall_grass",
    [B.FLOWER_YELLOW]: "flower_yellow", [B.FLOWER_RED]: "flower_red",
    [B.MUSHROOM_BROWN]: "mushroom_brown", [B.MUSHROOM_RED]: "mushroom_red",
    [B.REEDS]: "reeds", [B.DEAD_BUSH]: "dead_bush", [B.LADDER]: "ladder",
    [B.FENCE]: "fence_item", [B.FENCE_GATE]: "gate_item"
};

for (let i = 1; i < 256; i++) {
    const b = BLOCKS[i];
    if (b.noItem || b.name === "Unknown") {
        continue;
    }
    item(i, b.name, {
        block: i,
        icon: FLAT_BLOCK_ICONS[i] ? { flat: FLAT_BLOCK_ICONS[i], tint: b.tint } : { block: i }
    });
}

const FUEL = 1;
item(I.STICK, "Stick", { icon: { flat: "stick" }, fuel: 100 * FUEL });
item(I.COAL, "Coal", { icon: { flat: "coal" }, fuel: 1600 });
item(I.IRON_INGOT, "Iron Ingot", { icon: { flat: "iron_ingot" } });
item(I.GOLD_INGOT, "Gold Ingot", { icon: { flat: "gold_ingot" } });
item(I.CRYSTAL, "Crystal", { icon: { flat: "crystal" } });
item(I.FLINT, "Flint", { icon: { flat: "flint" } });
item(I.CLAY_BALL, "Clay Ball", { icon: { flat: "clay_ball" } });
item(I.BRICK, "Brick", { icon: { flat: "brick" } });
item(I.SEEDS, "Seeds", { icon: { flat: "seeds" }, plant: B.WHEAT });
item(I.WHEAT, "Wheat", { icon: { flat: "wheat_item" } });
item(I.BREAD, "Bread", { icon: { flat: "bread" }, food: { hunger: 5, sat: 6 } });
item(I.APPLE, "Apple", { icon: { flat: "apple" }, food: { hunger: 4, sat: 2.4 } });
item(I.BOWL, "Bowl", { icon: { flat: "bowl" }, fuel: 100 });
item(I.STEW, "Mushroom Stew", { icon: { flat: "stew" }, stack: 1, food: { hunger: 6, sat: 7.2, leaves: I.BOWL } });
item(I.BUCKET, "Bucket", { icon: { flat: "bucket" }, stack: 16 });
item(I.WATER_BUCKET, "Water Bucket", { icon: { flat: "water_bucket" }, stack: 1 });
item(I.LAVA_BUCKET, "Lava Bucket", { icon: { flat: "lava_bucket" }, stack: 1, fuel: 20000, fuelLeaves: I.BUCKET });
item(I.FLINT_AND_STEEL, "Flint and Steel", { icon: { flat: "flint_and_steel" }, stack: 1, tool: { kind: "igniter", tier: 0, speed: 1, durability: 64 } });
item(I.DOOR, "Door", { icon: { flat: "door_item" }, stack: 16, fuel: 200 });
item(I.BED, "Bed", { icon: { flat: "bed_item" }, stack: 1 });

//Fuel for blocks (ticks at 20 ticks per second; one smelt takes 200 ticks)
ITEMS[B.LOG].fuel = 300;
ITEMS[B.PLANKS].fuel = 300;
ITEMS[B.PLANK_SLAB].fuel = 150;
ITEMS[B.SAPLING].fuel = 100;
ITEMS[B.WORKBENCH].fuel = 300;
ITEMS[B.CHEST].fuel = 300;
ITEMS[B.LADDER].fuel = 300;
ITEMS[B.FENCE].fuel = 300;
ITEMS[B.FENCE_GATE].fuel = 300;
ITEMS[B.REEDS].block = B.REEDS;

export const TOOL_STATS = [
    { name: "Wooden", tier: 1, speed: 2, durability: 64, material: B.PLANKS },
    { name: "Stone", tier: 2, speed: 4, durability: 140, material: B.COBBLE },
    { name: "Iron", tier: 3, speed: 6, durability: 260, material: I.IRON_INGOT },
    { name: "Golden", tier: 1, speed: 11, durability: 40, material: I.GOLD_INGOT },
    { name: "Crystal", tier: 4, speed: 8, durability: 1200, material: I.CRYSTAL }
];
const KIND_NAMES = ["Pickaxe", "Axe", "Shovel", "Hoe"];

TOOL_MATERIALS.forEach((m, mi) => {
    TOOL_KINDS.forEach((k, ki) => {
        const st = TOOL_STATS[mi];
        item(toolId(mi, ki), st.name + " " + KIND_NAMES[ki], {
            icon: { flat: m.key + "_" + k },
            stack: 1,
            tool: { kind: k, tier: st.tier, speed: st.speed, durability: st.durability },
            fuel: mi === 0 ? 200 : 0
        });
    });
});

export function itemDef(id) {
    return ITEMS[id] || null;
}

export function itemName(id) {
    const it = ITEMS[id];
    return it ? it.name : "?";
}

/* ---------- Mining ---------- */

export function canHarvest(block, tool) {
    if (block.tier === 0) {
        return true;
    }
    return !!tool && tool.kind === block.tool && tool.tier >= block.tier;
}

//Seconds needed to break `block` holding `itemId` (no modifiers)
export function breakSeconds(block, itemId) {
    if (block.hardness < 0) {
        return Infinity;
    }
    if (block.hardness === 0) {
        return 0;
    }
    const it = ITEMS[itemId];
    const tool = it && it.tool;
    let speed = 1;
    if (tool && tool.kind === block.tool) {
        speed = tool.speed;
    }
    if (block.id === B.LEAVES && tool && tool.kind === "axe") {
        speed = tool.speed;
    }
    const factor = canHarvest(block, tool) ? 1.5 : 5;
    return block.hardness * factor / speed;
}

export function blockDrops(id, meta, rng, itemId) {
    const b = BLOCKS[id];
    const it = ITEMS[itemId];
    if (!canHarvest(b, it && it.tool)) {
        return [];
    }
    if (b.shape === "slab") {
        return [[id, meta === 2 ? 2 : 1]];
    }
    if (b.drops) {
        return b.drops(meta, rng);
    }
    if (b.noItem) {
        return [];
    }
    return [[id, 1]];
}

/* ---------- Crafting ---------- */

//Shaped recipes are laid out on the crafting grid as drawn (mirroring is
//allowed); shapeless ones only need the right items anywhere on the grid.
//A recipe whose pattern fits in 2x2 can be made in the inventory, larger
//ones need the 3x3 grid of a workbench.
export const RECIPES = [];

function finish(r) {
    const need = new Map();
    if (r.shape) {
        r.h = r.shape.length;
        r.w = Math.max(...r.shape.map((row) => row.length));
        r.shape = r.shape.map((row) => row.padEnd(r.w, "."));
        for (const row of r.shape) {
            for (const ch of row) {
                if (ch !== ".") {
                    need.set(r.key[ch], (need.get(r.key[ch]) || 0) + 1);
                }
            }
        }
        r.small = r.w <= 2 && r.h <= 2;
    } else {
        for (const id of r.items) {
            need.set(id, (need.get(id) || 0) + 1);
        }
        r.small = r.items.length <= 4;
    }
    r.inputs = [...need.entries()];
    RECIPES.push(r);
}

function shaped(out, count, shape, key, group = "Building") {
    finish({ out, count, shape, key, group });
}

function shapeless(out, count, items, group = "Building") {
    finish({ out, count, items, group });
}

shapeless(B.PLANKS, 4, [B.LOG], "Basics");
shaped(I.STICK, 4, ["P", "P"], { P: B.PLANKS }, "Basics");
shaped(B.WORKBENCH, 1, ["PP", "PP"], { P: B.PLANKS }, "Basics");
shaped(B.TORCH, 4, ["C", "S"], { C: I.COAL, S: I.STICK }, "Basics");
shaped(B.CHEST, 1, ["PPP", "P.P", "PPP"], { P: B.PLANKS }, "Basics");
shaped(B.FURNACE, 1, ["CCC", "C.C", "CCC"], { C: B.COBBLE }, "Basics");

const TOOL_SHAPES = [
    ["MMM", ".S.", ".S."],
    ["MM", "MS", ".S"],
    ["M", "S", "S"],
    ["MM", ".S", ".S"]
];
TOOL_STATS.forEach((st, mi) => {
    TOOL_SHAPES.forEach((shape, ki) => {
        shaped(toolId(mi, ki), 1, shape, { M: st.material, S: I.STICK }, "Tools");
    });
});
shaped(I.BUCKET, 1, ["I.I", ".I."], { I: I.IRON_INGOT }, "Tools");
shapeless(I.FLINT_AND_STEEL, 1, [I.IRON_INGOT, I.FLINT], "Tools");

shaped(I.BOWL, 4, ["P.P", ".P."], { P: B.PLANKS }, "Food");
shaped(I.BREAD, 1, ["WWW"], { W: I.WHEAT }, "Food");
shapeless(I.STEW, 1, [B.MUSHROOM_BROWN, B.MUSHROOM_RED, I.BOWL], "Food");

shaped(B.LADDER, 3, ["S.S", "SSS", "S.S"], { S: I.STICK });
shaped(B.SANDSTONE, 1, ["SS", "SS"], { S: B.SAND });
shaped(B.STONE_BRICKS, 4, ["SS", "SS"], { S: B.STONE });
shaped(B.BRICKS, 1, ["BB", "BB"], { B: I.BRICK });
shaped(B.CLAY, 1, ["CC", "CC"], { C: I.CLAY_BALL });
shapeless(B.MOSSY_COBBLE, 1, [B.COBBLE, B.TALL_GRASS]);
shaped(B.STONE_SLAB, 6, ["MMM"], { M: B.STONE });
shaped(B.PLANK_SLAB, 6, ["MMM"], { M: B.PLANKS });
shaped(B.COBBLE_SLAB, 6, ["MMM"], { M: B.COBBLE });
shaped(B.SANDSTONE_SLAB, 6, ["MMM"], { M: B.SANDSTONE });
shaped(B.LAMP, 1, [".G.", "GTG", ".G."], { G: B.GLASS, T: B.TORCH });
shaped(I.DOOR, 3, ["PP", "PP", "PP"], { P: B.PLANKS });
shaped(B.FENCE, 3, ["PSP", "PSP"], { P: B.PLANKS, S: I.STICK });
shaped(B.FENCE_GATE, 1, ["SPS", "SPS"], { P: B.PLANKS, S: I.STICK });
shaped(I.BED, 1, ["WWW", "PPP"], { W: I.WHEAT, P: B.PLANKS });
for (const [block, ingot] of [[B.IRON_BLOCK, I.IRON_INGOT], [B.GOLD_BLOCK, I.GOLD_INGOT], [B.CRYSTAL_BLOCK, I.CRYSTAL]]) {
    shaped(block, 1, ["III", "III", "III"], { I: ingot });
    shapeless(ingot, 9, [block], "Basics");
}

//Find the recipe laid out on a size x size grid of item ids (0 = empty)
export function matchRecipe(grid, size) {
    let minX = size, minY = size, maxX = -1, maxY = -1;
    const present = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const id = grid[y * size + x];
            if (id) {
                present.push(id);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
    }
    if (!present.length) {
        return null;
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const sorted = present.slice().sort((a, b) => a - b).join(",");
    for (const r of RECIPES) {
        if (r.items) {
            if (r.items.length === present.length && r.items.slice().sort((a, b) => a - b).join(",") === sorted) {
                return r;
            }
            continue;
        }
        if (r.w !== w || r.h !== h) {
            continue;
        }
        for (const mirror of [false, true]) {
            let ok = true;
            for (let y = 0; y < h && ok; y++) {
                for (let x = 0; x < w; x++) {
                    const ch = r.shape[y][mirror ? w - 1 - x : x];
                    const want = ch === "." ? 0 : r.key[ch];
                    if (grid[(minY + y) * size + minX + x] !== want) {
                        ok = false;
                        break;
                    }
                }
            }
            if (ok) {
                return r;
            }
        }
    }
    return null;
}

//Grid cells (row major, for the given grid size) a recipe occupies
export function recipeLayout(r, size) {
    const cells = new Array(size * size).fill(0);
    if (r.items) {
        r.items.forEach((id, i) => {
            cells[i] = id;
        });
        return cells;
    }
    for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
            const ch = r.shape[y][x];
            cells[y * size + x] = ch === "." ? 0 : r.key[ch];
        }
    }
    return cells;
}

/* ---------- Smelting ---------- */

export const SMELT_TICKS = 200;

export const SMELTING = new Map([
    [B.IRON_ORE, I.IRON_INGOT],
    [B.GOLD_ORE, I.GOLD_INGOT],
    [B.CRYSTAL_ORE, I.CRYSTAL],
    [B.COAL_ORE, I.COAL],
    [B.SAND, B.GLASS],
    [B.COBBLE, B.STONE],
    [I.CLAY_BALL, I.BRICK],
    [B.LOG, I.COAL],
    [B.CACTUS, B.SAND]
]);

export function fuelTicks(id) {
    const it = ITEMS[id];
    return it ? it.fuel : 0;
}

//Everything a creative player can pick from, grouped for the palette tabs
export function creativeGroups() {
    const building = [B.STONE, B.COBBLE, B.MOSSY_COBBLE, B.STONE_BRICKS, B.BRICKS, B.DIRT, B.GRASS, B.SAND, B.SANDSTONE,
        B.GRAVEL, B.CLAY, B.LOG, B.PLANKS, B.LEAVES, B.GLASS, B.LAMP, B.STONE_SLAB, B.PLANK_SLAB,
        B.COBBLE_SLAB, B.SANDSTONE_SLAB, B.IRON_BLOCK, B.GOLD_BLOCK, B.CRYSTAL_BLOCK, B.COAL_ORE, B.IRON_ORE,
        B.GOLD_ORE, B.CRYSTAL_ORE, B.OBSIDIAN, B.LADDER, B.TORCH, B.WORKBENCH, B.FURNACE, B.CHEST,
        B.FENCE, B.FENCE_GATE, I.DOOR, I.BED];
    const nature = [B.SAPLING, B.TALL_GRASS, B.FLOWER_YELLOW, B.FLOWER_RED, B.MUSHROOM_BROWN, B.MUSHROOM_RED,
        B.CACTUS, B.REEDS, B.DEAD_BUSH, I.SEEDS];
    const tools = [];
    for (let mi = 0; mi < 5; mi++) {
        for (let ki = 0; ki < 4; ki++) {
            tools.push(toolId(mi, ki));
        }
    }
    tools.push(I.BUCKET, I.WATER_BUCKET, I.LAVA_BUCKET, I.FLINT_AND_STEEL);
    const items = [I.STICK, I.COAL, I.IRON_INGOT, I.GOLD_INGOT, I.CRYSTAL, I.FLINT, I.CLAY_BALL, I.BRICK,
        I.WHEAT, I.BOWL, I.APPLE, I.BREAD, I.STEW];
    return [
        { name: "Building", ids: building },
        { name: "Nature", ids: nature },
        { name: "Tools", ids: tools },
        { name: "Items", ids: items }
    ];
}
