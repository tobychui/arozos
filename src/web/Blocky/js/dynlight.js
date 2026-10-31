//Held light: a torch (or anything that glows) in the player's hand lights
//the blocks around them. The light is flooded from the player's head
//through the world like block light (one level lost per block, stopped by
//opaque blocks), into a small grid around the player that the terrain
//shader samples. Nothing is written into the world's own light.
import * as THREE from "three";
import { LIGHT_OPACITY, SHAPE } from "./blocks.js";

export const DYN_SIZE = 32;
const N = DYN_SIZE, HALF = N / 2;
const REFRESH = 0.25;

export class DynLight {
    constructor() {
        this.levels = new Uint8Array(N * N * N);
        this.data = new Uint8Array(N * N * N);
        this.tex = new THREE.Data3DTexture(this.data, N, N, N);
        this.tex.format = THREE.RedFormat;
        this.tex.type = THREE.UnsignedByteType;
        this.tex.minFilter = THREE.LinearFilter;
        this.tex.magFilter = THREE.LinearFilter;
        this.tex.wrapS = this.tex.wrapT = this.tex.wrapR = THREE.ClampToEdgeWrapping;
        this.tex.unpackAlignment = 1;
        this.tex.needsUpdate = true;
        //x, y, z of the grid's first cell; w = 1 while a light is held
        this.uniform = new THREE.Vector4(0, 0, 0, 0);
        this.queue = new Int32Array(N * N * N);
        this.level = 0;
        this.key = "";
        this.age = 0;
    }

    //Light level at a world cell (0 when nothing is held or out of reach)
    at(x, y, z) {
        if (!this.level) {
            return 0;
        }
        const ix = x - this.uniform.x, iy = y - this.uniform.y, iz = z - this.uniform.z;
        if (ix < 0 || iy < 0 || iz < 0 || ix >= N || iy >= N || iz >= N) {
            return 0;
        }
        return this.levels[ix + iy * N + iz * N * N];
    }

    //Called every frame. level is the held item's light (0 for none)
    update(world, x, y, z, level, dt) {
        const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
        const key = cx + "," + cy + "," + cz + "," + level;
        this.age += dt;
        //Blocks change under the light, so refresh it now and then too
        if (key === this.key && (this.age < REFRESH || !level)) {
            return;
        }
        this.key = key;
        this.age = 0;
        this.level = level;
        if (!level) {
            this.uniform.w = 0;
            return;
        }
        this.uniform.set(cx - HALF, cy - HALF, cz - HALF, 1);
        this.flood(world, cx - HALF, cy - HALF, cz - HALF, level);
    }

    flood(world, ox, oy, oz, level) {
        const lv = this.levels, q = this.queue;
        lv.fill(0);
        //255 = opaque, 0 = open, else extra opacity (water, leaves)
        const block = new Uint8Array(N * N * N);
        for (let iz = 0; iz < N; iz++) {
            for (let iy = 0; iy < N; iy++) {
                for (let ix = 0; ix < N; ix++) {
                    const id = world.getBlock(ox + ix, oy + iy, oz + iz);
                    let o = LIGHT_OPACITY[id];
                    if (o === 0 && SHAPE[id] === "slab" && world.getMeta(ox + ix, oy + iy, oz + iz) === 2) {
                        o = 15;
                    }
                    block[ix + iy * N + iz * N * N] = o >= 15 ? 255 : o;
                }
            }
        }
        const start = HALF + HALF * N + HALF * N * N;
        lv[start] = level;
        let head = 0, tail = 0;
        q[tail++] = start;
        while (head < tail) {
            const i = q[head++];
            const l = lv[i];
            if (l <= 1) {
                continue;
            }
            const ix = i % N, iy = ((i / N) | 0) % N, iz = (i / (N * N)) | 0;
            for (let d = 0; d < 6; d++) {
                let j;
                if (d === 0) {
                    if (ix === N - 1) { continue; }
                    j = i + 1;
                } else if (d === 1) {
                    if (ix === 0) { continue; }
                    j = i - 1;
                } else if (d === 2) {
                    if (iy === N - 1) { continue; }
                    j = i + N;
                } else if (d === 3) {
                    if (iy === 0) { continue; }
                    j = i - N;
                } else if (d === 4) {
                    if (iz === N - 1) { continue; }
                    j = i + N * N;
                } else {
                    if (iz === 0) { continue; }
                    j = i - N * N;
                }
                const o = block[j];
                if (o === 255) {
                    continue;
                }
                const nl = l - 1 - o;
                if (nl > lv[j]) {
                    lv[j] = nl;
                    q[tail++] = j;
                }
            }
        }
        //The shader blends neighbouring cells; give opaque cells the light
        //of the open cell beside them so faces do not darken toward edges
        const out = this.data;
        for (let i = 0; i < out.length; i++) {
            let l = lv[i];
            if (block[i] === 255) {
                const ix = i % N, iy = ((i / N) | 0) % N, iz = (i / (N * N)) | 0;
                if (ix > 0) { l = Math.max(l, lv[i - 1]); }
                if (ix < N - 1) { l = Math.max(l, lv[i + 1]); }
                if (iy > 0) { l = Math.max(l, lv[i - N]); }
                if (iy < N - 1) { l = Math.max(l, lv[i + N]); }
                if (iz > 0) { l = Math.max(l, lv[i - N * N]); }
                if (iz < N - 1) { l = Math.max(l, lv[i + N * N]); }
                l = Math.max(0, l - 1);
            }
            out[i] = l * 17;
        }
        this.tex.needsUpdate = true;
    }
}
