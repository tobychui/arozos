/*
    Blocky - mobs.js

    Animals. Cows, sheep and chickens wander the grassland and forests in
    daylight; wolves and bears only appear where it is dark (light below 7:
    at night or underground). On Normal and Hard they hunt the player at night
    or in the dark; on Easy they only fight back when hit; on Peaceful they
    never appear. Animals drop food, wool, feathers and bones when killed.

    Also flies arrows shot from a bow: they hit animals or stick in blocks,
    where the player can pick them up again.

    Animals are not saved with the world; they spawn around the player.
*/

import * as THREE from "three";
import { B, I, BLOCKS, isOpaqueAt } from "./blocks.js";
import { moveAxis } from "./physics.js";
import { BIOME } from "./worldgen.js";
import { mulberry32 } from "./util.js";

//attack: damage per difficulty (peaceful, easy, normal, hard)
export const MOBS = {
    cow: { name: "Cow", health: 10, w: 0.9, h: 1.3, speed: 1.3, drops: [[I.RAW_MEAT, 1, 3]], herd: [2, 4] },
    sheep: { name: "Sheep", health: 8, w: 0.9, h: 1.2, speed: 1.2, drops: [[B.WOOL, 1, 2], [I.RAW_MUTTON, 1, 2]], herd: [2, 4] },
    chicken: { name: "Chicken", health: 4, w: 0.45, h: 0.7, speed: 1.1, drops: [[I.RAW_CHICKEN, 1, 1], [I.FEATHER, 0, 2]], herd: [2, 3], floaty: true },
    wolf: { name: "Wolf", health: 10, w: 0.6, h: 0.85, speed: 1.8, chase: 5.0, predator: true, attack: [0, 2, 3, 4], drops: [[I.BONE, 0, 2]], herd: [2, 3] },
    bear: { name: "Bear", health: 24, w: 1.3, h: 1.4, speed: 1.4, chase: 4.2, predator: true, attack: [0, 4, 5, 7], drops: [[I.RAW_MEAT, 2, 4], [I.BONE, 0, 2]], herd: [1, 1] }
};

const PASSIVE_CAP = 14;
const PREDATOR_CAP = 6;
const DESPAWN = 96;
const DARK = 7;

/* ---------------- textures ---------------- */

function pixelTexture(paint, seed) {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(16, 16);
    const rng = mulberry32(seed);
    const set = (x, y, col) => {
        if (x < 0 || y < 0 || x > 15 || y > 15) {
            return;
        }
        const i = (y * 16 + x) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 255;
    };
    paint(set, rng);
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
}

const vary = (rng, c, v) => {
    const k = (rng() - 0.5) * 2 * v;
    return [c[0] + k, c[1] + k, c[2] + k];
};

function fur(base, v, spots, spotColor) {
    return (set, rng) => {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                set(x, y, vary(rng, base, v));
            }
        }
        for (let s = 0; s < spots; s++) {
            const cx = Math.floor(rng() * 16), cy = Math.floor(rng() * 16), r = 1.5 + rng() * 2.5;
            for (let y = -4; y <= 4; y++) {
                for (let x = -4; x <= 4; x++) {
                    if (x * x + y * y < r * r) {
                        set(cx + x, cy + y, vary(rng, spotColor, 8));
                    }
                }
            }
        }
    };
}

//A face: base fur, two eyes, and an optional muzzle patch at the bottom
function face(base, eye, muzzle) {
    return (set, rng) => {
        fur(base, 10, 0)(set, rng);
        for (const x of [3, 4, 11, 12]) {
            set(x, 6, x === 4 || x === 11 ? [240, 240, 240] : eye);
            set(x, 7, eye);
        }
        if (muzzle) {
            for (let y = 10; y < 16; y++) {
                for (let x = 3; x < 13; x++) {
                    set(x, y, vary(rng, muzzle, 6));
                }
            }
            set(5, 12, [60, 40, 40]);
            set(10, 12, [60, 40, 40]);
        }
    };
}

function buildTextures() {
    return {
        cowHide: pixelTexture(fur([236, 236, 230], 8, 5, [40, 36, 34]), 11),
        cowFace: pixelTexture(face([236, 236, 230], [30, 30, 30], [226, 160, 160]), 12),
        wool: pixelTexture(fur([236, 236, 232], 14, 0), 13),
        sheepSkin: pixelTexture(fur([214, 196, 170], 8, 0), 14),
        sheepFace: pixelTexture(face([214, 196, 170], [40, 30, 30], null), 15),
        feathers: pixelTexture(fur([246, 246, 244], 8, 0), 16),
        chickenFace: pixelTexture(face([246, 246, 244], [20, 20, 20], null), 17),
        wolfFur: pixelTexture(fur([150, 146, 140], 16, 3, [204, 200, 194]), 18),
        wolfFace: pixelTexture(face([150, 146, 140], [40, 40, 40], [210, 206, 200]), 19),
        bearFur: pixelTexture(fur([104, 72, 44], 14, 0), 20),
        bearFace: pixelTexture(face([104, 72, 44], [20, 16, 14], [196, 160, 118]), 21)
    };
}

/* ---------------- models ---------------- */

//Models face -z; the group sits at the feet
function buildModel(type, T) {
    const group = new THREE.Group();
    const mats = [];
    const mat = (tex) => {
        const m = new THREE.MeshBasicMaterial(tex.isTexture ? { map: tex } : { color: tex });
        m.userData.base = tex.isTexture ? new THREE.Color(1, 1, 1) : new THREE.Color(tex);
        mats.push(m);
        return m;
    };
    const box = (w, h, d, m, x, y, z, parent = group) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    };
    const legs = [];
    const leg = (w, len, m, x, hip, z) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, hip, z);
        box(w, len, w, m, 0, -len / 2, 0, pivot);
        group.add(pivot);
        legs.push(pivot);
    };
    const headFaces = (side, front) => [side, side, side, side, side, front];
    const parts = { legs, wings: [], tail: null, head: null };
    if (type === "cow") {
        const hide = mat(T.cowHide), faceM = mat(T.cowFace), horn = mat(0xe6dcc0);
        box(0.9, 0.7, 1.3, hide, 0, 0.9, 0.1);
        parts.head = box(0.55, 0.5, 0.45, headFaces(hide, faceM), 0, 1.15, -0.72);
        box(0.08, 0.14, 0.08, horn, -0.2, 1.46, -0.72);
        box(0.08, 0.14, 0.08, horn, 0.2, 1.46, -0.72);
        for (const [x, z] of [[-0.27, -0.42], [0.27, -0.42], [-0.27, 0.55], [0.27, 0.55]]) {
            leg(0.22, 0.55, hide, x, 0.55, z);
        }
    } else if (type === "sheep") {
        const wool = mat(T.wool), skin = mat(T.sheepSkin), faceM = mat(T.sheepFace);
        box(0.85, 0.72, 1.15, wool, 0, 0.95, 0.08);
        parts.head = box(0.42, 0.42, 0.42, headFaces(skin, faceM), 0, 1.2, -0.66);
        box(0.5, 0.18, 0.3, wool, 0, 1.42, -0.62);
        for (const [x, z] of [[-0.24, -0.35], [0.24, -0.35], [-0.24, 0.45], [0.24, 0.45]]) {
            leg(0.2, 0.6, skin, x, 0.6, z);
        }
    } else if (type === "chicken") {
        const feathers = mat(T.feathers), faceM = mat(T.chickenFace), beak = mat(0xf0a020), wattle = mat(0xd02020), feet = mat(0xe8b830);
        box(0.4, 0.42, 0.5, feathers, 0, 0.47, 0.05);
        parts.head = box(0.25, 0.3, 0.22, headFaces(feathers, faceM), 0, 0.78, -0.24);
        box(0.12, 0.07, 0.12, beak, 0, 0.78, -0.4);
        box(0.08, 0.1, 0.06, wattle, 0, 0.68, -0.37);
        for (const side of [-1, 1]) {
            const pivot = new THREE.Group();
            pivot.position.set(side * 0.21, 0.62, 0.05);
            box(0.05, 0.3, 0.36, feathers, side * 0.02, -0.15, 0, pivot);
            group.add(pivot);
            parts.wings.push(pivot);
        }
        for (const x of [-0.1, 0.1]) {
            leg(0.06, 0.27, feet, x, 0.27, 0.06);
        }
    } else if (type === "wolf") {
        const fM = mat(T.wolfFur), faceM = mat(T.wolfFace), nose = mat(0x2a2624);
        box(0.5, 0.48, 0.95, fM, 0, 0.62, 0.06);
        box(0.6, 0.55, 0.42, fM, 0, 0.66, -0.3);
        parts.head = box(0.42, 0.4, 0.36, headFaces(fM, faceM), 0, 0.78, -0.62);
        box(0.22, 0.18, 0.22, fM, 0, 0.7, -0.88);
        box(0.08, 0.06, 0.04, nose, 0, 0.76, -1.0);
        box(0.1, 0.14, 0.06, fM, -0.13, 1.02, -0.6);
        box(0.1, 0.14, 0.06, fM, 0.13, 1.02, -0.6);
        const tail = new THREE.Group();
        tail.position.set(0, 0.72, 0.52);
        box(0.12, 0.12, 0.5, fM, 0, 0, 0.25, tail);
        tail.rotation.x = 0.6;
        group.add(tail);
        parts.tail = tail;
        for (const [x, z] of [[-0.15, -0.3], [0.15, -0.3], [-0.15, 0.4], [0.15, 0.4]]) {
            leg(0.15, 0.42, fM, x, 0.42, z);
        }
    } else {
        const fM = mat(T.bearFur), faceM = mat(T.bearFace), snout = mat(0xc4a076);
        box(1.0, 0.85, 1.5, fM, 0, 0.98, 0.1);
        parts.head = box(0.62, 0.56, 0.52, headFaces(fM, faceM), 0, 1.15, -0.9);
        box(0.3, 0.24, 0.22, snout, 0, 1.04, -1.25);
        box(0.14, 0.14, 0.08, fM, -0.24, 1.48, -0.86);
        box(0.14, 0.14, 0.08, fM, 0.24, 1.48, -0.86);
        for (const [x, z] of [[-0.32, -0.45], [0.32, -0.45], [-0.32, 0.62], [0.32, 0.62]]) {
            leg(0.3, 0.58, fM, x, 0.58, z);
        }
    }
    return { group, mats, parts };
}

/* ---------------- ray helpers ---------------- */

function rayAABB(ox, oy, oz, dx, dy, dz, b) {
    let tmin = 0, tmax = Infinity;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
            if (o[a] < b[a] || o[a] > b[a + 3]) {
                return null;
            }
            continue;
        }
        let t1 = (b[a] - o[a]) / d[a], t2 = (b[a + 3] - o[a]) / d[a];
        if (t1 > t2) {
            [t1, t2] = [t2, t1];
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
            return null;
        }
    }
    return tmin;
}

/* ---------------- manager ---------------- */

export class Mobs {
    constructor(game) {
        this.game = game;
        this.renderer = game.renderer;
        this.list = [];
        this.arrows = [];
        this.textures = buildTextures();
        this.spawnTimer = 1;
        this.rng = mulberry32((Date.now() & 0xffffff) | 1);
    }

    clear() {
        for (const m of this.list) {
            this.disposeMob(m);
        }
        for (const a of this.arrows) {
            this.renderer.scene.remove(a.mesh);
        }
        this.list = [];
        this.arrows = [];
    }

    disposeMob(m) {
        this.renderer.scene.remove(m.model.group);
        m.model.group.traverse((o) => {
            if (o.geometry) {
                o.geometry.dispose();
            }
        });
        for (const mt of m.model.mats) {
            mt.dispose();
        }
    }

    spawn(type, x, y, z) {
        const def = MOBS[type];
        const model = buildModel(type, this.textures);
        this.renderer.scene.add(model.group);
        this.renderer.castShadows(model.group);
        const m = {
            type, def, x, y, z, vx: 0, vy: 0, vz: 0, yaw: this.rng() * Math.PI * 2, health: def.health,
            model, hurtTime: 0, angry: 0, flee: 0, attackCd: 0, walk: 0, onGround: false,
            target: null, idle: 1 + this.rng() * 3, soundIn: 4 + this.rng() * 12, burnCd: 0
        };
        this.list.push(m);
        return m;
    }

    box(m) {
        const hw = m.def.w / 2;
        return [m.x - hw, m.y, m.z - hw, m.x + hw, m.y + m.def.h, m.z + hw];
    }

    //True when a predator would attack the player right now
    aggressive(m) {
        const g = this.game;
        if (!m.def.predator || g.player.creative || g.player.dead) {
            return false;
        }
        if (m.angry > 0) {
            return true;
        }
        if (g.player.difficulty < 2) {
            return false;
        }
        return g.isNight() || this.lightAt(m.x, m.y + 0.5, m.z) < DARK;
    }

    lightAt(x, y, z) {
        const w = this.game.world;
        const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
        return Math.max(w.getSky(fx, fy, fz) - w.skyDarken, w.getBlockLight(fx, fy, fz));
    }

    /* ---------------- spawning ---------------- */

    trySpawn() {
        const g = this.game, p = g.player, w = g.world, rng = this.rng;
        let passive = 0, predators = 0;
        for (const m of this.list) {
            if (m.def.predator) {
                predators++;
            } else {
                passive++;
            }
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            const ang = rng() * Math.PI * 2, d = 22 + rng() * 34;
            const x = Math.floor(p.x + Math.cos(ang) * d), z = Math.floor(p.z + Math.sin(ang) * d);
            const c = w.chunkAt(x >> 4, z >> 4);
            if (!c || !c.lit) {
                continue;
            }
            const biome = w.biomeAt(x, z);
            const top = w.rainTop(x, z);
            //Grazing animals: daylight grass
            if (passive < PASSIVE_CAP && rng() < 0.5) {
                if (w.getBlock(x, top - 1, z) === B.GRASS && w.getSky(x, top, z) >= 9 && !g.isNight()
                    && (biome === BIOME.GRASSLAND || biome === BIOME.FOREST || biome === BIOME.BEACH)) {
                    const r = rng();
                    const type = biome === BIOME.FOREST ? (r < 0.4 ? "chicken" : r < 0.75 ? "cow" : "sheep")
                        : (r < 0.35 ? "cow" : r < 0.7 ? "sheep" : "chicken");
                    passive += this.spawnGroup(type, x, top, z);
                }
                continue;
            }
            //Wolves and bears: only in the dark
            if (predators < PREDATOR_CAP && p.difficulty > 0) {
                let y = top;
                if (rng() < 0.5) {
                    y = 6 + Math.floor(rng() * Math.max(1, top - 10));
                }
                if (!this.standable(x, y, z, 1.5) || this.lightAt(x + 0.5, y, z + 0.5) >= DARK) {
                    continue;
                }
                if (y >= top && biome !== BIOME.GRASSLAND && biome !== BIOME.FOREST) {
                    continue;
                }
                const type = rng() < (biome === BIOME.FOREST ? 0.55 : 0.7) ? "wolf" : "bear";
                predators += this.spawnGroup(type, x, y, z);
            }
        }
    }

    standable(x, y, z, height) {
        const w = this.game.world;
        const below = w.getBlock(x, y - 1, z);
        if (!isOpaqueAt(below, w.getMeta(x, y - 1, z))) {
            return false;
        }
        for (let k = 0; k < Math.ceil(height); k++) {
            const id = w.getBlock(x, y + k, z);
            if (BLOCKS[id].solid || id === B.WATER || id === B.LAVA || id === B.FIRE) {
                return false;
            }
        }
        return true;
    }

    spawnGroup(type, x, y, z) {
        const def = MOBS[type], rng = this.rng;
        const n = def.herd[0] + Math.floor(rng() * (def.herd[1] - def.herd[0] + 1));
        let made = 0;
        for (let k = 0; k < n * 3 && made < n; k++) {
            const sx = x + Math.floor(rng() * 5) - 2, sz = z + Math.floor(rng() * 5) - 2;
            for (const dy of [0, 1, -1]) {
                if (this.standable(sx, y + dy, sz, def.h)) {
                    this.spawn(type, sx + 0.5, y + dy, sz + 0.5);
                    made++;
                    break;
                }
            }
        }
        return made;
    }

    /* ---------------- per frame ---------------- */

    update(dt) {
        const g = this.game, p = g.player, w = g.world;
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = 1;
            this.trySpawn();
        }
        const fogFar = this.renderer.shared.uFogFar.value;
        for (let i = this.list.length - 1; i >= 0; i--) {
            const m = this.list[i];
            const dx = m.x - p.x, dz = m.z - p.z;
            const dist = Math.hypot(dx, dz);
            const gone = dist > DESPAWN || (m.def.predator && p.difficulty === 0)
                || (m.def.predator && !g.isNight() && dist > 28 && this.lightAt(m.x, m.y + 0.5, m.z) >= DARK && this.rng() < 0.01);
            if (gone) {
                this.disposeMob(m);
                this.list.splice(i, 1);
                continue;
            }
            if (!w.isLoaded(Math.floor(m.x), Math.floor(m.z))) {
                continue;
            }
            this.think(m, dt, dist);
            this.move(m, dt);
            if (m.health <= 0) {
                this.die(m);
                this.list.splice(i, 1);
                continue;
            }
            this.pose(m, dt, dist < fogFar);
        }
        this.updateArrows(dt);
    }

    think(m, dt, dist) {
        const g = this.game, p = g.player, rng = this.rng;
        m.hurtTime = Math.max(0, m.hurtTime - dt);
        m.angry = Math.max(0, m.angry - dt);
        m.flee = Math.max(0, m.flee - dt);
        m.attackCd = Math.max(0, m.attackCd - dt);
        let speed = 0, dirX = 0, dirZ = 0;
        const toX = p.x - m.x, toZ = p.z - m.z;
        if (this.aggressive(m) && dist < 24) {
            //Hunt the player
            speed = m.def.chase;
            dirX = toX;
            dirZ = toZ;
            if (!m.growled) {
                m.growled = true;
                this.sound(m, "angry", dist);
            }
            const reach = m.def.w / 2 + 0.7;
            if (dist < reach && Math.abs((p.y + 0.9) - (m.y + m.def.h / 2)) < 1.6 && m.attackCd === 0) {
                m.attackCd = 1.0;
                const dmg = m.def.attack[p.difficulty] || 2;
                g.hurtPlayerBy(dmg, m.type, m.x, m.z);
            }
        } else if (m.flee > 0) {
            speed = m.def.speed * 2.2;
            dirX = -toX;
            dirZ = -toZ;
            m.growled = false;
        } else {
            m.growled = false;
            m.idle -= dt;
            if (m.target) {
                const tx = m.target[0] - m.x, tz = m.target[1] - m.z;
                if (Math.hypot(tx, tz) < 0.6 || m.idle < -8) {
                    m.target = null;
                    m.idle = 2 + rng() * 5;
                } else {
                    speed = m.def.speed;
                    dirX = tx;
                    dirZ = tz;
                }
            } else if (m.idle <= 0) {
                const a = rng() * Math.PI * 2, r = 3 + rng() * 7;
                m.target = [m.x + Math.cos(a) * r, m.z + Math.sin(a) * r];
                m.idle = 0;
            }
        }
        const len = Math.hypot(dirX, dirZ);
        if (len > 1e-3 && speed > 0) {
            dirX /= len;
            dirZ /= len;
            const wantYaw = Math.atan2(-dirX, -dirZ);
            let dy = wantYaw - m.yaw;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            m.yaw += dy * Math.min(1, dt * 8);
        }
        const k = 1 - Math.exp(-(m.onGround ? 10 : 2) * dt);
        m.vx += (dirX * speed - m.vx) * k;
        m.vz += (dirZ * speed - m.vz) * k;
        //Ambient sounds
        m.soundIn -= dt;
        if (m.soundIn <= 0) {
            m.soundIn = 6 + rng() * 14;
            if (dist < 24) {
                this.sound(m, "idle", dist);
            }
        }
    }

    move(m, dt) {
        const w = this.game.world;
        const feet = w.getBlock(Math.floor(m.x), Math.floor(m.y + 0.3), Math.floor(m.z));
        const inWater = feet === B.WATER;
        const inLava = feet === B.LAVA;
        if (inWater || inLava) {
            m.vy = Math.min(m.vy + 18 * dt, 2.2);
        } else {
            m.vy -= 28 * dt;
            if (m.def.floaty && m.vy < -3) {
                m.vy = -3;
            }
        }
        m.vy = Math.max(m.vy, -40);
        const box = this.box(m);
        const dy = m.vy * dt, dx = m.vx * dt, dz = m.vz * dt;
        const my = moveAxis(w, box, 1, dy);
        m.onGround = dy < 0 && my > dy + 1e-6;
        if (my !== dy) {
            m.vy = 0;
        }
        const mx = moveAxis(w, box, 0, dx);
        const mz = moveAxis(w, box, 2, dz);
        //Hop up one block when walking into it
        if ((Math.abs(mx - dx) > 1e-6 || Math.abs(mz - dz) > 1e-6) && (m.onGround || inWater)) {
            m.vy = inWater ? 4 : 7.6;
        }
        m.x = (box[0] + box[3]) / 2;
        m.y = box[1];
        m.z = (box[2] + box[5]) / 2;
        //Fire and lava hurt animals too
        m.burnCd = Math.max(0, m.burnCd - dt);
        if ((inLava || feet === B.FIRE) && m.burnCd === 0) {
            m.burnCd = 0.5;
            this.damage(m, inLava ? 4 : 1, null);
        }
        if (m.y < -40) {
            m.health = 0;
        }
    }

    pose(m, dt, visible) {
        const { group, parts, mats } = m.model;
        group.visible = visible;
        if (!visible) {
            return;
        }
        group.position.set(m.x, m.y, m.z);
        group.rotation.y = m.yaw;
        const sp = Math.hypot(m.vx, m.vz);
        m.walk += dt * sp * 4.5;
        const swing = Math.sin(m.walk) * Math.min(0.8, sp * 0.5);
        parts.legs.forEach((leg, i) => {
            leg.rotation.x = (i % 2 === (i < 2 ? 0 : 1) ? 1 : -1) * swing;
        });
        if (parts.wings.length) {
            const flap = m.onGround ? 0 : Math.sin(performance.now() * 0.03) * 0.8 + 0.8;
            parts.wings[0].rotation.z = -flap;
            parts.wings[1].rotation.z = flap;
        }
        if (parts.tail) {
            parts.tail.rotation.x = this.aggressive(m) ? 1.1 : 0.5 + Math.sin(m.walk * 0.5) * 0.15;
        }
        //Light and the red flash when hurt
        const w = this.game.world;
        const fx = Math.floor(m.x), fy = Math.floor(m.y + 0.5), fz = Math.floor(m.z);
        const b = this.renderer.objectLight(w.getSky(fx, fy, fz) / 15, w.getBlockLight(fx, fy, fz) / 15);
        for (const mt of mats) {
            const base = mt.userData.base;
            if (m.hurtTime > 0) {
                mt.color.setRGB(Math.min(1, b * 1.6), b * 0.35, b * 0.35);
            } else {
                mt.color.setRGB(base.r * b, base.g * b, base.b * b);
            }
        }
    }

    /* ---------------- combat ---------------- */

    //Nearest animal along a ray within reach: { mob, t }
    raycast(ox, oy, oz, dx, dy, dz, reach) {
        let best = null;
        for (const m of this.list) {
            const t = rayAABB(ox, oy, oz, dx, dy, dz, this.box(m));
            if (t !== null && t <= reach && (!best || t < best.t)) {
                best = { mob: m, t };
            }
        }
        return best;
    }

    //source: [x, z] of the attacker for knockback, or null
    damage(m, amount, source) {
        if (m.health <= 0) {
            return;
        }
        m.health -= amount;
        m.hurtTime = 0.35;
        const p = this.game.player;
        if (source) {
            const ax = m.x - source[0], az = m.z - source[1];
            const l = Math.hypot(ax, az) || 1;
            m.vx += ax / l * 6;
            m.vz += az / l * 6;
            m.vy = Math.max(m.vy, 4.5);
        }
        if (m.def.predator) {
            if (p.difficulty > 0) {
                m.angry = 30;
                //The pack joins in
                for (const o of this.list) {
                    if (o !== m && o.type === m.type && Math.hypot(o.x - m.x, o.z - m.z) < 14) {
                        o.angry = 30;
                    }
                }
            }
        } else {
            m.flee = 4;
            m.target = null;
        }
        if (m.health > 0) {
            this.sound(m, "hurt", Math.hypot(m.x - p.x, m.z - p.z));
        }
    }

    die(m) {
        const g = this.game, rng = this.rng;
        this.sound(m, "death", Math.hypot(m.x - g.player.x, m.z - g.player.z));
        for (const [id, lo, hi] of m.def.drops) {
            const n = lo + Math.floor(rng() * (hi - lo + 1));
            if (n > 0) {
                g.entities.spawnItem(m.x, m.y + 0.5, m.z, id, n);
            }
        }
        this.renderer.spawnParticles(m.x, m.y + m.def.h / 2, m.z, [220, 220, 220], 18, m.def.w / 2, 2.5);
        this.disposeMob(m);
    }

    sound(m, kind, dist) {
        this.game.sound.animal(m.type, kind, dist);
    }

    /* ---------------- arrows ---------------- */

    shootArrow(x, y, z, vx, vy, vz, damage) {
        const mesh = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: 0x8c6a3c }));
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0x5c5c64 }));
        head.position.z = -0.32;
        const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.14), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
        fletch.position.z = 0.26;
        mesh.add(shaft, head, fletch);
        this.renderer.scene.add(mesh);
        this.arrows.push({ x, y, z, vx, vy, vz, damage, mesh, stuck: false, life: 60 });
    }

    updateArrows(dt) {
        const g = this.game, w = g.world, p = g.player;
        for (let i = this.arrows.length - 1; i >= 0; i--) {
            const a = this.arrows[i];
            a.life -= dt;
            let remove = a.life <= 0;
            if (!a.stuck && !remove) {
                a.vy -= 18 * dt;
                const speed = Math.hypot(a.vx, a.vy, a.vz);
                const steps = Math.max(1, Math.ceil(speed * dt / 0.2));
                for (let s = 0; s < steps && !a.stuck && !remove; s++) {
                    a.x += a.vx * dt / steps;
                    a.y += a.vy * dt / steps;
                    a.z += a.vz * dt / steps;
                    for (const m of this.list) {
                        const b = this.box(m);
                        if (a.x > b[0] - 0.1 && a.x < b[3] + 0.1 && a.y > b[1] && a.y < b[4] + 0.1 && a.z > b[2] - 0.1 && a.z < b[5] + 0.1) {
                            this.damage(m, Math.round(a.damage * Math.min(1, speed / 40)), [a.x - a.vx, a.z - a.vz]);
                            remove = true;
                            break;
                        }
                    }
                    const id = w.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));
                    if (!remove && BLOCKS[id].solid) {
                        a.stuck = true;
                        a.life = 60;
                    }
                }
                if (!a.stuck) {
                    a.mesh.position.set(a.x, a.y, a.z);
                    a.mesh.lookAt(a.x - a.vx, a.y - a.vy, a.z - a.vz);
                }
            }
            if (a.stuck && !remove && !p.creative && Math.hypot(a.x - p.x, a.y - (p.y + 0.5), a.z - p.z) < 1.4) {
                if (g.inventory.add(I.ARROW, 1) === 0) {
                    g.onPickup(I.ARROW, 1);
                    remove = true;
                }
            }
            if (remove) {
                this.renderer.scene.remove(a.mesh);
                a.mesh.traverse((o) => {
                    if (o.geometry) {
                        o.geometry.dispose();
                        o.material.dispose();
                    }
                });
                this.arrows.splice(i, 1);
                continue;
            }
            a.mesh.position.set(a.x, a.y, a.z);
        }
    }

    //Any animal that would attack within this radius (sleeping is blocked)
    threatNear(x, z, r) {
        return this.list.some((m) => m.def.predator && this.aggressive(m) && Math.hypot(m.x - x, m.z - z) < r);
    }
}
