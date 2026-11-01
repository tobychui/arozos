/*
    Blocky - boats.js

    Wooden boats. A boat floats on water (it rises to the surface of the
    water it is in and bobs there), slides slowly on land and falls through
    the air. Flowing water carries it along and a waterfall takes it down.
    Right click to sit in it; W / S row forward and back, A / D
    turn the boat (and your view with it), Shift gets out onto the nearest
    dry spot. Two hits break a boat (one in creative) and drop it as an item.
    Walking into an empty boat nudges it along. Boats bump into each other,
    burn up in lava and are saved with the world.
*/

import * as THREE from "three";
import { B, I, BLOCKS, SOLID } from "./blocks.js";
import { moveAxis } from "./physics.js";
import { waterHeight } from "./mesher.js";

//Collision box: square (the hull turns, the box does not) and just under
//one block wide, so a boat fits a one block wide canal
const HALF = 0.49, HEIGHT = 0.55;
//How deep the hull sits below the water surface
const DRAFT = 0.14;
//Rowing on water: forward / backward thrust and top speed (blocks / s)
const THRUST = 7, BACK_THRUST = 3, MAX_FWD = 7, MAX_BACK = 2.5;
//On land a boat only shuffles along
const LAND_THRUST = 1.5, LAND_MAX = 1.2;
//Turning speed (radians / s)
const TURN = 2.2;
//Flowing water carries a boat at this speed (blocks / s); rowing works
//relative to the water, so upstream is that much slower
const CURRENT = 2.5;
//How fast a waterfall takes a boat down
const FALL_SPEED = 7;
//Where the hull looks for water besides its middle: near its four corners
const PROBES = [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]];
//Hull size (model space, bow toward -z like the player's view)
const LEN = 1.375, WID = 0.875;

export class Boats {
    constructor(game) {
        this.game = game;
        this.renderer = game.renderer;
        this.list = [];
        this.texture = null;
    }

    clear() {
        for (const b of this.list) {
            this.disposeBoat(b);
        }
        this.list = [];
    }

    /* ---------------- model ---------------- */

    woodTexture() {
        if (!this.texture) {
            const canvas = this.game.app.tex.canvases.get("planks");
            const t = new THREE.CanvasTexture(canvas);
            t.magFilter = THREE.NearestFilter;
            t.minFilter = THREE.NearestFilter;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            this.texture = t;
        }
        return this.texture;
    }

    buildModel() {
        const group = new THREE.Group();
        const hull = new THREE.Group();
        group.add(hull);
        const wood = new THREE.MeshBasicMaterial({ map: this.woodTexture() });
        const dark = new THREE.MeshBasicMaterial({ map: this.woodTexture() });
        wood.userData.base = new THREE.Color(1, 1, 1);
        dark.userData.base = new THREE.Color(0.62, 0.56, 0.5);
        //A box whose texture keeps the block's pixel size on every face
        const box = (parent, w, h, d, m, x, y, z) => {
            const g = new THREE.BoxGeometry(w, h, d);
            const uv = g.attributes.uv;
            const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
            for (let f = 0; f < 6; f++) {
                for (let k = 0; k < 4; k++) {
                    const i = f * 4 + k;
                    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
                }
            }
            const mesh = new THREE.Mesh(g, m);
            mesh.position.set(x, y, z);
            parent.add(mesh);
            return mesh;
        };
        const t = 0.1, rim = 0.55, hw = WID / 2, hl = LEN / 2;
        box(hull, WID, t, LEN, dark, 0, t / 2, 0);
        box(hull, t, rim - t, LEN, wood, -hw + t / 2, (rim + t) / 2, 0);
        box(hull, t, rim - t, LEN, wood, hw - t / 2, (rim + t) / 2, 0);
        box(hull, WID - 2 * t, rim - t, t, wood, 0, (rim + t) / 2, -hl + t / 2);
        box(hull, WID - 2 * t, rim - t, t, wood, 0, (rim + t) / 2, hl - t / 2);
        //Seat plank across the middle
        box(hull, WID - 2 * t, 0.06, 0.28, wood, 0, 0.3, 0.1);
        //Oars: a pivot at each oarlock turns a shaft with a blade
        const oars = [];
        for (const side of [-1, 1]) {
            const pivot = new THREE.Group();
            pivot.position.set(side * (hw + 0.02), rim - 0.04, 0);
            box(pivot, 0.05, 0.05, 1.1, wood, side * 0.06, 0, 0);
            box(pivot, 0.03, 0.2, 0.26, dark, side * 0.06, 0, 0.5);
            hull.add(pivot);
            oars.push({ pivot, side });
        }
        //Keeps the water surface from showing inside the hull: drawn after
        //the boat, it writes depth only, so the water behind it is hidden
        const mask = new THREE.Mesh(new THREE.PlaneGeometry(WID - 2 * t, LEN - 2 * t),
            new THREE.MeshBasicMaterial({ colorWrite: false }));
        mask.rotation.x = -Math.PI / 2;
        mask.position.y = rim - 0.06;
        mask.renderOrder = 1;
        hull.add(mask);
        this.renderer.scene.add(group);
        hull.children.forEach((o) => {
            if (o !== mask) {
                this.renderer.castShadows(o);
            }
        });
        return { group, hull, oars, mask, mats: [wood, dark] };
    }

    spawn(x, y, z, data = {}) {
        const b = {
            x, y, z, vx: data.vx || 0, vy: 0, vz: data.vz || 0, yaw: data.yaw || 0,
            hits: 0, hitCd: 0, rider: false, onGround: false, inWater: false,
            row: 0, rowPhase: 0, splash: 0, bob: Math.random() * 6
        };
        b.model = this.buildModel();
        this.list.push(b);
        return b;
    }

    disposeBoat(b) {
        this.renderer.scene.remove(b.model.group);
        b.model.group.traverse((o) => {
            if (o.geometry) {
                o.geometry.dispose();
            }
        });
        for (const m of b.model.mats) {
            m.dispose();
        }
        b.model.mask.material.dispose();
    }

    box(b) {
        return [b.x - HALF, b.y, b.z - HALF, b.x + HALF, b.y + HEIGHT, b.z + HALF];
    }

    raycast(ox, oy, oz, dx, dy, dz, reach) {
        let best = null;
        for (const b of this.list) {
            if (b.rider) {
                continue;
            }
            const bx = this.box(b);
            let tmin = 0, tmax = Infinity, miss = false;
            const o = [ox, oy, oz], d = [dx, dy, dz];
            for (let a = 0; a < 3 && !miss; a++) {
                if (Math.abs(d[a]) < 1e-9) {
                    miss = o[a] < bx[a] || o[a] > bx[a + 3];
                    continue;
                }
                let t1 = (bx[a] - o[a]) / d[a], t2 = (bx[a + 3] - o[a]) / d[a];
                if (t1 > t2) {
                    [t1, t2] = [t2, t1];
                }
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                miss = tmin > tmax;
            }
            if (!miss && tmin <= reach && (!best || tmin < best.t)) {
                best = { boat: b, t: tmin };
            }
        }
        return best;
    }

    /* ---------------- player actions ---------------- */

    //Left click: two hits break a boat (one in creative)
    hit(b) {
        const g = this.game;
        if (b.hitCd > 0) {
            return;
        }
        b.hitCd = 0.25;
        b.hits++;
        g.sound.block("dig", "wood");
        if (b.hits >= 2 || g.creative) {
            this.breakBoat(b, !g.creative);
        }
    }

    breakBoat(b, drop) {
        const g = this.game;
        if (b.rider) {
            this.dismount();
        }
        if (drop) {
            g.entities.spawnItem(b.x, b.y + 0.5, b.z, I.BOAT, 1);
        }
        g.sound.block("break", "wood");
        this.disposeBoat(b);
        this.list.splice(this.list.indexOf(b), 1);
    }

    //Right click: sit in it
    use(b) {
        const g = this.game;
        if (b.rider || g.boat || g.riding) {
            return;
        }
        b.rider = true;
        g.boat = b;
        g.player.eyeSmooth = 0;
        g.ui.toast("W / S to row, A / D to turn, Shift to get out");
    }

    dismount() {
        const g = this.game, b = g.boat;
        if (!b) {
            return;
        }
        b.rider = false;
        g.boat = null;
        const w = g.world, p = g.player;
        //Step onto the nearest dry spot beside the boat, else on top of it
        const fx = Math.floor(b.x), fz = Math.floor(b.z);
        let best = null;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                for (let y = Math.floor(b.y) + 1; y >= Math.floor(b.y) - 1; y--) {
                    const x = fx + dx, z = fz + dz;
                    const below = w.getBlock(x, y - 1, z);
                    if (!BLOCKS[below].solid || BLOCKS[w.getBlock(x, y, z)].solid || BLOCKS[w.getBlock(x, y + 1, z)].solid ||
                        w.getBlock(x, y, z) === B.WATER || w.getBlock(x, y, z) === B.LAVA) {
                        continue;
                    }
                    const d = Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z) + Math.abs(y - b.y) * 0.5;
                    if (!best || d < best.d) {
                        best = { x, y, z, d };
                    }
                    break;
                }
            }
        }
        if (best) {
            p.setPos(best.x + 0.5, best.y, best.z + 0.5);
        } else {
            p.setPos(b.x, b.y + HEIGHT + 0.05, b.z);
        }
    }

    /* ---------------- per frame ---------------- */

    //The water in one column under the boat, near its hull: the top of the
    //surface there and that block, whether it is lava, and `falling` when
    //it is a waterfall - falling water (meta 8) with water or air under it,
    //or water draining into such falling water. Falling water lying on the
    //bottom of a pool or pit is not a waterfall.
    columnAt(b, bx, bz) {
        const w = this.game.world;
        for (const by of [Math.floor(b.y + DRAFT + 0.05), Math.floor(b.y + DRAFT + 0.05) - 1]) {
            const id = w.getBlock(bx, by, bz);
            if (id !== B.WATER && id !== B.LAVA) {
                continue;
            }
            const lava = id === B.LAVA;
            const falls = (y) => w.getBlock(bx, y, bz) === id && w.getMeta(bx, y, bz) === 8 &&
                (w.getBlock(bx, y - 1, bz) === id || !SOLID[w.getBlock(bx, y - 1, bz)]);
            if (falls(by) || falls(by - 1)) {
                return { falling: true, lava };
            }
            //Under water: rise to the top of the column, but not up into a
            //waterfall pouring onto it
            let top = by;
            while (top - by < 8 && w.getBlock(bx, top + 1, bz) === id && !falls(top + 1)) {
                top++;
            }
            return { y: top + waterHeight(w.getMeta(bx, top, bz), false), lava, cell: [bx, top, bz] };
        }
        return null;
    }

    //The water the boat is in (null when it is not on water). The middle of
    //the hull decides waterfalls and lava; otherwise the highest surface
    //under the middle or a corner holds it up, so a boat resting on a rim
    //over water still floats, and `cells` lists every column of that surface
    //under the hull for the current
    surface(b) {
        const mid = this.columnAt(b, Math.floor(b.x), Math.floor(b.z));
        if (mid && (mid.falling || mid.lava)) {
            return mid;
        }
        const found = mid ? [mid] : [];
        //Without water under the middle (resting on a rim), the hull slips
        //off toward the corners that are over water
        let sx = 0, sz = 0;
        for (const [ox, oz] of PROBES) {
            const s = this.columnAt(b, Math.floor(b.x + ox), Math.floor(b.z + oz));
            if (s && !s.falling && !s.lava) {
                found.push(s);
                sx += ox;
                sz += oz;
            }
        }
        if (!found.length) {
            return null;
        }
        const best = found.reduce((a, c) => (c.y > a.y ? c : a));
        best.slip = !mid && Math.hypot(sx, sz) > 0.01 ? [sx / Math.hypot(sx, sz), sz / Math.hypot(sx, sz)] : null;
        const seen = new Set();
        best.cells = found.filter((c) => {
            const k = c.cell.join(",");
            if (seen.has(k) || best.y - c.y > 0.3) {
                return false;
            }
            seen.add(k);
            return true;
        }).map((c) => c.cell);
        return best;
    }

    //Velocity of the water a floating boat is in: the current under its
    //hull, or out from under a waterfall that lands where it floats
    current(b, s) {
        const w = this.game.world;
        let fx = 0, fz = 0;
        for (const [x, y, z] of s.cells) {
            const f = w.liquidFlow(x, y, z);
            fx += f[0];
            fz += f[1];
        }
        fx /= s.cells.length;
        fz /= s.cells.length;
        if (s.slip) {
            return [(fx + s.slip[0]) * CURRENT, (fz + s.slip[1]) * CURRENT];
        }
        const [x, y, z] = s.cell;
        if (Math.hypot(fx, fz) < 0.05 && w.getBlock(x, y + 1, z) === w.getBlock(x, y, z)) {
            let dx = b.x - (x + 0.5), dz = b.z - (z + 0.5);
            let l = Math.hypot(dx, dz);
            if (l < 0.05) {
                dx = -Math.sin(b.yaw);
                dz = -Math.cos(b.yaw);
                l = 1;
            }
            return [dx / l * CURRENT, dz / l * CURRENT];
        }
        return [fx * CURRENT, fz * CURRENT];
    }

    //input: the rider's movement input (forward, strafe, sneak)
    update(dt, input) {
        const g = this.game;
        if (g.boat && input && input.sneak) {
            this.dismount();
        }
        let rem = Math.min(dt, 0.1);
        while (rem > 1e-4) {
            const h = Math.min(rem, 1 / 60);
            rem -= h;
            for (let i = this.list.length - 1; i >= 0; i--) {
                const b = this.list[i];
                b.hitCd = Math.max(0, b.hitCd - h);
                this.step(b, h, b.rider ? input : null);
            }
            this.collide();
        }
        for (const b of this.list) {
            this.pose(b, dt);
        }
    }

    step(b, h, input) {
        const g = this.game, w = g.world;
        if (!w.isLoaded(Math.floor(b.x), Math.floor(b.z))) {
            return;
        }
        const s = this.surface(b);
        if (s && s.lava) {
            //Burns up with whatever it carried
            g.sound.play("fizz");
            this.breakBoat(b, false);
            return;
        }
        b.inWater = !!s;
        //Float: spring toward the surface, damped; go down a waterfall at
        //its speed; otherwise fall. cw: the water's own velocity.
        let cw = [0, 0];
        if (s && s.falling) {
            b.vy = Math.max(b.vy - 30 * h, -FALL_SPEED);
        } else if (s) {
            b.vy += ((s.y - DRAFT) - b.y) * 40 * h;
            b.vy *= Math.exp(-6 * h);
            cw = this.current(b, s);
        } else {
            b.vy -= 28 * h;
            b.vy = Math.max(b.vy, -40);
        }
        //Rowing and turning, relative to the water: an empty boat drifts
        //with the current, and the keel damps sliding across it
        const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
        const rx = b.vx - cw[0], rz = b.vz - cw[1];
        let along = rx * fx + rz * fz;
        let side = rx * fz - rz * fx;
        const fwd = input ? input.forward : 0, turn = input ? input.strafe : 0;
        if (turn) {
            const d = turn * TURN * h * (b.inWater || !b.onGround ? 1 : 0.5);
            b.yaw -= d;
            g.player.yaw -= d;
        }
        if (b.inWater) {
            along += (fwd > 0 ? THRUST : BACK_THRUST) * fwd * h;
            along = Math.max(-MAX_BACK, Math.min(MAX_FWD, along));
            along *= Math.exp(-(fwd ? 0.25 : 0.6) * h);
            side *= Math.exp(-4 * h);
        } else if (b.onGround) {
            along += LAND_THRUST * fwd * h;
            along = Math.max(-LAND_MAX, Math.min(LAND_MAX, along));
            along *= Math.exp(-5 * h);
            side *= Math.exp(-8 * h);
        }
        b.row = fwd;
        const nfx = -Math.sin(b.yaw), nfz = -Math.cos(b.yaw);
        b.vx = cw[0] + nfx * along + nfz * side;
        b.vz = cw[1] + nfz * along - nfx * side;
        //Move against the blocks
        const box = this.box(b);
        const dy = b.vy * h;
        const my = moveAxis(w, box, 1, dy);
        b.onGround = dy < 0 && my > dy + 1e-6;
        if (my !== dy) {
            b.vy = 0;
        }
        if (Math.abs(moveAxis(w, box, 0, b.vx * h) - b.vx * h) > 1e-6) {
            b.vx = 0;
        }
        if (Math.abs(moveAxis(w, box, 2, b.vz * h) - b.vz * h) > 1e-6) {
            b.vz = 0;
        }
        b.x = (box[0] + box[3]) / 2;
        b.y = box[1];
        b.z = (box[2] + box[5]) / 2;
        //A player walking into an empty boat nudges it
        const p = g.player;
        if (!b.rider && g.boat !== b) {
            const pb = p.box();
            if (pb[0] < box[3] && pb[3] > box[0] && pb[2] < box[5] && pb[5] > box[2] && pb[1] < box[4] && pb[4] > box[1]) {
                const dx = b.x - p.x, dz = b.z - p.z, l = Math.hypot(dx, dz) || 1;
                b.vx += dx / l * 6 * h;
                b.vz += dz / l * 6 * h;
            }
        }
    }

    //Boats bump into each other
    collide() {
        const L = this.list;
        for (let i = 0; i < L.length; i++) {
            for (let j = i + 1; j < L.length; j++) {
                const a = L[i], b = L[j];
                const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
                if (d >= 1.1 || d < 1e-4 || Math.abs(a.y - b.y) > 0.6) {
                    continue;
                }
                const nx = dx / d, nz = dz / d;
                const va = a.vx * nx + a.vz * nz, vb = b.vx * nx + b.vz * nz;
                if (va - vb > 0) {
                    a.vx += (vb - va) * nx;
                    a.vz += (vb - va) * nz;
                    b.vx += (va - vb) * nx;
                    b.vz += (va - vb) * nz;
                }
                const push = (1.1 - d) / 2;
                a.x -= nx * push;
                a.z -= nz * push;
                b.x += nx * push;
                b.z += nz * push;
            }
        }
    }

    pose(b, dt) {
        const g = this.game, m = b.model;
        b.bob += dt;
        const bob = b.inWater ? Math.sin(b.bob * 1.8) * 0.025 : 0;
        const roll = b.inWater ? Math.sin(b.bob * 1.3) * 0.03 : 0;
        m.group.position.set(b.x, b.y + bob, b.z);
        m.group.rotation.set(0, b.yaw, 0);
        m.hull.rotation.set(0, 0, roll);
        //Oars sweep while rowing, rest along the sides otherwise
        if (b.row) {
            b.rowPhase += dt * 6 * Math.sign(b.row);
            b.splash -= dt;
            if (b.inWater && b.splash <= 0) {
                b.splash = Math.PI * 2 / 6;
                if (b.rider) {
                    g.sound.play("paddle");
                }
            }
        }
        for (const o of m.oars) {
            const sweep = b.row ? Math.sin(b.rowPhase) * 0.7 : 0;
            const dip = b.row ? 0.35 + Math.cos(b.rowPhase) * 0.2 : 0.55;
            o.pivot.rotation.set(0, sweep * -o.side + (b.row ? 0 : 0.2 * o.side), dip * o.side, "ZYX");
        }
        const w = g.world;
        const fx = Math.floor(b.x), fy = Math.floor(b.y + 0.6), fz = Math.floor(b.z);
        const sky = w.getSky(fx, fy, fz) / 15, blk = Math.max(w.getBlockLight(fx, fy, fz), this.renderer.dyn.at(fx, fy, fz)) / 15;
        const bright = this.renderer.objectLight(sky, blk);
        for (const mat of m.mats) {
            mat.color.copy(mat.userData.base).multiplyScalar(bright);
        }
    }

    //Where the rider sits
    seat(b) {
        return [b.x, b.y - 0.12, b.z];
    }

    /* ---------------- save data ---------------- */

    serialize() {
        return this.list.map((b) => ({ x: b.x, y: b.y, z: b.z, vx: b.vx, vz: b.vz, yaw: b.yaw }));
    }

    load(list) {
        if (!Array.isArray(list)) {
            return;
        }
        for (const d of list) {
            if (Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)) {
                this.spawn(d.x, d.y, d.z, d);
            }
        }
    }
}
