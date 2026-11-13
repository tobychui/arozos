/*
    3D Modeler - the sheet on screen

    Shows the drawing sheet as SVG (the same primitives the exports write,
    js/io/drawsvg.js), lets the user pan and zoom it, and finds what is
    under the pointer: an annotation, a view, or an edge or snap point of a
    view's geometry. Clicking selects, dragging moves (the controller,
    drawing.js, decides how a view or an annotation may move), double click
    edits. While a tool is active (tools.js) the pointer goes to the tool.

    Navigation: the wheel zooms at the pointer; dragging with the middle
    button, or with the left button on empty paper, pans.

    options:
        host                the element to fill
        data()              the drawing data to show
        projections()       { viewId: { edges, box, snaps } }
        estimate(view)      a view's local box while it has no edges yet
        viewState(id)       { status: "loading" | "error" | "ok", message }
        orphans()           Set of annotation ids whose geometry is gone
        onSelect(sel)       sel: { kind: "view" | "ann" | null, ids }
        onDrag(info)        { kind, id, from, to, phase: "move" | "end" | "cancel", event }
        onEdit(target)      double click on { kind, id }
        onContext(target, clientX, clientY)
        onHover(target)     what is under the pointer, or null
*/

import { build, scaleOf, toLocal, itemsBox } from './layout.js';
import { primitiveSVG } from '../io/drawsvg.js';
import { textWidth } from './font.js';
import * as G2 from './geometry2d.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs) {
    const e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) {
        e.setAttribute(k, attrs[k]);
    });
    return e;
}

function segDist(p, a, b) {
    return G2.nearestOnSegment(p, a, b).d;
}

export function createSheetEditor(options) {
    const host = options.host;
    host.innerHTML = '';
    const svg = el('svg', { class: 'sheet-svg' });
    const shadow = el('rect', { class: 'sheet-shadow' });
    const paper = el('rect', { class: 'sheet-paper' });
    const content = el('g', { class: 'sheet-content' });
    const overlay = el('g', { class: 'sheet-overlay' });
    svg.appendChild(shadow);
    svg.appendChild(paper);
    svg.appendChild(content);
    svg.appendChild(overlay);
    host.appendChild(svg);

    const cam = { cx: 210, cy: 148.5, z: 2 };   // sheet point at the middle, px per mm
    let sheetSize = [420, 297];
    let owners = {};        // owner -> { el, markup }
    let viewBoxes = {};     // view id -> sheet box
    let annItems = {};      // annotation id -> primitives
    let annBoxes = {};
    let hover = null;       // { kind, id }
    let selection = { kind: null, ids: [] };
    let tool = null;
    let pan = null;
    let drag = null;
    let fitted = false;
    let lastPointer = null;

    /* ================= camera ================= */
    function size() {
        return [Math.max(1, host.clientWidth), Math.max(1, host.clientHeight)];
    }

    function applyCamera() {
        const s = size();
        const w = s[0] / cam.z;
        const h = s[1] / cam.z;
        const H = sheetSize[1];
        svg.setAttribute('viewBox', [cam.cx - w / 2, H - cam.cy - h / 2, w, h].map(function (v) {
            return +v.toFixed(4);
        }).join(' '));
        drawOverlay();
    }

    function fit() {
        const s = size();
        cam.z = Math.max(0.05, Math.min((s[0] - 48) / sheetSize[0], (s[1] - 48) / sheetSize[1]));
        cam.cx = sheetSize[0] / 2;
        cam.cy = sheetSize[1] / 2;
        applyCamera();
    }

    // Sheet millimetres under a client point
    function toSheetPoint(clientX, clientY) {
        const r = svg.getBoundingClientRect();
        const s = size();
        const x = cam.cx + (clientX - r.left - s[0] / 2) / cam.z;
        const y = cam.cy - (clientY - r.top - s[1] / 2) / cam.z;
        return [x, y];
    }

    function zoomAt(factor, clientX, clientY) {
        const before = toSheetPoint(clientX, clientY);
        cam.z = Math.max(0.05, Math.min(200, cam.z * factor));
        const after = toSheetPoint(clientX, clientY);
        cam.cx += before[0] - after[0];
        cam.cy += before[1] - after[1];
        applyCamera();
    }

    /* ================= drawing ================= */
    function render() {
        const data = options.data();
        sheetSize = [data.sheet.width, data.sheet.height];
        const W = sheetSize[0];
        const H = sheetSize[1];
        [shadow, paper].forEach(function (r, i) {
            r.setAttribute('x', i ? 0 : 1.2);
            r.setAttribute('y', i ? 0 : 1.2);
            r.setAttribute('width', W);
            r.setAttribute('height', H);
        });
        const groups = build(data, options.projections(), { estimate: options.estimate });
        const seen = {};
        viewBoxes = {};
        annItems = {};
        annBoxes = {};
        groups.forEach(function (g) {
            seen[g.owner] = true;
            let rec = owners[g.owner];
            if (!rec) {
                rec = owners[g.owner] = { el: el('g', { 'data-owner': g.owner }), markup: null };
            }
            const markup = g.items.map(function (it) {
                return primitiveSVG(it, H, '#000');
            }).join('');
            if (rec.markup !== markup) {
                rec.el.innerHTML = markup;
                rec.markup = markup;
            }
            content.appendChild(rec.el);
            if (g.owner.indexOf('view:') === 0) {
                viewBoxes[g.owner.slice(5)] = g.box;
            } else if (g.owner.indexOf('ann:') === 0) {
                const id = g.owner.slice(4);
                annItems[id] = g.items;
                annBoxes[id] = itemsBox(g.items);
            }
        });
        Object.keys(owners).forEach(function (owner) {
            if (!seen[owner]) {
                owners[owner].el.remove();
                delete owners[owner];
            }
        });
        // A selection of things that are gone is dropped
        selection.ids = selection.ids.filter(function (id) {
            return selection.kind === 'view' ? !!viewBoxes[id] || data.views.some(function (v) {
                return v.id === id;
            }) : !!annItems[id];
        });
        if (!selection.ids.length) {
            selection.kind = null;
        }
        if (!fitted && host.clientWidth > 0) {
            fitted = true;
            fit();
        } else {
            applyCamera();
        }
        applyClasses();
    }

    function applyClasses() {
        const orphans = options.orphans ? options.orphans() : new Set();
        Object.keys(owners).forEach(function (owner) {
            const parts = owner.split(':');
            const kind = parts[0] === 'ann' ? 'ann' : parts[0] === 'view' ? 'view' : null;
            const id = parts[1];
            const e = owners[owner].el;
            e.classList.toggle('hot', !!hover && hover.kind === kind && hover.id === id && kind === 'ann');
            e.classList.toggle('sel', selection.kind === kind && selection.ids.indexOf(id) >= 0 && kind === 'ann');
            e.classList.toggle('orphan', kind === 'ann' && orphans.has(id));
        });
    }

    function px(n) {
        return n / cam.z;
    }

    function frameSVG(box, cls, H) {
        const pad = px(6);
        return '<rect class="' + cls + '" x="' + (box[0] - pad) + '" y="' + (H - box[3] - pad) + '" width="' + (box[2] - box[0] + 2 * pad) + '" height="' + (box[3] - box[1] + 2 * pad) + '"/>';
    }

    function labelSVG(p, text, cls, H) {
        return '<text class="' + cls + '" x="' + p[0] + '" y="' + (H - p[1]) + '" font-size="' + px(12) + '">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>';
    }

    function drawOverlay() {
        const data = options.data();
        const H = sheetSize[1];
        let out = '';
        // Views: placeholders while they are projected, hover and selection frames
        data.views.forEach(function (v) {
            const box = viewBoxes[v.id];
            if (!box) {
                return;
            }
            const state = options.viewState ? options.viewState(v.id) : null;
            if (state && state.status !== 'ok') {
                out += frameSVG(box, 'ov-pending' + (state.status === 'error' ? ' bad' : ''), H);
                out += labelSVG([box[0], box[3] + px(10)], state.status === 'error' ? v.name + ': ' + (state.message || 'cannot be drawn') : v.name + ': projecting...', 'ov-label' + (state.status === 'error' ? ' bad' : ''), H);
            }
            const selected = selection.kind === 'view' && selection.ids.indexOf(v.id) >= 0;
            const hot = hover && hover.kind === 'view' && hover.id === v.id;
            if (selected || hot) {
                out += frameSVG(box, selected ? 'ov-sel' : 'ov-hot', H);
            }
        });
        // What the active tool shows: a preview, highlighted edges, snap marks
        const extra = tool && tool.overlay ? tool.overlay() : null;
        if (extra) {
            (extra.frames || []).forEach(function (f) {
                out += frameSVG(f.box, f.cls || 'ov-ghost', H);
                if (f.label) {
                    out += labelSVG([f.box[0], f.box[3] + px(10)], f.label, 'ov-label', H);
                }
            });
            (extra.edges || []).forEach(function (pts) {
                out += '<polyline class="ov-edge" points="' + pts.map(function (p) {
                    return p[0] + ',' + (H - p[1]);
                }).join(' ') + '"/>';
            });
            out += (extra.items || []).map(function (it) {
                return primitiveSVG(it, H, '#e07b1f');
            }).join('');
            (extra.marks || []).forEach(function (m) {
                const r = px(m.kind === 'center' ? 5 : 4);
                out += m.kind === 'mid' ? '<rect class="ov-mark" x="' + (m.p[0] - r) + '" y="' + (H - m.p[1] - r) + '" width="' + 2 * r + '" height="' + 2 * r + '"/>'
                    : '<circle class="ov-mark' + (m.kind === 'center' ? ' center' : '') + '" cx="' + m.p[0] + '" cy="' + (H - m.p[1]) + '" r="' + r + '"/>';
            });
        }
        overlay.innerHTML = out;
    }

    /* ================= picking ================= */
    function inBox(p, box, pad) {
        return !!box && p[0] >= box[0] - pad && p[0] <= box[2] + pad && p[1] >= box[1] - pad && p[1] <= box[3] + pad;
    }

    function itemDistance(p, it) {
        if (it.t === 'line') {
            return segDist(p, it.a, it.b);
        }
        if (it.t === 'circle' || it.t === 'arc') {
            return it.filled ? Math.max(0, G2.dist(p, it.c) - it.r) : Math.abs(G2.dist(p, it.c) - it.r);
        }
        if (it.t === 'poly' || it.t === 'fill') {
            let best = Infinity;
            for (let i = 1; i < it.pts.length; i++) {
                best = Math.min(best, segDist(p, it.pts[i - 1], it.pts[i]));
            }
            return best;
        }
        if (it.t === 'text') {
            const w = textWidth(it.text, it.h);
            const r = -(it.rot || 0) * Math.PI / 180;
            const d = [p[0] - it.p[0], p[1] - it.p[1]];
            const lx = d[0] * Math.cos(r) - d[1] * Math.sin(r);
            const ly = d[0] * Math.sin(r) + d[1] * Math.cos(r);
            const x0 = it.anchor === 'middle' ? -w / 2 : it.anchor === 'end' ? -w : 0;
            const dx = Math.max(x0 - lx, 0, lx - (x0 + w));
            const dy = Math.max(-0.3 * it.h - ly, 0, ly - it.h * 1.2);
            return Math.hypot(dx, dy);
        }
        return Infinity;
    }

    function annotationAt(p) {
        const tol = px(5);
        const data = options.data();
        for (let i = data.annotations.length - 1; i >= 0; i--) {
            const id = data.annotations[i].id;
            if (!inBox(p, annBoxes[id], tol)) {
                continue;
            }
            if ((annItems[id] || []).some(function (it) {
                return itemDistance(p, it) <= tol;
            })) {
                return id;
            }
        }
        return null;
    }

    function viewAt(p) {
        const data = options.data();
        for (let i = data.views.length - 1; i >= 0; i--) {
            if (inBox(p, viewBoxes[data.views[i].id], px(6))) {
                return data.views[i].id;
            }
        }
        return null;
    }

    function targetAt(p) {
        const ann = annotationAt(p);
        if (ann) {
            return { kind: 'ann', id: ann };
        }
        const view = viewAt(p);
        return view ? { kind: 'view', id: view } : null;
    }

    // The geometry of a view under a sheet point: the nearest snap point
    // and edge within a few pixels. { view, local, snap, edge } or null.
    // filter(view) can leave views out.
    function geometryAt(p, filter) {
        const data = options.data();
        const projections = options.projections();
        let best = null;
        data.views.forEach(function (v) {
            const proj = projections[v.id];
            if (!proj || !proj.edges || (filter && !filter(v)) || !inBox(p, viewBoxes[v.id], px(12))) {
                return;
            }
            const s = scaleOf(data, v);
            const local = toLocal(v, s, p);
            let snap = G2.snapAt(proj.snaps || [], local, px(7) / s);
            const edge = G2.edgeAt(proj.edges, local, px(6) / s);
            // A point wins when the pointer is right on it, or nearer to it
            // than to the edge; otherwise the edge under the pointer wins
            const snapD = snap ? G2.dist(local, snap.p) * s : Infinity;
            const edgeD = edge ? G2.distanceToEdge(local, edge) * s : Infinity;
            if (snap && edge && snapD > px(4) && snapD > edgeD + px(2)) {
                snap = null;
            }
            const score = snap ? snapD : edge ? edgeD + px(1) : Infinity;
            if (score < Infinity && (!best || score < best.score)) {
                best = { view: v.id, local: local, snap: snap, edge: edge, score: score };
            }
        });
        if (best) {
            return best;
        }
        const view = viewAt(p);
        if (view) {
            const v = data.views.filter(function (x) {
                return x.id === view;
            })[0];
            return { view: view, local: toLocal(v, scaleOf(data, v), p), snap: null, edge: null };
        }
        return null;
    }

    /* ================= selection ================= */
    function setSelection(sel, quiet) {
        selection = { kind: sel && sel.ids && sel.ids.length ? sel.kind : null, ids: sel && sel.ids ? sel.ids.slice() : [] };
        applyClasses();
        drawOverlay();
        if (!quiet && options.onSelect) {
            options.onSelect(selection);
        }
    }

    function setHover(target) {
        const same = (!hover && !target) || (hover && target && hover.kind === target.kind && hover.id === target.id);
        if (same) {
            return;
        }
        hover = target;
        applyClasses();
        drawOverlay();
        if (options.onHover) {
            options.onHover(target);
        }
    }

    /* ================= pointer ================= */
    svg.addEventListener('contextmenu', function (event) {
        event.preventDefault();
    });

    svg.addEventListener('pointerdown', function (event) {
        const p = toSheetPoint(event.clientX, event.clientY);
        lastPointer = p;
        if (event.button === 1 || (event.button === 0 && event.altKey)) {
            event.preventDefault();
            pan = { x: event.clientX, y: event.clientY, cx: cam.cx, cy: cam.cy };
            svg.setPointerCapture(event.pointerId);
            svg.classList.add('panning');
            return;
        }
        if (event.button === 2) {
            if (tool) {
                if (tool.cancel) {
                    tool.cancel(true);
                }
                return;
            }
            const target = targetAt(p);
            if (target && !(selection.kind === target.kind && selection.ids.indexOf(target.id) >= 0)) {
                setSelection({ kind: target.kind, ids: [target.id] });
            }
            if (options.onContext) {
                options.onContext(target, event.clientX, event.clientY);
            }
            return;
        }
        if (event.button !== 0) {
            return;
        }
        if (tool) {
            tool.down(p, event);
            drawOverlay();
            return;
        }
        const target = targetAt(p);
        if (!target) {
            setSelection(null);
            pan = { x: event.clientX, y: event.clientY, cx: cam.cx, cy: cam.cy, click: true };
            svg.setPointerCapture(event.pointerId);
            return;
        }
        const additive = event.ctrlKey || event.shiftKey || event.metaKey;
        if (additive && selection.kind === target.kind) {
            const has = selection.ids.indexOf(target.id) >= 0;
            setSelection({ kind: target.kind, ids: has ? selection.ids.filter(function (id) {
                return id !== target.id;
            }) : selection.ids.concat([target.id]) });
            return;
        }
        if (!(selection.kind === target.kind && selection.ids.indexOf(target.id) >= 0)) {
            setSelection({ kind: target.kind, ids: [target.id] });
        }
        drag = { kind: target.kind, id: target.id, from: p, x: event.clientX, y: event.clientY, moved: false };
        svg.setPointerCapture(event.pointerId);
    });

    let frame = 0;
    let pendingMove = null;
    svg.addEventListener('pointermove', function (event) {
        const p = toSheetPoint(event.clientX, event.clientY);
        lastPointer = p;
        if (pan) {
            cam.cx = pan.cx - (event.clientX - pan.x) / cam.z;
            cam.cy = pan.cy + (event.clientY - pan.y) / cam.z;
            if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 3) {
                svg.classList.add('panning');
            }
            applyCamera();
            return;
        }
        if (drag) {
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) {
                return;
            }
            drag.moved = true;
            pendingMove = { kind: drag.kind, id: drag.id, from: drag.from, to: p, phase: 'move', event: event };
            if (!frame) {
                frame = requestAnimationFrame(function () {
                    frame = 0;
                    if (pendingMove && drag) {
                        options.onDrag(pendingMove);
                    }
                });
            }
            return;
        }
        if (tool) {
            tool.move(p, event);
            drawOverlay();
            return;
        }
        setHover(targetAt(p));
    });

    function endPointer(event, cancelled) {
        if (pan) {
            pan = null;
            svg.classList.remove('panning');
        }
        if (drag) {
            const d = drag;
            drag = null;
            if (frame) {
                cancelAnimationFrame(frame);
                frame = 0;
            }
            if (d.moved) {
                options.onDrag({ kind: d.kind, id: d.id, from: d.from, to: toSheetPoint(event.clientX, event.clientY), phase: cancelled ? 'cancel' : 'end', event: event });
            }
        }
    }

    svg.addEventListener('pointerup', function (event) {
        endPointer(event, false);
    });
    svg.addEventListener('pointercancel', function (event) {
        endPointer(event, true);
    });
    svg.addEventListener('pointerleave', function () {
        if (!pan && !drag && !tool) {
            setHover(null);
        }
    });

    svg.addEventListener('dblclick', function (event) {
        if (tool) {
            if (tool.dblclick) {
                tool.dblclick(toSheetPoint(event.clientX, event.clientY), event);
            }
            return;
        }
        const target = targetAt(toSheetPoint(event.clientX, event.clientY));
        if (target && options.onEdit) {
            options.onEdit(target);
        }
    });

    svg.addEventListener('wheel', function (event) {
        event.preventDefault();
        zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
        if (tool && lastPointer) {
            tool.move(toSheetPoint(event.clientX, event.clientY), event);
            drawOverlay();
        }
    }, { passive: false });

    if (window.ResizeObserver) {
        new ResizeObserver(function () {
            if (!fitted && host.clientWidth > 0) {
                fitted = true;
                fit();
            } else {
                applyCamera();
            }
        }).observe(host);
    }

    return {
        render: render,
        redrawOverlay: drawOverlay,
        fit: fit,
        zoom: function (factor) {
            const r = svg.getBoundingClientRect();
            zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
        },
        // Where the sheet is looked at: { cx, cy, z }, or null to fit it
        cameraState: function () {
            return fitted ? { cx: cam.cx, cy: cam.cy, z: cam.z } : null;
        },
        setCameraState: function (s) {
            if (!s) {
                fitted = false;
                if (host.clientWidth > 0) {
                    fitted = true;
                    fit();
                }
                return;
            }
            cam.cx = s.cx;
            cam.cy = s.cy;
            cam.z = s.z;
            fitted = true;
            applyCamera();
        },
        // Fit the sheet again the next time it is shown (a new drawing)
        refit: function () {
            fitted = false;
            if (host.clientWidth > 0) {
                fitted = true;
                fit();
            }
        },
        toSheetPoint: toSheetPoint,
        pixels: px,
        pointer: function () {
            return lastPointer;
        },
        annotationAt: annotationAt,
        viewAt: viewAt,
        targetAt: targetAt,
        geometryAt: geometryAt,
        viewBox: function (id) {
            return viewBoxes[id] || null;
        },
        selection: function () {
            return { kind: selection.kind, ids: selection.ids.slice() };
        },
        select: setSelection,
        setTool: function (t) {
            tool = t || null;
            svg.classList.toggle('tooling', !!tool);
            setHover(null);
            drawOverlay();
        },
        tool: function () {
            return tool;
        },
        isDragging: function () {
            return !!drag && drag.moved;
        },
        cancelDrag: function () {
            if (drag && drag.moved) {
                options.onDrag({ kind: drag.kind, id: drag.id, from: drag.from, to: drag.from, phase: 'cancel' });
            }
            drag = null;
        }
    };
}
