/*
    PDF Editor - objects on the pages

    Draws the objects the user added (as SVG in each object's own box, so
    the zoom only moves boxes), and handles selecting, moving, resizing,
    rotating, the creation tools (text, shapes, ink, markup, redaction,
    white-out, links, crop, placing a picture) and inline text editing.
    The object model is described in js/doc.js.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var V = PE.view;
    var F = PE.fonts;

    var O = PE.objs = {
        style: {
            text: { font: 'helv', size: 12, color: '#000000', bold: false, italic: false, align: 'left' },
            shape: { stroke: '#d13438', fill: null, sw: 2 },
            ink: { stroke: '#0f6cbd', sw: 2 },
            highlight: { color: '#ffd400' },
            underline: { color: '#107c10' },
            strike: { color: '#e81123' }
        }
    };

    var sel = { k: -1, ids: [] };
    var editing = null;
    var clip = null;
    var drag = null;
    var nudgeSnap = null, nudgeTimer = null;

    function num(v) {
        return Math.round(v * 1000) / 1000;
    }

    /* ------------------------------------------------------------ SVG */
    function dash(o) {
        return o.dash ? ' stroke-dasharray="' + num((o.sw || 1) * 3) + ' ' + num((o.sw || 1) * 2) + '"' : '';
    }

    O.textStyle = function (o) {
        return 'font-family:' + F.css(o.font || 'helv').replace(/"/g, '\'') + ';font-size:' + num(o.size || 12) + 'px;font-weight:' +
            (o.bold ? 700 : 400) + ';font-style:' + (o.italic ? 'italic' : 'normal') + ';font-kerning:none;white-space:pre';
    };

    O.svgBody = function (o) {
        var w = o.w, h = o.h;
        var p = [];
        switch (o.type) {
            case 'text': {
                var L = F.layout(o);
                var bw = o.border ? (o.borderW || 1) : 0;
                if (o.bg || o.border) {
                    p.push('<rect x="' + num(bw / 2) + '" y="' + num(bw / 2) + '" width="' + num(Math.max(0, w - bw)) + '" height="' +
                        num(Math.max(0, h - bw)) + '" rx="' + num(o.radius || 0) + '" fill="' + (o.bg || 'none') + '" stroke="' +
                        (o.border || 'none') + '" stroke-width="' + num(bw) + '"/>');
                }
                var st = O.textStyle(o);
                L.lines.forEach(function (ln, i) {
                    var x = F.lineX(o, L, ln);
                    var y = F.baseline(L, i);
                    if (ln.text) {
                        p.push('<text x="' + num(x) + '" y="' + num(y) + '" fill="' + (o.color || '#000') + '" style="' + st + '">' +
                            PE.esc(ln.text) + '</text>');
                    }
                    var th = Math.max(0.5, L.size * 0.06);
                    if (o.underline && ln.width > 0) {
                        p.push('<rect x="' + num(x) + '" y="' + num(y + L.size * 0.1) + '" width="' + num(ln.width) + '" height="' + num(th) + '" fill="' + (o.color || '#000') + '"/>');
                    }
                    if (o.strike && ln.width > 0) {
                        p.push('<rect x="' + num(x) + '" y="' + num(y - L.size * 0.3) + '" width="' + num(ln.width) + '" height="' + num(th) + '" fill="' + (o.color || '#000') + '"/>');
                    }
                });
                break;
            }
            case 'image': {
                var a = D.assets[o.asset];
                if (a) {
                    p.push('<image href="' + a.url + '" x="0" y="0" width="' + num(w) + '" height="' + num(h) + '" preserveAspectRatio="none"/>');
                }
                break;
            }
            case 'rect': {
                var sw = o.stroke ? (o.sw || 0) : 0;
                p.push('<rect x="' + num(sw / 2) + '" y="' + num(sw / 2) + '" width="' + num(Math.max(0, w - sw)) + '" height="' + num(Math.max(0, h - sw)) +
                    '" rx="' + num(o.radius || 0) + '" fill="' + (o.fill || 'none') + '" stroke="' + (o.stroke || 'none') + '" stroke-width="' + num(sw) + '"' + dash(o) + '/>');
                break;
            }
            case 'ellipse': {
                var sw2 = o.stroke ? (o.sw || 0) : 0;
                p.push('<ellipse cx="' + num(w / 2) + '" cy="' + num(h / 2) + '" rx="' + num(Math.max(0, (w - sw2) / 2)) + '" ry="' + num(Math.max(0, (h - sw2) / 2)) +
                    '" fill="' + (o.fill || 'none') + '" stroke="' + (o.stroke || 'none') + '" stroke-width="' + num(sw2) + '"' + dash(o) + '/>');
                break;
            }
            case 'line': {
                var lw = o.sw || 1;
                var y0 = h / 2;
                var ah = O.arrowSize(o);
                var x0 = o.arrow === 'both' ? ah * 0.8 : 0;
                var x1 = o.arrow === 'end' || o.arrow === 'both' ? w - ah * 0.8 : w;
                p.push('<line x1="' + num(x0) + '" y1="' + num(y0) + '" x2="' + num(Math.max(x0, x1)) + '" y2="' + num(y0) + '" stroke="' + (o.stroke || '#000') +
                    '" stroke-width="' + num(lw) + '" stroke-linecap="' + (o.dash ? 'butt' : 'round') + '"' + dash(o) + '/>');
                if (o.arrow === 'end' || o.arrow === 'both') {
                    p.push('<polygon points="' + num(w) + ',' + num(y0) + ' ' + num(w - ah) + ',' + num(y0 - ah * 0.45) + ' ' + num(w - ah) + ',' + num(y0 + ah * 0.45) + '" fill="' + (o.stroke || '#000') + '"/>');
                }
                if (o.arrow === 'both') {
                    p.push('<polygon points="0,' + num(y0) + ' ' + num(ah) + ',' + num(y0 - ah * 0.45) + ' ' + num(ah) + ',' + num(y0 + ah * 0.45) + '" fill="' + (o.stroke || '#000') + '"/>');
                }
                break;
            }
            case 'ink': {
                p.push('<path d="' + O.inkPath(o) + '" fill="none" stroke="' + (o.stroke || '#000') + '" stroke-width="' + num(o.sw || 1) +
                    '" stroke-linecap="round" stroke-linejoin="round"/>');
                break;
            }
            case 'markup': {
                O.markupShapes(o).forEach(function (r) {
                    p.push('<rect x="' + num(r.x - o.x) + '" y="' + num(r.y - o.y) + '" width="' + num(r.w) + '" height="' + num(r.h) + '" fill="' + (o.color || '#ffd400') + '"' +
                        (o.kind === 'highlight' ? ' fill-opacity="0.45"' : '') + '/>');
                });
                break;
            }
            case 'redact':
                p.push('<rect x="0" y="0" width="' + num(w) + '" height="' + num(h) + '" fill="#000"/>');
                break;
            default:
                break;
        }
        return p.join('');
    };

    O.arrowSize = function (o) {
        return Math.max(7, (o.sw || 1) * 3.6);
    };

    O.inkPath = function (o) {
        var d = '';
        (o.pts || []).forEach(function (pt, i) {
            d += (i ? 'L' : 'M') + num(pt[0] * o.w) + ' ' + num(pt[1] * o.h);
        });
        return d;
    };

    /* The rectangles a markup paints (view space): the whole line for a
       highlight, a thin bar under / through it for the others */
    O.markupShapes = function (o) {
        if (o.kind === 'highlight') {
            return o.rects;
        }
        var a = ((o.angle || 0) % 360 + 360) % 360;
        return o.rects.map(function (r) {
            var vertical = a === 90 || a === 270;
            var thick = Math.max(0.8, (vertical ? r.w : r.h) * 0.075);
            var f = o.kind === 'underline' ? 0.86 : 0.52;
            if (!vertical) {
                var y = a === 180 ? r.y + r.h * (1 - f) : r.y + r.h * f;
                return { x: r.x, y: y - thick / 2, w: r.w, h: thick };
            }
            var x = a === 90 ? r.x + r.w * (1 - f) : r.x + r.w * f;
            return { x: x - thick / 2, y: r.y, w: thick, h: r.h };
        });
    };

    O.makeEl = function (o, s, interactive) {
        var el = PE.el('div', 'pe-obj t-' + o.type + (o.type === 'markup' && o.kind === 'highlight' ? ' markup' : '') +
            (o.type === 'link' ? ' link' : '') + (o.type === 'redact' ? ' redact' : '') + (interactive ? '' : ' static'));
        if (interactive) {
            el.dataset.id = o.id;
        }
        placeEl(el, o, s);
        if (o.type !== 'link') {
            el.innerHTML = '<svg viewBox="0 0 ' + num(Math.max(o.w, 0.01)) + ' ' + num(Math.max(o.h, 0.01)) + '" preserveAspectRatio="none"' +
                (o.opacity !== undefined && o.opacity < 1 ? ' style="opacity:' + o.opacity + '"' : '') + '>' + O.svgBody(o) + '</svg>';
        } else {
            el.title = o.url ? o.url : PE.T('link/toPage', 'Go to page {n}', { n: (o.page || 0) + 1 });
        }
        return el;
    };

    function placeEl(el, o, s) {
        el.style.left = o.x * s + 'px';
        el.style.top = o.y * s + 'px';
        el.style.width = Math.max(1, o.w * s) + 'px';
        el.style.height = Math.max(1, o.h * s) + 'px';
        el.style.transform = o.angle ? 'rotate(' + o.angle + 'deg)' : '';
    }

    /* ------------------------------------------------------------ layer */
    O.renderLayer = function (layer, k, s, interactive) {
        var p = D.pages[k];
        if (!p) {
            return;
        }
        var keepEditor = editing && editing.k === k && interactive ? editing.el : null;
        layer.innerHTML = '';
        p.objs.forEach(function (o) {
            var el = O.makeEl(o, s, interactive);
            if (interactive && editing && editing.id === o.id) {
                el.classList.add('editing');
            }
            layer.appendChild(el);
        });
        if (!interactive) {
            return;
        }
        if (keepEditor) {
            layer.appendChild(keepEditor);
            placeEditor();
        }
        if (sel.k === k) {
            drawSel();
        }
    };

    function layerOf(k) {
        var el = V.pageEl(k);
        return el ? el._pe.objs : null;
    }

    function objEl(id, k) {
        var layer = layerOf(k);
        return layer ? layer.querySelector('.pe-obj[data-id="' + id + '"]') : null;
    }

    /* Update one object's element in place (fast path for drags) */
    function redrawObj(o, k) {
        var layer = layerOf(k);
        if (!layer) {
            return;
        }
        var old = objEl(o.id, k);
        var el = O.makeEl(o, V.scale(), true);
        if (editing && editing.id === o.id) {
            el.classList.add('editing');
        }
        if (old) {
            layer.replaceChild(el, old);
        } else {
            layer.appendChild(el);
        }
    }

    /* ------------------------------------------------------------ selection */
    O.selected = function () {
        if (sel.k < 0 || !D.pages[sel.k]) {
            return [];
        }
        var p = D.pages[sel.k];
        return p.objs.filter(function (o) { return sel.ids.indexOf(o.id) >= 0; });
    };

    O.selPage = function () {
        return sel.k;
    };

    O.select = function (ids, k, add) {
        if (add && sel.k === k) {
            ids.forEach(function (id) {
                var i = sel.ids.indexOf(id);
                if (i >= 0) {
                    sel.ids.splice(i, 1);
                } else {
                    sel.ids.push(id);
                }
            });
        } else {
            var oldK = sel.k;
            sel = { k: k, ids: ids.slice() };
            if (oldK !== k && oldK >= 0) {
                clearSelBoxes(oldK);
            }
        }
        drawSel();
        PE.emitSel && PE.emitSel();
    };

    O.clearSel = function () {
        if (!sel.ids.length && sel.k < 0) {
            return;
        }
        var k = sel.k;
        sel = { k: -1, ids: [] };
        if (k >= 0) {
            clearSelBoxes(k);
        }
        PE.emitSel && PE.emitSel();
    };

    function clearSelBoxes(k) {
        var layer = layerOf(k);
        if (layer) {
            Array.prototype.forEach.call(layer.querySelectorAll('.pe-sel'), function (b) {
                b.parentNode.removeChild(b);
            });
        }
    }

    function handlesFor(o) {
        switch (o.type) {
            case 'text': return ['w', 'e', 'rot'];
            case 'line': return ['p1', 'p2'];
            case 'markup': return [];
            case 'link': case 'redact': return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
            default: return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rot'];
        }
    }

    var HPOS = {
        nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5]
    };
    var HCUR = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];

    function cursorFor(h, angle) {
        var base = { n: 0, ne: 1, e: 2, se: 3, s: 0, sw: 1, w: 2, nw: 3 }[h];
        var steps = Math.round(((angle || 0) % 180 + 180) % 180 / 45);
        return HCUR[(base + steps) % 4];
    }

    function drawSel() {
        if (sel.k < 0) {
            return;
        }
        var layer = layerOf(sel.k);
        if (!layer) {
            return;
        }
        clearSelBoxes(sel.k);
        var s = V.scale();
        var objs = O.selected();
        var single = objs.length === 1;
        objs.forEach(function (o) {
            var b = PE.el('div', 'pe-sel' + (single ? '' : ' multi'));
            b.dataset.for = o.id;
            placeEl(b, o, s);
            if (single && !(editing && editing.id === o.id)) {
                var hs = handlesFor(o);
                hs.forEach(function (h) {
                    var e = PE.el('div', 'pe-h ' + (h === 'rot' ? 'rot' : (h === 'p1' || h === 'p2' ? 'end' : '')));
                    e.dataset.h = h;
                    if (h === 'rot') {
                        e.style.left = '50%';
                        e.style.top = '-22px';
                        b.appendChild(PE.el('div', 'stem'));
                    } else if (h === 'p1' || h === 'p2') {
                        e.style.left = (h === 'p1' ? 0 : 100) + '%';
                        e.style.top = '50%';
                    } else {
                        e.style.left = HPOS[h][0] * 100 + '%';
                        e.style.top = HPOS[h][1] * 100 + '%';
                        e.style.cursor = cursorFor(h, o.angle);
                    }
                    e.addEventListener('pointerdown', function (ev) {
                        startHandleDrag(ev, o.id, h);
                    });
                    b.appendChild(e);
                });
            }
            if (o.type === 'line') {
                b.style.borderColor = 'transparent';
            }
            layer.appendChild(b);
        });
    }
    O.drawSel = drawSel;

    function updateSelBox(o) {
        var layer = layerOf(sel.k);
        if (!layer) {
            return;
        }
        var b = layer.querySelector('.pe-sel[data-for="' + o.id + '"]');
        if (b) {
            placeEl(b, o, V.scale());
        }
    }

    /* ------------------------------------------------------------ add / change */
    O.add = function (k, o, opts) {
        opts = opts || {};
        o.id = o.id || PE.uid();
        if (o.angle === undefined) {
            o.angle = 0;
        }
        var snap = opts.snap || D.snapshot();
        D.pages[k].objs.push(o);
        if (!opts.noUndo) {
            D.pushUndo(snap);
        }
        V.refreshPage(k);
        D.emit('objects', { k: k });
        if (opts.select !== false) {
            O.select([o.id], k);
        }
        return o;
    };

    /* Patch the selected objects (or the given ids) with undo */
    O.update = function (patch, ids, opts) {
        var list = ids ? ids.map(function (id) { return D.find(id); }).filter(Boolean).map(function (f) { return f.o; }) : O.selected();
        if (!list.length) {
            return;
        }
        var snap = D.snapshot();
        var pages = {};
        list.forEach(function (o) {
            var f = D.find(o.id);
            pages[f.k] = true;
            var p = typeof patch === 'function' ? patch(o) : patch;
            if (p) {
                Object.keys(p).forEach(function (key) {
                    if (p[key] === undefined) {
                        delete o[key];
                    } else {
                        o[key] = p[key];
                    }
                });
            }
            if (o.type === 'text') {
                F.fit(o);
            }
        });
        if (!(opts && opts.noUndo)) {
            D.pushUndo(snap);
        }
        Object.keys(pages).forEach(function (k) {
            V.refreshPage(+k);
        });
        D.emit('objects', {});
        PE.emitSel && PE.emitSel();
    };

    O.remove = function (ids) {
        if (!ids.length) {
            return;
        }
        var snap = D.snapshot();
        var pages = {};
        ids.forEach(function (id) {
            var f = D.find(id);
            if (f) {
                D.pages[f.k].objs.splice(f.j, 1);
                pages[f.k] = true;
            }
        });
        D.pushUndo(snap);
        sel.ids = sel.ids.filter(function (id) { return ids.indexOf(id) < 0; });
        Object.keys(pages).forEach(function (k) {
            V.refreshPage(+k);
        });
        D.emit('objects', {});
        PE.emitSel && PE.emitSel();
    };

    O.deleteSel = function () {
        O.remove(sel.ids.slice());
    };

    O.order = function (dir) {
        var objs = O.selected();
        if (!objs.length) {
            return;
        }
        var p = D.pages[sel.k];
        var snap = D.snapshot();
        var ids = objs.map(function (o) { return o.id; });
        var rest = p.objs.filter(function (o) { return ids.indexOf(o.id) < 0; });
        var moving = p.objs.filter(function (o) { return ids.indexOf(o.id) >= 0; });
        if (dir > 0) {
            p.objs = rest.concat(moving);
        } else {
            p.objs = moving.concat(rest);
        }
        D.pushUndo(snap);
        V.refreshPage(sel.k);
        D.emit('objects', { k: sel.k });
    };

    /* ------------------------------------------------------------ clipboard */
    O.copy = function (cut) {
        var objs = O.selected();
        if (!objs.length) {
            return false;
        }
        clip = { objs: PE.clone(objs), k: sel.k, pageId: D.pages[sel.k].id, n: 0 };
        var text = objs.filter(function (o) { return o.type === 'text'; }).map(function (o) { return o.text; }).join('\n');
        clip.text = text || ('[PDF Editor ' + objs.length + ']');
        try {
            navigator.clipboard.writeText(clip.text).catch(function () {});
        } catch (e) {
            //clipboard API not available
        }
        if (cut) {
            O.deleteSel();
        }
        return true;
    };

    O.hasClip = function () {
        return !!clip;
    };

    O.paste = function () {
        if (!clip || !D.pages.length) {
            return false;
        }
        var k = V.cur;
        clip.n = D.pages[k].id === clip.pageId ? clip.n + 1 : 0;
        var off = D.pages[k].id === clip.pageId ? 10 * clip.n : 0;
        var snap = D.snapshot();
        var ids = [];
        PE.clone(clip.objs).forEach(function (o) {
            o.id = PE.uid();
            o.x += off;
            o.y += off;
            if (o.rects) {
                o.rects.forEach(function (r) {
                    r.x += off;
                    r.y += off;
                });
            }
            D.pages[k].objs.push(o);
            ids.push(o.id);
        });
        D.pushUndo(snap);
        V.refreshPage(k);
        D.emit('objects', { k: k });
        O.select(ids, k);
        return true;
    };

    O.pasteMatches = function (text) {
        return clip && clip.text === text;
    };

    O.duplicate = function () {
        if (O.copy(false)) {
            clip.pageId = D.pages[sel.k].id;
            V.cur = sel.k;
            O.paste();
        }
    };

    O.selectAll = function () {
        var k = V.cur;
        var p = D.pages[k];
        if (!p || !p.objs.length) {
            return false;
        }
        O.select(p.objs.map(function (o) { return o.id; }), k);
        return true;
    };

    O.nudge = function (dx, dy) {
        var objs = O.selected();
        if (!objs.length) {
            return;
        }
        if (!nudgeSnap) {
            nudgeSnap = D.snapshot();
        }
        objs.forEach(function (o) {
            moveObj(o, dx, dy);
            redrawObj(o, sel.k);
            updateSelBox(o);
        });
        clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(function () {
            if (nudgeSnap) {
                D.pushUndo(nudgeSnap);
                nudgeSnap = null;
                D.emit('objects', { k: sel.k });
            }
        }, 500);
    };

    function moveObj(o, dx, dy) {
        o.x += dx;
        o.y += dy;
        if (o.rects) {
            o.rects.forEach(function (r) {
                r.x += dx;
                r.y += dy;
            });
        }
    }

    /* ------------------------------------------------------------ dragging */
    function startMove(e, k, ids) {
        var start = V.pagePoint(k, e.clientX, e.clientY);
        var p = D.pages[k];
        var origs = {};
        p.objs.forEach(function (o) {
            if (ids.indexOf(o.id) >= 0) {
                origs[o.id] = { x: o.x, y: o.y, rects: o.rects ? PE.clone(o.rects) : null };
            }
        });
        drag = { kind: 'move', k: k, start: start, origs: origs, snap: D.snapshot(), moved: false, pointer: e.pointerId };
        capture(e);
    }

    function capture(e) {
        try {
            e.target.setPointerCapture(e.pointerId);
        } catch (err) {
            //not capturable
        }
        drag.target = e.target;
        e.target.addEventListener('pointermove', onDragMove);
        e.target.addEventListener('pointerup', onDragEnd);
        e.target.addEventListener('pointercancel', onDragEnd);
    }

    function release() {
        if (!drag || !drag.target) {
            return;
        }
        drag.target.removeEventListener('pointermove', onDragMove);
        drag.target.removeEventListener('pointerup', onDragEnd);
        drag.target.removeEventListener('pointercancel', onDragEnd);
    }

    function startHandleDrag(e, id, h) {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        var f = D.find(id);
        if (!f) {
            return;
        }
        var o = f.o;
        drag = {
            kind: h === 'rot' ? 'rotate' : (h === 'p1' || h === 'p2' ? 'end' : 'resize'),
            h: h, k: f.k, id: id, snap: D.snapshot(), moved: false,
            orig: { x: o.x, y: o.y, w: o.w, h: o.h, angle: o.angle || 0, size: o.size },
            start: V.pagePoint(f.k, e.clientX, e.clientY)
        };
        if (drag.kind === 'end') {
            drag.ends = lineEnds(o);
        }
        capture(e);
    }

    function lineEnds(o) {
        var a = (o.angle || 0) * Math.PI / 180;
        var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        var hx = Math.cos(a) * o.w / 2, hy = Math.sin(a) * o.w / 2;
        return [[cx - hx, cy - hy], [cx + hx, cy + hy]];
    }
    O.lineEnds = lineEnds;

    function setLineEnds(o, p1, p2) {
        var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        var len = Math.max(1, Math.hypot(dx, dy));
        var hh = Math.max(8, (o.sw || 1) + 6, O.arrowSize(o));
        o.w = len;
        o.h = hh;
        o.x = (p1[0] + p2[0]) / 2 - len / 2;
        o.y = (p1[1] + p2[1]) / 2 - hh / 2;
        o.angle = Math.atan2(dy, dx) * 180 / Math.PI;
    }
    O.setLineEnds = setLineEnds;

    function onDragMove(e) {
        if (!drag) {
            return;
        }
        var pt = V.pagePoint(drag.k, e.clientX, e.clientY);
        var dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
        if (!drag.moved && Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) {
            return;
        }
        drag.moved = true;
        var p = D.pages[drag.k];
        if (drag.kind === 'move') {
            p.objs.forEach(function (o) {
                var og = drag.origs[o.id];
                if (!og) {
                    return;
                }
                o.x = og.x;
                o.y = og.y;
                if (og.rects) {
                    o.rects = PE.clone(og.rects);
                }
                moveObj(o, dx, dy);
                var el = objEl(o.id, drag.k);
                if (el) {
                    placeEl(el, o, V.scale());
                }
                updateSelBox(o);
            });
            return;
        }
        var f = D.find(drag.id);
        if (!f) {
            return;
        }
        var o = f.o;
        var og = drag.orig;
        if (drag.kind === 'rotate') {
            var cx = og.x + og.w / 2, cy = og.y + og.h / 2;
            var ang = Math.atan2(pt.y - cy, pt.x - cx) * 180 / Math.PI + 90;
            if (e.shiftKey) {
                ang = Math.round(ang / 15) * 15;
            } else {
                var near = Math.round(ang / 90) * 90;
                if (Math.abs(ang - near) < 4) {
                    ang = near;
                }
            }
            o.angle = ((ang % 360) + 360) % 360;
        } else if (drag.kind === 'end') {
            var ends = drag.ends;
            var moveIdx = drag.h === 'p1' ? 0 : 1;
            var other = ends[1 - moveIdx];
            var np = [ends[moveIdx][0] + dx, ends[moveIdx][1] + dy];
            if (e.shiftKey) {
                var ddx = np[0] - other[0], ddy = np[1] - other[1];
                var ln = Math.hypot(ddx, ddy);
                var an = Math.round(Math.atan2(ddy, ddx) / (Math.PI / 4)) * (Math.PI / 4);
                np = [other[0] + Math.cos(an) * ln, other[1] + Math.sin(an) * ln];
            }
            if (moveIdx === 0) {
                setLineEnds(o, np, other);
            } else {
                setLineEnds(o, other, np);
            }
        } else {
            resizeBox(o, og, drag.h, dx, dy, e.shiftKey);
        }
        redrawObj(o, drag.k);
        updateSelBox(o);
    }

    function resizeBox(o, og, h, dx, dy, shift) {
        var a = og.angle * Math.PI / 180;
        var lx = dx * Math.cos(a) + dy * Math.sin(a);
        var ly = -dx * Math.sin(a) + dy * Math.cos(a);
        var left = 0, top = 0, right = og.w, bottom = og.h;
        if (h.indexOf('w') >= 0) {
            left += lx;
        }
        if (h.indexOf('e') >= 0) {
            right += lx;
        }
        if (h.indexOf('n') >= 0) {
            top += ly;
        }
        if (h.indexOf('s') >= 0) {
            bottom += ly;
        }
        var minS = 4;
        if (right - left < minS) {
            if (h.indexOf('w') >= 0) {
                left = right - minS;
            } else {
                right = left + minS;
            }
        }
        if (bottom - top < minS) {
            if (h.indexOf('n') >= 0) {
                top = bottom - minS;
            } else {
                bottom = top + minS;
            }
        }
        var corner = h.length === 2;
        var keepAspect = (o.type === 'image' && corner && !shift) || (o.type !== 'image' && corner && shift);
        if (keepAspect && og.w > 0 && og.h > 0) {
            var ratio = og.w / og.h;
            var nw = right - left, nh = bottom - top;
            if (nw / nh > ratio) {
                nw = nh * ratio;
            } else {
                nh = nw / ratio;
            }
            if (h.indexOf('w') >= 0) {
                left = right - nw;
            } else {
                right = left + nw;
            }
            if (h.indexOf('n') >= 0) {
                top = bottom - nh;
            } else {
                bottom = top + nh;
            }
        }
        var ncx = (left + right) / 2 - og.w / 2, ncy = (top + bottom) / 2 - og.h / 2;
        var cx = og.x + og.w / 2 + ncx * Math.cos(a) - ncy * Math.sin(a);
        var cy = og.y + og.h / 2 + ncx * Math.sin(a) + ncy * Math.cos(a);
        var w = right - left, hh = bottom - top;
        if (o.type === 'text') {
            o.wrap = true;
            o.w = w;
            o.x = cx - w / 2;
            o.y = og.y + (og.h - og.h) / 2;
            //keep the top edge: re-fit from the original top
            o.h = og.h;
            o.y = cy - og.h / 2;
            F.fit(o);
            return;
        }
        o.w = w;
        o.h = hh;
        o.x = cx - w / 2;
        o.y = cy - hh / 2;
    }

    function onDragEnd(e) {
        if (!drag) {
            return;
        }
        var d = drag;
        release();
        drag = null;
        if (d.moved) {
            D.pushUndo(d.snap);
            V.refreshPage(d.k);
            D.emit('objects', { k: d.k });
            PE.emitSel && PE.emitSel();
        } else if (d.kind === 'move' && d.clickEdit) {
            O.editText(d.clickEdit);
        }
    }

    /* ------------------------------------------------------------ pointer */
    var lastDown = null;

    function onDouble(o, e) {
        if (o.type === 'text') {
            O.editText(o.id, { caret: { x: e.clientX, y: e.clientY } });
        } else if (o.type === 'link') {
            PE.dialogs.link(o, function (target) {
                O.update({ url: target.url || '', page: target.page }, [o.id]);
            });
        }
    }

    function onObjDown(e, k, objEl) {
        var id = objEl.dataset.id;
        var f = D.find(id);
        if (!f) {
            return;
        }
        var t = V.tool;
        if (t !== 'select' && t !== 'editpdf' && t !== 'text') {
            return;
        }
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (editing && editing.id === id) {
            return;
        }
        //a cancelled pointerdown suppresses the browser's dblclick, so
        //double clicks are told apart here
        var now = Date.now();
        var dbl = lastDown && lastDown.id === id && now - lastDown.t < 450 &&
            Math.abs(e.clientX - lastDown.x) < 5 && Math.abs(e.clientY - lastDown.y) < 5;
        lastDown = { id: id, t: now, x: e.clientX, y: e.clientY };
        if (dbl) {
            lastDown = null;
            O.commitEdit();
            onDouble(f.o, e);
            return;
        }
        O.commitEdit();
        if ((t === 'text' || t === 'editpdf') && f.o.type === 'text') {
            O.select([id], k);
            startMove(e, k, [id]);
            drag.clickEdit = id;
            return;
        }
        var already = sel.k === k && sel.ids.indexOf(id) >= 0;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            O.select([id], k, true);
            if (sel.ids.indexOf(id) < 0) {
                return;
            }
        } else if (!already) {
            O.select([id], k);
        }
        startMove(e, k, sel.ids.slice());
    }

    function onPageDown(e) {
        if (e.button !== 0) {
            return;
        }
        var k = V.pageIndexOf(e.target);
        if (k < 0) {
            if (!e.target.closest('.pe-menu') && V.tool === 'select') {
                O.commitEdit();
                O.clearSel();
            }
            return;
        }
        if (e.target.closest('.pe-editor')) {
            return;
        }
        var oe = e.target.closest('.pe-obj');
        if (oe && oe.dataset.id && oe.closest('.pe-objs')) {
            onObjDown(e, k, oe);
            if (e.defaultPrevented) {
                return;
            }
        }
        if (e.target.closest('.pe-h')) {
            return;
        }
        var hadEdit = !!editing;
        O.commitEdit();
        var t = V.tool;
        var pt = V.pagePoint(k, e.clientX, e.clientY);
        switch (t) {
            case 'select':
                e.preventDefault();
                if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
                    O.clearSel();
                }
                startRubber(e, k, pt, 'marquee');
                return;
            case 'editpdf':
                if (!e.target.closest('.pe-run')) {
                    O.clearSel();
                }
                return;
            case 'text':
                e.preventDefault();
                if (hadEdit) {
                    V.setTool('select');
                    return;
                }
                createText(k, pt);
                return;
            case 'draw':
                e.preventDefault();
                startInk(e, k, pt);
                return;
            case 'place':
                e.preventDefault();
                place(k, pt);
                return;
            case 'hand':
            case 'textsel':
                return;
            default:
                e.preventDefault();
                startRubber(e, k, pt, t);
        }
    }

    /* ------------------------------------------------------------ creation */
    function createText(k, pt) {
        var st = O.style.text;
        var o = {
            type: 'text', text: '', font: st.font, size: st.size, color: st.color, bold: st.bold, italic: st.italic,
            align: st.align, lh: 1.2, wrap: false, x: pt.x - F.PAD, y: pt.y - st.size * 0.6 - F.PAD, w: 10, h: 10, angle: 0
        };
        F.fit(o);
        o.x = pt.x - F.PAD;
        o.y = pt.y - st.size * 0.6 - F.PAD;
        var snap = D.snapshot();
        O.add(k, o, { noUndo: true });
        O.editText(o.id, { snap: snap, isNew: true });
        V.setTool('select');
    }

    function startRubber(e, k, p0, kind) {
        var layer = layerOf(k);
        var s = V.scale();
        var rb = PE.el('div', 'pe-rubber' + (kind === 'redact' ? ' redact' : kind === 'whiteout' ? ' white' : kind === 'crop' ? ' crop' : ''));
        var lineSvg = null;
        if (kind === 'line' || kind === 'arrow') {
            rb.style.border = '0';
            rb.style.background = 'transparent';
            rb.style.left = '0';
            rb.style.top = '0';
            rb.style.width = '100%';
            rb.style.height = '100%';
            rb.innerHTML = '<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"><line stroke="' +
                (O.style.shape.stroke || '#d13438') + '" stroke-width="' + (O.style.shape.sw || 2) * s + '" stroke-linecap="round"/></svg>';
            lineSvg = rb.querySelector('line');
        }
        layer.appendChild(rb);
        var p1 = p0;
        function rect(shift) {
            var x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
            var w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
            if (shift && (kind === 'rect' || kind === 'ellipse')) {
                var m = Math.max(w, h);
                w = h = m;
                x = p1.x < p0.x ? p0.x - m : p0.x;
                y = p1.y < p0.y ? p0.y - m : p0.y;
            }
            return { x: x, y: y, w: w, h: h };
        }
        function show(shift) {
            if (lineSvg) {
                var q = p1;
                if (shift) {
                    var ddx = p1.x - p0.x, ddy = p1.y - p0.y;
                    var ln = Math.hypot(ddx, ddy);
                    var an = Math.round(Math.atan2(ddy, ddx) / (Math.PI / 4)) * (Math.PI / 4);
                    q = { x: p0.x + Math.cos(an) * ln, y: p0.y + Math.sin(an) * ln };
                }
                lineSvg.setAttribute('x1', p0.x * s);
                lineSvg.setAttribute('y1', p0.y * s);
                lineSvg.setAttribute('x2', q.x * s);
                lineSvg.setAttribute('y2', q.y * s);
                return q;
            }
            var r = rect(shift);
            rb.style.left = r.x * s + 'px';
            rb.style.top = r.y * s + 'px';
            rb.style.width = r.w * s + 'px';
            rb.style.height = r.h * s + 'px';
            return null;
        }
        show(false);
        var target = e.target;
        try {
            target.setPointerCapture(e.pointerId);
        } catch (err) {
            //ignore
        }
        var lastQ = null;
        function mv(ev) {
            p1 = V.pagePoint(k, ev.clientX, ev.clientY);
            lastQ = show(ev.shiftKey);
        }
        function up(ev) {
            target.removeEventListener('pointermove', mv);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
            if (rb.parentNode) {
                rb.parentNode.removeChild(rb);
            }
            if (ev.type === 'pointercancel') {
                return;
            }
            var r = rect(ev.shiftKey);
            finishRubber(k, kind, r, p0, lastQ || p1);
        }
        target.addEventListener('pointermove', mv);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    }

    function finishRubber(k, kind, r, p0, p1) {
        var tiny = r.w < 3 && r.h < 3;
        var st = O.style.shape;
        switch (kind) {
            case 'marquee': {
                if (tiny) {
                    return;
                }
                var hit = D.pages[k].objs.filter(function (o) {
                    var a = (o.angle || 0) * Math.PI / 180;
                    var hw = (Math.abs(Math.cos(a)) * o.w + Math.abs(Math.sin(a)) * o.h) / 2;
                    var hh = (Math.abs(Math.sin(a)) * o.w + Math.abs(Math.cos(a)) * o.h) / 2;
                    var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
                    return cx - hw < r.x + r.w && cx + hw > r.x && cy - hh < r.y + r.h && cy + hh > r.y;
                }).map(function (o) { return o.id; });
                if (hit.length) {
                    O.select(hit, k, sel.k === k && sel.ids.length > 0);
                }
                return;
            }
            case 'rect':
            case 'ellipse':
                if (tiny) {
                    r = { x: p0.x - 50, y: p0.y - 35, w: 100, h: 70 };
                }
                O.add(k, { type: kind, x: r.x, y: r.y, w: r.w, h: r.h, stroke: st.stroke, fill: st.fill, sw: st.sw, angle: 0 });
                V.setTool('select');
                return;
            case 'line':
            case 'arrow': {
                var a = [p0.x, p0.y], b = [p1.x, p1.y];
                if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) {
                    b = [a[0] + 100, a[1]];
                }
                var o = { type: 'line', stroke: st.stroke, sw: st.sw, arrow: kind === 'arrow' ? 'end' : 'none' };
                setLineEnds(o, a, b);
                O.add(k, o);
                V.setTool('select');
                return;
            }
            case 'redact':
                if (tiny) {
                    return;
                }
                O.add(k, { type: 'redact', x: r.x, y: r.y, w: r.w, h: r.h, angle: 0 }, { select: false });
                return;
            case 'whiteout':
                if (tiny) {
                    return;
                }
                O.add(k, { type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: '#ffffff', stroke: null, sw: 0, angle: 0 }, { select: false });
                return;
            case 'link':
                if (tiny) {
                    return;
                }
                PE.dialogs.link(null, function (target) {
                    O.add(k, { type: 'link', x: r.x, y: r.y, w: r.w, h: r.h, angle: 0, url: target.url || '', page: target.page });
                    V.setTool('select');
                });
                return;
            case 'crop':
                if (tiny) {
                    return;
                }
                V.setTool('select');
                PE.dialogs.crop(k, r);
                return;
            case 'snapshot':
                if (tiny) {
                    return;
                }
                V.setTool('select');
                PE.dialogs.snapshot(k, r);
                return;
            case 'highlight':
            case 'underline':
            case 'strike':
                markupFromRect(k, kind, r, tiny);
                return;
            default:
                return;
        }
    }

    function markupFromRect(k, kind, r, tiny) {
        V.textItems(k).then(function (items) {
            var lines = [];
            items.forEach(function (it) {
                if (!it.str.trim()) {
                    return;
                }
                var ix0 = Math.max(it.x, r.x), iy0 = Math.max(it.y, r.y);
                var ix1 = Math.min(it.x + it.w, r.x + r.w), iy1 = Math.min(it.y + it.h, r.y + r.h);
                if (tiny) {
                    if (r.x < it.x || r.x > it.x + it.w || r.y < it.y || r.y > it.y + it.h) {
                        return;
                    }
                    ix0 = it.x;
                    ix1 = it.x + it.w;
                    iy0 = it.y;
                    iy1 = it.y + it.h;
                } else if (ix1 <= ix0 || iy1 <= iy0) {
                    return;
                }
                var horiz = Math.abs(it.angle) < 45 || Math.abs(Math.abs(it.angle) - 180) < 45;
                var box = horiz ? { x: ix0, y: it.y, w: ix1 - ix0, h: it.h } : { x: it.x, y: iy0, w: it.w, h: iy1 - iy0 };
                var ang = ((Math.round(it.angle / 90) * 90) % 360 + 360) % 360;
                //merge with a box on the same line
                for (var i = 0; i < lines.length; i++) {
                    var L = lines[i];
                    if (L.ang !== ang) {
                        continue;
                    }
                    var same = horiz ? Math.abs((L.y + L.h / 2) - (box.y + box.h / 2)) < Math.min(L.h, box.h) * 0.5 :
                        Math.abs((L.x + L.w / 2) - (box.x + box.w / 2)) < Math.min(L.w, box.w) * 0.5;
                    if (same) {
                        var x0 = Math.min(L.x, box.x), y0 = Math.min(L.y, box.y);
                        var x1 = Math.max(L.x + L.w, box.x + box.w), y1 = Math.max(L.y + L.h, box.y + box.h);
                        L.x = x0;
                        L.y = y0;
                        L.w = x1 - x0;
                        L.h = y1 - y0;
                        return;
                    }
                }
                box.ang = ang;
                lines.push(box);
            });
            if (!lines.length) {
                if (tiny) {
                    return;
                }
                lines = [{ x: r.x, y: r.y, w: r.w, h: r.h, ang: 0 }];
            }
            var ang0 = lines[0].ang;
            var rects = lines.map(function (L) { return { x: L.x, y: L.y, w: L.w, h: L.h }; });
            var bb = D.rectsBox(rects);
            O.add(k, {
                type: 'markup', kind: kind, rects: rects, color: O.style[kind].color, angle: ang0,
                x: bb.x, y: bb.y, w: bb.w, h: bb.h
            }, { select: false });
        });
    }

    function startInk(e, k, p0) {
        var layer = layerOf(k);
        var s = V.scale();
        var st = O.style.ink;
        var pts = [[p0.x, p0.y]];
        var tmp = PE.el('div', 'pe-rubber');
        tmp.style.cssText = 'left:0;top:0;width:100%;height:100%;border:0;background:transparent';
        tmp.innerHTML = '<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"><path fill="none" stroke="' + st.stroke +
            '" stroke-width="' + st.sw * s + '" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        var path = tmp.querySelector('path');
        layer.appendChild(tmp);
        var target = e.target;
        try {
            target.setPointerCapture(e.pointerId);
        } catch (err) {
            //ignore
        }
        function d() {
            return pts.map(function (q, i) { return (i ? 'L' : 'M') + (q[0] * s).toFixed(1) + ' ' + (q[1] * s).toFixed(1); }).join('');
        }
        function mv(ev) {
            var evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
            (evs.length ? evs : [ev]).forEach(function (ce) {
                var q = V.pagePoint(k, ce.clientX, ce.clientY);
                var last = pts[pts.length - 1];
                if (Math.hypot(q.x - last[0], q.y - last[1]) > 0.7) {
                    pts.push([q.x, q.y]);
                }
            });
            path.setAttribute('d', d());
        }
        function up() {
            target.removeEventListener('pointermove', mv);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
            if (tmp.parentNode) {
                tmp.parentNode.removeChild(tmp);
            }
            if (pts.length < 2) {
                pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);
            }
            pts = simplify(pts, 0.35);
            var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            pts.forEach(function (q) {
                x0 = Math.min(x0, q[0]);
                y0 = Math.min(y0, q[1]);
                x1 = Math.max(x1, q[0]);
                y1 = Math.max(y1, q[1]);
            });
            var padv = st.sw / 2 + 1;
            x0 -= padv;
            y0 -= padv;
            x1 += padv;
            y1 += padv;
            var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
            O.add(k, {
                type: 'ink', stroke: st.stroke, sw: st.sw, x: x0, y: y0, w: w, h: h, angle: 0,
                pts: pts.map(function (q) { return [num((q[0] - x0) / w), num((q[1] - y0) / h)]; })
            }, { select: false });
        }
        target.addEventListener('pointermove', mv);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    }

    //Ramer-Douglas-Peucker
    function simplify(pts, eps) {
        if (pts.length < 3) {
            return pts;
        }
        var keep = new Array(pts.length);
        keep[0] = keep[pts.length - 1] = true;
        var stack = [[0, pts.length - 1]];
        while (stack.length) {
            var seg = stack.pop();
            var a = pts[seg[0]], b = pts[seg[1]];
            var dx = b[0] - a[0], dy = b[1] - a[1];
            var len = Math.hypot(dx, dy) || 1;
            var maxD = 0, idx = -1;
            for (var i = seg[0] + 1; i < seg[1]; i++) {
                var dd = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
                if (dd > maxD) {
                    maxD = dd;
                    idx = i;
                }
            }
            if (maxD > eps && idx > 0) {
                keep[idx] = true;
                stack.push([seg[0], idx], [idx, seg[1]]);
            }
        }
        return pts.filter(function (q, i) { return keep[i]; });
    }

    /* Place tool: V.toolOpts.make(k, pt) returns the object to add */
    function place(k, pt) {
        var opts = V.toolOpts;
        if (!opts.make) {
            V.setTool('select');
            return;
        }
        var o = opts.make(k, pt);
        if (o) {
            O.add(k, o);
        }
        removeGhost();
        if (!opts.sticky) {
            V.setTool('select');
        }
    }

    var ghost = null;
    function removeGhost() {
        if (ghost && ghost.parentNode) {
            ghost.parentNode.removeChild(ghost);
        }
        ghost = null;
    }

    function onPageMove(e) {
        if (V.tool !== 'place' || !V.toolOpts.ghost) {
            removeGhost();
            return;
        }
        var k = V.pageIndexOf(e.target);
        if (k < 0) {
            removeGhost();
            return;
        }
        var pt = V.pagePoint(k, e.clientX, e.clientY);
        var layer = layerOf(k);
        var g = V.toolOpts.ghost;     //{w, h, html}
        if (!ghost || ghost.parentNode !== layer) {
            removeGhost();
            ghost = PE.el('div', 'pe-ghost', g.html);
            layer.appendChild(ghost);
        }
        var s = V.scale();
        ghost.style.left = (pt.x - g.w / 2) * s + 'px';
        ghost.style.top = (pt.y - g.h / 2) * s + 'px';
        ghost.style.width = g.w * s + 'px';
        ghost.style.height = g.h * s + 'px';
    }

    /* ------------------------------------------------------------ text editing */
    var mctx = null;
    function cssBaseline(o, s) {
        if (!mctx) {
            mctx = document.createElement('canvas').getContext('2d');
        }
        mctx.font = (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + '100px ' + F.css(o.font || 'helv');
        var m = mctx.measureText('Hg');
        var A = (m.fontBoundingBoxAscent || 90) / 100, De = (m.fontBoundingBoxDescent || 22) / 100;
        var size = o.size || 12, LH = size * (o.lh || 1.2);
        var cssFirst = (LH - (A + De) * size) / 2 + A * size;
        return (0.8 * size - cssFirst) * s;
    }

    O.editing = function () {
        return editing ? editing.id : null;
    };

    O.editText = function (id, opts) {
        opts = opts || {};
        var f = D.find(id);
        if (!f || f.o.type !== 'text') {
            return;
        }
        if (editing) {
            O.commitEdit();
            f = D.find(id);
            if (!f) {
                return;
            }
        }
        var o = f.o;
        var k = f.k;
        if (V.mode === 'single' && V.cur !== k) {
            V.goto(k);
        }
        var ed = PE.el('div', 'pe-editor' + (o.wrap ? ' wrap' : ''));
        try {
            ed.contentEditable = 'plaintext-only';
        } catch (e) {
            ed.contentEditable = 'true';
        }
        if (ed.contentEditable !== 'plaintext-only') {
            ed.contentEditable = 'true';
        }
        ed.spellcheck = false;
        ed.textContent = o.text;
        editing = { id: id, k: k, el: ed, snap: opts.snap || D.snapshot(), orig: o.text, isNew: !!opts.isNew };
        O.select([id], k);
        var layer = layerOf(k);
        var oe = objEl(id, k);
        if (oe) {
            oe.classList.add('editing');
        }
        layer.appendChild(ed);
        placeEditor();
        drawSel();
        ed.addEventListener('input', function () {
            var cur = D.find(id);
            if (!cur) {
                return;
            }
            cur.o.text = ed.innerText.replace(/\n$/, '');
            F.fit(cur.o);
            placeEditor();
            redrawObj(cur.o, k);
            updateSelBox(cur.o);
        });
        ed.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                O.commitEdit();
            }
        });
        ed.addEventListener('paste', function (ev) {
            if (ed.contentEditable === 'true') {
                ev.preventDefault();
                var t = (ev.clipboardData || window.clipboardData).getData('text/plain');
                document.execCommand('insertText', false, t);
            }
        });
        ed.addEventListener('blur', function () {
            setTimeout(function () {
                if (editing && editing.el === ed && document.activeElement !== ed) {
                    O.commitEdit();
                }
            }, 0);
        });
        ed.focus();
        var range = document.createRange();
        if (opts.caret && document.caretRangeFromPoint) {
            var r = document.caretRangeFromPoint(opts.caret.x, opts.caret.y);
            if (r && ed.contains(r.startContainer)) {
                range = r;
            } else {
                range.selectNodeContents(ed);
                range.collapse(false);
            }
        } else if (opts.selectAll) {
            range.selectNodeContents(ed);
        } else {
            range.selectNodeContents(ed);
            range.collapse(false);
        }
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        PE.emitSel && PE.emitSel();
    };

    function placeEditor() {
        if (!editing) {
            return;
        }
        var f = D.find(editing.id);
        if (!f) {
            return;
        }
        var o = f.o;
        var s = V.scale();
        var ed = editing.el;
        var pad = F.padOf(o) * s;
        ed.style.left = o.x * s + 'px';
        ed.style.top = o.y * s + 'px';
        ed.style.width = o.w * s + 'px';
        ed.style.minHeight = o.h * s + 'px';
        ed.style.padding = pad + 'px';
        ed.style.fontFamily = F.css(o.font || 'helv');
        ed.style.fontSize = (o.size || 12) * s + 'px';
        ed.style.lineHeight = (o.size || 12) * (o.lh || 1.2) * s + 'px';
        ed.style.fontWeight = o.bold ? '700' : '400';
        ed.style.fontStyle = o.italic ? 'italic' : 'normal';
        ed.style.textDecoration = (o.underline ? 'underline ' : '') + (o.strike ? 'line-through' : '');
        ed.style.color = o.color || '#000';
        ed.style.textAlign = o.align || 'left';
        ed.style.fontKerning = 'none';
        ed.style.transformOrigin = (o.w * s / 2) + 'px ' + (o.h * s / 2) + 'px';
        ed.style.transform = (o.angle ? 'rotate(' + o.angle + 'deg) ' : '') + 'translateY(' + cssBaseline(o, s) + 'px)';
        ed.style.whiteSpace = o.wrap ? 'pre-wrap' : 'pre';
        ed.classList.toggle('wrap', !!o.wrap);
    }

    O.commitEdit = function () {
        if (!editing) {
            return;
        }
        var ed = editing;
        editing = null;
        if (ed.el.parentNode) {
            ed.el.parentNode.removeChild(ed.el);
        }
        var f = D.find(ed.id);
        if (f) {
            var o = f.o;
            o.text = ed.el.innerText.replace(/\n$/, '');
            if (!o.text.trim() && !o.bg && !o.border) {
                D.pages[f.k].objs.splice(f.j, 1);
                sel.ids = sel.ids.filter(function (id) { return id !== ed.id; });
                if (ed.isNew && !ed.fromEdit) {
                    //an empty new box leaves no trace
                    if (D.snapshot() === ed.snap) {
                        V.refreshPage(f.k);
                        PE.emitSel && PE.emitSel();
                        return;
                    }
                }
            } else {
                F.fit(o);
            }
            if (ed.isNew || o.text !== ed.orig || D.snapshot() !== ed.snap) {
                D.pushUndo(ed.snap);
            }
            V.refreshPage(f.k);
            D.emit('objects', { k: f.k });
        }
        PE.emitSel && PE.emitSel();
    };

    O.cancelEditIfAny = O.commitEdit;

    /* ------------------------------------------------------------ hooks */
    O.onZoom = function () {
        placeEditor();
    };

    O.onTool = function (prev, t) {
        if (t !== 'select' && t !== 'text' && t !== 'editpdf') {
            O.commitEdit();
            O.clearSel();
        }
        if (t !== 'place') {
            removeGhost();
        }
    };

    O.init = function () {
        var pages = PE.$('pePages');
        pages.addEventListener('pointerdown', onPageDown);
        PE.$('peViewer').addEventListener('pointerdown', function (e) {
            if (e.target === PE.$('peViewer') || e.target === pages) {
                O.commitEdit();
                if (V.tool === 'select' || V.tool === 'editpdf') {
                    O.clearSel();
                }
            }
        });
        pages.addEventListener('pointermove', onPageMove);
        pages.addEventListener('pointerleave', removeGhost);

    };
})(window.PE);
