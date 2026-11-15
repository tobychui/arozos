/*
    Rectangle and free-form selections, moving / resizing what is selected,
    and the clipboard.

    A selection is a rectangle (x, y, w, h) with an optional outline polygon
    in 0..1 coordinates of that rectangle (free-form). Dragging it "lifts" the
    pixels into a floating canvas drawn on the preview layer and leaves the
    background colour (or transparency) behind; the floating pixels are drawn
    back into the picture when the selection is dropped. Ctrl + drag moves a
    copy and leaves the original in place. Pasted images arrive as a
    floating selection too.
*/
import { App } from './app.js';
import { normRect, unionRect, clipRect } from './raster.js';
import { boxHandles, dragBoxHandle, handleCursor } from './shapetool.js';
import { T, TF, toast, newCanvas, clamp, shortcutLabel } from './util.js';

/* ------------------------------------------------------------ controller */

export const Sel = {
    sel: null,          // { x, y, w, h, poly, floating, orig, hole, label }
    draft: null,        // marquee rectangle or lasso points while dragging

    has() {
        return !!this.sel;
    },

    absPoly(s) {
        return s.poly.map((p) => [s.x + p[0] * s.w, s.y + p[1] * s.h]);
    },

    // Outline path of the selection, offset by (ox, oy)
    path(s, ox, oy) {
        const p = new Path2D();
        ox = ox || 0;
        oy = oy || 0;
        if (s.poly) {
            const pts = this.absPoly(s);
            p.moveTo(pts[0][0] - ox, pts[0][1] - oy);
            for (let i = 1; i < pts.length; i++) {
                p.lineTo(pts[i][0] - ox, pts[i][1] - oy);
            }
            p.closePath();
        } else {
            p.rect(s.x - ox, s.y - oy, s.w, s.h);
        }
        return p;
    },

    // Fill the selected area of the picture with the background (or clear it)
    punch(s) {
        const c = App.ctx;
        const bg = App.backgroundFill();
        c.save();
        if (bg === null) {
            c.globalCompositeOperation = 'destination-out';
            c.fillStyle = '#000';
        } else {
            c.fillStyle = bg;
        }
        c.fill(this.path(s));
        c.restore();
    },

    // Pick the selected pixels up into a floating canvas
    lift(copy) {
        const s = this.sel;
        if (!s || s.floating) {
            return;
        }
        App.history.begin();
        const f = newCanvas(s.w, s.h);
        const fc = f.getContext('2d');
        fc.drawImage(App.canvas, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
        if (s.poly) {
            fc.globalCompositeOperation = 'destination-in';
            fc.fill(this.path(s, s.x, s.y));
        }
        if (!copy) {
            this.punch(s);
        }
        s.floating = f;
        s.hole = !copy;
        s.orig = { x: s.x, y: s.y, w: s.w, h: s.h };
        s.label = copy ? 'Duplicate' : 'Move selection';
        this.render();
        App.markDirty();
    },

    render() {
        App.clearPreview();
        const s = this.sel;
        if (s && s.floating) {
            const c = App.pctx;
            c.save();
            c.imageSmoothingEnabled = s.w !== s.floating.width || s.h !== s.floating.height;
            c.imageSmoothingQuality = 'high';
            c.drawImage(s.floating, s.x, s.y, s.w, s.h);
            c.restore();
        }
        App.emit('overlay');
        App.emit('selection');
    },

    // Drop the selection, drawing floating pixels into the picture
    commit() {
        const s = this.sel;
        this.draft = null;
        if (!s) {
            return;
        }
        this.sel = null;
        if (s.floating) {
            const c = App.ctx;
            c.save();
            c.imageSmoothingEnabled = s.w !== s.floating.width || s.h !== s.floating.height;
            c.imageSmoothingQuality = 'high';
            c.drawImage(s.floating, s.x, s.y, s.w, s.h);
            c.restore();
            App.history.commit(s.label || 'Move selection', unionRect(s.orig, { x: s.x, y: s.y, w: s.w, h: s.h }));
            App.emit('changed');
        }
        this.render();
    },

    // Delete key: clear the selected area (or throw away what floats)
    remove() {
        const s = this.sel;
        if (!s) {
            return;
        }
        this.sel = null;
        if (s.floating) {
            if (s.hole) {
                App.history.commit('Delete', s.orig);
            } else {
                App.history.cancel();
            }
        } else {
            App.history.begin();
            this.punch(s);
            App.history.commit('Delete', s);
        }
        App.emit('changed');
        this.render();
    },

    // What is selected, as a canvas the size of the selection
    content() {
        const s = this.sel;
        if (!s) {
            return null;
        }
        const c = newCanvas(s.w, s.h);
        const x = c.getContext('2d');
        if (s.floating) {
            x.imageSmoothingQuality = 'high';
            x.drawImage(s.floating, 0, 0, s.w, s.h);
            return c;
        }
        x.drawImage(App.canvas, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
        if (s.poly) {
            x.globalCompositeOperation = 'destination-in';
            x.fill(this.path(s, s.x, s.y));
        }
        return c;
    },

    selectAll() {
        App.setTool('select');
        App.finalize();
        this.sel = { x: 0, y: 0, w: App.W, h: App.H, poly: null };
        this.render();
    },

    /*
        Place an image as a floating selection. A blank new picture takes the
        size of the image; a smaller picture grows so the image fits.
        at = document point to centre it on (drag and drop).
    */
    paste(img, at) {
        const iw = img.width, ih = img.height;
        if (!iw || !ih) {
            return;
        }
        if (App.tool.id !== 'select' && App.tool.id !== 'lasso') {
            App.setTool('select');
        }
        App.finalize();
        if (App.untouched) {
            App.ops.canvasSize(iw, ih, 'tl', true);
        } else if (iw > App.W || ih > App.H) {
            App.ops.canvasSize(Math.max(iw, App.W), Math.max(ih, App.H), 'tl');
            toast(T('canvas-enlarged', 'The canvas was enlarged to fit the pasted image'));
        }
        let x, y;
        if (at) {
            x = Math.round(at.x - iw / 2);
            y = Math.round(at.y - ih / 2);
        } else {
            const v = App.view.visibleRect();
            x = Math.floor(v.x);
            y = Math.floor(v.y);
        }
        x = clamp(x, 0, Math.max(0, App.W - iw));
        y = clamp(y, 0, Math.max(0, App.H - ih));
        const f = newCanvas(iw, ih);
        f.getContext('2d').drawImage(img, 0, 0);
        App.history.begin();
        this.sel = { x: x, y: y, w: iw, h: ih, poly: null, floating: f, orig: { x: x, y: y, w: iw, h: ih }, hole: false, label: 'Paste' };
        App.markDirty();
        this.render();
    },

    /*
        Turn or mirror the selection: fn(canvas) returns the new floating
        canvas, mapPoly maps outline points, swap = width and height swap.
    */
    transform(fn, mapPoly, swap) {
        const s = this.sel;
        if (!s) {
            return false;
        }
        this.lift(false);
        const scaled = newCanvas(s.w, s.h);
        scaled.getContext('2d').drawImage(s.floating, 0, 0, s.w, s.h);
        s.floating = fn(scaled);
        if (swap) {
            const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
            const w = s.h, h = s.w;
            s.w = w;
            s.h = h;
            s.x = Math.round(cx - w / 2);
            s.y = Math.round(cy - h / 2);
        }
        if (s.poly && mapPoly) {
            s.poly = s.poly.map(mapPoly);
        }
        this.render();
        return true;
    }
};

/* ------------------------------------------------------------ the two tools */

function makeSelectTool(id) {
    return {
        id: id,
        cursor: 'crosshair',
        mode: null,

        isPending() {
            return !!(Sel.sel && Sel.sel.floating);
        },

        commit() {
            Sel.commit();
            this.mode = null;
        },

        clampPt(p) {
            return { x: clamp(p.x, 0, App.W), y: clamp(p.y, 0, App.H) };
        },

        down(p, e) {
            const s = Sel.sel;
            if (s) {
                const h = App.view.hitHandles(p, boxHandles(s));
                if (h) {
                    Sel.lift(false);
                    this.mode = h.id;
                    this.grab = p;
                    this.start = { x: s.x, y: s.y, w: s.w, h: s.h };
                    return;
                }
                if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
                    Sel.lift(e.ctrlKey || e.metaKey);
                    this.mode = 'move';
                    this.grab = p;
                    this.start = { x: s.x, y: s.y, w: s.w, h: s.h };
                    return;
                }
                Sel.commit();
            }
            const a = this.clampPt(p);
            this.anchor = a;
            this.mode = this.id === 'lasso' ? 'lasso' : 'marquee';
            Sel.draft = this.mode === 'lasso' ? [[a.x, a.y]] : null;
            App.emit('overlay');
        },

        move(p, e) {
            const s = Sel.sel;
            if (this.mode === 'marquee') {
                let q = this.clampPt(p);
                if (e.shiftKey) {
                    const d = Math.max(Math.abs(q.x - this.anchor.x), Math.abs(q.y - this.anchor.y));
                    q = this.clampPt({ x: this.anchor.x + (q.x < this.anchor.x ? -d : d), y: this.anchor.y + (q.y < this.anchor.y ? -d : d) });
                }
                const r = normRect(Math.round(this.anchor.x), Math.round(this.anchor.y), Math.round(q.x), Math.round(q.y));
                Sel.draft = r;
                App.emit('overlay');
                App.emit('selection', r);
            } else if (this.mode === 'lasso') {
                const q = this.clampPt(p);
                const last = Sel.draft[Sel.draft.length - 1];
                if (Math.hypot(q.x - last[0], q.y - last[1]) >= App.view.tol(2)) {
                    Sel.draft.push([q.x, q.y]);
                    App.emit('overlay');
                }
            } else if (this.mode === 'move' && s) {
                s.x = this.start.x + Math.round(p.x - this.grab.x);
                s.y = this.start.y + Math.round(p.y - this.grab.y);
                Sel.render();
            } else if (this.mode && s) {
                const n = dragBoxHandle(this.start, this.mode, p.x - this.grab.x, p.y - this.grab.y, e.shiftKey);
                const r = normRect(Math.round(n.x0), Math.round(n.y0), Math.round(n.x1), Math.round(n.y1));
                s.x = r.x;
                s.y = r.y;
                s.w = Math.max(1, r.w);
                s.h = Math.max(1, r.h);
                Sel.render();
            }
        },

        up() {
            if (this.mode === 'marquee') {
                const r = Sel.draft;
                Sel.draft = null;
                if (r && r.w >= 1 && r.h >= 1) {
                    Sel.sel = { x: r.x, y: r.y, w: r.w, h: r.h, poly: null };
                }
            } else if (this.mode === 'lasso') {
                const pts = Sel.draft || [];
                Sel.draft = null;
                if (pts.length >= 3) {
                    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                    for (const q of pts) {
                        x0 = Math.min(x0, q[0]);
                        y0 = Math.min(y0, q[1]);
                        x1 = Math.max(x1, q[0]);
                        y1 = Math.max(y1, q[1]);
                    }
                    const r = clipRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, App.W, App.H);
                    if (r && r.w >= 2 && r.h >= 2) {
                        Sel.sel = {
                            x: r.x, y: r.y, w: r.w, h: r.h,
                            poly: pts.map((q) => [(q[0] - r.x) / r.w, (q[1] - r.y) / r.h])
                        };
                    }
                }
            }
            this.mode = null;
            Sel.render();
        },

        cancel() {
            if (this.mode === 'move' || (this.mode && this.mode.length <= 2)) {
                const s = Sel.sel;
                if (s && this.start) {
                    Object.assign(s, this.start);
                }
            }
            Sel.draft = null;
            this.mode = null;
            Sel.render();
        },

        hover(p) {
            const s = Sel.sel;
            if (!s) {
                return null;
            }
            const h = App.view.hitHandles(p, boxHandles(s));
            if (h) {
                return handleCursor(h.id);
            }
            if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
                return 'move';
            }
            return null;
        },

        overlay(o) {
            if (this.mode === 'marquee' && Sel.draft) {
                const r = Sel.draft;
                o.rect(r.x, r.y, r.w, r.h, { ants: true });
                return;
            }
            if (this.mode === 'lasso' && Sel.draft) {
                o.poly(Sel.draft, false, { ants: true });
                return;
            }
            const s = Sel.sel;
            if (!s) {
                return;
            }
            if (s.poly) {
                o.poly(Sel.absPoly(s), true, { ants: true });
                o.rect(s.x, s.y, s.w, s.h, { cls: 'ov-dash' });
            } else {
                o.rect(s.x, s.y, s.w, s.h, { ants: true });
            }
            if (this.mode !== 'move') {
                o.handles(boxHandles(s));
            }
        },

        key(e) {
            const s = Sel.sel;
            if (!s || this.mode) {
                return false;
            }
            const step = e.shiftKey ? 10 : 1;
            const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (nudge) {
                Sel.lift(false);
                s.x += nudge[0];
                s.y += nudge[1];
                Sel.render();
                return true;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                Sel.remove();
                return true;
            }
            if (e.key === 'Escape' || e.key === 'Enter') {
                Sel.commit();
                return true;
            }
            return false;
        }
    };
}

export function registerSelectTools() {
    App.registerTool(makeSelectTool('select'));
    App.registerTool(makeSelectTool('lasso'));
    App.on('previewreset', () => Sel.render());
}

/* ------------------------------------------------------------ clipboard */

function canvasToBlob(c) {
    return new Promise((resolve, reject) => {
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png');
    });
}

export function loadImageBlob(blob) {
    if (window.createImageBitmap) {
        return createImageBitmap(blob).catch(() => loadImageUrl(URL.createObjectURL(blob), true));
    }
    return loadImageUrl(URL.createObjectURL(blob), true);
}

export function loadImageUrl(url, revoke) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            if (revoke) {
                URL.revokeObjectURL(url);
            }
            resolve(img);
        };
        img.onerror = () => {
            if (revoke) {
                URL.revokeObjectURL(url);
            }
            reject(new Error('Unable to read the image'));
        };
        img.src = url;
    });
}

export const Clipboard = {
    internal: null,         // last copy, used when the system clipboard refused it
    systemHasIt: false,

    async copy(cut) {
        App.tools.text && App.tools.text.commit();
        App.tools.shapes && App.tools.shapes.commit();
        let c = Sel.content();
        const whole = !c;
        if (whole) {
            if (cut) {
                toast(T('select-first', 'Select an area first'));
                return;
            }
            c = App.canvas;
        }
        const copyCanvas = newCanvas(c.width, c.height);
        copyCanvas.getContext('2d').drawImage(c, 0, 0);
        this.internal = copyCanvas;
        this.systemHasIt = false;
        try {
            if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
                // Safari wants the promise handed over, not the blob
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(copyCanvas) })]);
                this.systemHasIt = true;
            }
        } catch (e) {
            this.systemHasIt = false;
        }
        if (cut) {
            Sel.remove();
            toast(T('cut-done', 'Cut to the clipboard'));
        } else {
            toast(whole ? T('copied-all', 'Copied the whole picture') : T('copied', 'Copied to the clipboard'));
        }
    },

    // The Paste button: read the system clipboard when the browser lets us
    async pasteButton() {
        try {
            if (navigator.clipboard && navigator.clipboard.read) {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const type = item.types.find((t) => t.startsWith('image/'));
                    if (type) {
                        const img = await loadImageBlob(await item.getType(type));
                        Sel.paste(img);
                        return;
                    }
                }
            }
        } catch (e) {
            //permission refused or not available (plain http)
        }
        if (this.internal) {
            Sel.paste(this.internal);
            return;
        }
        toast(TF('paste-hint', 'Press {key} to paste an image from the clipboard', { key: shortcutLabel('Ctrl+V') }));
    },

    // Ctrl+V anywhere in the window
    onPaste(e) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            return;
        }
        const items = e.clipboardData ? e.clipboardData.items : [];
        for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) {
                    e.preventDefault();
                    loadImageBlob(f).then((img) => Sel.paste(img), () => toast(T('paste-failed', 'The clipboard image could not be read'), true));
                    return;
                }
            }
        }
        if (this.internal && !this.systemHasIt) {
            e.preventDefault();
            Sel.paste(this.internal);
            return;
        }
        toast(T('paste-none', 'There is no image on the clipboard'));
    }
};
