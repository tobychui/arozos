/*
    Gerber Viewer - board shape and drill summary

    GV.board.build(layers) turns the outline layer's strokes into closed loops
    (board edge + cut-outs) and collects every hole and slot from the drill
    layers. The realistic renderer, the 3D view and the board report use it.
*/
(function (GV) {
    'use strict';

    var G = GV.geom;

    //Convert outline items to open polylines (and closed contours from regions)
    function outlinePieces(layer) {
        var open = [], closed = [];
        layer.image.groups.forEach(function (g) {
            if (!g.dark) {
                return;
            }
            g.items.forEach(function (it) {
                if (it.t === 'l') {
                    if (it.x1 !== it.x2 || it.y1 !== it.y2) {
                        open.push([it.x1, it.y1, it.x2, it.y2]);
                    }
                } else if (it.t === 'a') {
                    var s = G.arcStart(it);
                    var pts = [s[0], s[1]];
                    G.flattenArc(pts, it.cx, it.cy, it.r, it.a0, it.sw);
                    if (Math.abs(it.sw) >= G.TAU - 1e-9) {
                        G.dropClosingPoint(pts);
                        closed.push(pts);
                    } else {
                        open.push(pts);
                    }
                } else if (it.t === 'p' && it.o && it.o.k === 'region') {
                    it.c.forEach(function (c) { closed.push(c.slice()); });
                }
            });
        });
        return { open: open, closed: closed };
    }

    //Join polylines end to end into loops
    function chain(polys, tol) {
        var used = new Array(polys.length);
        var grid = new Map();
        var cell = tol * 2;
        function key(x, y) {
            return Math.floor(x / cell) + ',' + Math.floor(y / cell);
        }
        function index(i) {
            var p = polys[i];
            [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]].forEach(function (pt) {
                var k = key(pt[0], pt[1]);
                if (!grid.has(k)) {
                    grid.set(k, []);
                }
                grid.get(k).push(i);
            });
        }
        for (var i = 0; i < polys.length; i++) {
            index(i);
        }
        function find(x, y) {
            var cx = Math.floor(x / cell), cy = Math.floor(y / cell);
            var best = -1, bestD = tol, bestRev = false;
            for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                    var list = grid.get((cx + dx) + ',' + (cy + dy));
                    if (!list) {
                        continue;
                    }
                    for (var k = 0; k < list.length; k++) {
                        var j = list[k];
                        if (used[j]) {
                            continue;
                        }
                        var p = polys[j];
                        var d0 = Math.hypot(p[0] - x, p[1] - y);
                        var d1 = Math.hypot(p[p.length - 2] - x, p[p.length - 1] - y);
                        if (d0 <= bestD) {
                            best = j; bestD = d0; bestRev = false;
                        }
                        if (d1 <= bestD) {
                            best = j; bestD = d1; bestRev = true;
                        }
                    }
                }
            }
            return best < 0 ? null : { i: best, rev: bestRev };
        }
        function appendTo(path, p, rev) {
            var n = p.length / 2;
            for (var k = 1; k < n; k++) {
                var idx = rev ? n - 1 - k : k;
                path.push(p[idx * 2], p[idx * 2 + 1]);
            }
        }
        var loops = [], openChains = [];
        for (var s = 0; s < polys.length; s++) {
            if (used[s]) {
                continue;
            }
            used[s] = true;
            var path = polys[s].slice();
            var closedLoop = false;
            for (var pass = 0; pass < 2 && !closedLoop; pass++) {
                for (;;) {
                    var n = path.length;
                    if (n >= 6 && Math.hypot(path[0] - path[n - 2], path[1] - path[n - 1]) <= tol) {
                        closedLoop = true;
                        break;
                    }
                    var f = find(path[n - 2], path[n - 1]);
                    if (!f) {
                        break;
                    }
                    used[f.i] = true;
                    appendTo(path, polys[f.i], f.rev);
                }
                if (!closedLoop) {
                    //Grow from the other end too
                    path = G.reverseContour(path);
                }
            }
            if (!closedLoop && path.length >= 6) {
                var gap = Math.hypot(path[0] - path[path.length - 2], path[1] - path[path.length - 1]);
                var bb = boundsOf(path);
                if (gap < Math.max(0.5, 0.02 * Math.max(bb[2] - bb[0], bb[3] - bb[1]))) {
                    closedLoop = true;
                }
            }
            if (closedLoop) {
                G.dropClosingPoint(path);
                if (path.length >= 6) {
                    loops.push(path);
                }
            } else {
                openChains.push(path);
            }
        }
        return { loops: loops, open: openChains };
    }

    function boundsOf(c) {
        var b = G.emptyBounds();
        for (var i = 0; i < c.length; i += 2) {
            if (c[i] < b[0]) b[0] = c[i];
            if (c[i + 1] < b[1]) b[1] = c[i + 1];
            if (c[i] > b[2]) b[2] = c[i];
            if (c[i + 1] > b[3]) b[3] = c[i + 1];
        }
        return b;
    }

    function insideCount(loop, others) {
        var x = loop[0], y = loop[1];
        var depth = 0;
        for (var i = 0; i < others.length; i++) {
            if (others[i] !== loop && G.windingNumber(others[i], x, y) !== 0) {
                depth++;
            }
        }
        return depth;
    }

    //Largest drill treated as a via when no file says which holes are vias
    var VIA_MAX_DIA = 0.45;

    //EasyEDA repeats every via in the PTH file as well, so identical holes
    //(same place and size) are only counted once. Via files are read first
    //so a repeated via keeps its via flag.
    function drillItems(layers) {
        var holes = [], slots = [];
        var seen = new Set();
        var drills = layers.filter(function (l) { return l.type === 'drill' && l.image; });
        var hasViaFile = drills.some(function (l) { return l.via; });
        drills.sort(function (a, b) { return (b.via ? 1 : 0) - (a.via ? 1 : 0); });
        drills.forEach(function (layer) {
            layer.image.groups.forEach(function (g) {
                g.items.forEach(function (it) {
                    var plated = it.o && it.o.plated !== null && it.o.plated !== undefined ? it.o.plated : layer.plated;
                    if (it.t === 'c') {
                        var key = Math.round(it.x * 1000) + ',' + Math.round(it.y * 1000) + ',' + Math.round(it.r * 1000);
                        if (seen.has(key)) {
                            return;
                        }
                        seen.add(key);
                        var via = hasViaFile ? !!layer.via : (plated !== false && it.r * 2 <= VIA_MAX_DIA);
                        holes.push({ x: it.x, y: it.y, r: it.r, plated: plated !== false, via: via, layer: layer, o: it.o });
                    } else if (it.t === 'l' || it.t === 'a') {
                        slots.push({ item: it, plated: plated !== false, layer: layer });
                    }
                });
            });
        });
        return { holes: holes, slots: slots };
    }

    //Slot outline (stadium) as a contour, used to cut slots out of the 3D board
    function slotContour(it) {
        if (it.t === 'l') {
            var ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
            var r = it.w / 2;
            var c = [it.x2 + r * Math.cos(ang - Math.PI / 2), it.y2 + r * Math.sin(ang - Math.PI / 2)];
            G.flattenArc(c, it.x2, it.y2, r, ang - Math.PI / 2, Math.PI);
            c.push(it.x1 + r * Math.cos(ang + Math.PI / 2), it.y1 + r * Math.sin(ang + Math.PI / 2));
            G.flattenArc(c, it.x1, it.y1, r, ang + Math.PI / 2, Math.PI);
            G.dropClosingPoint(c);
            return G.orient(c, true);
        }
        //Arc slot: outer arc, end cap, inner arc back, start cap
        var w = it.w / 2;
        var pts = [];
        var a0 = it.a0, sw = it.sw;
        var ro = it.r + w, ri = Math.max(0, it.r - w);
        pts.push(it.cx + ro * Math.cos(a0), it.cy + ro * Math.sin(a0));
        G.flattenArc(pts, it.cx, it.cy, ro, a0, sw);
        var e = G.arcEnd(it);
        var dir = sw > 0 ? 1 : -1;
        G.flattenArc(pts, e[0], e[1], w, a0 + sw, dir * Math.PI);
        G.flattenArc(pts, it.cx, it.cy, ri, a0 + sw, -sw);
        var s = G.arcStart(it);
        G.flattenArc(pts, s[0], s[1], w, a0 + Math.PI, dir * Math.PI);
        G.dropClosingPoint(pts);
        return G.orient(pts, true);
    }

    function build(layers) {
        var outline = layers.filter(function (l) { return l.type === 'outline' && l.image && l.image.groups.length; })[0];
        var loops = [];
        var source = 'none';
        if (outline) {
            var pieces = outlinePieces(outline);
            var widest = 0;
            outline.image.groups.forEach(function (g) {
                g.items.forEach(function (it) {
                    if (it.w > widest) {
                        widest = it.w;
                    }
                });
            });
            var tol = Math.max(0.02, Math.min(0.2, widest / 2));
            var ch = chain(pieces.open, tol);
            loops = ch.loops.concat(pieces.closed);
            if (loops.length) {
                source = 'outline';
            }
        }

        //Drop loops that are basically a dot (tiny marks on the outline layer)
        loops = loops.filter(function (l) {
            return Math.abs(G.signedArea(l)) > 0.01;
        });

        var outer = [], cutouts = [];
        loops.sort(function (a, b) { return Math.abs(G.signedArea(b)) - Math.abs(G.signedArea(a)); });
        loops.forEach(function (l) {
            var depth = insideCount(l, loops);
            if (depth % 2 === 0) {
                outer.push(G.orient(l, true));
            } else {
                cutouts.push(G.orient(l, false));
            }
        });

        var bounds = G.emptyBounds();
        outer.forEach(function (l) { G.unionBounds(bounds, boundsOf(l)); });

        if (!outer.length) {
            //No usable outline: fall back to the copper (or everything's) extent
            var pick = layers.filter(function (l) { return l.image && /copper/.test(l.type) && G.boundsValid(l.image.bounds); });
            if (!pick.length) {
                pick = layers.filter(function (l) { return l.image && l.type !== 'document' && G.boundsValid(l.image.bounds); });
            }
            pick.forEach(function (l) { G.unionBounds(bounds, l.image.bounds); });
            if (G.boundsValid(bounds)) {
                var pad = 0.5;
                bounds = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad];
                outer.push([bounds[0], bounds[1], bounds[2], bounds[1], bounds[2], bounds[3], bounds[0], bounds[3]]);
                source = 'extent';
            }
        }

        var drills = drillItems(layers);
        var w = G.boundsValid(bounds) ? bounds[2] - bounds[0] : 0, h = G.boundsValid(bounds) ? bounds[3] - bounds[1] : 0;
        var outerArea = outer.reduce(function (s, l) { return s + Math.abs(G.signedArea(l)); }, 0);
        return {
            //A single outline that fills its bounding box: V-cut friendly
            rect: outer.length === 1 && w > 0 && Math.abs(outerArea - w * h) < 0.01 * w * h,
            source: source,
            outer: outer,
            cutouts: cutouts,
            bounds: bounds,
            width: G.boundsValid(bounds) ? bounds[2] - bounds[0] : 0,
            height: G.boundsValid(bounds) ? bounds[3] - bounds[1] : 0,
            area: outer.reduce(function (s, l) { return s + Math.abs(G.signedArea(l)); }, 0) -
                cutouts.reduce(function (s, l) { return s + Math.abs(G.signedArea(l)); }, 0),
            holes: drills.holes,
            slots: drills.slots
        };
    }

    //Is a point inside the board (outer loops minus cut-outs)?
    function contains(board, x, y) {
        var wn = 0;
        board.outer.forEach(function (l) { wn += G.windingNumber(l, x, y); });
        board.cutouts.forEach(function (l) { wn += G.windingNumber(l, x, y); });
        return wn !== 0;
    }

    GV.board = {
        build: build,
        contains: contains,
        slotContour: slotContour,
        boundsOf: boundsOf
    };
})(typeof window !== 'undefined' ? (window.GV = window.GV || {}) : (global.GV = global.GV || {}));
