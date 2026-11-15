/*
    Painting tools: pencil, brush (round, calligraphy, highlighter, spray),
    eraser, fill bucket and colour picker.

    The left mouse button paints with the primary colour, the right one with
    the secondary colour. Alt + click with a painting tool picks a colour.
*/
import { App } from './app.js';
import { bresenham, floodFill, parseHex, toHex, unionRect } from './raster.js';
import { clamp } from './util.js';

/* ------------------------------------------------------------ helpers */

function colorFor(e) {
    return e && e.button === 2 ? App.state.secondary : App.state.primary;
}

function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function boxAround(p, r) {
    return { x: p.x - r - 2, y: p.y - r - 2, w: 2 * r + 4, h: 2 * r + 4 };
}

function pressureWidth(size, e) {
    if (e && e.pointerType === 'pen' && e.pressure > 0) {
        return Math.max(0.5, size * (0.25 + e.pressure));
    }
    return size;
}

// Cursor drawn from an icon, with a white halo so it shows on any colour
function iconCursor(inner, hx, hy, fallback) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<g stroke="#fff" stroke-width="4">' + inner + '</g><g stroke="#111" stroke-width="1.6">' + inner + '</g></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + hx + ' ' + hy + ', ' + (fallback || 'crosshair');
}

export const CURSORS = {
    picker: iconCursor('<path d="M14.6 5.2l1.3-1.3a2.1 2.1 0 0 1 3 0l1.2 1.2a2.1 2.1 0 0 1 0 3l-1.3 1.3"/><path d="M12.4 6.4l5.2 5.2"/><path d="M15.6 9.6L7.4 17.8 2.5 21.5l3.7-4.9 8.2-8.2"/>', 2, 21),
    fill: iconCursor('<path d="M10.6 3.8l8.1 8.1-6.8 6.8a2 2 0 0 1-2.8 0L4 13.6a2 2 0 0 1 0-2.8z"/><path d="M3.6 12.4h15"/><path d="M20.4 15.6s1.6 2 1.6 3.1a1.6 1.6 0 0 1-3.2 0c0-1.1 1.6-3.1 1.6-3.1z"/>', 20, 21)
};

/* ------------------------------------------------------------ pencil */

const pencil = {
    id: 'pencil',
    cursor: 'crosshair',
    altPicks: true,
    coalesced: true,
    last: null,

    brushRadius() {
        return App.state.sizes.pencil / 2;
    },
    squareBrush() {
        return true;
    },
    plot(x, y) {
        const s = Math.max(1, Math.round(App.state.sizes.pencil));
        const o = Math.floor(s / 2);
        App.ctx.fillRect(x - o, y - o, s, s);
        this.box = unionRect(this.box, { x: x - o - 1, y: y - o - 1, w: s + 2, h: s + 2 });
    },
    down(p, e) {
        App.history.begin();
        App.ctx.fillStyle = colorFor(e);
        this.box = null;
        this.last = { x: Math.floor(p.x), y: Math.floor(p.y) };
        this.plot(this.last.x, this.last.y);
    },
    move(p) {
        if (!this.last) {
            return;
        }
        const cur = { x: Math.floor(p.x), y: Math.floor(p.y) };
        if (cur.x === this.last.x && cur.y === this.last.y) {
            return;
        }
        bresenham(this.last.x, this.last.y, cur.x, cur.y, (x, y) => this.plot(x, y));
        this.last = cur;
    },
    up() {
        if (!this.last) {
            return;
        }
        this.last = null;
        App.history.commit('Pencil', this.box);
        App.emit('changed');
    },
    cancel() {
        this.last = null;
        App.history.revert();
    }
};

/* ------------------------------------------------------------ brush */

const brush = {
    id: 'brush',
    cursor: 'crosshair',
    altPicks: true,
    coalesced: true,
    pts: null,

    brushRadius() {
        return App.state.sizes.brush / 2;
    },

    down(p, e) {
        const s = App.state;
        this.type = s.brushType;
        this.color = colorFor(e);
        this.size = s.sizes.brush;
        this.pts = [p];
        this.box = boxAround(p, this.size);
        App.history.begin();
        if (this.type === 'highlighter') {
            App.clearPreview();
            App.preview.classList.add('highlight');
            this.target = App.pctx;
        } else {
            this.target = App.ctx;
        }
        const c = this.target;
        c.save();
        c.fillStyle = this.color;
        c.strokeStyle = this.color;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        if (this.type === 'spray') {
            this.pos = p;
            this.spray(1);
            this.timer = setInterval(() => this.spray(1), 25);
        } else if (this.type === 'calligraphy') {
            this.nib(p, p);
        } else {
            const w = this.type === 'highlighter' ? this.size : pressureWidth(this.size, e);
            c.beginPath();
            c.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
            c.fill();
        }
    },

    move(p, e) {
        if (!this.pts) {
            return;
        }
        const last = this.pts[this.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.35) {
            return;
        }
        this.box = unionRect(this.box, boxAround(p, this.size * 1.5));
        const c = this.target;
        if (this.type === 'spray') {
            // Spray along the whole movement so fast strokes leave no gaps
            const step = Math.max(2, this.size / 4);
            const n = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / step));
            for (let i = 1; i <= n; i++) {
                this.pos = { x: last.x + ((p.x - last.x) * i) / n, y: last.y + ((p.y - last.y) * i) / n };
                this.spray(0.25);
            }
            this.pts.push(p);
            return;
        }
        if (this.type === 'calligraphy') {
            this.nib(last, p);
            this.pts.push(p);
            return;
        }
        this.pts.push(p);
        const n = this.pts.length;
        c.lineWidth = this.type === 'highlighter' ? this.size : pressureWidth(this.size, e);
        c.beginPath();
        if (n === 2) {
            const m = mid(this.pts[0], this.pts[1]);
            c.moveTo(this.pts[0].x, this.pts[0].y);
            c.lineTo(m.x, m.y);
        } else {
            const a = mid(this.pts[n - 3], this.pts[n - 2]);
            const b = mid(this.pts[n - 2], this.pts[n - 1]);
            c.moveTo(a.x, a.y);
            c.quadraticCurveTo(this.pts[n - 2].x, this.pts[n - 2].y, b.x, b.y);
        }
        c.stroke();
    },

    up() {
        if (!this.pts) {
            return;
        }
        const c = this.target;
        const n = this.pts.length;
        if (n >= 2 && this.type !== 'spray' && this.type !== 'calligraphy') {
            const a = mid(this.pts[n - 2], this.pts[n - 1]);
            c.beginPath();
            c.moveTo(a.x, a.y);
            c.lineTo(this.pts[n - 1].x, this.pts[n - 1].y);
            c.stroke();
        }
        c.restore();
        clearInterval(this.timer);
        if (this.type === 'highlighter') {
            App.ctx.save();
            App.ctx.globalAlpha = 0.45;
            App.ctx.globalCompositeOperation = 'multiply';
            App.ctx.drawImage(App.preview, 0, 0);
            App.ctx.restore();
            App.clearPreview();
            App.preview.classList.remove('highlight');
        }
        this.pts = null;
        App.history.commit('Brush', this.box);
        App.emit('changed');
    },

    cancel() {
        if (!this.pts) {
            return;
        }
        this.target.restore();
        clearInterval(this.timer);
        if (this.type === 'highlighter') {
            App.clearPreview();
            App.preview.classList.remove('highlight');
        }
        this.pts = null;
        App.history.revert();
    },

    // Airbrush: random dots inside the brush circle
    spray(amount) {
        const R = this.size / 2;
        const n = Math.max(2, Math.round((R * 1.2 + 6) * amount));
        const dot = Math.max(1, Math.round(this.size / 30));
        const c = this.target;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = R * Math.sqrt(Math.random());
            c.fillRect(Math.round(this.pos.x + Math.cos(a) * r), Math.round(this.pos.y + Math.sin(a) * r), dot, dot);
        }
        this.box = unionRect(this.box, boxAround(this.pos, R + dot));
    },

    // Calligraphy pen: a flat nib held at 45 degrees
    nib(a, b) {
        const h = this.size / 2;
        const nx = Math.cos(Math.PI / 4) * h, ny = -Math.sin(Math.PI / 4) * h;
        const c = this.target;
        c.beginPath();
        c.moveTo(a.x + nx, a.y + ny);
        c.lineTo(b.x + nx, b.y + ny);
        c.lineTo(b.x - nx, b.y - ny);
        c.lineTo(a.x - nx, a.y - ny);
        c.closePath();
        c.fill();
        c.lineWidth = 1;
        c.stroke();
    }
};

/* ------------------------------------------------------------ eraser */

const eraser = {
    id: 'eraser',
    cursor: 'crosshair',
    coalesced: true,
    last: null,

    brushRadius() {
        return App.state.sizes.eraser / 2;
    },

    down(p) {
        const size = App.state.sizes.eraser;
        const fill = App.backgroundFill();
        const c = App.ctx;
        App.history.begin();
        c.save();
        if (fill === null) {
            c.globalCompositeOperation = 'destination-out';
            c.strokeStyle = c.fillStyle = '#000';
        } else {
            c.strokeStyle = c.fillStyle = fill;
        }
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.lineWidth = size;
        c.beginPath();
        c.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
        c.fill();
        this.last = p;
        this.box = boxAround(p, size);
    },
    move(p) {
        if (!this.last) {
            return;
        }
        const c = App.ctx;
        c.beginPath();
        c.moveTo(this.last.x, this.last.y);
        c.lineTo(p.x, p.y);
        c.stroke();
        this.box = unionRect(this.box, boxAround(p, App.state.sizes.eraser));
        this.last = p;
    },
    up() {
        if (!this.last) {
            return;
        }
        App.ctx.restore();
        this.last = null;
        App.history.commit('Eraser', this.box);
        App.emit('changed');
    },
    cancel() {
        if (!this.last) {
            return;
        }
        App.ctx.restore();
        this.last = null;
        App.history.revert();
    }
};

/* ------------------------------------------------------------ fill */

const fill = {
    id: 'fill',
    cursor: CURSORS.fill,
    altPicks: true,

    down(p, e) {
        const x = Math.floor(p.x), y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= App.W || y >= App.H) {
            return;
        }
        const rgba = parseHex(colorFor(e));
        if (!rgba) {
            return;
        }
        App.history.begin();
        const img = App.ctx.getImageData(0, 0, App.W, App.H);
        const tol = Math.round((clamp(App.state.tolerance, 0, 100) / 100) * 255);
        const r = floodFill(img.data, App.W, App.H, x, y, rgba, tol);
        if (!r) {
            App.history.cancel();
            return;
        }
        App.ctx.putImageData(img, 0, 0, r.x, r.y, r.w, r.h);
        App.history.commit('Fill', r);
        App.emit('changed');
    }
};

/* ------------------------------------------------------------ colour picker */

const picker = {
    id: 'picker',
    cursor: CURSORS.picker,

    colorAt(p) {
        const x = Math.floor(p.x), y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= App.W || y >= App.H) {
            return null;
        }
        const d = App.ctx.getImageData(x, y, 1, 1).data;
        if (d[3] === 0) {
            return null;
        }
        return toHex(d[0], d[1], d[2]);
    },

    pickAt(p, secondary) {
        const hex = this.colorAt(p);
        if (hex) {
            App.setColor(secondary ? 'secondary' : 'primary', hex);
        }
    },

    down(p, e) {
        this.pickAt(p, e.button === 2);
    },

    up() {
        // Back to the tool the colour was picked for
        const back = App.prevToolId && App.prevToolId !== 'picker' ? App.prevToolId : 'brush';
        App.setTool(back, true);
    },

    hover(p) {
        App.emit('pickhover', this.colorAt(p));
        return null;
    },

    deactivate() {
        App.emit('pickhover', null);
    }
};

export function registerPaintTools() {
    App.registerTool(pencil);
    App.registerTool(brush);
    App.registerTool(eraser);
    App.registerTool(fill);
    App.registerTool(picker);
}
