/*
    Whole-picture operations: new picture, load, resize, canvas size, crop,
    rotate, flip, invert, grayscale, clear. Rotate, flip and the colour
    filters work on the selection instead when something is selected.
*/
import { App } from './app.js';
import { Sel } from './selection.js';
import { copyCanvas, newCanvas, T, toast } from './util.js';
import { anchorOffset, invertPixels, grayscalePixels, clipRect, hasTransparency } from './raster.js';

export const MAX_SIZE = 16384;

// Replace the picture with a new one of size w x h drawn by draw(ctx, before)
function replaceDoc(label, w, h, draw) {
    const before = copyCanvas(App.canvas);
    App.canvas.width = w;
    App.canvas.height = h;
    App.ctx.imageSmoothingEnabled = true;
    App.ctx.imageSmoothingQuality = 'high';
    draw(App.ctx, before);
    App.history.pushResize(label, before);
    App.emit('docsize');
    App.emit('changed');
}

// Good quality downscaling: halve in steps, then the last scale
export function drawScaled(ctx, src, w, h, smooth) {
    if (smooth === false) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(src, 0, 0, w, h);
        return;
    }
    let cur = src, cw = src.width, ch = src.height;
    while (cw / 2 >= w && ch / 2 >= h) {
        const nw = Math.max(w, Math.round(cw / 2)), nh = Math.max(h, Math.round(ch / 2));
        const t = newCanvas(nw, nh);
        const tc = t.getContext('2d');
        tc.imageSmoothingQuality = 'high';
        tc.drawImage(cur, 0, 0, nw, nh);
        cur = t;
        cw = nw;
        ch = nh;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
}

function rotated(c, dir) {
    const w = c.width, h = c.height;
    const swap = dir !== 180;
    const out = newCanvas(swap ? h : w, swap ? w : h);
    const x = out.getContext('2d');
    if (dir === 90) {
        x.translate(h, 0);
        x.rotate(Math.PI / 2);
    } else if (dir === -90) {
        x.translate(0, w);
        x.rotate(-Math.PI / 2);
    } else {
        x.translate(w, h);
        x.rotate(Math.PI);
    }
    x.drawImage(c, 0, 0);
    return out;
}

function flipped(c, axis) {
    const out = newCanvas(c.width, c.height);
    const x = out.getContext('2d');
    if (axis === 'h') {
        x.translate(c.width, 0);
        x.scale(-1, 1);
    } else {
        x.translate(0, c.height);
        x.scale(1, -1);
    }
    x.drawImage(c, 0, 0);
    return out;
}

const ROT_POLY = {
    '90': (p) => [1 - p[1], p[0]],
    '-90': (p) => [p[1], 1 - p[0]],
    '180': (p) => [1 - p[0], 1 - p[1]]
};

function fillBackground(ctx, w, h) {
    const bg = App.backgroundFill();
    if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
    }
}

export const Ops = {
    canvasSize(w, h, anchor, quiet) {
        App.finalize();
        w = Math.max(1, Math.min(MAX_SIZE, Math.round(w)));
        h = Math.max(1, Math.min(MAX_SIZE, Math.round(h)));
        if (w === App.W && h === App.H) {
            return;
        }
        replaceDoc('Canvas size', w, h, (ctx, before) => {
            fillBackground(ctx, w, h);
            const o = anchorOffset(anchor, before.width, before.height, w, h);
            ctx.drawImage(before, o.x, o.y);
        });
        if (!quiet) {
            App.view.queueOverlay();
        }
    },

    resize(w, h, smooth) {
        App.finalize();
        w = Math.max(1, Math.min(MAX_SIZE, Math.round(w)));
        h = Math.max(1, Math.min(MAX_SIZE, Math.round(h)));
        if (w === App.W && h === App.H) {
            return;
        }
        replaceDoc('Resize', w, h, (ctx, before) => drawScaled(ctx, before, w, h, smooth));
    },

    rotate(dir) {
        if (Sel.has()) {
            Sel.transform((c) => rotated(c, dir), ROT_POLY[String(dir)], dir !== 180);
            return;
        }
        App.finalize();
        const swap = dir !== 180;
        replaceDoc('Rotate', swap ? App.H : App.W, swap ? App.W : App.H, (ctx, before) => {
            ctx.drawImage(rotated(before, dir), 0, 0);
        });
    },

    flip(axis) {
        if (Sel.has()) {
            Sel.transform((c) => flipped(c, axis), axis === 'h' ? (p) => [1 - p[0], p[1]] : (p) => [p[0], 1 - p[1]], false);
            return;
        }
        App.finalize();
        replaceDoc('Flip', App.W, App.H, (ctx, before) => {
            ctx.drawImage(flipped(before, axis), 0, 0);
        });
    },

    filter(fn, label) {
        if (Sel.has()) {
            Sel.transform((c) => {
                const x = c.getContext('2d');
                const img = x.getImageData(0, 0, c.width, c.height);
                fn(img.data);
                x.putImageData(img, 0, 0);
                return c;
            }, null, false);
            return;
        }
        App.finalize();
        App.history.begin();
        const img = App.ctx.getImageData(0, 0, App.W, App.H);
        fn(img.data);
        App.ctx.putImageData(img, 0, 0);
        App.history.commit(label);
        App.emit('changed');
    },

    invert() {
        this.filter(invertPixels, 'Invert colours');
    },

    grayscale() {
        this.filter(grayscalePixels, 'Black and white');
    },

    crop() {
        if (!Sel.has()) {
            toast(T('select-first', 'Select an area first'));
            return;
        }
        const s = Sel.sel;
        const r = clipRect({ x: s.x, y: s.y, w: s.w, h: s.h }, App.W, App.H);
        App.finalize();
        if (!r) {
            return;
        }
        replaceDoc('Crop', r.w, r.h, (ctx, before) => {
            ctx.drawImage(before, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        });
    },

    clear() {
        App.finalize();
        App.history.begin();
        App.ctx.clearRect(0, 0, App.W, App.H);
        fillBackground(App.ctx, App.W, App.H);
        App.history.commit('Clear');
        App.emit('changed');
    },

    // Start over with a blank picture
    newImage(w, h, transparent) {
        App.finalize();
        App.canvas.width = Math.max(1, Math.min(MAX_SIZE, Math.round(w)));
        App.canvas.height = Math.max(1, Math.min(MAX_SIZE, Math.round(h)));
        if (!transparent) {
            App.ctx.fillStyle = '#ffffff';
            App.ctx.fillRect(0, 0, App.W, App.H);
        }
        App.state.transparentBg = !!transparent;
        App.history.clear();
        App.file = { path: '', name: T('untitled', 'Untitled') + '.png' };
        App.untouched = true;
        App.setClean();
        App.emit('docsize');
        App.view.resetView();
        App.emit('file');
        App.emit('options');
    },

    // Open an image as the picture
    loadImage(img, file) {
        App.finalize();
        const w = img.naturalWidth || img.width || 800;
        const h = img.naturalHeight || img.height || 600;
        App.canvas.width = Math.min(MAX_SIZE, w);
        App.canvas.height = Math.min(MAX_SIZE, h);
        App.ctx.drawImage(img, 0, 0, App.W, App.H);
        let transparent = false;
        try {
            transparent = hasTransparency(App.ctx.getImageData(0, 0, App.W, App.H).data);
        } catch (e) {
            transparent = false;
        }
        App.state.transparentBg = transparent;
        App.history.clear();
        App.file = file;
        App.untouched = false;
        App.setClean();
        App.emit('docsize');
        App.view.resetView();
        App.emit('file');
        App.emit('options');
    }
};

export function registerOps() {
    App.ops = Ops;
}
