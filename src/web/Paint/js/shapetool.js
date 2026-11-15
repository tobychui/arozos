/*
    Shapes tool. A new shape stays editable after it is drawn: drag inside
    to move it, drag the handles to resize it, drag the middle handle of a
    line to bend it, and change colours or the outline while it is selected.
    It is drawn into the picture when you click elsewhere, pick another tool,
    or press Enter. Delete throws it away.

    Hold Shift for squares, circles and lines at 45 degree steps.
*/
import { App } from './app.js';
import {
    buildShape, isLineShape, lineGeometry, buildLineBody, buildArrowHead,
    lineMid, controlFromMid, distanceToLine, snapAngle, arrowHeadSize
} from './shapes.js';
import { normRect } from './raster.js';

export function shapeStyle(swap) {
    const s = App.state;
    return {
        stroke: swap ? s.secondary : s.primary,
        fill: swap ? s.primary : s.secondary,
        outline: s.outline,
        filled: s.filled,
        width: Math.max(1, s.sizes.shape),
        dash: s.dash
    };
}

function applyDash(ctx, st) {
    if (st.dash === 'dash') {
        ctx.setLineDash([st.width * 3, st.width * 2]);
        ctx.lineCap = 'butt';
    } else if (st.dash === 'dot') {
        ctx.setLineDash([0.01, st.width * 2]);
        ctx.lineCap = 'round';
    } else {
        ctx.setLineDash([]);
    }
}

export function drawShape(ctx, sh, st) {
    ctx.save();
    ctx.lineWidth = st.width;
    ctx.strokeStyle = st.stroke;
    ctx.fillStyle = st.fill;
    ctx.lineCap = 'round';
    ctx.lineJoin = sh.id === 'rect' ? 'miter' : 'round';
    ctx.miterLimit = 4;
    if (isLineShape(sh.id)) {
        const geo = lineGeometry({ x: sh.x0, y: sh.y0 }, { x: sh.x1, y: sh.y1 }, sh.c, sh.id === 'arrow', st.width);
        const body = new Path2D();
        buildLineBody(body, geo);
        applyDash(ctx, st);
        ctx.stroke(body);
        if (geo.head) {
            const head = new Path2D();
            buildArrowHead(head, geo);
            ctx.setLineDash([]);
            ctx.fillStyle = st.stroke;
            ctx.lineWidth = Math.min(2, st.width);
            ctx.lineJoin = 'round';
            ctx.fill(head);
            ctx.stroke(head);
        }
    } else {
        const r = normRect(sh.x0, sh.y0, sh.x1, sh.y1);
        const inset = st.outline ? st.width / 2 : 0;
        const w = r.w - inset * 2, h = r.h - inset * 2;
        if (w > 0.5 && h > 0.5) {
            const path = new Path2D();
            buildShape(path, sh.id, r.x + inset, r.y + inset, w, h);
            if (st.filled) {
                ctx.fill(path);
            }
            if (st.outline) {
                applyDash(ctx, st);
                ctx.stroke(path);
            }
        } else if (st.outline || st.filled) {
            // Too small for its outline: a solid block of the outline colour
            ctx.fillStyle = st.outline ? st.stroke : st.fill;
            ctx.fillRect(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h));
        }
    }
    ctx.restore();
}

// Area a shape can paint, for undo
export function shapeBounds(sh, st) {
    if (isLineShape(sh.id)) {
        const xs = [sh.x0, sh.x1], ys = [sh.y0, sh.y1];
        if (sh.c) {
            xs.push(sh.c.x);
            ys.push(sh.c.y);
        }
        const m = st.width + (sh.id === 'arrow' ? arrowHeadSize(st.width).len : 0) + 2;
        const x = Math.min(...xs) - m, y = Math.min(...ys) - m;
        return { x: x, y: y, w: Math.max(...xs) + m - x, h: Math.max(...ys) + m - y };
    }
    const r = normRect(sh.x0, sh.y0, sh.x1, sh.y1);
    return { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 };
}

const HANDLE_CURSORS = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    p0: 'pointer', p1: 'pointer', bend: 'pointer'
};

export function boxHandles(r) {
    const l = r.x, t = r.y, R = r.x + r.w, B = r.y + r.h, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return [
        { id: 'nw', x: l, y: t }, { id: 'n', x: cx, y: t }, { id: 'ne', x: R, y: t }, { id: 'e', x: R, y: cy },
        { id: 'se', x: R, y: B }, { id: 's', x: cx, y: B }, { id: 'sw', x: l, y: B }, { id: 'w', x: l, y: cy }
    ];
}

export function handleCursor(id) {
    return HANDLE_CURSORS[id] || 'move';
}

// Resize rect `start` by dragging handle `id` by (dx, dy); keepRatio on corners
export function dragBoxHandle(start, id, dx, dy, keepRatio) {
    let l = start.x, t = start.y, r = start.x + start.w, b = start.y + start.h;
    if (id.indexOf('w') >= 0) { l += dx; }
    if (id.indexOf('e') >= 0) { r += dx; }
    if (id.indexOf('n') >= 0) { t += dy; }
    if (id.indexOf('s') >= 0) { b += dy; }
    if (keepRatio && id.length === 2 && start.w > 0 && start.h > 0) {
        const nw = r - l, nh = b - t;
        const s = Math.max(Math.abs(nw) / start.w, Math.abs(nh) / start.h);
        const w2 = (nw < 0 ? -1 : 1) * start.w * s, h2 = (nh < 0 ? -1 : 1) * start.h * s;
        if (id.indexOf('w') >= 0) { l = r - w2; } else { r = l + w2; }
        if (id.indexOf('n') >= 0) { t = b - h2; } else { b = t + h2; }
    }
    return { x0: l, y0: t, x1: r, y1: b };
}

const shapeTool = {
    id: 'shapes',
    cursor: 'crosshair',
    altPicks: true,
    sh: null,
    mode: null,

    isPending() {
        return !!this.sh;
    },

    rect() {
        return normRect(this.sh.x0, this.sh.y0, this.sh.x1, this.sh.y1);
    },

    handles() {
        const sh = this.sh;
        if (!sh) {
            return [];
        }
        if (isLineShape(sh.id)) {
            const p0 = { x: sh.x0, y: sh.y0 }, p1 = { x: sh.x1, y: sh.y1 };
            const m = lineMid(p0, p1, sh.c);
            return [
                { id: 'p0', x: p0.x, y: p0.y, round: true },
                { id: 'p1', x: p1.x, y: p1.y, round: true },
                { id: 'bend', x: m.x, y: m.y, round: true }
            ];
        }
        return boxHandles(this.rect());
    },

    inside(p) {
        const sh = this.sh;
        const t = App.view.tol(5);
        if (isLineShape(sh.id)) {
            return distanceToLine(p, { x: sh.x0, y: sh.y0 }, { x: sh.x1, y: sh.y1 }, sh.c) <= Math.max(shapeStyle().width / 2, t);
        }
        const r = this.rect();
        return p.x >= r.x - t && p.x <= r.x + r.w + t && p.y >= r.y - t && p.y <= r.y + r.h + t;
    },

    down(p, e) {
        if (this.sh) {
            const h = App.view.hitHandles(p, this.handles());
            if (h) {
                this.mode = h.id;
                this.grab = p;
                this.start = JSON.parse(JSON.stringify(this.sh));
                return;
            }
            if (this.inside(p)) {
                this.mode = 'move';
                this.grab = p;
                this.start = JSON.parse(JSON.stringify(this.sh));
                return;
            }
            this.commit();
        }
        this.sh = { id: App.state.shape, x0: p.x, y0: p.y, x1: p.x, y1: p.y, c: null, swap: e.button === 2 };
        this.mode = 'draw';
        this.render();
    },

    move(p, e) {
        const sh = this.sh;
        if (!sh || !this.mode) {
            return;
        }
        const line = isLineShape(sh.id);
        const st = this.start;
        if (this.mode === 'draw') {
            if (line) {
                const end = e.shiftKey ? snapAngle({ x: sh.x0, y: sh.y0 }, p) : p;
                sh.x1 = end.x;
                sh.y1 = end.y;
            } else if (e.shiftKey) {
                const dx = p.x - sh.x0, dy = p.y - sh.y0;
                const d = Math.max(Math.abs(dx), Math.abs(dy));
                sh.x1 = sh.x0 + (dx < 0 ? -d : d);
                sh.y1 = sh.y0 + (dy < 0 ? -d : d);
            } else {
                sh.x1 = p.x;
                sh.y1 = p.y;
            }
        } else if (this.mode === 'move') {
            const dx = p.x - this.grab.x, dy = p.y - this.grab.y;
            sh.x0 = st.x0 + dx;
            sh.y0 = st.y0 + dy;
            sh.x1 = st.x1 + dx;
            sh.y1 = st.y1 + dy;
            sh.c = st.c ? { x: st.c.x + dx, y: st.c.y + dy } : null;
        } else if (this.mode === 'p0' || this.mode === 'p1') {
            let q = p;
            if (e.shiftKey) {
                q = this.mode === 'p0' ? snapAngle({ x: sh.x1, y: sh.y1 }, p) : snapAngle({ x: sh.x0, y: sh.y0 }, p);
            }
            if (this.mode === 'p0') {
                sh.x0 = q.x;
                sh.y0 = q.y;
            } else {
                sh.x1 = q.x;
                sh.y1 = q.y;
            }
        } else if (this.mode === 'bend') {
            const p0 = { x: sh.x0, y: sh.y0 }, p1 = { x: sh.x1, y: sh.y1 };
            const straight = lineMid(p0, p1, null);
            sh.c = Math.hypot(p.x - straight.x, p.y - straight.y) < App.view.tol(4) ? null : controlFromMid(p0, p1, p);
        } else {
            const r = normRect(st.x0, st.y0, st.x1, st.y1);
            const n = dragBoxHandle(r, this.mode, p.x - this.grab.x, p.y - this.grab.y, e.shiftKey);
            sh.x0 = n.x0;
            sh.y0 = n.y0;
            sh.x1 = n.x1;
            sh.y1 = n.y1;
        }
        this.render();
    },

    up() {
        const sh = this.sh;
        if (!sh) {
            return;
        }
        if (this.mode === 'draw') {
            const tiny = Math.abs(sh.x1 - sh.x0) < 2 && Math.abs(sh.y1 - sh.y0) < 2;
            if (tiny) {
                // A click, not a drag: nothing to draw
                this.sh = null;
            }
        }
        this.mode = null;
        this.render();
    },

    hover(p) {
        if (!this.sh) {
            return null;
        }
        const h = App.view.hitHandles(p, this.handles());
        if (h) {
            return handleCursor(h.id);
        }
        return this.inside(p) ? 'move' : null;
    },

    render() {
        App.clearPreview();
        if (this.sh) {
            drawShape(App.pctx, this.sh, shapeStyle(this.sh.swap));
        }
        App.emit('overlay');
        App.emit('selection');
    },

    overlay(o) {
        const sh = this.sh;
        if (!sh) {
            return;
        }
        if (!isLineShape(sh.id)) {
            const r = this.rect();
            o.rect(r.x, r.y, r.w, r.h, { cls: 'ov-dash' });
        }
        if (this.mode !== 'draw') {
            o.handles(this.handles());
        }
    },

    commit() {
        const sh = this.sh;
        if (!sh) {
            return;
        }
        this.sh = null;
        this.mode = null;
        const st = shapeStyle(sh.swap);
        App.history.begin();
        drawShape(App.ctx, sh, st);
        App.history.commit('Shape', shapeBounds(sh, st));
        App.clearPreview();
        App.emit('overlay');
        App.emit('selection');
        App.emit('changed');
    },

    cancel() {
        if (this.mode === 'draw') {
            this.sh = null;
        } else if (this.start) {
            this.sh = this.start;
        }
        this.mode = null;
        this.render();
    },

    discard() {
        this.sh = null;
        this.mode = null;
        this.render();
    },

    key(e) {
        if (!this.sh || this.mode) {
            return false;
        }
        const step = e.shiftKey ? 10 : 1;
        const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (nudge) {
            const sh = this.sh;
            sh.x0 += nudge[0];
            sh.x1 += nudge[0];
            sh.y0 += nudge[1];
            sh.y1 += nudge[1];
            if (sh.c) {
                sh.c.x += nudge[0];
                sh.c.y += nudge[1];
            }
            this.render();
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Escape') {
            this.commit();
            return true;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            this.discard();
            return true;
        }
        return false;
    },

    // The shape picked in the gallery replaces the one being edited
    setShape(id) {
        if (!this.sh) {
            return;
        }
        const wasLine = isLineShape(this.sh.id);
        if (wasLine !== isLineShape(id)) {
            this.commit();
            return;
        }
        this.sh.id = id;
        this.render();
    }
};

export function registerShapeTool() {
    App.registerTool(shapeTool);
    const rerender = () => {
        if (shapeTool.sh) {
            shapeTool.render();
        }
    };
    App.on('colors', rerender);
    App.on('options', rerender);
    App.on('previewreset', rerender);
}
