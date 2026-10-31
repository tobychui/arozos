/*
    Blocky - worldgen.js

    Deterministic terrain generator. A column's height and biome come from
    2D noise only, so any column can be asked about without generating its
    chunk; that is what lets trees straddle chunk borders: every chunk
    re-derives the trees of its eight neighbours and stamps the parts that
    fall inside itself.

    Biomes: ocean, grassland, desert, forest (plus sandy beaches along water).
    Caves are worm tunnels: winding passages 3-7 blocks wide, forking, with
    the odd cavern, that link into networks across many chunks. Cave floors
    below y = 11 are lava, and some stone hides lava pockets.
*/

import { Noise } from "./noise.js";
import { B } from "./blocks.js";
import { mulberry32, hash2, hash3, smoothstep, lerp } from "./util.js";

export const WORLD_H = 128;
export const SEA = 62;

export const BIOME = { OCEAN: 0, GRASSLAND: 1, DESERT: 2, FOREST: 3, BEACH: 4 };

//Share of chunks that start a cave system, and how many chunks away a
//system's tunnels can still reach
const CAVE_CHANCE = 0.3;
const CAVE_REACH = 8;
export const BIOME_NAMES = ["Ocean", "Grassland", "Desert", "Forest", "Beach"];

//Grass and foliage tints per biome blend
const GRASS_PLAIN = [0.62, 1.0, 0.43];
const GRASS_FOREST = [0.5, 0.9, 0.36];
const GRASS_DRY = [0.82, 0.92, 0.42];
const LEAF_PLAIN = [0.48, 0.86, 0.32];
const LEAF_FOREST = [0.38, 0.76, 0.28];

export const idx = (x, y, z) => (x << 11) | (z << 7) | y;

export class TerrainGen {
    constructor(seed) {
        this.seed = seed | 0;
        this.nCont = new Noise(seed ^ 0x1a2b3c);
        this.nTemp = new Noise(seed ^ 0x2b3c4d);
        this.nHum = new Noise(seed ^ 0x3c4d5e);
        this.nHill = new Noise(seed ^ 0x4d5e6f);
        this.nDetail = new Noise(seed ^ 0x5e6f70);
        this.nFloor = new Noise(seed ^ 0x8192a3);
        this.nPeak = new Noise(seed ^ 0x92a3b4);
        this.colCache = new Map();
        this.caveCache = new Map();
    }

    //Height, biome and tints of one column
    column(x, z) {
        const cont = this.nCont.fbm2(x / 560, z / 560, 4);
        const temp = this.nTemp.fbm2(x / 400 + 311, z / 400 - 127, 3);
        const hum = this.nHum.fbm2(x / 340 - 97, z / 340 + 53, 3);
        const land = smoothstep(-0.2, -0.06, cont);
        const forest = smoothstep(0.0, 0.16, hum);
        const desert = smoothstep(0.06, 0.2, temp) * (1 - forest);
        const hill = this.nHill.fbm2(x / 150, z / 150, 4);
        const detail = this.nDetail.fbm2(x / 34, z / 34, 2);
        const amp = 5 + 7 * forest - 2.5 * desert + 4 * Math.max(0, cont);
        let landH = SEA + 3 + Math.max(0, cont + 0.06) * 16 + hill * amp + detail * 1.5;
        const peak = this.nPeak.fbm2(x / 220, z / 220, 3);
        if (peak > 0.45) {
            landH += (peak - 0.45) * 46 * (1 - desert);
        }
        landH += desert * Math.abs(this.nDetail.noise2(x / 22, z / 22)) * 3;
        const oceanH = SEA - 11 + this.nFloor.fbm2(x / 60, z / 60, 3) * 5 + Math.min(0, cont + 0.2) * 14;
        const h = Math.max(4, Math.min(WORLD_H - 20, Math.floor(lerp(oceanH, landH, land))));

        let biome;
        if (land < 0.5) {
            biome = BIOME.OCEAN;
        } else if (desert > 0.5) {
            biome = BIOME.DESERT;
        } else if (forest > 0.5) {
            biome = BIOME.FOREST;
        } else {
            biome = BIOME.GRASSLAND;
        }
        if (biome !== BIOME.OCEAN && biome !== BIOME.DESERT && h <= SEA + 1 && h >= SEA - 2) {
            const beachy = this.nDetail.noise2(x / 18 + 50, z / 18) > -0.35;
            if (beachy) {
                biome = BIOME.BEACH;
            }
        }
        const dry = desert;
        const grass = [0, 1, 2].map((i) => lerp(lerp(GRASS_PLAIN[i], GRASS_FOREST[i], forest), GRASS_DRY[i], dry * 0.8));
        const leaf = [0, 1, 2].map((i) => lerp(LEAF_PLAIN[i], LEAF_FOREST[i], forest));
        return { h, biome, grass, leaf, forest, desert };
    }

    //Cached column lookup for neighbouring tree origins
    columnCached(x, z) {
        const k = (x + 32768) * 65536 + (z + 32768);
        let c = this.colCache.get(k);
        if (!c) {
            c = this.column(x, z);
            if (this.colCache.size > 20000) {
                this.colCache.clear();
            }
            this.colCache.set(k, c);
        }
        return c;
    }

    generate(chunk) {
        const { blocks, meta } = chunk;
        const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
        const cols = new Array(256);
        let maxH = SEA;
        for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
                const c = this.columnCached(x0 + lx, z0 + lz);
                cols[lz * 16 + lx] = c;
                chunk.biome[lz * 16 + lx] = c.biome;
                chunk.tint.set(c.grass, (lz * 16 + lx) * 6);
                chunk.tint.set(c.leaf, (lz * 16 + lx) * 6 + 3);
                if (c.h > maxH) {
                    maxH = c.h;
                }
            }
        }

        const rng = mulberry32(hash2(this.seed, chunk.cx, chunk.cz));

        for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
                const c = cols[lz * 16 + lx];
                const h = c.h;
                const underwater = h < SEA;
                const floorN = this.nFloor.noise2((x0 + lx) / 14, (z0 + lz) / 14);
                const top = Math.max(h, SEA);
                for (let y = 0; y <= top; y++) {
                    const i = idx(lx, y, lz);
                    let id;
                    if (y === 0 || (y < 4 && rng() < (4 - y) / 5)) {
                        id = B.BEDROCK;
                    } else if (y <= h) {
                        const depth = h - y;
                        id = B.STONE;
                        if (underwater) {
                            if (depth < 3) {
                                id = floorN > 0.45 ? B.GRAVEL : floorN < -0.55 && depth === 0 ? B.CLAY : floorN > 0.2 && c.biome !== BIOME.OCEAN ? B.DIRT : B.SAND;
                            }
                        } else if (c.biome === BIOME.DESERT) {
                            id = depth < 4 ? B.SAND : depth < 7 ? B.SANDSTONE : B.STONE;
                        } else if (c.biome === BIOME.BEACH) {
                            id = depth < 3 ? B.SAND : depth < 5 ? B.SANDSTONE : B.STONE;
                        } else {
                            const soil = 3 + ((hash2(this.seed, x0 + lx, z0 + lz) & 1));
                            id = depth === 0 ? B.GRASS : depth <= soil ? B.DIRT : B.STONE;
                        }
                    } else {
                        id = y <= SEA ? B.WATER : B.AIR;
                    }
                    blocks[i] = id;
                }
            }
        }

        this.carveCaves(chunk, cols);

        //Ores and underground pockets
        const vein = (id, tries, size, ymin, ymax, replace) => {
            for (let t = 0; t < tries; t++) {
                let x = Math.floor(rng() * 16), z = Math.floor(rng() * 16);
                let y = ymin + Math.floor(rng() * (ymax - ymin));
                for (let s = 0; s < size; s++) {
                    if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WORLD_H) {
                        const i = idx(x, y, z);
                        if (blocks[i] === replace) {
                            blocks[i] = id;
                        }
                    }
                    const r = rng();
                    if (r < 0.33) {
                        x += rng() < 0.5 ? -1 : 1;
                    } else if (r < 0.66) {
                        z += rng() < 0.5 ? -1 : 1;
                    } else {
                        y += rng() < 0.5 ? -1 : 1;
                    }
                }
            }
        };
        vein(B.DIRT, 6, 22, 10, Math.max(12, maxH - 4), B.STONE);
        vein(B.GRAVEL, 5, 20, 6, Math.max(8, maxH - 4), B.STONE);
        vein(B.COAL_ORE, 18, 10, 5, 100, B.STONE);
        vein(B.IRON_ORE, 12, 7, 5, 64, B.STONE);
        vein(B.GOLD_ORE, 2, 7, 5, 32, B.STONE);
        vein(B.CRYSTAL_ORE, 1, 5, 5, 17, B.STONE);
        vein(B.SPARK_ORE, 4, 6, 5, 18, B.STONE);
        if (rng() < 0.3) {
            vein(B.LAVA, 1, 14, 6, 40, B.STONE);
        }

        this.placeTrees(chunk, cols);
        this.placePlants(chunk, cols, rng);
    }

    /* ---------------- caves ---------------- */

    //Cave systems started by one chunk: a list of carving spheres
    //(x, y, z, radius) plus their bounding box. Cached, since every chunk
    //within reach replays them.
    caveSystems(cx, cz) {
        const key = (cx + 32768) * 65536 + (cz + 32768);
        let sys = this.caveCache.get(key);
        if (sys) {
            return sys;
        }
        const rng = mulberry32(hash2(this.seed ^ 0xca7e5, cx, cz));
        const out = [];
        if (rng() < CAVE_CHANCE) {
            const systems = rng() < 0.35 ? 2 : 1;
            for (let n = 0; n < systems; n++) {
                const x = cx * 16 + rng() * 16, z = cz * 16 + rng() * 16;
                const y = 12 + rng() * 50;
                if (rng() < 0.3) {
                    //A cavern where the tunnels meet
                    const room = 3.5 + rng() * 3;
                    out.push(x, y, z, room, x + room * 0.5, y, z, room * 0.8);
                }
                const tunnels = 2 + Math.floor(rng() * 3);
                for (let t = 0; t < tunnels; t++) {
                    this.caveWorm(out, rng, x, y, z, rng() * Math.PI * 2, (rng() - 0.5) * 0.4,
                        70 + Math.floor(rng() * 60), 1.4 + rng() * 1.5, 0);
                }
            }
        }
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < out.length; i += 4) {
            minX = Math.min(minX, out[i] - out[i + 3]);
            maxX = Math.max(maxX, out[i] + out[i + 3]);
            minZ = Math.min(minZ, out[i + 2] - out[i + 3]);
            maxZ = Math.max(maxZ, out[i + 2] + out[i + 3]);
        }
        sys = { spheres: new Float32Array(out), minX, maxX, minZ, maxZ };
        if (this.caveCache.size > 4096) {
            this.caveCache.clear();
        }
        this.caveCache.set(key, sys);
        return sys;
    }

    //One winding tunnel: steady turns, mostly level, fattest in the middle,
    //with a chance to fork once
    caveWorm(out, rng, x, y, z, yaw, pitch, len, radius, depth) {
        let yawV = 0, pitchV = 0;
        const forkAt = depth < 2 && rng() < 0.55 ? Math.floor(len * (0.25 + rng() * 0.5)) : -1;
        for (let i = 0; i < len; i++) {
            const r = radius * (0.7 + 0.6 * Math.sin(Math.PI * i / len));
            x += Math.cos(yaw) * Math.cos(pitch);
            z += Math.sin(yaw) * Math.cos(pitch);
            y += Math.sin(pitch);
            yawV = yawV * 0.8 + (rng() - 0.5) * 1.6;
            pitchV = pitchV * 0.8 + (rng() - 0.5) * 0.8;
            yaw += yawV * 0.1;
            pitch = pitch * 0.85 + pitchV * 0.08;
            if (y < 8) {
                pitch = Math.abs(pitch) + 0.05;
            } else if (y > 72) {
                pitch = -Math.abs(pitch) - 0.05;
            }
            out.push(x, y, z, r);
            if (i === forkAt) {
                const side = rng() < 0.5 ? -1 : 1;
                this.caveWorm(out, rng, x, y, z, yaw + side * (Math.PI / 2 + (rng() - 0.5) * 0.6), pitch * 0.5,
                    Math.floor((len - i) * (0.6 + rng() * 0.5)), radius * 0.85, depth + 1);
            }
        }
    }

    carveCaves(chunk, cols) {
        const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
        const R = CAVE_REACH;
        for (let dcx = -R; dcx <= R; dcx++) {
            for (let dcz = -R; dcz <= R; dcz++) {
                const sys = this.caveSystems(chunk.cx + dcx, chunk.cz + dcz);
                if (sys.maxX < x0 || sys.minX > x0 + 16 || sys.maxZ < z0 || sys.minZ > z0 + 16) {
                    continue;
                }
                const sp = sys.spheres;
                for (let i = 0; i < sp.length; i += 4) {
                    const r = sp[i + 3];
                    if (sp[i] + r < x0 || sp[i] - r > x0 + 16 || sp[i + 2] + r < z0 || sp[i + 2] - r > z0 + 16) {
                        continue;
                    }
                    this.carveSphere(chunk, cols, sp[i] - x0, sp[i + 1], sp[i + 2] - z0, r);
                }
            }
        }
    }

    carveSphere(chunk, cols, cx, cy, cz, r) {
        const blocks = chunk.blocks;
        const ry = r * 0.75;
        const lx0 = Math.max(0, Math.floor(cx - r)), lx1 = Math.min(15, Math.floor(cx + r));
        const lz0 = Math.max(0, Math.floor(cz - r)), lz1 = Math.min(15, Math.floor(cz + r));
        const y0 = Math.max(1, Math.floor(cy - ry)), y1 = Math.min(WORLD_H - 2, Math.floor(cy + ry));
        for (let lx = lx0; lx <= lx1; lx++) {
            const dx = (lx + 0.5 - cx) / r;
            for (let lz = lz0; lz <= lz1; lz++) {
                const dz = (lz + 0.5 - cz) / r;
                const col = cols[lz * 16 + lx];
                for (let y = y0; y <= y1; y++) {
                    const dy = (y + 0.5 - cy) / ry;
                    if (dx * dx + dy * dy + dz * dz >= 1) {
                        continue;
                    }
                    //Keep seas, lakes and beaches sealed
                    if (col.h < SEA + 3 && y > col.h - 7) {
                        continue;
                    }
                    const i = idx(lx, y, lz);
                    const id = blocks[i];
                    if (id === B.AIR || id === B.WATER || id === B.BEDROCK || id === B.LAVA || blocks[i + 1] === B.WATER) {
                        continue;
                    }
                    //The deepest caves are flooded with lava
                    blocks[i] = y <= 10 ? B.LAVA : B.AIR;
                }
            }
        }
    }

    //Trees of this chunk and its neighbours, clipped to this chunk
    placeTrees(chunk) {
        const { blocks, meta } = chunk;
        const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
        for (let dcx = -1; dcx <= 1; dcx++) {
            for (let dcz = -1; dcz <= 1; dcz++) {
                const ncx = chunk.cx + dcx, ncz = chunk.cz + dcz;
                const trng = mulberry32(hash2(this.seed ^ 0x7eee, ncx, ncz));
                const candidates = 12;
                for (let t = 0; t < candidates; t++) {
                    const tx = ncx * 16 + Math.floor(trng() * 16);
                    const tz = ncz * 16 + Math.floor(trng() * 16);
                    const roll = trng();
                    const kind = trng();
                    const heightRoll = trng();
                    const c = this.columnCached(tx, tz);
                    let chance = 0;
                    if (c.biome === BIOME.FOREST) {
                        chance = 0.72;
                    } else if (c.biome === BIOME.GRASSLAND) {
                        chance = 0.035;
                    }
                    if (roll >= chance || c.h < SEA) {
                        continue;
                    }
                    const tall = c.biome === BIOME.FOREST && kind < 0.3;
                    const trunk = tall ? 7 + Math.floor(heightRoll * 3) : 4 + Math.floor(heightRoll * 3);
                    this.stampTree(blocks, meta, x0, z0, tx, c.h + 1, tz, trunk, tall);
                }
            }
        }
    }

    stampTree(blocks, meta, x0, z0, tx, ty, tz, trunk, tall) {
        const inside = (x, y, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16 && y > 0 && y < WORLD_H;
        const topY = ty + trunk - 1;
        //Canopy
        const r = tall ? 3 : 2;
        const dyMin = tall ? -4 : -2;
        for (let dy = dyMin; dy <= 1; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    const x = tx + dx, y = topY + dy, z = tz + dz;
                    if (!inside(x, y, z)) {
                        continue;
                    }
                    let keep;
                    const jitter = (hash3(this.seed, x, y, z) & 255) / 255;
                    if (tall) {
                        const rad = 2.7 - (dy - dyMin) * 0.42;
                        keep = dx * dx + dz * dz <= rad * rad + jitter * 1.2;
                    } else {
                        const d = dx * dx + dz * dz + (dy + 0.5) * (dy + 0.5) * 1.6;
                        keep = d <= 5.2 + jitter * 1.8;
                    }
                    if (!keep) {
                        continue;
                    }
                    const i = idx(x - x0, y, z - z0);
                    const cur = blocks[i];
                    if (cur === B.AIR || cur === B.TALL_GRASS) {
                        blocks[i] = B.LEAVES;
                        meta[i] = 0;
                    }
                }
            }
        }
        //Trunk (overwrites leaves)
        for (let y = ty; y <= topY; y++) {
            if (inside(tx, y, tz)) {
                const i = idx(tx - x0, y, tz - z0);
                const cur = blocks[i];
                if (cur === B.AIR || cur === B.LEAVES || cur === B.TALL_GRASS) {
                    blocks[i] = B.LOG;
                }
            }
        }
        if (inside(tx, ty - 1, tz)) {
            const i = idx(tx - x0, ty - 1, tz - z0);
            if (blocks[i] === B.GRASS) {
                blocks[i] = B.DIRT;
            }
        }
    }

    placePlants(chunk, cols, rng) {
        const { blocks, meta } = chunk;
        const columnTop = (lx, lz) => {
            for (let y = WORLD_H - 1; y > 0; y--) {
                if (blocks[idx(lx, y, lz)] !== B.AIR) {
                    return y;
                }
            }
            return 0;
        };
        for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
                const c = cols[lz * 16 + lx];
                const y = c.h;
                if (y < SEA || y >= WORLD_H - 4) {
                    continue;
                }
                const ground = blocks[idx(lx, y, lz)];
                const above = idx(lx, y + 1, lz);
                if (blocks[above] !== B.AIR) {
                    continue;
                }
                const r = rng();
                if (ground === B.GRASS) {
                    if (c.biome === BIOME.GRASSLAND) {
                        if (r < 0.2) {
                            blocks[above] = B.TALL_GRASS;
                        } else if (r < 0.225) {
                            const f = rng();
                            blocks[above] = f < 0.5 ? B.FLOWER_YELLOW : f < 0.8 ? B.FLOWER_RED : B.BLUE_FLOWER;
                        }
                    } else if (c.biome === BIOME.FOREST) {
                        const shaded = columnTop(lx, lz) > y + 2;
                        if (r < 0.09) {
                            blocks[above] = B.TALL_GRASS;
                        } else if (shaded && r < 0.11) {
                            blocks[above] = rng() < 0.6 ? B.MUSHROOM_BROWN : B.MUSHROOM_RED;
                        } else if (r < 0.115) {
                            blocks[above] = rng() < 0.5 ? B.FLOWER_RED : B.BLUE_FLOWER;
                        }
                    }
                }
                if (ground === B.SAND && c.biome === BIOME.DESERT) {
                    if (r < 0.006 && lx > 0 && lx < 15 && lz > 0 && lz < 15) {
                        const hgt = 1 + Math.floor(rng() * 3);
                        let free = true;
                        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            for (let k = 1; k <= hgt; k++) {
                                if (blocks[idx(lx + dx, y + k, lz + dz)] !== B.AIR) {
                                    free = false;
                                }
                            }
                        }
                        if (free) {
                            for (let k = 1; k <= hgt; k++) {
                                blocks[idx(lx, y + k, lz)] = B.CACTUS;
                            }
                        }
                    } else if (r < 0.016) {
                        blocks[above] = B.DEAD_BUSH;
                    }
                }
                //Reeds grow beside water
                if ((ground === B.GRASS || ground === B.SAND || ground === B.DIRT) && y === SEA && r > 0.86) {
                    let wet = false;
                    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nx = lx + dx, nz = lz + dz;
                        if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && blocks[idx(nx, y, nz)] === B.WATER) {
                            wet = true;
                        }
                    }
                    if (wet) {
                        const hgt = 1 + Math.floor(rng() * 3);
                        for (let k = 1; k <= hgt; k++) {
                            blocks[idx(lx, y + k, lz)] = B.REEDS;
                        }
                    }
                }
            }
        }
    }

    //Grow a tree at runtime (from a sapling); returns the block list to set
    treeBlocks(x, y, z, rng) {
        const tall = rng() < 0.2;
        const trunk = tall ? 7 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 3);
        const out = [];
        const topY = y + trunk - 1;
        const r = tall ? 3 : 2;
        const dyMin = tall ? -4 : -2;
        for (let dy = dyMin; dy <= 1; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    const jitter = (hash3(this.seed, x + dx, topY + dy, z + dz) & 255) / 255;
                    let keep;
                    if (tall) {
                        const rad = 2.7 - (dy - dyMin) * 0.42;
                        keep = dx * dx + dz * dz <= rad * rad + jitter * 1.2;
                    } else {
                        const d = dx * dx + dz * dz + (dy + 0.5) * (dy + 0.5) * 1.6;
                        keep = d <= 5.2 + jitter * 1.8;
                    }
                    if (keep) {
                        out.push([x + dx, topY + dy, z + dz, B.LEAVES]);
                    }
                }
            }
        }
        for (let yy = y; yy <= topY; yy++) {
            out.push([x, yy, z, B.LOG]);
        }
        return { blocks: out, height: trunk + 2 };
    }

    //A dry land spot near the origin to spawn on
    findSpawn() {
        for (let r = 0; r < 600; r += 8) {
            for (let a = 0; a < 16; a++) {
                const ang = (a / 16) * Math.PI * 2;
                const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
                const c = this.column(x, z);
                if (c.h >= SEA + 1 && c.biome !== BIOME.OCEAN) {
                    return { x: x + 0.5, z: z + 0.5, h: c.h };
                }
                if (r === 0) {
                    break;
                }
            }
        }
        return { x: 0.5, z: 0.5, h: SEA + 1 };
    }
}
