/*
    The workspace: zoom, scrolling, panning, pointer routing to the active
    tool, the SVG overlay (selection outlines, handles, brush outline) and
    the grips that resize the canvas.
*/
import { App } from './app.js';
import { $, clamp } from './util.js';

const ZOOMS = [0.05, 0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const HANDLE = 8;           // handle size on screen, px

/* ------------------------------------------------------------ overlay builder */

// Collects SVG markup in document coordinates, written out in screen pixels
export class Overlay {
    constructor(zoom) {
        this.z = zoom;
        this.parts = [];
    }
    sx(v) {
        return Math.round(v * this.z) + 0.5;
    }
    rect(x, y, w, h, opts) {
        const X = this.sx(x), Y = this.sx(y);
        const W = Math.max(0, Math.round((x + w) * this.z) + 0.5 - X), H = Math.max(0, Math.round((y + h) * this.z) + 0.5 - Y);
        const shape = '<rect x="' + X + '" y="' + Y + '" width="' + W + '" height="' + H + '"';
        this.outline(shape, opts);
    }
    poly(pts, closed, opts) {
        if (pts.length < 2) {
            return;
        }
        const d = pts.map((p, i) => (i ? 'L' : 'M') + (p[0] * this.z).toFixed(1) + ' ' + (p[1] * this.z).toFixed(1)).join('') + (closed ? 'Z' : '');
        this.outline('<path d="' + d + '"', opts);
    }
    line(x0, y0, x1, y1, opts) {
        const shape = '<line x1="' + this.sx(x0) + '" y1="' + this.sx(y0) + '" x2="' + this.sx(x1) + '" y2="' + this.sx(y1) + '"';
        this.outline(shape, opts);
    }
    path(d, opts) {
        // d is already in screen pixels
        this.outline('<path d="' + d + '"', opts);
    }
    outline(shape, opts) {
        opts = opts || {};
        if (opts.ants) {
            this.parts.push(shape + ' class="ov-ants-bg"/>');
            this.parts.push(shape + ' class="ov-ants"/>');
        } else {
            this.parts.push(shape + ' class="ov-frame' + (opts.cls ? ' ' + opts.cls : '') + '"/>');
        }
    }
    handles(list) {
        const h = HANDLE;
        for (const p of list) {
            const X = Math.round(p.x * this.z) - h / 2 + 0.5, Y = Math.round(p.y * this.z) - h / 2 + 0.5;
            if (p.round) {
                this.parts.push('<circle cx="' + (X + h / 2) + '" cy="' + (Y + h / 2) + '" r="' + (h / 2 + 0.5) + '" class="ov-handle round"/>');
            } else {
                this.parts.push('<rect x="' + X + '" y="' + Y + '" width="' + h + '" height="' + h + '" rx="1.5" class="ov-handle"/>');
            }
        }
    }
    brush(x, y, r, square) {
        const R = r * this.z;
        if (square) {
            const X = (x * this.z - R).toFixed(1), Y = (y * this.z - R).toFixed(1), S = (2 * R).toFixed(1);
            this.parts.push('<rect x="' + X + '" y="' + Y + '" width="' + S + '" height="' + S + '" class="ov-brush-bg"/>');
            this.parts.push('<rect x="' + X + '" y="' + Y + '" width="' + S + '" height="' + S + '" class="ov-brush"/>');
            return;
        }
        const cx = (x * this.z).toFixed(1), cy = (y * this.z).toFixed(1);
        this.parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + R.toFixed(1) + '" class="ov-brush-bg"/>');
        this.parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + R.toFixed(1) + '" class="ov-brush"/>');
    }
    markup() {
        return this.parts.join('');
    }
}

/* ------------------------------------------------------------ view */

export const View = {
    zoom: 1,
    hover: null,            // last pointer position over the workspace (doc coords)
    spaceDown: false,
    drag: null,             // { id, button } while a tool drag is running
    pan: null,
    pinch: null,
    grip: null,             // canvas resize drag
    touches: new Map(),
    _overlayQueued: false,

    init() {
        this.ws = $('workspace');
        this.stage = $('stage');
        this.box = $('canvas-box');
        this.svg = $('overlay');
        this.gridEl = $('pixel-grid');
        App.canvas = $('doc-canvas');
        App.ctx = App.canvas.getContext('2d', { willReadFrequently: false });
        App.preview = $('preview-canvas');
        App.pctx = App.preview.getContext('2d');
        App.view = this;

        App.on('overlay', () => this.queueOverlay());
        App.on('docsize', () => this.layout());
        App.on('tool', () => {
            this.updateCursor();
            this.queueOverlay();
        });

        this.bindPointer();
        this.bindGrips();
        this.ws.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.ws.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('resize', () => this.queueOverlay());

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.isTyping(e) && !e.repeat) {
                this.spaceDown = true;
                this.updateCursor();
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.spaceDown = false;
                this.updateCursor();
            }
        });
        window.addEventListener('blur', () => {
            this.spaceDown = false;
        });
    },

    isTyping(e) {
        const t = e.target;
        return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    },

    /* ------------------------------------------------------------ geometry */

    // Event position in document coordinates (fractional)
    toDoc(e) {
        const r = this.box.getBoundingClientRect();
        return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
    },

    // Tolerance for hitting handles and outlines, in document units
    tol(px) {
        return (px || HANDLE) / this.zoom;
    },

    hitHandles(p, list) {
        const t = this.tol(HANDLE * 0.5 + 3);
        let best = null, bestD = Infinity;
        for (const h of list) {
            const d = Math.max(Math.abs(p.x - h.x), Math.abs(p.y - h.y));
            if (d <= t && d < bestD) {
                best = h;
                bestD = d;
            }
        }
        return best;
    },

    layout() {
        const W = App.W, H = App.H, z = this.zoom;
        if (App.preview.width !== W || App.preview.height !== H) {
            App.preview.width = W;
            App.preview.height = H;
            App.emit('previewreset');
        }
        const bw = Math.max(1, Math.round(W * z)), bh = Math.max(1, Math.round(H * z));
        this.box.style.width = bw + 'px';
        this.box.style.height = bh + 'px';
        // Sharp pixels when zoomed in, or when every picture pixel covers a
        // whole number of screen pixels (100 % on a high-DPI screen)
        const dev = z * (window.devicePixelRatio || 1);
        this.box.classList.toggle('pixelated', z >= 2 || (dev >= 1.99 && Math.abs(dev - Math.round(dev)) < 0.01));
        const showGrid = App.state.grid && z >= 4;
        this.gridEl.style.display = showGrid ? 'block' : 'none';
        if (showGrid) {
            this.gridEl.style.backgroundSize = z + 'px ' + z + 'px';
        }
        App.emit('zoom');
        this.queueOverlay();
    },

    setZoom(z, anchor) {
        z = clamp(z, MIN_ZOOM, MAX_ZOOM);
        if (Math.abs(z - 1) < 0.02) {
            z = 1;
        }
        const ws = this.ws;
        const wr = ws.getBoundingClientRect();
        // Keep the document point under the anchor (default: view centre) still
        const ax = anchor ? anchor.x : wr.left + wr.width / 2;
        const ay = anchor ? anchor.y : wr.top + wr.height / 2;
        const before = this.toDoc({ clientX: ax, clientY: ay });
        this.zoom = z;
        this.layout();
        const br = this.box.getBoundingClientRect();
        ws.scrollLeft += br.left + before.x * z - ax;
        ws.scrollTop += br.top + before.y * z - ay;
    },

    zoomStep(dir, anchor) {
        const z = this.zoom;
        let next;
        if (dir > 0) {
            next = ZOOMS.find((v) => v > z + 1e-6) || MAX_ZOOM;
        } else {
            next = [...ZOOMS].reverse().find((v) => v < z - 1e-6) || MIN_ZOOM;
        }
        this.setZoom(next, anchor);
    },

    fitZoom() {
        const pad = 48;
        const aw = Math.max(50, this.ws.clientWidth - pad * 2);
        const ah = Math.max(50, this.ws.clientHeight - pad * 2);
        return Math.min(aw / App.W, ah / App.H);
    },

    fit() {
        this.zoom = clamp(this.fitZoom(), MIN_ZOOM, MAX_ZOOM);
        this.layout();
        this.center();
    },

    // 100 % for pictures that fit, otherwise the whole picture in view
    resetView() {
        const f = this.fitZoom();
        this.zoom = f >= 1 ? 1 : clamp(f, MIN_ZOOM, 1);
        this.layout();
        this.center();
    },

    center() {
        const ws = this.ws;
        ws.scrollLeft = (ws.scrollWidth - ws.clientWidth) / 2;
        ws.scrollTop = (ws.scrollHeight - ws.clientHeight) / 2;
    },

    // Visible part of the document, in document coordinates
    visibleRect() {
        const wr = this.ws.getBoundingClientRect();
        const br = this.box.getBoundingClientRect();
        const x0 = Math.max(0, (wr.left - br.left) / this.zoom);
        const y0 = Math.max(0, (wr.top - br.top) / this.zoom);
        const x1 = Math.min(App.W, (wr.right - br.left) / this.zoom);
        const y1 = Math.min(App.H, (wr.bottom - br.top) / this.zoom);
        return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    },

    /* ------------------------------------------------------------ overlay */

    queueOverlay() {
        if (this._overlayQueued) {
            return;
        }
        this._overlayQueued = true;
        requestAnimationFrame(() => {
            this._overlayQueued = false;
            this.renderOverlay();
        });
    },

    renderOverlay() {
        const o = new Overlay(this.zoom);
        if (this.grip) {
            o.rect(0, 0, this.grip.w, this.grip.h, { cls: 'ov-dash' });
        }
        const t = App.tool;
        if (t && t.overlay) {
            t.overlay(o);
        }
        if (t && t.brushRadius && this.hover && !this.pan && !this.spaceDown) {
            const r = t.brushRadius();
            if (r * this.zoom >= 3) {
                o.brush(this.hover.x, this.hover.y, r, t.squareBrush && t.squareBrush());
            }
        }
        this.svg.innerHTML = o.markup();
    },

    updateCursor(c) {
        let cur = c;
        if (this.pan || this.spaceDown) {
            cur = this.pan ? 'grabbing' : 'grab';
        } else if (!cur) {
            cur = App.tool && App.tool.cursor ? App.tool.cursor : 'crosshair';
        }
        if (this.ws.style.cursor !== cur) {
            this.ws.style.cursor = cur;
        }
    },

    /* ------------------------------------------------------------ pointer */

    bindPointer() {
        const ws = this.ws;

        ws.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.text-editor') || e.target.closest('.grip')) {
                return;
            }
            const ae = document.activeElement;
            if (ae && ae !== document.body && !ae.closest('.text-editor') && ae.blur) {
                ae.blur();
            }
            if (e.pointerType === 'touch') {
                this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (this.touches.size === 2) {
                    this.startPinch();
                    return;
                }
                if (this.touches.size > 2) {
                    return;
                }
            }
            if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
                e.preventDefault();
                this.pan = { x: e.clientX, y: e.clientY, sl: ws.scrollLeft, st: ws.scrollTop, id: e.pointerId };
                ws.setPointerCapture(e.pointerId);
                this.updateCursor();
                return;
            }
            if (e.button !== 0 && e.button !== 2) {
                return;
            }
            // Clicks on the workspace scrollbars
            if (e.target === ws && (e.offsetX >= ws.clientWidth || e.offsetY >= ws.clientHeight)) {
                return;
            }
            if (this.drag) {
                // A second finger is ignored; a mouse drag whose release was
                // lost (outside the window) is finished first
                if (e.pointerType !== 'mouse') {
                    return;
                }
                this.endDrag(this.hover || this.toDoc(e), e);
            }
            e.preventDefault();
            try {
                ws.setPointerCapture(e.pointerId);
            } catch (err) {
                //pointer already gone
            }
            const p = this.toDoc(e);
            const t = App.tool;
            if (e.altKey && t && t.altPicks && App.tools.picker) {
                App.tools.picker.pickAt(p, e.button === 2);
                return;
            }
            this.drag = { id: e.pointerId, button: e.button };
            if (t && t.down) {
                t.down(p, e);
            }
        });

        ws.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
                this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (this.pinch) {
                    this.movePinch();
                    return;
                }
            }
            if (this.pan) {
                ws.scrollLeft = this.pan.sl - (e.clientX - this.pan.x);
                ws.scrollTop = this.pan.st - (e.clientY - this.pan.y);
                return;
            }
            const p = this.toDoc(e);
            this.hover = p;
            App.emit('pointer', p);
            const t = App.tool;
            if (this.drag && e.pointerId === this.drag.id) {
                const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
                if (t && t.move) {
                    if (list && list.length > 1 && t.coalesced) {
                        for (const ce of list) {
                            t.move(this.toDoc(ce), ce);
                        }
                    } else {
                        t.move(p, e);
                    }
                }
            } else if (!this.drag) {
                const c = t && t.hover ? t.hover(p, e) : null;
                this.updateCursor(c);
            }
            if (t && t.brushRadius) {
                this.queueOverlay();
            }
        });

        const end = (e) => {
            if (e.pointerType === 'touch') {
                this.touches.delete(e.pointerId);
                if (this.pinch) {
                    if (this.touches.size < 2) {
                        this.pinch = null;
                    }
                    return;
                }
            }
            if (this.pan && e.pointerId === this.pan.id) {
                this.pan = null;
                this.updateCursor();
                return;
            }
            if (this.drag && e.pointerId === this.drag.id) {
                this.endDrag(this.toDoc(e), e);
                const t = App.tool;
                const c = t && t.hover ? t.hover(this.toDoc(e), e) : null;
                this.updateCursor(c);
            }
        };
        ws.addEventListener('pointerup', end);
        ws.addEventListener('pointercancel', end);
        ws.addEventListener('lostpointercapture', (e) => {
            if (this.drag && e.pointerId === this.drag.id) {
                this.endDrag(this.hover || { x: 0, y: 0 }, e);
            }
        });
        ws.addEventListener('pointerleave', () => {
            if (!this.drag) {
                this.hover = null;
                App.emit('pointer', null);
                this.queueOverlay();
            }
        });
    },

    endDrag(p, e) {
        if (!this.drag) {
            return;
        }
        this.drag = null;
        const t = App.tool;
        if (t && t.up) {
            t.up(p, e);
        }
    },

    // Two fingers: cancel what the first finger started, then pinch and pan
    startPinch() {
        if (this.drag) {
            const t = App.tool;
            if (t && t.cancel) {
                t.cancel();
            } else if (t && t.up && this.hover) {
                t.up(this.hover, {});
            }
            this.drag = null;
        }
        const pts = [...this.touches.values()];
        this.pinch = {
            d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
            cx: (pts[0].x + pts[1].x) / 2,
            cy: (pts[0].y + pts[1].y) / 2,
            z: this.zoom
        };
    },

    movePinch() {
        const pts = [...this.touches.values()];
        if (pts.length < 2) {
            return;
        }
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        this.ws.scrollLeft -= cx - this.pinch.cx;
        this.ws.scrollTop -= cy - this.pinch.cy;
        this.pinch.cx = cx;
        this.pinch.cy = cy;
        this.setZoom(this.pinch.z * (d / this.pinch.d), { x: cx, y: cy });
    },

    onWheel(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
            this.setZoom(this.zoom * factor, { x: e.clientX, y: e.clientY });
        }
    },

    /* ------------------------------------------------------------ canvas grips */

    bindGrips() {
        const grips = this.box.querySelectorAll('.grip');
        grips.forEach((g) => {
            g.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                App.finalize();
                g.setPointerCapture(e.pointerId);
                this.grip = { dir: g.dataset.dir, w: App.W, h: App.H };
                App.emit('gripsize', this.grip);
            });
            g.addEventListener('pointermove', (e) => {
                if (!this.grip) {
                    return;
                }
                const p = this.toDoc(e);
                if (this.grip.dir.indexOf('e') >= 0) {
                    this.grip.w = clamp(Math.round(p.x), 1, 20000);
                }
                if (this.grip.dir.indexOf('s') >= 0) {
                    this.grip.h = clamp(Math.round(p.y), 1, 20000);
                }
                App.emit('gripsize', this.grip);
                this.queueOverlay();
            });
            const end = () => {
                if (!this.grip) {
                    return;
                }
                const g2 = this.grip;
                this.grip = null;
                App.emit('gripsize', null);
                if (g2.w !== App.W || g2.h !== App.H) {
                    App.ops.canvasSize(g2.w, g2.h, 'tl');
                }
                this.queueOverlay();
            };
            g.addEventListener('pointerup', end);
            g.addEventListener('pointercancel', end);
        });
    }
};
