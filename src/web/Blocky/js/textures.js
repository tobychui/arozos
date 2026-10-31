/*
    Blocky - textures.js

    Every texture in the game is painted here at start up: 16x16 pixel art
    tiles for blocks and items, the block breaking crack stages, and the
    isometric inventory icons. Nothing is loaded from image files, so the
    look is entirely Blocky's own.

    Output:
        layers      - Uint8Array of all tiles stacked (RGBA, 16x16 each),
                      uploaded as one texture array by the renderer
        layerOf     - tile name -> layer index
        canvases    - tile name -> 16x16 canvas (for icons and particles)
        avgColor    - tile name -> [r, g, b] average of the opaque pixels
*/

import { mulberry32 } from "./util.js";

const S = 16;

//Grassland tints, also used to colour the inventory icons of tinted tiles
export const GRASS_TINT = [0.62, 1.0, 0.43];
export const FOLIAGE_TINT = [0.48, 0.86, 0.32];

class Tile {
    constructor(seed) {
        this.d = new Uint8ClampedArray(S * S * 4);
        this.rnd = mulberry32(seed);
    }
    r() {
        return this.rnd();
    }
    ri(n) {
        return Math.floor(this.rnd() * n);
    }
    set(x, y, c, a = 255) {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || y < 0 || x >= S || y >= S) {
            return;
        }
        const i = (y * S + x) * 4;
        this.d[i] = c[0];
        this.d[i + 1] = c[1];
        this.d[i + 2] = c[2];
        this.d[i + 3] = a;
    }
    get(x, y) {
        const i = (y * S + x) * 4;
        return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
    }
    alpha(x, y) {
        return this.d[(y * S + x) * 4 + 3];
    }
    vary(c, v) {
        const k = (this.rnd() - 0.5) * 2 * v;
        return [c[0] + k, c[1] + k, c[2] + k];
    }
    fill(c, v = 0) {
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                this.set(x, y, this.vary(c, v));
            }
        }
    }
    clear() {
        this.d.fill(0);
    }
    shade(x, y, f) {
        if (x < 0 || y < 0 || x >= S || y >= S) {
            return;
        }
        const i = (y * S + x) * 4;
        this.d[i] *= f;
        this.d[i + 1] *= f;
        this.d[i + 2] *= f;
    }
    rect(x0, y0, w, h, c, v = 0, a = 255) {
        for (let y = y0; y < y0 + h; y++) {
            for (let x = x0; x < x0 + w; x++) {
                this.set(x, y, this.vary(c, v), a);
            }
        }
    }
    border(c, v = 0) {
        for (let i = 0; i < S; i++) {
            this.set(i, 0, this.vary(c, v));
            this.set(i, S - 1, this.vary(c, v));
            this.set(0, i, this.vary(c, v));
            this.set(S - 1, i, this.vary(c, v));
        }
    }
    copy(other) {
        this.d.set(other.d);
    }
    //Paint every pixel for which pred(x + 0.5, y + 0.5) is true
    shape(pred, colorFn) {
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                if (pred(x + 0.5, y + 0.5)) {
                    this.set(x, y, colorFn(x, y));
                }
            }
        }
    }
    //Darken opaque pixels that touch a transparent pixel (item outlines)
    outline(f = 0.55) {
        const edge = [];
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                if (this.alpha(x, y) === 0) {
                    continue;
                }
                const out = (xx, yy) => xx < 0 || yy < 0 || xx >= S || yy >= S || this.alpha(xx, yy) === 0;
                if (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1)) {
                    edge.push([x, y]);
                }
            }
        }
        for (const [x, y] of edge) {
            this.shade(x, y, f);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Block tiles                                                         */
/* ------------------------------------------------------------------ */

function paintStone(t) {
    t.fill([127, 127, 127], 9);
    for (let k = 0; k < 8; k++) {
        const x = t.ri(16), y = t.ri(16), len = 2 + t.ri(4);
        for (let i = 0; i < len; i++) {
            t.set((x + i) % 16, y + (i > 1 && t.r() < 0.3 ? 1 : 0), t.vary([104, 104, 104], 5));
        }
    }
    for (let k = 0; k < 10; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([150, 150, 150], 6));
    }
}

function wrapDist(ax, ay, bx, by) {
    let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    dx = Math.min(dx, 16 - dx);
    dy = Math.min(dy, 16 - dy);
    return Math.sqrt(dx * dx + dy * dy);
}

function paintCobble(t, base = [128, 128, 128], spread = 28) {
    const pts = [];
    for (let i = 0; i < 11; i++) {
        pts.push([t.r() * 16, t.r() * 16, (t.r() - 0.5) * spread]);
    }
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let d1 = 99, d2 = 99, cell = 0;
            for (let i = 0; i < pts.length; i++) {
                const d = wrapDist(x + 0.5, y + 0.5, pts[i][0], pts[i][1]);
                if (d < d1) {
                    d2 = d1; d1 = d; cell = i;
                } else if (d < d2) {
                    d2 = d;
                }
            }
            if (d2 - d1 < 1.0) {
                t.set(x, y, t.vary([base[0] * 0.55, base[1] * 0.55, base[2] * 0.55], 6));
            } else {
                const k = pts[cell][2] + (d1 < 1.6 ? 12 : 0);
                t.set(x, y, t.vary([base[0] + k, base[1] + k, base[2] + k], 8));
            }
        }
    }
}

function paintDirt(t) {
    t.fill([134, 96, 67], 10);
    for (let k = 0; k < 22; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([104, 74, 50], 6));
    }
    for (let k = 0; k < 12; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([162, 120, 86], 6));
    }
}

function paintSand(t) {
    t.fill([219, 207, 163], 6);
    for (let k = 0; k < 16; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([198, 184, 138], 5));
    }
    for (let k = 0; k < 10; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([234, 226, 192], 4));
    }
}

function paintOre(t, color, clusters) {
    paintStone(t);
    for (let c = 0; c < clusters; c++) {
        const cx = 2 + t.ri(12), cy = 2 + t.ri(12);
        const n = 3 + t.ri(3);
        for (let i = 0; i < n; i++) {
            const x = cx + t.ri(3) - 1, y = cy + t.ri(3) - 1;
            t.set(x, y, t.vary(color, 12));
            if (t.r() < 0.5) {
                t.set(x + 1, y, t.vary([color[0] * 0.7, color[1] * 0.7, color[2] * 0.7], 8));
            }
        }
        t.set(cx, cy, [Math.min(255, color[0] + 40), Math.min(255, color[1] + 40), Math.min(255, color[2] + 40)]);
    }
}

function paintPlanks(t, base = [168, 134, 82]) {
    for (let b = 0; b < 4; b++) {
        const f = 0.9 + t.r() * 0.16;
        const seam = (b * 7 + 3) % 16;
        for (let yy = 0; yy < 4; yy++) {
            const y = b * 4 + yy;
            for (let x = 0; x < 16; x++) {
                let c = [base[0] * f, base[1] * f, base[2] * f];
                if (yy === 3) {
                    c = [base[0] * 0.62, base[1] * 0.62, base[2] * 0.6];
                } else if (x === seam) {
                    c = [base[0] * 0.7, base[1] * 0.7, base[2] * 0.68];
                } else if (t.r() < 0.12) {
                    c = [c[0] * 0.88, c[1] * 0.88, c[2] * 0.88];
                }
                t.set(x, y, t.vary(c, 4));
            }
        }
    }
}

function paintLogSide(t) {
    const base = [104, 82, 52];
    for (let x = 0; x < 16; x++) {
        const f = 0.82 + t.r() * 0.3;
        for (let y = 0; y < 16; y++) {
            t.set(x, y, t.vary([base[0] * f, base[1] * f, base[2] * f], 6));
        }
    }
    for (let k = 0; k < 9; k++) {
        const x = t.ri(16), y = t.ri(16), len = 3 + t.ri(5);
        for (let i = 0; i < len; i++) {
            t.set(x, (y + i) % 16, t.vary([68, 52, 32], 5));
        }
    }
}

function paintLogTop(t) {
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const dx = x - 7.5, dy = y - 7.5;
            const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.sqrt(dx * dx + dy * dy) * 0.45;
            if (d > 6.7) {
                t.set(x, y, t.vary([100, 79, 50], 8));
            } else {
                const ring = Math.floor(d * 1.15) % 2;
                t.set(x, y, t.vary(ring ? [184, 150, 94] : [160, 128, 78], 5));
            }
        }
    }
}

function paintLeaves(t) {
    t.fill([150, 150, 150], 24);
    for (let k = 0; k < 26; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([104, 104, 104], 10));
    }
    for (let k = 0; k < 10; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([196, 196, 196], 8));
    }
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            if (t.r() < 0.16) {
                t.set(x, y, [0, 0, 0], 0);
            }
        }
    }
}

function paintGlass(t) {
    t.clear();
    for (let i = 0; i < 16; i++) {
        t.set(i, 0, [214, 234, 240]);
        t.set(i, 15, [190, 214, 222]);
        t.set(0, i, [214, 234, 240]);
        t.set(15, i, [190, 214, 222]);
    }
    for (let i = 0; i < 4; i++) {
        t.set(3 + i, 6 - i, [236, 250, 255], 230);
    }
    t.set(11, 11, [236, 250, 255], 210);
    t.set(12, 10, [236, 250, 255], 210);
}

function paintBricks(t) {
    t.fill([176, 170, 164], 5);
    for (let row = 0; row < 4; row++) {
        const off = (row % 2) * 4;
        for (let b = 0; b < 3; b++) {
            const bx = off + b * 8;
            const tone = t.vary([150, 72, 56], 14);
            for (let yy = 0; yy < 3; yy++) {
                for (let xx = 0; xx < 7; xx++) {
                    let c = t.vary(tone, 6);
                    if (yy === 0) {
                        c = [c[0] + 16, c[1] + 10, c[2] + 8];
                    }
                    t.set((bx + xx) % 16, row * 4 + yy, c);
                }
            }
        }
    }
}

function paintStoneBricks(t) {
    t.fill([124, 124, 124], 7);
    for (let x = 0; x < 16; x++) {
        t.set(x, 7, t.vary([82, 82, 82], 4));
        t.set(x, 15, t.vary([82, 82, 82], 4));
        t.set(x, 0, t.vary([150, 150, 150], 4));
        t.set(x, 8, t.vary([150, 150, 150], 4));
        t.set(x, 6, t.vary([108, 108, 108], 4));
        t.set(x, 14, t.vary([108, 108, 108], 4));
    }
    for (let y = 0; y < 8; y++) {
        t.set(15, y, t.vary([82, 82, 82], 4));
        t.set(7, y + 8, t.vary([82, 82, 82], 4));
        t.set(0, y, t.vary([140, 140, 140], 4));
        t.set(8, y + 8, t.vary([140, 140, 140], 4));
    }
}

function paintSmoothStone(t, sideSplit) {
    t.fill([164, 164, 164], 4);
    t.border([118, 118, 118], 3);
    if (sideSplit) {
        for (let x = 0; x < 16; x++) {
            t.set(x, 7, t.vary([118, 118, 118], 3));
            t.set(x, 8, t.vary([180, 180, 180], 3));
        }
    }
}

function paintMetal(t, base, edge, dark) {
    t.fill(base, 4);
    t.border(edge, 3);
    for (let i = 1; i < 15; i++) {
        t.set(i, 1, [Math.min(255, base[0] + 25), Math.min(255, base[1] + 25), Math.min(255, base[2] + 25)]);
        t.set(1, i, [Math.min(255, base[0] + 25), Math.min(255, base[1] + 25), Math.min(255, base[2] + 25)]);
        t.set(i, 14, dark);
        t.set(14, i, dark);
    }
    for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]]) {
        t.set(x, y, dark);
    }
}

function paintFurnaceSide(t) {
    t.fill([118, 118, 118], 7);
    for (let k = 0; k < 12; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([98, 98, 98], 5));
    }
    t.border([84, 84, 84], 4);
}

function paintFurnaceFront(t, lit) {
    paintFurnaceSide(t);
    for (let x = 3; x < 13; x++) {
        t.set(x, 7, [80, 80, 80]);
    }
    for (let y = 8; y < 14; y++) {
        for (let x = 4; x < 12; x++) {
            if (!lit) {
                t.set(x, y, t.vary([28, 28, 30], 4));
            } else {
                const heat = (y - 8) / 6;
                const flick = t.r();
                const c = flick < 0.3 ? [255, 236, 140] : [255, 150 + heat * 60, 40 + heat * 20];
                t.set(x, y, t.vary(c, 10));
            }
        }
    }
    for (let x = 4; x < 12; x += 2) {
        t.set(x, 3, [70, 70, 70]);
        t.set(x, 4, [70, 70, 70]);
    }
}

function paintChest(t, kind) {
    paintPlanks(t, [160, 112, 52]);
    t.border([88, 60, 28], 4);
    if (kind !== "top") {
        for (let x = 0; x < 16; x++) {
            t.set(x, 5, [88, 60, 28]);
            t.set(x, 6, [118, 82, 40]);
        }
    }
    if (kind === "front") {
        t.rect(7, 4, 2, 4, [205, 205, 205]);
        t.set(7, 7, [120, 120, 120]);
        t.set(8, 7, [120, 120, 120]);
    }
}

function paintWorkbench(t, kind) {
    paintPlanks(t);
    if (kind === "top") {
        t.border([96, 70, 40], 3);
        t.rect(2, 2, 12, 12, [150, 116, 70], 5);
        for (let i = 2; i < 14; i++) {
            t.set(i, 6, [112, 84, 50]);
            t.set(i, 10, [112, 84, 50]);
            t.set(6, i, [112, 84, 50]);
            t.set(10, i, [112, 84, 50]);
        }
        return;
    }
    for (let x = 0; x < 16; x++) {
        t.set(x, 0, [96, 70, 40]);
        t.set(x, 1, [120, 90, 54]);
    }
    if (kind === "side") {
        //Hammer
        t.rect(2, 4, 5, 2, [150, 150, 154]);
        t.rect(4, 6, 1, 6, [96, 66, 34]);
        //Saw blade with teeth
        for (let y = 4; y < 11; y++) {
            for (let x = 9; x < 9 + Math.max(1, y - 3); x++) {
                t.set(x, y, [182, 184, 190]);
            }
            t.set(9 + Math.max(1, y - 3), y, (y % 2) ? [120, 122, 128] : [182, 184, 190]);
        }
        t.rect(8, 3, 2, 2, [110, 76, 40]);
    } else {
        t.rect(3, 5, 10, 7, [112, 84, 50]);
        t.rect(4, 6, 8, 5, [150, 116, 70], 4);
        t.rect(7, 8, 2, 1, [70, 50, 28]);
    }
}

function paintCactus(t, kind) {
    if (kind === "side") {
        t.fill([70, 138, 54], 6);
        for (let y = 0; y < 16; y++) {
            for (const x of [0, 5, 10, 15]) {
                t.set(x, y, t.vary([48, 106, 38], 4));
            }
            if (y % 4 === 1) {
                for (const x of [2, 7, 12]) {
                    t.set(x, y, [214, 226, 176]);
                }
            }
        }
        return;
    }
    t.fill([84, 150, 62], 5);
    t.border([52, 108, 40], 3);
    for (let y = 4; y < 12; y++) {
        for (let x = 4; x < 12; x++) {
            if (x === 4 || x === 11 || y === 4 || y === 11) {
                t.set(x, y, [62, 124, 48]);
            }
        }
    }
    t.set(7, 7, [140, 190, 110]);
    t.set(8, 8, [140, 190, 110]);
    if (kind === "bottom") {
        for (let i = 0; i < 16 * 16; i++) {
            t.d[i * 4] *= 0.8;
            t.d[i * 4 + 1] *= 0.8;
            t.d[i * 4 + 2] *= 0.8;
        }
    }
}

function paintFarmland(t, wet) {
    const base = wet ? [86, 58, 38] : [124, 88, 60];
    t.fill(base, 7);
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            if (y % 4 === 0) {
                t.set(x, y, t.vary([base[0] * 0.72, base[1] * 0.72, base[2] * 0.72], 4));
            } else if (y % 4 === 1) {
                t.set(x, y, t.vary([base[0] * 1.15, base[1] * 1.15, base[2] * 1.15], 4));
            }
        }
    }
}

function paintGrassBlades(t, gray) {
    t.clear();
    for (let b = 0; b < 8; b++) {
        const x0 = 1 + t.ri(14);
        const h = 6 + t.ri(9);
        const lean = (t.r() - 0.5) * 0.5;
        const c = gray ? t.vary([176, 176, 176], 30) : t.vary([90, 150, 60], 20);
        for (let i = 0; i < h; i++) {
            const y = 15 - i;
            const x = x0 + lean * i;
            t.set(x, y, i > h - 3 ? [c[0] * 1.12, c[1] * 1.12, c[2] * 1.12] : c);
        }
    }
}

function paintFlower(t, petal, center) {
    t.clear();
    for (let y = 8; y < 16; y++) {
        t.set(7, y, [62, 136, 42]);
    }
    t.set(6, 12, [74, 156, 50]);
    t.set(5, 11, [74, 156, 50]);
    t.set(8, 11, [74, 156, 50]);
    t.set(9, 10, [74, 156, 50]);
    for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [-1, 0], [1, 0], [0, 1]]) {
        t.set(7 + dx, 5 + dy, t.vary(petal, 10));
    }
    t.set(7, 5, center);
}

function paintMushroom(t, cap, spots) {
    t.clear();
    t.rect(7, 10, 2, 5, [222, 212, 192], 6);
    for (let y = 5; y < 10; y++) {
        const half = y === 5 ? 2 : y === 6 ? 3 : 4;
        for (let x = 8 - half; x < 8 + half; x++) {
            const c = y < 7 ? [cap[0] * 1.15, cap[1] * 1.15, cap[2] * 1.15] : cap;
            t.set(x, y, t.vary(c, 8));
        }
    }
    if (spots) {
        for (const [x, y] of [[6, 6], [9, 7], [5, 8], [10, 8]]) {
            t.set(x, y, [240, 236, 228]);
        }
    }
}

function paintReeds(t) {
    t.clear();
    for (const x0 of [2, 7, 12]) {
        const off = t.ri(5);
        for (let y = 0; y < 16; y++) {
            const joint = (y + off) % 5 === 0;
            t.set(x0, y, joint ? [196, 226, 150] : t.vary([150, 200, 100], 8));
            t.set(x0 + 1, y, joint ? [160, 196, 116] : t.vary([116, 166, 72], 8));
        }
        t.set(x0 - 1, 4 + off, [110, 170, 70]);
        t.set(x0 + 2, 9 + off % 3, [110, 170, 70]);
    }
}

function paintWheat(t, stage) {
    t.clear();
    const h = 2 + Math.round(stage * 1.75);
    const ripe = stage / 7;
    const stalk = [80 + 130 * ripe, 168 + 10 * ripe, 40 + 30 * ripe];
    for (const x0 of [1, 4, 7, 10, 13]) {
        const hh = h - t.ri(2);
        for (let i = 0; i < hh; i++) {
            t.set(x0 + (i > hh * 0.6 ? 1 : 0), 15 - i, t.vary(stalk, 10));
        }
        if (stage >= 5) {
            for (let i = 0; i < 3; i++) {
                t.set(x0 + 1, 15 - hh + i, t.vary([214 + 20 * ripe, 180, 70], 10));
                t.set(x0 + 2, 15 - hh + i + 1, t.vary([200, 168, 64], 10));
            }
        }
    }
}

function paintSapling(t) {
    t.clear();
    t.rect(7, 9, 2, 7, [104, 76, 44], 6);
    for (let y = 1; y < 11; y++) {
        for (let x = 2; x < 14; x++) {
            const dx = x - 7.5, dy = (y - 5.5) * 1.2;
            if (dx * dx + dy * dy < 22 && t.r() > 0.18) {
                t.set(x, y, t.vary([58, 132, 44], 18));
            }
        }
    }
}

function paintDeadBush(t) {
    t.clear();
    const twig = (x, y, dx, len) => {
        for (let i = 0; i < len; i++) {
            t.set(x + dx * i, y - i, [124, 88, 48]);
        }
    };
    twig(7, 15, 0, 6);
    twig(7, 11, -0.6, 7);
    twig(8, 12, 0.7, 7);
    twig(7, 9, 0.3, 6);
    twig(4, 8, -0.4, 3);
    twig(11, 9, 0.5, 3);
}

function paintWater(t) {
    t.fill([52, 98, 212], 8);
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const w = Math.sin((x + y * 0.5) * 0.8) + Math.sin((x * 0.5 - y) * 0.9);
            if (w > 1.3) {
                t.set(x, y, t.vary([96, 146, 236], 6));
            }
        }
    }
    for (let i = 0; i < S * S; i++) {
        t.d[i * 4 + 3] = 178;
    }
}

function paintLadder(t) {
    t.clear();
    for (let y = 0; y < 16; y++) {
        t.set(2, y, [126, 94, 52]);
        t.set(3, y, [100, 72, 40]);
        t.set(12, y, [126, 94, 52]);
        t.set(13, y, [100, 72, 40]);
    }
    for (const y of [2, 7, 12]) {
        for (let x = 4; x < 12; x++) {
            t.set(x, y, [146, 110, 64]);
            t.set(x, y + 1, [110, 80, 46]);
        }
    }
}

function paintTorch(t) {
    t.clear();
    for (let y = 9; y < 16; y++) {
        t.set(7, y, [138, 102, 54]);
        t.set(8, y, [104, 76, 40]);
    }
    t.set(7, 6, [255, 196, 70]);
    t.set(8, 6, [255, 170, 50]);
    t.set(7, 7, [255, 248, 196]);
    t.set(8, 7, [255, 226, 120]);
    t.set(7, 8, [255, 204, 90]);
    t.set(8, 8, [240, 150, 40]);
}

function paintLamp(t) {
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
            t.set(x, y, t.vary(d < 3 ? [255, 246, 212] : [255, 222, 146], 6));
        }
    }
    t.border([122, 94, 58], 4);
    for (let i = 1; i < 15; i++) {
        t.set(i, 7, [122, 94, 58]);
        t.set(7, i, [122, 94, 58]);
    }
}

function paintCrystalBlock(t) {
    t.fill([104, 224, 220], 6);
    for (let i = -16; i < 32; i += 5) {
        for (let k = 0; k < 16; k++) {
            t.set(i + k, k, [170, 246, 242]);
        }
    }
    t.border([60, 168, 166], 3);
}

function paintFire(t) {
    t.clear();
    //Tongues of flame rising from the bottom, hottest at the base
    for (let x = 0; x < 16; x++) {
        const h = 7 + Math.round(5 * Math.abs(Math.sin(x * 1.3 + 0.5)) + t.r() * 4);
        for (let i = 0; i < h; i++) {
            const y = 15 - i;
            const k = i / h;
            const c = k < 0.3 ? [255, 236, 150] : k < 0.65 ? [255, 168, 40] : [222, 70, 20];
            if (k > 0.8 && t.r() < 0.4) {
                continue;
            }
            t.set(x, y, t.vary(c, 12), k > 0.85 ? 200 : 255);
        }
    }
}

function paintLava(t) {
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const a = Math.sin((x / 16) * Math.PI * 2) + Math.cos((y / 16) * Math.PI * 4 + x * 0.4);
            const b = Math.sin(((x + y) / 16) * Math.PI * 2 * 2);
            const v = a * 0.6 + b * 0.4;
            let c;
            if (v > 0.75) {
                c = [255, 214, 90];
            } else if (v > 0.1) {
                c = [246, 128, 26];
            } else if (v > -0.7) {
                c = [214, 76, 14];
            } else {
                c = [150, 36, 8];
            }
            t.set(x, y, t.vary(c, 8));
        }
    }
}

function paintObsidian(t) {
    t.fill([22, 17, 32], 5);
    for (let k = 0; k < 18; k++) {
        t.set(t.ri(16), t.ri(16), t.vary([58, 40, 88], 10));
    }
    for (let k = 0; k < 6; k++) {
        t.set(t.ri(16), t.ri(16), [120, 96, 160]);
    }
}

function paintDoor(t, upper) {
    const wood = [168, 126, 72], dark = [104, 74, 40];
    t.fill(wood, 6);
    for (let y = 0; y < 16; y++) {
        for (const x of [0, 15]) {
            t.set(x, y, t.vary(dark, 4));
        }
        if (y % 4 === 0) {
            t.set(7, y, t.vary(dark, 4));
        }
    }
    if (upper) {
        for (let x = 0; x < 16; x++) {
            t.set(x, 0, t.vary(dark, 4));
        }
        //Four open window panes you can look through, in a wooden frame
        for (let y = 3; y < 12; y++) {
            for (let x = 3; x < 13; x++) {
                const frame = x === 3 || x === 12 || y === 3 || y === 11 || x === 7 || x === 8 || y === 7;
                if (frame) {
                    t.set(x, y, t.vary(dark, 4));
                } else {
                    t.set(x, y, [0, 0, 0], 0);
                }
            }
        }
    } else {
        for (let x = 0; x < 16; x++) {
            t.set(x, 15, t.vary(dark, 4));
        }
        for (const [y0, y1] of [[2, 6], [9, 13]]) {
            for (let y = y0; y <= y1; y++) {
                for (let x = 3; x < 13; x++) {
                    if (y === y0 || y === y1 || x === 3 || x === 12) {
                        t.set(x, y, t.vary([140, 102, 56], 4));
                    }
                }
            }
        }
        t.set(13, 1, [70, 70, 76]);
        t.set(13, 2, [70, 70, 76]);
    }
}

function paintBedTop(t, head) {
    t.fill([186, 40, 40], 8);
    for (let y = 0; y < 16; y++) {
        for (const x of [0, 15]) {
            t.set(x, y, t.vary([124, 90, 50], 5));
        }
    }
    if (head) {
        //Pillow at the head end (top rows of the tile)
        for (let y = 1; y < 6; y++) {
            for (let x = 2; x < 14; x++) {
                t.set(x, y, t.vary(y === 5 ? [196, 196, 204] : [236, 236, 242], 5));
            }
        }
        for (let x = 0; x < 16; x++) {
            t.set(x, 0, t.vary([124, 90, 50], 5));
        }
    } else {
        for (let x = 1; x < 15; x++) {
            t.set(x, 2, t.vary([150, 26, 26], 5));
            t.set(x, 15, t.vary([124, 90, 50], 5));
        }
    }
}

function paintBedSide(t) {
    t.clear();
    for (let x = 0; x < 16; x++) {
        for (let y = 7; y < 16; y++) {
            let c;
            if (y < 11) {
                c = [186, 40, 40];
            } else if (y === 11) {
                c = [232, 232, 236];
            } else {
                c = [124, 90, 50];
            }
            t.set(x, y, t.vary(c, 6));
        }
    }
}

/* ------------------------------------------------------------------ */
/* Item tiles                                                          */
/* ------------------------------------------------------------------ */

function paintDoorItem(t) {
    t.clear();
    for (let y = 1; y < 15; y++) {
        for (let x = 4; x < 12; x++) {
            let c = [168, 126, 72];
            if (x === 4 || x === 11 || y === 1 || y === 14 || y === 8) {
                c = [104, 74, 40];
            } else if (y < 7 && x > 5 && x < 10) {
                c = [176, 214, 232];
            }
            t.set(x, y, c);
        }
    }
    t.set(10, 9, [70, 70, 76]);
    t.outline(0.7);
}

function paintBedItem(t) {
    t.clear();
    for (let x = 1; x < 15; x++) {
        t.set(x, 8, x < 5 ? [236, 236, 242] : [196, 46, 46]);
        t.set(x, 9, x < 5 ? [210, 210, 218] : [176, 36, 36]);
        t.set(x, 10, [124, 90, 50]);
        t.set(x, 11, [104, 74, 40]);
    }
    for (const x of [1, 2, 13, 14]) {
        t.set(x, 12, [104, 74, 40]);
    }
    for (let y = 5; y < 10; y++) {
        t.set(1, y, [124, 90, 50]);
    }
    t.outline(0.7);
}

function paintFenceItem(t, gate) {
    t.clear();
    const posts = gate ? [1, 14] : [3, 11];
    for (const x of posts) {
        for (let y = 2; y < 15; y++) {
            t.set(x, y, [168, 126, 72]);
            t.set(x + 1, y, [130, 96, 54]);
        }
    }
    for (const y of [5, 10]) {
        for (let x = posts[0] + 2; x < posts[1]; x++) {
            t.set(x, y, [178, 136, 80]);
            t.set(x, y + 1, [130, 96, 54]);
        }
    }
    if (gate) {
        for (let y = 5; y < 12; y++) {
            t.set(7, y, [168, 126, 72]);
            t.set(8, y, [130, 96, 54]);
        }
    }
    t.outline(0.7);
}

function paintFlintAndSteel(t) {
    t.clear();
    //Steel striker: a thick C shape
    for (let a = 0; a < 40; a++) {
        const ang = Math.PI * 0.35 + (a / 40) * Math.PI * 1.3;
        for (const r of [3.2, 4]) {
            t.set(5.5 + Math.cos(ang) * r, 8 + Math.sin(ang) * r, r > 3.5 ? [150, 150, 158] : [204, 204, 212]);
        }
    }
    //Flint shard
    t.shape((x, y) => x > 9 && x < 15 && y > 4 + (x - 9) * 0.6 && y < 13 - (x - 9) * 0.3, (x, y) => (x < 12 ? [96, 96, 102] : [60, 60, 66]));
    t.outline(0.65);
}

function paintLavaBucket(t) {
    paintBucket(t, false);
    for (let x = 3; x < 13; x++) {
        t.set(x, 5, [255, 170, 40]);
    }
    for (let x = 4; x < 12; x++) {
        t.set(x, 6, [226, 90, 20]);
    }
}

//Coordinates along / across a handle running from bottom-left to top-right
function handleFrame(x, y) {
    const ox = 2.5, oy = 13.5;
    const u = ((x - ox) - (y - oy)) * 0.7071;
    const v = ((x - ox) + (y - oy)) * 0.7071;
    return [u, v];
}

const WOOD_LIGHT = [150, 110, 62];
const WOOD_DARK = [96, 68, 36];

function paintHandle(t, len = 13) {
    t.shape((x, y) => {
        const [u, v] = handleFrame(x, y);
        return u > -0.5 && u < len && Math.abs(v) < 0.75;
    }, (x, y) => (handleFrame(x + 0.5, y + 0.5)[1] < 0 ? WOOD_LIGHT : WOOD_DARK));
}

function paintStick(t) {
    t.clear();
    paintHandle(t, 14.5);
    t.outline(0.75);
}

function paintTool(t, kind, color) {
    t.clear();
    const light = [Math.min(255, color[0] + 40), Math.min(255, color[1] + 40), Math.min(255, color[2] + 40)];
    const headColor = (x, y) => {
        const [u, v] = handleFrame(x + 0.5, y + 0.5);
        return (u + v * 0.3) > 11.6 ? light : color;
    };
    let head;
    if (kind === "pickaxe") {
        paintHandle(t, 11);
        head = (x, y) => {
            const [u, v] = handleFrame(x, y);
            const uc = 11.2 - 0.07 * v * v;
            return Math.abs(v) < 6.6 && Math.abs(u - uc) < 1.05 + (Math.abs(v) < 2 ? 0.35 : 0);
        };
    } else if (kind === "axe") {
        paintHandle(t, 12.5);
        head = (x, y) => {
            const [u, v] = handleFrame(x, y);
            return v > -5.2 && v < 0.9 && Math.abs(u - 10.6) < 1.3 + Math.max(0, -v) * 0.42;
        };
    } else if (kind === "shovel") {
        paintHandle(t, 10);
        head = (x, y) => {
            const [u, v] = handleFrame(x, y);
            return u > 9 && u < 14.6 && Math.abs(v) < (u < 13 ? 2.3 : 2.3 - (u - 13) * 1.3);
        };
    } else {
        paintHandle(t, 12.5);
        head = (x, y) => {
            const [u, v] = handleFrame(x, y);
            return (v > -4.6 && v < 0.9 && u > 11 && u < 12.8) || (v > -4.6 && v < -3.1 && u > 9.6 && u < 12.8);
        };
    }
    t.shape(head, headColor);
    t.outline(0.6);
}

/* ------------------------------------------------------------------ */
/* Weapons, animal drops and wool                                      */
/* ------------------------------------------------------------------ */

function paintSword(t, color) {
    t.clear();
    const light = [Math.min(255, color[0] + 50), Math.min(255, color[1] + 50), Math.min(255, color[2] + 50)];
    //Grip and pommel
    t.shape((x, y) => {
        const [u, v] = handleFrame(x, y);
        return u > -0.3 && u < 3.6 && Math.abs(v) < 0.8;
    }, (x, y) => (handleFrame(x + 0.5, y + 0.5)[1] < 0 ? WOOD_LIGHT : WOOD_DARK));
    //Blade with a pointed tip, lighter along one edge
    t.shape((x, y) => {
        const [u, v] = handleFrame(x, y);
        return u > 4.4 && u < 15.4 && Math.abs(v) < (u < 13.4 ? 1.25 : 1.25 - (u - 13.4) * 0.62);
    }, (x, y) => (handleFrame(x + 0.5, y + 0.5)[1] < 0 ? light : color));
    //Cross guard
    t.shape((x, y) => {
        const [u, v] = handleFrame(x, y);
        return u > 3.4 && u < 4.6 && Math.abs(v) < 3;
    }, () => [color[0] * 0.55, color[1] * 0.55, color[2] * 0.55]);
    t.outline(0.6);
}

function paintBow(t) {
    t.clear();
    //Wooden limb bending away from a straight string
    for (let i = 0; i <= 40; i++) {
        const k = i / 40;
        const a = (1 - k) * (1 - k), b = 2 * k * (1 - k), c = k * k;
        const x = a * 13 + b * 15 + c * 2, y = a * 2 + b * 15 + c * 13;
        t.set(x, y, WOOD_LIGHT);
        t.set(x - 0.6, y - 0.6, WOOD_DARK);
    }
    for (let i = 0; i <= 11; i++) {
        t.set(13 - i, 2 + i, [214, 214, 214]);
    }
    t.outline(0.75);
}

function paintArrow(t) {
    t.clear();
    for (let i = 0; i < 9; i++) {
        t.set(4 + i, 11 - i, [150, 112, 64]);
    }
    //Flint head
    for (const [x, y] of [[12, 2], [13, 2], [13, 3], [12, 3], [14, 1], [11, 2], [13, 4]]) {
        t.set(x, y, [96, 96, 104]);
    }
    //Fletching
    for (const [x, y] of [[2, 12], [3, 12], [2, 13], [4, 13], [3, 14], [1, 13], [3, 11], [2, 11]]) {
        t.set(x, y, [236, 236, 236]);
    }
    t.outline(0.75);
}

function paintFeather(t) {
    t.clear();
    for (let i = 0; i < 11; i++) {
        const x = 3 + i, y = 13 - i;
        t.set(x, y, [200, 200, 204]);
        if (i > 1) {
            t.set(x - 1, y - 1, [246, 246, 248]);
            t.set(x - 2, y, [236, 236, 240]);
            t.set(x + 1, y + 1, [226, 226, 232]);
        }
    }
    t.outline(0.8);
}

function paintString(t) {
    t.clear();
    for (let x = 1; x < 15; x++) {
        const y = 8 + Math.round(Math.sin(x * 0.9) * 3);
        t.set(x, y, [226, 226, 226]);
        t.set(x, y + 1, [170, 170, 174]);
    }
}

function paintBone(t) {
    t.clear();
    for (let i = 0; i < 9; i++) {
        t.set(4 + i, 11 - i, [236, 232, 214]);
        t.set(5 + i, 11 - i, [206, 200, 180]);
    }
    for (const [cx, cy] of [[3, 12], [13, 3]]) {
        for (const [dx, dy] of [[-1, 0], [0, 1], [1, 1], [0, -1], [-1, -1], [1, 0]]) {
            t.set(cx + dx, cy + dy, [240, 236, 220]);
        }
    }
    t.outline(0.7);
}

function paintBoneMeal(t) {
    t.clear();
    for (let y = 8; y < 14; y++) {
        const half = 1 + (y - 8);
        for (let x = 8 - half; x < 8 + half; x++) {
            if (t.r() < 0.85) {
                t.set(x, y, t.vary([236, 234, 226], 14));
            }
        }
    }
    t.outline(0.75);
}

function paintMeat(t, base, fat, cooked) {
    t.clear();
    paintBlob(t, 8, 8.5, 6, 4.6, (x, y) => (x < 6 && y < 8 ? [base[0] + 30, base[1] + 24, base[2] + 20] : base));
    //Marbling (raw) or grill lines (cooked)
    for (let k = 0; k < 5; k++) {
        const x = 4 + t.ri(8), y = 6 + t.ri(5);
        if (t.alpha(x, y)) {
            t.set(x, y, fat);
            if (!cooked) {
                t.set(x + 1, y, fat);
            }
        }
    }
    if (cooked) {
        for (const x of [5, 8, 11]) {
            for (let y = 6; y < 12; y++) {
                if (t.alpha(x + (y - 6) % 2, y)) {
                    t.set(x + (y - 6) % 2, y, [base[0] * 0.55, base[1] * 0.55, base[2] * 0.55]);
                }
            }
        }
    }
    t.outline(0.62);
}

function paintWool(t) {
    t.fill([232, 232, 228], 8);
    for (let k = 0; k < 30; k++) {
        const x = t.ri(16), y = t.ri(16);
        t.set(x, y, t.vary([210, 210, 206], 6));
        t.set(x + 1, y, t.vary([246, 246, 244], 4));
    }
}

/* ------------------------------------------------------------------ */
/* Coloured wool, dyes, panes and the spark system                     */
/* ------------------------------------------------------------------ */

function paintColorWool(t, c) {
    const lum = (c[0] + c[1] + c[2]) / 3;
    const v = lum < 60 ? 8 : 14;
    t.fill(c, v);
    for (let k = 0; k < 30; k++) {
        const x = t.ri(16), y = t.ri(16);
        t.set(x, y, t.vary([c[0] * 0.82, c[1] * 0.82, c[2] * 0.82], 5));
        t.set(x + 1, y, t.vary([Math.min(255, c[0] * 1.12 + 6), Math.min(255, c[1] * 1.12 + 6), Math.min(255, c[2] * 1.12 + 6)], 4));
    }
}

//A small heap of powder in the given colour (dyes, spark dust)
function paintPowder(t, c) {
    t.clear();
    for (let y = 7; y < 14; y++) {
        const half = 1 + (y - 7) * 0.9;
        for (let x = Math.round(8 - half); x < Math.round(8 + half); x++) {
            if (t.r() < 0.88) {
                const k = y < 9 ? 1.15 : 1;
                t.set(x, y, t.vary([Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)], 16));
            }
        }
    }
    t.set(6, 8, [Math.min(255, c[0] + 60), Math.min(255, c[1] + 60), Math.min(255, c[2] + 60)]);
    t.outline(0.7);
}

function paintSparkTorch(t, on) {
    t.clear();
    for (let y = 9; y < 16; y++) {
        t.set(7, y, [138, 102, 54]);
        t.set(8, y, [104, 76, 40]);
    }
    const head = on ? [[255, 214, 120], [255, 170, 40], [255, 236, 170], [240, 130, 20]] : [[120, 40, 24], [96, 30, 18], [140, 52, 30], [80, 24, 14]];
    t.set(7, 6, head[0]);
    t.set(8, 6, head[1]);
    t.set(7, 7, head[2]);
    t.set(8, 7, head[1]);
    t.set(7, 8, head[1]);
    t.set(8, 8, head[3]);
}

function paintSparkLamp(t, on) {
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
            const c = on ? (d < 3 ? [255, 236, 160] : [255, 176, 64]) : (d < 3 ? [120, 70, 40] : [92, 52, 30]);
            t.set(x, y, t.vary(c, 8));
        }
    }
    t.border([70, 66, 64], 4);
    for (let i = 1; i < 15; i++) {
        if (i % 5 === 0) {
            for (let k = 1; k < 15; k++) {
                t.set(i, k, [90, 84, 80]);
                t.set(k, i, [90, 84, 80]);
            }
        }
    }
}

function paintPistonSide(t) {
    paintStone(t);
    //The wooden top strip and a dark iron band
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 4; y++) {
            t.set(x, y, t.vary(y === 3 ? [110, 84, 50] : [168, 134, 82], 6));
        }
        t.set(x, 9, [86, 86, 90]);
    }
}

function paintPistonTop(t, sticky) {
    paintPlanks(t);
    t.border([110, 84, 50], 3);
    if (sticky) {
        for (let y = 4; y < 12; y++) {
            for (let x = 4; x < 12; x++) {
                t.set(x, y, t.vary([150, 176, 196], 10));
            }
        }
    } else {
        t.rect(6, 6, 4, 4, [120, 120, 124], 6);
    }
}

function paintPistonBottom(t) {
    paintStone(t);
    t.border([90, 90, 94], 3);
    t.rect(5, 5, 6, 6, [110, 110, 114], 6);
}

function paintPistonInner(t) {
    paintStone(t);
    t.rect(6, 6, 4, 4, [168, 134, 82], 6);
}

function paintRail(t, kind) {
    t.clear();
    const metal = kind === "powered" ? [214, 176, 60] : kind === "on" ? [244, 210, 90] : [176, 176, 182];
    const tie = [110, 80, 44];
    if (kind === "curve") {
        //Ties around a quarter circle, rails along it (bottom edge to right edge)
        for (let a = 0; a <= 8; a++) {
            const ang = (a / 8) * Math.PI / 2;
            for (let r = 2; r <= 14; r++) {
                if (a % 2 === 0) {
                    t.set(16 - Math.cos(ang) * r, 16 - Math.sin(ang) * r, tie);
                }
            }
        }
        for (let i = 0; i <= 60; i++) {
            const ang = (i / 60) * Math.PI / 2;
            for (const r of [4, 12]) {
                t.set(16 - Math.cos(ang) * r, 16 - Math.sin(ang) * r, metal);
            }
        }
        return;
    }
    for (let y = 1; y < 16; y += 4) {
        for (let x = 1; x < 15; x++) {
            t.set(x, y, tie);
            t.set(x, y + 1, [tie[0] * 0.8, tie[1] * 0.8, tie[2] * 0.8]);
        }
    }
    for (let y = 0; y < 16; y++) {
        for (const x of [3, 12]) {
            t.set(x, y, metal);
            t.set(x + (x === 3 ? -1 : 1), y, [metal[0] * 0.7, metal[1] * 0.7, metal[2] * 0.7]);
        }
        if (kind === "on" || kind === "powered") {
            t.set(7, y, kind === "on" ? [255, 120, 40] : [96, 40, 24]);
            t.set(8, y, kind === "on" ? [255, 160, 60] : [110, 46, 26]);
        }
    }
}

function paintLeverItem(t) {
    t.clear();
    t.rect(4, 11, 8, 4, [128, 128, 128], 10);
    t.outline(0.7);
    for (let i = 0; i < 9; i++) {
        t.set(7 + i * 0.45, 11 - i, [150, 112, 64]);
        t.set(8 + i * 0.45, 11 - i, [104, 76, 40]);
    }
}

function paintButtonItem(t) {
    t.clear();
    t.rect(4, 6, 8, 5, [146, 146, 146], 6);
    t.rect(4, 6, 8, 1, [176, 176, 176], 2);
    t.outline(0.6);
}

function paintMinecart(t, cargo) {
    t.clear();
    if (cargo === "chest") {
        t.rect(4, 2, 8, 6, [160, 112, 52], 6);
        t.rect(7, 4, 2, 2, [205, 205, 205]);
    } else if (cargo === "furnace") {
        t.rect(4, 2, 8, 6, [118, 118, 118], 6);
        t.rect(6, 5, 4, 3, [255, 150, 40]);
    }
    for (let y = 7; y < 13; y++) {
        for (let x = 1; x < 15; x++) {
            const edge = y === 7 || x === 1 || x === 14;
            t.set(x, y, edge ? [190, 190, 196] : t.vary([120, 120, 126], 6));
        }
    }
    for (const x of [3, 12]) {
        t.rect(x - 1, 13, 3, 2, [60, 60, 64]);
    }
    t.outline(0.7);
}

function paintIngot(t, base) {
    t.clear();
    const light = [Math.min(255, base[0] + 45), Math.min(255, base[1] + 45), Math.min(255, base[2] + 45)];
    const dark = [base[0] * 0.66, base[1] * 0.66, base[2] * 0.66];
    for (let y = 5; y < 8; y++) {
        for (let x = 4 + (7 - y); x < 13 + (7 - y); x++) {
            t.set(x, y, light);
        }
    }
    for (let y = 8; y < 11; y++) {
        for (let x = 2; x < 12; x++) {
            t.set(x, y, base);
        }
        t.set(12, y, dark);
        t.set(13, y - 1, dark);
        t.set(14, y - 2, dark);
    }
    t.outline(0.62);
}

function paintBlob(t, cx, cy, rx, ry, colorFn, jag = 0) {
    t.shape((x, y) => {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        return dx * dx + dy * dy < 1 - jag * (t.r() - 0.5);
    }, colorFn);
}

function paintCoal(t) {
    t.clear();
    paintBlob(t, 7.8, 8.2, 5.6, 4.8, () => t.vary([44, 44, 48], 10), 0.3);
    for (let k = 0; k < 6; k++) {
        const x = 4 + t.ri(8), y = 5 + t.ri(6);
        if (t.alpha(x, y)) {
            t.set(x, y, [96, 96, 104]);
        }
    }
    t.outline(0.6);
}

function paintCrystal(t) {
    t.clear();
    t.shape((x, y) => Math.abs(x - 8) / 6 + Math.abs(y - 8) / 7 < 1, (x, y) => {
        if (y < 6) {
            return [190, 252, 248];
        }
        return x < 8 ? [110, 232, 226] : [72, 196, 196];
    });
    t.set(6, 5, [255, 255, 255]);
    t.outline(0.6);
}

function paintFlint(t) {
    t.clear();
    t.shape((x, y) => y > 3 && y < 14 && x > 3 + (13 - y) * 0.2 && x < 12 - Math.abs(y - 8) * 0.35, (x, y) => (x + y < 16 ? [104, 104, 110] : [62, 62, 68]));
    t.outline(0.6);
}

function paintClayBall(t) {
    t.clear();
    paintBlob(t, 8, 8.5, 5, 4.6, (x, y) => (x + y < 14 ? [184, 190, 204] : [150, 156, 172]));
    t.outline(0.65);
}

function paintSeeds(t) {
    t.clear();
    for (let k = 0; k < 8; k++) {
        const x = 3 + t.ri(10), y = 4 + t.ri(9);
        t.set(x, y, [96, 170, 60]);
        t.set(x + 1, y, [70, 130, 44]);
    }
}

function paintWheatItem(t) {
    t.clear();
    for (let s = 0; s < 5; s++) {
        const x0 = 4 + s * 2;
        for (let y = 7; y < 15; y++) {
            t.set(x0 + (y > 11 ? (s < 2 ? 1 : s > 2 ? -1 : 0) : 0), y, [176, 160, 70]);
        }
        for (let y = 2; y < 7; y++) {
            t.set(x0, y, t.vary([226, 196, 90], 12));
        }
    }
    t.rect(5, 11, 7, 1, [140, 96, 40]);
}

function paintBread(t) {
    t.clear();
    paintBlob(t, 8, 9, 7, 4.2, (x, y) => (y < 8 ? [222, 162, 82] : [184, 120, 52]));
    for (const x of [5, 8, 11]) {
        t.set(x, 7, [150, 96, 40]);
        t.set(x + 1, 6, [150, 96, 40]);
    }
    t.outline(0.62);
}

function paintApple(t) {
    t.clear();
    paintBlob(t, 8, 9.5, 5.5, 5, (x, y) => (x < 6 && y < 9 ? [246, 92, 80] : [204, 34, 36]));
    t.set(5, 7, [255, 190, 180]);
    t.set(8, 3, [104, 72, 40]);
    t.set(8, 4, [104, 72, 40]);
    t.set(9, 3, [70, 150, 50]);
    t.set(10, 3, [70, 150, 50]);
    t.set(10, 2, [70, 150, 50]);
    t.outline(0.65);
}

function paintBowl(t, stew) {
    t.clear();
    t.shape((x, y) => {
        const dx = (x - 8) / 7, dy = (y - 8) / 6;
        return y > 8 && dx * dx + dy * dy < 1;
    }, (x, y) => (y < 11 ? [150, 108, 60] : [118, 84, 46]));
    for (let x = 1; x < 15; x++) {
        t.set(x, 8, stew ? [146, 96, 54] : [86, 60, 32]);
    }
    if (stew) {
        for (let x = 3; x < 13; x++) {
            t.set(x, 7, [172, 120, 70]);
        }
        t.set(5, 7, [214, 196, 170]);
        t.set(9, 6, [200, 60, 50]);
        t.set(11, 7, [214, 196, 170]);
    }
    t.outline(0.65);
}

function paintBucket(t, water) {
    t.clear();
    for (let y = 5; y < 14; y++) {
        const inset = (y - 5) * 0.25;
        for (let x = Math.round(3 + inset); x < Math.round(13 - inset); x++) {
            t.set(x, y, x < 7 ? [214, 214, 220] : [168, 168, 176]);
        }
    }
    for (let x = 3; x < 13; x++) {
        t.set(x, 5, water ? [70, 120, 226] : [64, 64, 70]);
    }
    for (let x = 4; x < 12; x++) {
        t.set(x, 6, water ? [52, 98, 212] : [96, 96, 102]);
    }
    for (let i = 0; i < 9; i++) {
        const a = Math.PI * (i / 8);
        t.set(8 - Math.cos(a) * 5, 4 - Math.sin(a) * 3, [130, 130, 138]);
    }
    t.outline(0.6);
}

/* ------------------------------------------------------------------ */
/* Crack overlays                                                      */
/* ------------------------------------------------------------------ */

function paintCracks(stage) {
    const t = new Tile(4242);
    t.clear();
    const rng = mulberry32(777);
    //Fixed crack paths; later stages reveal more of them
    const pts = [];
    for (let c = 0; c < 9; c++) {
        let x = 8 + (rng() - 0.5) * 4, y = 8 + (rng() - 0.5) * 4;
        const a0 = rng() * Math.PI * 2;
        for (let i = 0; i < 9; i++) {
            const a = a0 + (rng() - 0.5) * 1.2;
            x += Math.cos(a) * 1.1;
            y += Math.sin(a) * 1.1;
            pts.push([x, y, c * 0.9 + i * 0.14]);
        }
    }
    const limit = (stage + 1) * 0.95;
    for (const [x, y, order] of pts) {
        if (order < limit) {
            t.set(x, y, [26, 26, 26], 210);
        }
    }
    return t;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const PAINTERS = {
    stone: paintStone,
    cobblestone: (t) => paintCobble(t),
    mossy: (t) => paintCobble(t, [110, 128, 104], 24),
    dirt: paintDirt,
    grass_top: (t) => {
        t.fill([164, 164, 164], 20);
        for (let k = 0; k < 24; k++) {
            t.set(t.ri(16), t.ri(16), t.vary([124, 124, 124], 8));
        }
        for (let k = 0; k < 12; k++) {
            t.set(t.ri(16), t.ri(16), t.vary([196, 196, 196], 8));
        }
    },
    grass_side: (t) => {
        paintDirt(t);
        for (let x = 0; x < 16; x++) {
            const h = 3 + (t.r() < 0.5 ? 1 : 0) + (t.r() < 0.25 ? 1 : 0);
            for (let y = 0; y < h; y++) {
                t.set(x, y, t.vary(y === h - 1 ? [78, 132, 54] : [100, 162, 70], 10));
            }
        }
    },
    sand: paintSand,
    sandstone_top: (t) => {
        t.fill([224, 212, 164], 4);
        for (let k = 0; k < 10; k++) {
            t.set(t.ri(16), t.ri(16), t.vary([206, 192, 146], 4));
        }
    },
    sandstone_side: (t) => {
        t.fill([216, 203, 155], 5);
        for (let x = 0; x < 16; x++) {
            for (let y = 0; y < 3; y++) {
                t.set(x, y, t.vary([230, 220, 174], 4));
            }
            t.set(x, 3, t.vary([188, 172, 124], 4));
            t.set(x, 10, t.vary([204, 190, 142], 4));
            for (let y = 13; y < 16; y++) {
                t.set(x, y, t.vary([200, 186, 138], 6));
            }
        }
    },
    sandstone_bottom: (t) => {
        t.fill([206, 192, 144], 6);
        for (let k = 0; k < 5; k++) {
            const x = t.ri(16), y = t.ri(16);
            for (let i = 0; i < 4; i++) {
                t.set(x + i, y + (i > 1 ? 1 : 0), [180, 164, 118]);
            }
        }
    },
    gravel: (t) => {
        t.fill([128, 122, 118], 8);
        const tones = [[154, 148, 142], [100, 96, 92], [160, 142, 126], [88, 84, 82]];
        for (let k = 0; k < 24; k++) {
            const x = t.ri(16), y = t.ri(16), c = tones[t.ri(4)];
            t.set(x, y, c);
            t.set(x + 1, y, t.vary(c, 6));
            if (t.r() < 0.5) {
                t.set(x, y + 1, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]);
            }
        }
    },
    bedrock: (t) => {
        t.fill([86, 86, 86], 26);
        for (let k = 0; k < 12; k++) {
            const x = t.ri(16), y = t.ri(16), c = t.r() < 0.5 ? [36, 36, 36] : [146, 146, 146];
            t.rect(x, y, 1 + t.ri(3), 1 + t.ri(2), c, 6);
        }
    },
    log_side: paintLogSide,
    log_top: paintLogTop,
    planks: (t) => paintPlanks(t),
    leaves: paintLeaves,
    glass: paintGlass,
    coal_ore: (t) => paintOre(t, [36, 36, 40], 5),
    iron_ore: (t) => paintOre(t, [214, 172, 140], 4),
    gold_ore: (t) => paintOre(t, [250, 218, 60], 4),
    crystal_ore: (t) => paintOre(t, [96, 232, 228], 3),
    clay: (t) => {
        t.fill([160, 166, 180], 4);
        for (let k = 0; k < 14; k++) {
            t.set(t.ri(16), t.ri(16), t.vary([146, 152, 168], 3));
        }
    },
    bricks: paintBricks,
    stone_bricks: paintStoneBricks,
    slab_top: (t) => paintSmoothStone(t, false),
    slab_side: (t) => paintSmoothStone(t, true),
    torch: paintTorch,
    workbench_top: (t) => paintWorkbench(t, "top"),
    workbench_side: (t) => paintWorkbench(t, "side"),
    workbench_front: (t) => paintWorkbench(t, "front"),
    furnace_side: paintFurnaceSide,
    furnace_top: (t) => {
        t.fill([132, 132, 132], 5);
        t.border([92, 92, 92], 3);
    },
    furnace_front: (t) => paintFurnaceFront(t, false),
    furnace_front_lit: (t) => paintFurnaceFront(t, true),
    chest_top: (t) => paintChest(t, "top"),
    chest_side: (t) => paintChest(t, "side"),
    chest_front: (t) => paintChest(t, "front"),
    tall_grass: (t) => paintGrassBlades(t, true),
    flower_yellow: (t) => paintFlower(t, [250, 216, 40], [226, 140, 20]),
    flower_red: (t) => paintFlower(t, [214, 36, 40], [96, 12, 12]),
    mushroom_brown: (t) => paintMushroom(t, [150, 110, 80], false),
    mushroom_red: (t) => paintMushroom(t, [204, 40, 32], true),
    cactus_side: (t) => paintCactus(t, "side"),
    cactus_top: (t) => paintCactus(t, "top"),
    cactus_bottom: (t) => paintCactus(t, "bottom"),
    reeds: paintReeds,
    farmland_dry: (t) => paintFarmland(t, false),
    farmland_wet: (t) => paintFarmland(t, true),
    sapling: paintSapling,
    dead_bush: paintDeadBush,
    water: paintWater,
    ladder: paintLadder,
    iron_block: (t) => paintMetal(t, [216, 216, 220], [168, 168, 172], [150, 150, 156]),
    gold_block: (t) => paintMetal(t, [250, 212, 70], [204, 152, 30], [190, 140, 26]),
    crystal_block: paintCrystalBlock,
    lamp: paintLamp,

    //Items
    stick: paintStick,
    coal: paintCoal,
    iron_ingot: (t) => paintIngot(t, [206, 206, 212]),
    gold_ingot: (t) => paintIngot(t, [240, 196, 50]),
    brick: (t) => paintIngot(t, [168, 82, 60]),
    crystal: paintCrystal,
    flint: paintFlint,
    clay_ball: paintClayBall,
    seeds: paintSeeds,
    wheat_item: paintWheatItem,
    bread: paintBread,
    apple: paintApple,
    bowl: (t) => paintBowl(t, false),
    stew: (t) => paintBowl(t, true),
    bucket: (t) => paintBucket(t, false),
    water_bucket: (t) => paintBucket(t, true),

    fire: paintFire,
    lava: paintLava,
    obsidian: paintObsidian,
    door_lower: (t) => paintDoor(t, false),
    door_upper: (t) => paintDoor(t, true),
    bed_head_top: (t) => paintBedTop(t, true),
    bed_foot_top: (t) => paintBedTop(t, false),
    bed_side: paintBedSide,
    door_item: paintDoorItem,
    bed_item: paintBedItem,
    fence_item: (t) => paintFenceItem(t, false),
    gate_item: (t) => paintFenceItem(t, true),
    flint_and_steel: paintFlintAndSteel,
    lava_bucket: paintLavaBucket
};

for (let s = 0; s < 8; s++) {
    PAINTERS["wheat_" + s] = (t) => paintWheat(t, s);
}

export const TOOL_MATERIALS = [
    { key: "wood", color: [150, 112, 64] },
    { key: "stone", color: [128, 128, 128] },
    { key: "iron", color: [212, 212, 218] },
    { key: "gold", color: [244, 204, 60] },
    { key: "crystal", color: [96, 226, 220] }
];
export const TOOL_KINDS = ["pickaxe", "axe", "shovel", "hoe"];

for (const m of TOOL_MATERIALS) {
    for (const k of TOOL_KINDS) {
        PAINTERS[m.key + "_" + k] = (t) => paintTool(t, k, m.color);
    }
    PAINTERS[m.key + "_sword"] = (t) => paintSword(t, m.color);
}

Object.assign(PAINTERS, {
    wool: paintWool,
    bow: paintBow,
    arrow: paintArrow,
    feather: paintFeather,
    string: paintString,
    bone: paintBone,
    bone_meal: paintBoneMeal,
    raw_meat: (t) => paintMeat(t, [196, 64, 64], [240, 196, 196], false),
    cooked_meat: (t) => paintMeat(t, [138, 82, 46], [184, 122, 72], true),
    raw_mutton: (t) => paintMeat(t, [210, 90, 96], [246, 214, 214], false),
    cooked_mutton: (t) => paintMeat(t, [150, 94, 56], [196, 140, 86], true),
    raw_chicken: (t) => paintMeat(t, [236, 182, 168], [250, 226, 214], false),
    cooked_chicken: (t) => paintMeat(t, [204, 146, 80], [232, 190, 120], true),
    blue_flower: (t) => paintFlower(t, [70, 104, 232], [240, 220, 96]),
    spark_ore: (t) => paintOre(t, [255, 150, 40], 5),
    spark_dust: (t) => paintPowder(t, [255, 150, 40]),
    spark_wire: (t) => {
        t.fill([196, 196, 196], 26);
        for (let k = 0; k < 20; k++) {
            t.set(t.ri(16), t.ri(16), [255, 255, 255]);
        }
    },
    spark_torch_on: (t) => paintSparkTorch(t, true),
    spark_torch_off: (t) => paintSparkTorch(t, false),
    spark_lamp_off: (t) => paintSparkLamp(t, false),
    spark_lamp_on: (t) => paintSparkLamp(t, true),
    spark_block: (t) => paintMetal(t, [240, 140, 40], [190, 96, 24], [176, 86, 20]),
    piston_side: paintPistonSide,
    piston_top: (t) => paintPistonTop(t, false),
    piston_top_sticky: (t) => paintPistonTop(t, true),
    piston_bottom: paintPistonBottom,
    piston_inner: paintPistonInner,
    rail: (t) => paintRail(t, "plain"),
    rail_curve: (t) => paintRail(t, "curve"),
    powered_rail: (t) => paintRail(t, "powered"),
    powered_rail_on: (t) => paintRail(t, "on"),
    lever_item: paintLeverItem,
    button_item: paintButtonItem,
    minecart: (t) => paintMinecart(t, null),
    chest_minecart: (t) => paintMinecart(t, "chest"),
    furnace_minecart: (t) => paintMinecart(t, "furnace")
});

//Coloured wool blocks and the dyes that make them (colours as in blocks.js)
const COLORS = [
    ["red", [178, 48, 40]], ["orange", [214, 122, 44]], ["yellow", [222, 206, 60]], ["chartreuse", [146, 198, 56]],
    ["green", [86, 172, 66]], ["spring", [100, 198, 124]], ["cyan", [112, 208, 206]], ["capri", [104, 150, 216]],
    ["ultramarine", [94, 98, 208]], ["violet", [112, 52, 216]], ["purple", [134, 72, 202]], ["magenta", [184, 78, 208]],
    ["rose", [188, 64, 122]], ["lightgray", [152, 152, 152]], ["darkgray", [66, 66, 68]], ["black", [28, 28, 32]]
];
for (const [key, c] of COLORS) {
    PAINTERS["wool_" + key] = (t) => paintColorWool(t, c);
    PAINTERS["dye_" + key] = (t) => paintPowder(t, c);
}

for (let s = 0; s < 10; s++) {
    PAINTERS["destroy_" + s] = null; //painted separately
}

//Tiles whose transparent pixels should not be colour-dilated (crisp items)
function dilateTransparent(t) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < S * S; i++) {
        if (t.d[i * 4 + 3] > 0) {
            sr += t.d[i * 4];
            sg += t.d[i * 4 + 1];
            sb += t.d[i * 4 + 2];
            n++;
        }
    }
    if (n === 0) {
        return [0, 0, 0];
    }
    const avg = [sr / n, sg / n, sb / n];
    for (let i = 0; i < S * S; i++) {
        if (t.d[i * 4 + 3] === 0) {
            t.d[i * 4] = avg[0];
            t.d[i * 4 + 1] = avg[1];
            t.d[i * 4 + 2] = avg[2];
        }
    }
    return avg;
}

function tileToCanvas(d) {
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(S, S);
    img.data.set(d);
    ctx.putImageData(img, 0, 0);
    return c;
}

export function buildTextures() {
    const names = Object.keys(PAINTERS);
    const layers = new Uint8Array(names.length * S * S * 4);
    const layerOf = new Map();
    const canvases = new Map();
    const avgColor = new Map();
    names.forEach((name, i) => {
        let t;
        if (name.startsWith("destroy_")) {
            t = paintCracks(Number(name.slice(8)));
        } else {
            let seed = 0;
            for (let k = 0; k < name.length; k++) {
                seed = (Math.imul(seed, 31) + name.charCodeAt(k)) | 0;
            }
            t = new Tile(seed);
            PAINTERS[name](t);
        }
        //Keep an undilated copy for icons (transparent pixels stay clear)
        canvases.set(name, tileToCanvas(t.d));
        avgColor.set(name, dilateTransparent(t));
        layers.set(t.d, i * S * S * 4);
        layerOf.set(name, i);
    });
    return { names, layers, layerOf, canvases, avgColor, count: names.length };
}

/* ------------------------------------------------------------------ */
/* Inventory icons                                                     */
/* ------------------------------------------------------------------ */

export const ICON = 64;

function shadedTile(src, shade, tint) {
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    if (tint || shade !== 1) {
        const img = ctx.getImageData(0, 0, S, S);
        const k = tint || [1, 1, 1];
        for (let i = 0; i < S * S; i++) {
            img.data[i * 4] *= k[0] * shade;
            img.data[i * 4 + 1] *= k[1] * shade;
            img.data[i * 4 + 2] *= k[2] * shade;
        }
        ctx.putImageData(img, 0, 0);
    }
    return c;
}

//Draw one isometric block (or slab) icon at (ox, oy) on ctx
export function drawIsoIcon(ctx, ox, oy, tiles, opts = {}) {
    const half = !!opts.half;
    const sc = 0.86;
    const off = (1 - sc) * ICON / 2;
    const tf = (a, b, c, d, e, f) => {
        ctx.setTransform(a * sc, b * sc, c * sc, d * sc, ox + e * sc + off, oy + f * sc + off);
    };
    const dy = half ? 16 : 0;
    ctx.imageSmoothingEnabled = false;
    //Top face
    tf(2, -1, 2, 1, 0, 16 + dy);
    ctx.drawImage(shadedTile(tiles.top, 1, opts.topTint), 0, 0);
    //Left (front-left) face
    tf(2, 1, 0, 2, 0, 16 + dy);
    if (half) {
        ctx.drawImage(shadedTile(tiles.left, 0.78, opts.sideTint), 0, 8, 16, 8, 0, 0, 16, 8);
    } else {
        ctx.drawImage(shadedTile(tiles.left, 0.78, opts.sideTint), 0, 0);
    }
    //Right (front-right) face
    tf(2, -1, 0, 2, 32, 32 + dy);
    if (half) {
        ctx.drawImage(shadedTile(tiles.right, 0.6, opts.sideTint), 0, 8, 16, 8, 0, 0, 16, 8);
    } else {
        ctx.drawImage(shadedTile(tiles.right, 0.6, opts.sideTint), 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function drawFlatIcon(ctx, ox, oy, tile, tint) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(shadedTile(tile, 1, tint), ox + 4, oy + 4, ICON - 8, ICON - 8);
}
