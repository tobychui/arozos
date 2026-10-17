/*
    Gerber Viewer - 2D canvas renderer

    GV.render.drawScene(ctx, opts) draws a set of layers through an affine
    board -> device pixel matrix. It is used for the interactive view, the
    minimap, image export, printing and the 3D board textures.

    Each layer image is turned once into cached Path2D objects (one fill path
    plus one stroke path per line width, per polarity group). Every layer is
    drawn on its own scratch canvas so clear polarity only erases that layer,
    then composited with the layer's opacity.

    GV.Viewer wraps a base canvas (layers) and an overlay canvas (crosshair,
    measurements, selection) with pan / zoom / rotate / mirror state.
*/
(function (GV) {
    'use strict';

    var G = GV.geom;
    var MM_PER_INCH = 25.4;
    var CSS_PX_PER_MM = 96 / MM_PER_INCH;

    /* ------------------------------------------------------------------
        Path caches
    ------------------------------------------------------------------ */
    function buildPaths(image) {
        return image.groups.map(function (g) {
            var fill = new Path2D();
            var hasFill = false;
            var strokes = new Map();
            var compound = [];
            for (var i = 0; i < g.items.length; i++) {
                var it = g.items[i];
                if (it.t === 'l' || it.t === 'a') {
                    var p = strokes.get(it.w);
                    if (!p) {
                        p = new Path2D();
                        strokes.set(it.w, p);
                    }
                    G.emitStroke(p, it);
                } else if (it.t === 'p' && it.clip) {
                    var clip = new Path2D();
                    it.clip.forEach(function (c) { G.emitContour(clip, c); });
                    var f = new Path2D();
                    G.emitFill(f, it);
                    compound.push({ clip: clip, fill: f });
                } else {
                    G.emitFill(fill, it);
                    hasFill = true;
                }
            }
            var list = [];
            strokes.forEach(function (path, w) { list.push({ w: w, p: path }); });
            return { dark: g.dark, fill: hasFill ? fill : null, strokes: list, compound: compound };
        });
    }

    function layerPaths(layer) {
        if (!layer._paths) {
            layer._paths = layer.image ? buildPaths(layer.image) : [];
        }
        return layer._paths;
    }

    //Board outline and drill paths, cached on the board object
    function boardPaths(board) {
        if (board._paths) {
            return board._paths;
        }
        var shape = new Path2D();
        board.outer.forEach(function (c) { G.emitContour(shape, c); });
        board.cutouts.forEach(function (c) { G.emitContour(shape, c); });
        var holes = new Path2D(), vias = new Path2D(), viaPads = new Path2D();
        board.holes.forEach(function (h) {
            if (h.via) {
                G.emitCircle(vias, h.x, h.y, h.r, true);
                //Typical via annular ring: 0.15 mm around the drill
                G.emitCircle(viaPads, h.x, h.y, h.r + 0.15, true);
            } else {
                G.emitCircle(holes, h.x, h.y, h.r, true);
            }
        });
        var slots = new Map();
        board.slots.forEach(function (s) {
            var p = slots.get(s.item.w);
            if (!p) {
                p = new Path2D();
                slots.set(s.item.w, p);
            }
            G.emitStroke(p, s.item);
        });
        var slotList = [];
        slots.forEach(function (p, w) { slotList.push({ w: w, p: p }); });
        board._paths = { shape: shape, holes: holes, vias: vias, viaPads: viaPads, slots: slotList };
        return board._paths;
    }

    function drawPaths(ctx, paths, color, minW) {
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (var i = 0; i < paths.length; i++) {
            var g = paths[i];
            ctx.globalCompositeOperation = g.dark ? 'source-over' : 'destination-out';
            if (g.fill) {
                ctx.fill(g.fill, 'nonzero');
            }
            for (var j = 0; j < g.strokes.length; j++) {
                ctx.lineWidth = Math.max(g.strokes[j].w, minW);
                ctx.stroke(g.strokes[j].p);
            }
            for (var k = 0; k < g.compound.length; k++) {
                ctx.save();
                ctx.clip(g.compound[k].clip);
                ctx.fill(g.compound[k].fill);
                ctx.restore();
            }
        }
        ctx.globalCompositeOperation = 'source-over';
    }

    /* ------------------------------------------------------------------
        Scratch canvases
    ------------------------------------------------------------------ */
    function Scratch() {
        this.list = [];
        this.w = 0;
        this.h = 0;
    }
    Scratch.prototype.get = function (i, w, h) {
        if (w !== this.w || h !== this.h) {
            this.list.forEach(function (c) {
                c.width = w;
                c.height = h;
            });
            this.w = w;
            this.h = h;
        }
        while (this.list.length <= i) {
            var c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            this.list.push(c);
        }
        var cv = this.list[i];
        var ctx = cv.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, w, h);
        return { canvas: cv, ctx: ctx };
    };
    Scratch.prototype.release = function () {
        this.list.forEach(function (c) {
            c.width = 0;
            c.height = 0;
        });
        this.list = [];
        this.w = this.h = 0;
    };

    function setM(ctx, m) {
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    }

    /* ------------------------------------------------------------------
        Scene drawing
    ------------------------------------------------------------------ */
    /*
        opts:
            width, height     device pixels
            matrix            board mm -> device px [a, b, c, d, e, f]
            scale             device px per mm (for hairlines)
            mode              'layers' | 'realistic'
            side              'top' | 'bottom' (realistic)
            layers            draw order, bottom first (layers mode)
            all               every layer (realistic picks by type)
            board             GV.board.build() result
            background        css colour or null for transparent
            look              {substrate, mask, maskAlpha, silk, finish, copper}
            grid              {step, color, major} or null
            scratch           Scratch instance
    */
    function drawScene(ctx, opts) {
        var W = opts.width, H = opts.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, W, H);
        if (opts.background) {
            ctx.fillStyle = opts.background;
            ctx.fillRect(0, 0, W, H);
        }
        var minW = 1 / Math.max(opts.scale, 1e-6);
        if (opts.grid) {
            drawGrid(ctx, opts);
        }
        if (opts.mode === 'realistic') {
            drawRealistic(ctx, opts, minW);
        } else {
            for (var i = 0; i < opts.layers.length; i++) {
                var layer = opts.layers[i];
                if (!layer.visible || !layer.image || !layer.image.groups.length) {
                    continue;
                }
                var s = opts.scratch.get(0, W, H);
                setM(s.ctx, opts.matrix);
                drawPaths(s.ctx, layerPaths(layer), layer.color, minW);
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(s.canvas, 0, 0);
                ctx.globalAlpha = 1;
            }
        }
    }

    function findLayer(all, type) {
        for (var i = 0; i < all.length; i++) {
            if (all[i].type === type && all[i].image && all[i].image.groups.length) {
                return all[i];
            }
        }
        return null;
    }

    function drawRealistic(ctx, opts, minW) {
        var W = opts.width, H = opts.height, m = opts.matrix;
        var look = opts.look;
        var side = opts.side === 'bottom' ? 'bottom' : 'top';
        var board = opts.board;
        if (!board || !board.outer.length) {
            return;
        }
        var bp = boardPaths(board);
        var copper = findLayer(opts.all, side + '-copper');
        var silk = findLayer(opts.all, side + '-silk');
        //The mask always comes from the file (its layer-view visibility does not
        //matter here); without a mask file the board is fully covered.
        //look.mask === null means the user picked a bare board.
        var mask = findLayer(opts.all, side + '-mask');
        var maskOn = !!look.mask;

        var B = opts.scratch.get(0, W, H);
        setM(B.ctx, m);
        B.ctx.fillStyle = look.substrate;
        B.ctx.fill(bp.shape, 'nonzero');

        var C = null;
        if (copper && copper.visible) {
            C = opts.scratch.get(1, W, H);
            setM(C.ctx, m);
            drawPaths(C.ctx, layerPaths(copper), look.copper, minW);
            B.ctx.setTransform(1, 0, 0, 1, 0, 0);
            B.ctx.drawImage(C.canvas, 0, 0);
        }

        /*
            look.via (manufacturing preview) overrides how the fab covers vias:
            'tent' / 'plug' mask over the ring, 'open' exposes it, 'resin' fills
            and caps it with plated copper. Undefined keeps the files as drawn.
        */
        var via = look.via;
        var viaPadShown = via === 'open' || via === 'resin';
        var O = null;
        if (maskOn && (mask || viaPadShown)) {
            O = opts.scratch.get(2, W, H);
            setM(O.ctx, m);
            if (mask) {
                drawPaths(O.ctx, layerPaths(mask), '#000', minW);
            }
            O.ctx.fillStyle = '#000';
            if (viaPadShown) {
                O.ctx.fill(bp.viaPads, 'nonzero');
            } else if (via === 'tent' || via === 'plug') {
                O.ctx.globalCompositeOperation = 'destination-out';
                O.ctx.fill(bp.viaPads, 'nonzero');
                O.ctx.globalCompositeOperation = 'source-over';
            }
        }
        if (C && via === 'resin') {
            //The cap is plated copper over the filled hole
            setM(C.ctx, m);
            C.ctx.fillStyle = look.copper;
            C.ctx.fill(bp.viaPads, 'nonzero');
        }

        if (maskOn) {
            var M = opts.scratch.get(3, W, H);
            setM(M.ctx, m);
            M.ctx.fillStyle = look.mask;
            M.ctx.fill(bp.shape, 'nonzero');
            if (O) {
                M.ctx.setTransform(1, 0, 0, 1, 0, 0);
                M.ctx.globalCompositeOperation = 'destination-out';
                M.ctx.drawImage(O.canvas, 0, 0);
                M.ctx.globalCompositeOperation = 'source-over';
            }
            B.ctx.setTransform(1, 0, 0, 1, 0, 0);
            B.ctx.globalAlpha = look.maskAlpha;
            B.ctx.drawImage(M.canvas, 0, 0);
            B.ctx.globalAlpha = 1;
            //Copper inside the mask openings gets the surface finish
            if (C && O) {
                C.ctx.setTransform(1, 0, 0, 1, 0, 0);
                C.ctx.globalCompositeOperation = 'source-in';
                C.ctx.fillStyle = look.finish;
                C.ctx.fillRect(0, 0, W, H);
                C.ctx.globalCompositeOperation = 'destination-in';
                C.ctx.drawImage(O.canvas, 0, 0);
                C.ctx.globalCompositeOperation = 'source-over';
                B.ctx.drawImage(C.canvas, 0, 0);
            }
        } else if (C) {
            C.ctx.setTransform(1, 0, 0, 1, 0, 0);
            C.ctx.globalCompositeOperation = 'source-in';
            C.ctx.fillStyle = look.finish;
            C.ctx.fillRect(0, 0, W, H);
            C.ctx.globalCompositeOperation = 'source-over';
            B.ctx.setTransform(1, 0, 0, 1, 0, 0);
            B.ctx.drawImage(C.canvas, 0, 0);
        }

        if (silk && silk.visible) {
            var S = opts.scratch.get(3, W, H);
            setM(S.ctx, m);
            drawPaths(S.ctx, layerPaths(silk), look.silk, minW);
            if (O) {
                //Fabs clip the legend away from exposed pads
                S.ctx.setTransform(1, 0, 0, 1, 0, 0);
                S.ctx.globalCompositeOperation = 'destination-out';
                S.ctx.drawImage(O.canvas, 0, 0);
                S.ctx.globalCompositeOperation = 'source-over';
            }
            B.ctx.setTransform(1, 0, 0, 1, 0, 0);
            B.ctx.drawImage(S.canvas, 0, 0);
        }

        //Trim everything to the board and punch the holes
        setM(B.ctx, m);
        B.ctx.globalCompositeOperation = 'destination-in';
        B.ctx.fillStyle = '#000';
        B.ctx.fill(bp.shape, 'nonzero');
        var drillsVisible = opts.all.some(function (l) { return l.type === 'drill' && l.visible; });
        if (drillsVisible || !opts.all.some(function (l) { return l.type === 'drill'; })) {
            B.ctx.globalCompositeOperation = 'destination-out';
            B.ctx.fill(bp.holes, 'nonzero');
            if (!via || via === 'open') {
                B.ctx.fill(bp.vias, 'nonzero');
            } else if (via === 'tent') {
                //Mask stretched over the hole shows as a small dimple
                B.ctx.globalCompositeOperation = 'source-atop';
                B.ctx.fillStyle = 'rgba(0,0,0,0.35)';
                B.ctx.fill(bp.vias, 'nonzero');
                B.ctx.globalCompositeOperation = 'destination-out';
            }
            B.ctx.strokeStyle = '#000';
            B.ctx.lineCap = 'round';
            bp.slots.forEach(function (s) {
                B.ctx.lineWidth = Math.max(s.w, minW);
                B.ctx.stroke(s.p);
            });
        }
        B.ctx.globalCompositeOperation = 'source-over';

        //Soft drop shadow lifts the board off the background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (opts.shadow) {
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = Math.min(24, Math.max(4, opts.scale * 0.6));
            ctx.shadowOffsetY = Math.min(8, Math.max(1, opts.scale * 0.15));
            ctx.drawImage(B.canvas, 0, 0);
            ctx.restore();
        } else {
            ctx.drawImage(B.canvas, 0, 0);
        }
    }

    //Grid lines in board space, drawn in screen space for crisp 1px lines
    function drawGrid(ctx, opts) {
        var inv = invert(opts.matrix);
        var corners = [[0, 0], [opts.width, 0], [0, opts.height], [opts.width, opts.height]].map(function (p) {
            return apply(inv, p[0], p[1]);
        });
        var x0 = Math.min.apply(null, corners.map(function (c) { return c[0]; }));
        var x1 = Math.max.apply(null, corners.map(function (c) { return c[0]; }));
        var y0 = Math.min.apply(null, corners.map(function (c) { return c[1]; }));
        var y1 = Math.max.apply(null, corners.map(function (c) { return c[1]; }));
        var step = opts.grid.step;
        if (!(step > 0) || (x1 - x0) / step > 2000 || (y1 - y0) / step > 2000) {
            return;
        }
        var major = opts.grid.major || 5;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineWidth = 1;
        var m = opts.matrix;
        function seg(ax, ay, bx, by) {
            var a = apply(m, ax, ay), b = apply(m, bx, by);
            ctx.moveTo(Math.round(a[0]) + 0.5, Math.round(a[1]) + 0.5);
            ctx.lineTo(Math.round(b[0]) + 0.5, Math.round(b[1]) + 0.5);
        }
        [false, true].forEach(function (isMajor) {
            ctx.beginPath();
            for (var x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
                var mj = Math.abs(Math.round(x / step) % major) === 0;
                if (mj === isMajor) {
                    seg(x, y0, x, y1);
                }
            }
            for (var y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
                var mj2 = Math.abs(Math.round(y / step) % major) === 0;
                if (mj2 === isMajor) {
                    seg(x0, y, x1, y);
                }
            }
            ctx.strokeStyle = isMajor ? opts.grid.majorColor : opts.grid.color;
            ctx.stroke();
        });
        ctx.restore();
    }

    function apply(m, x, y) {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    function invert(m) {
        var det = m[0] * m[3] - m[1] * m[2];
        if (!det) {
            return [1, 0, 0, 1, 0, 0];
        }
        var a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
        return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
    }

    //Board -> device matrix for a view {cx, cy, scale, rot, flip} on a W x H canvas
    function viewMatrix(view, W, H, k) {
        var s = view.scale * k;
        var th = (view.rot || 0) * Math.PI / 180;
        var cs = Math.cos(th), sn = Math.sin(th);
        cs = Math.abs(cs) < 1e-12 ? 0 : cs;
        sn = Math.abs(sn) < 1e-12 ? 0 : sn;
        var mx = view.flip ? -1 : 1;
        var a = s * mx * cs, c = -s * mx * sn, b = -s * sn, d = -s * cs;
        return [a, b, c, d, W / 2 - (a * view.cx + c * view.cy), H / 2 - (b * view.cx + d * view.cy)];
    }

    /* ------------------------------------------------------------------
        Interactive viewer
    ------------------------------------------------------------------ */
    function Viewer(base, overlay) {
        this.base = base;
        this.overlay = overlay;
        this.view = { cx: 0, cy: 0, scale: 8, rot: 0, flip: false };
        this.scratch = new Scratch();
        this.dpr = 1;
        this.cssW = 1;
        this.cssH = 1;
        this.getScene = null;       //() -> partial drawScene opts
        this.drawOverlay = null;    //(ctx, viewer) -> void
        this.onViewChange = null;
        this._raf = 0;
        this._ovRaf = 0;
        this.lastRenderMs = 0;
    }

    Viewer.prototype.resize = function () {
        var r = this.base.parentNode.getBoundingClientRect();
        this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        this.cssW = Math.max(1, r.width);
        this.cssH = Math.max(1, r.height);
        var w = Math.round(this.cssW * this.dpr), h = Math.round(this.cssH * this.dpr);
        [this.base, this.overlay].forEach(function (c) {
            if (c.width !== w || c.height !== h) {
                c.width = w;
                c.height = h;
            }
        });
        this.requestRender();
    };

    Viewer.prototype.matrix = function (k) {
        return viewMatrix(this.view, this.cssW * (k || 1), this.cssH * (k || 1), k || 1);
    };

    Viewer.prototype.toBoard = function (x, y) {
        return apply(invert(this.matrix(1)), x, y);
    };

    Viewer.prototype.toScreen = function (x, y) {
        return apply(this.matrix(1), x, y);
    };

    Viewer.prototype.fit = function (b, pad) {
        if (!G.boundsValid(b)) {
            return;
        }
        pad = pad === undefined ? 40 : pad;
        var rotated = (this.view.rot / 90) % 2 !== 0;
        var bw = Math.max(b[2] - b[0], 1e-3), bh = Math.max(b[3] - b[1], 1e-3);
        if (rotated) {
            var t = bw;
            bw = bh;
            bh = t;
        }
        this.view.scale = Math.max(1e-3, Math.min((this.cssW - pad * 2) / bw, (this.cssH - pad * 2) / bh));
        this.view.cx = (b[0] + b[2]) / 2;
        this.view.cy = (b[1] + b[3]) / 2;
        this.changed();
    };

    Viewer.prototype.clampScale = function (s) {
        return Math.max(0.05, Math.min(s, 20000));
    };

    Viewer.prototype.zoomAt = function (factor, sx, sy) {
        var before = this.toBoard(sx, sy);
        this.view.scale = this.clampScale(this.view.scale * factor);
        var after = this.toBoard(sx, sy);
        this.view.cx += before[0] - after[0];
        this.view.cy += before[1] - after[1];
        this.changed();
    };

    Viewer.prototype.panBy = function (dx, dy) {
        var a = this.toBoard(0, 0), b = this.toBoard(dx, dy);
        this.view.cx -= b[0] - a[0];
        this.view.cy -= b[1] - a[1];
        this.changed();
    };

    Viewer.prototype.centerOn = function (x, y) {
        this.view.cx = x;
        this.view.cy = y;
        this.changed();
    };

    Viewer.prototype.changed = function () {
        this.requestRender();
        if (this.onViewChange) {
            this.onViewChange(this);
        }
    };

    Viewer.prototype.requestRender = function () {
        var self = this;
        if (this._raf) {
            return;
        }
        this._raf = requestAnimationFrame(function () {
            self._raf = 0;
            self.renderNow();
        });
    };

    Viewer.prototype.renderNow = function () {
        if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = 0;
        }
        var t0 = performance.now();
        var ctx = this.base.getContext('2d');
        var scene = this.getScene ? this.getScene() : null;
        if (!scene) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this.base.width, this.base.height);
        } else {
            scene.width = this.base.width;
            scene.height = this.base.height;
            scene.matrix = this.matrix(this.dpr);
            scene.scale = this.view.scale * this.dpr;
            scene.scratch = this.scratch;
            drawScene(ctx, scene);
        }
        this.lastRenderMs = performance.now() - t0;
        this.renderOverlay();
    };

    Viewer.prototype.requestOverlay = function () {
        var self = this;
        if (this._ovRaf || this._raf) {
            return;
        }
        this._ovRaf = requestAnimationFrame(function () {
            self._ovRaf = 0;
            self.renderOverlay();
        });
    };

    Viewer.prototype.renderOverlay = function () {
        var ctx = this.overlay.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        if (this.drawOverlay) {
            ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            this.drawOverlay(ctx, this);
        }
    };

    //Render an arbitrary view to a new canvas (export, print, thumbnails)
    function renderToCanvas(scene, view, width, height, scratch) {
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(width));
        cv.height = Math.max(1, Math.round(height));
        var own = !scratch;
        scratch = scratch || new Scratch();
        var opts = Object.assign({}, scene, {
            width: cv.width,
            height: cv.height,
            matrix: viewMatrix(view, cv.width, cv.height, 1),
            scale: view.scale,
            scratch: scratch
        });
        drawScene(cv.getContext('2d'), opts);
        if (own) {
            scratch.release();
        }
        return cv;
    }

    //Grid step (mm) so lines are at least minPx apart
    function niceStep(scale, minPx, imperial) {
        var base = imperial ? MM_PER_INCH / 1000 : 0.001; //1 mil or 1 um
        var steps = [1, 2, 5];
        for (var e = 0; e < 12; e++) {
            for (var i = 0; i < steps.length; i++) {
                var st = base * steps[i] * Math.pow(10, e);
                if (st * scale >= minPx) {
                    return st;
                }
            }
        }
        return 1000;
    }

    GV.render = {
        CSS_PX_PER_MM: CSS_PX_PER_MM,
        layerPaths: layerPaths,
        boardPaths: boardPaths,
        drawPaths: drawPaths,
        drawScene: drawScene,
        viewMatrix: viewMatrix,
        renderToCanvas: renderToCanvas,
        Scratch: Scratch,
        apply: apply,
        invert: invert,
        niceStep: niceStep
    };
    GV.Viewer = Viewer;
})(typeof window !== 'undefined' ? (window.GV = window.GV || {}) : (global.GV = global.GV || {}));
