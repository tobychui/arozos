/*
    3D Modeler - drawing tools

    What the pointer does on the sheet while a drawing command is active
    (editor.js hands it over). Each tool is
        { name, prompt, move(p), down(p, event), key(event) -> handled,
          overlay() -> { items, edges, marks, frames }, cancel(rightClick) }
    with p a sheet point (mm).

    The Dimension tool works like Inventor's general dimension: what is
    clicked decides what is measured.
        a circle            its diameter (an arc: its radius); R / D switch
        a straight edge     its length, or click a second straight edge:
                            the angle between them, or the distance when
                            they are parallel
        a point             (an end, a middle, a centre) and a second point
                            or edge: the distance between them
    then a last click places the text. A linear dimension is horizontal,
    vertical or aligned by where the pointer is; Space cycles through them.
    The Radius, Diameter, Angle, Hole Note and Center Mark buttons start the
    same tool limited to what they measure.

    ctx (from drawing.js):
        editor, data(), projections(), newId(prefix), commit(label, fn),
        setStatus(text), setPrompt(text), estimate(view) (a local box),
        editText(draft) (opens the text panel for a new note or text),
        done() (the tool ended by itself)
*/

import { annotationItems, scaleOf, toSheet, toLocal, frameOf } from './layout.js';
import { projectedFrame, sideFor, orientationKey, ORIENTATIONS } from './sheet.js';
import * as G2 from './geometry2d.js';

const NAMES = {
    linear: 'Dimension', radius: 'Radius', diameter: 'Diameter', angle: 'Angle', hole: 'Hole Note',
    center: 'Center Mark', note: 'Leader Note', text: 'Text'
};

function viewById(data, id) {
    return data.views.filter(function (v) {
        return v.id === id;
    })[0] || null;
}

function sheetPoint(data, viewId, local) {
    const v = viewById(data, viewId);
    return v ? toSheet(v, scaleOf(data, v), local) : local;
}

function edgeOnSheet(data, viewId, edge) {
    const v = viewById(data, viewId);
    if (!v) {
        return [];
    }
    const s = scaleOf(data, v);
    if (edge.type === 'circle' && edge.closed) {
        const pts = [];
        for (let i = 0; i <= 64; i++) {
            const t = i / 64 * 2 * Math.PI;
            pts.push(toSheet(v, s, [edge.c[0] + edge.r * Math.cos(t), edge.c[1] + edge.r * Math.sin(t)]));
        }
        return pts;
    }
    const pts = [];
    for (let i = 0; i < edge.pts.length; i += 2) {
        pts.push(toSheet(v, s, [edge.pts[i], edge.pts[i + 1]]));
    }
    return pts;
}

// What a pointer hit is, as something to dimension
function pickOf(hit) {
    if (!hit) {
        return null;
    }
    if (hit.snap) {
        return { kind: 'point', view: hit.view, p: hit.snap.p, snap: hit.snap.kind };
    }
    if (hit.edge) {
        return { kind: hit.edge.type === 'circle' ? 'circle' : hit.edge.type === 'line' ? 'line' : 'curve', view: hit.view, edge: hit.edge, local: hit.local };
    }
    return { kind: 'free', view: hit.view, p: hit.local };
}

function isHorizontal(e) {
    return Math.abs(e.a[1] - e.b[1]) < 1e-6;
}

function isVertical(e) {
    return Math.abs(e.a[0] - e.b[0]) < 1e-6;
}

// The orientation measuring square to a line: across a horizontal line is vertical
function across(e) {
    return isHorizontal(e) ? 'v' : isVertical(e) ? 'h' : 'a';
}

function along(e) {
    return isHorizontal(e) ? 'h' : isVertical(e) ? 'v' : 'a';
}

// Horizontal, vertical or aligned, by where the pointer is around two points
function orientFor(p1, p2, q) {
    if (Math.abs(p1[1] - p2[1]) < 1e-9) {
        return 'h';
    }
    if (Math.abs(p1[0] - p2[0]) < 1e-9) {
        return 'v';
    }
    const insideX = q[0] > Math.min(p1[0], p2[0]) && q[0] < Math.max(p1[0], p2[0]);
    const insideY = q[1] > Math.min(p1[1], p2[1]) && q[1] < Math.max(p1[1], p2[1]);
    if (insideX && !insideY) {
        return 'h';
    }
    if (insideY && !insideX) {
        return 'v';
    }
    return 'a';
}

// The foot of p on the (endless) line through edge e
function foot(p, e) {
    const d = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
    const l2 = d[0] * d[0] + d[1] * d[1];
    const t = l2 ? ((p[0] - e.a[0]) * d[0] + (p[1] - e.a[1]) * d[1]) / l2 : 0;
    return [e.a[0] + t * d[0], e.a[1] + t * d[1]];
}

function parallel(e1, e2) {
    const d1 = [e1.b[0] - e1.a[0], e1.b[1] - e1.a[1]];
    const d2 = [e2.b[0] - e2.a[0], e2.b[1] - e2.a[1]];
    const l = Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]);
    return !l || Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / l < 1e-6;
}

// The point of an edge nearest to p (view coordinates)
function nearestOnEdge(edge, p) {
    if (edge.type === 'circle' && edge.closed) {
        const d = [p[0] - edge.c[0], p[1] - edge.c[1]];
        const l = Math.hypot(d[0], d[1]) || 1;
        return [edge.c[0] + d[0] / l * edge.r, edge.c[1] + d[1] / l * edge.r];
    }
    let best = null;
    for (let i = 2; i < edge.pts.length; i += 2) {
        const n = G2.nearestOnSegment(p, [edge.pts[i - 2], edge.pts[i - 1]], [edge.pts[i], edge.pts[i + 1]]);
        if (!best || n.d < best.d) {
            best = n;
        }
    }
    return best ? best.point : p;
}

export function createDrawingTools(ctx) {
    const editor = ctx.editor;

    function hoverMarks(pick) {
        const data = ctx.data();
        const out = { marks: [], edges: [] };
        if (!pick) {
            return out;
        }
        if (pick.kind === 'point') {
            out.marks.push({ p: sheetPoint(data, pick.view, pick.p), kind: pick.snap || 'end' });
        } else if (pick.edge) {
            out.edges.push(edgeOnSheet(data, pick.view, pick.edge));
            if (pick.kind === 'circle') {
                out.marks.push({ p: sheetPoint(data, pick.view, pick.edge.c), kind: 'center' });
            }
        }
        return out;
    }

    /* ================= dimensions ================= */
    function dimension(mode) {
        let picks = [];
        let hovered = null;
        let draft = null;
        let forced = null;      // a linear orientation chosen with Space
        let circleKind = null;  // radius or diameter chosen with R / D
        const accepts = function (pick) {
            if (!pick) {
                return false;
            }
            if (mode === 'angle') {
                return pick.kind === 'line';
            }
            if (mode === 'radius' || mode === 'diameter' || mode === 'hole' || mode === 'center') {
                return pick.kind === 'circle';
            }
            return pick.kind === 'point' || pick.kind === 'line' || pick.kind === 'circle';
        };
        const firstPrompt = {
            auto: 'Dimension: click an edge, a circle or a point of a view',
            radius: 'Radius: click a circle or an arc',
            diameter: 'Diameter: click a circle or an arc',
            hole: 'Hole Note: click a hole (a circle)',
            angle: 'Angle: click two straight edges',
            center: 'Center Mark: click circles to mark their centres'
        }[mode];

        function prompt() {
            if (!picks.length) {
                ctx.setPrompt(firstPrompt);
                return;
            }
            const first = picks[0];
            if (first.kind === 'circle' || picks.length === 2) {
                ctx.setPrompt('Click to place the text' + (first.kind === 'circle' && mode === 'auto' ? ' (R: radius, D: diameter)' : '') + '. Esc starts again.');
            } else if (first.kind === 'line') {
                ctx.setPrompt(mode === 'angle' ? 'Angle: click the second straight edge' : 'Click to place the length, or a second edge (angle or distance), or a point');
            } else {
                ctx.setPrompt('Click a second point, edge or circle');
            }
        }

        function linearDraft(view, p1, p2, at, natural) {
            return { type: 'linear', view: view, p1: p1.slice(), p2: p2.slice(), orient: forced || natural || orientFor(p1, p2, at), at: at };
        }

        function twoLines(view, e1, e2, at) {
            if (parallel(e1, e2)) {
                const mid = [(e1.a[0] + e1.b[0]) / 2, (e1.a[1] + e1.b[1]) / 2];
                return linearDraft(view, mid, foot(mid, e2), at, across(e1));
            }
            return { type: 'angle', view: view, l1: [e1.a.slice(), e1.b.slice()], l2: [e2.a.slice(), e2.b.slice()], at: at };
        }

        function makeDraft(p) {
            if (!picks.length) {
                return null;
            }
            const data = ctx.data();
            const first = picks[0];
            const v = viewById(data, first.view);
            if (!v) {
                return null;
            }
            const at = toLocal(v, scaleOf(data, v), p);
            if (first.kind === 'circle') {
                const type = mode === 'auto' ? (circleKind || (first.edge.closed ? 'diameter' : 'radius')) : mode;
                const out = { type: type, view: v.id, c: first.edge.c.slice(), r: first.edge.r, at: at };
                if (type === 'hole') {
                    const proj = ctx.projections()[v.id];
                    out.count = proj ? Math.max(1, G2.countCircles(proj.edges, first.edge.r)) : 1;
                }
                return out;
            }
            const second = picks[1] || (hovered && hovered.view === first.view ? hovered : null);
            if (first.kind === 'line') {
                if (second && second.kind === 'line' && second.edge !== first.edge) {
                    return twoLines(v.id, first.edge, second.edge, at);
                }
                if (second && second.kind === 'point' && picks[1]) {
                    return linearDraft(v.id, second.p, foot(second.p, first.edge), at, across(first.edge));
                }
                return mode === 'angle' ? null : linearDraft(v.id, first.edge.a, first.edge.b, at, along(first.edge));
            }
            if (first.kind === 'point' && second) {
                if (second.kind === 'point' && G2.dist(second.p, first.p) > 1e-9) {
                    return linearDraft(v.id, first.p, second.p, at, null);
                }
                if (second.kind === 'line' && picks[1]) {
                    return linearDraft(v.id, first.p, foot(first.p, second.edge), at, across(second.edge));
                }
            }
            return null;
        }

        function reset() {
            picks = [];
            draft = null;
            forced = null;
            circleKind = null;
            prompt();
        }

        function commit(record) {
            if (!record) {
                return;
            }
            const out = Object.assign({ id: ctx.newId('d') }, record);
            ctx.commit('Add ' + NAMES[out.type === 'linear' ? 'linear' : out.type], function (d) {
                d.annotations.push(out);
            });
            reset();
        }

        const tool = {
            name: mode === 'auto' ? 'dimension' : mode,
            move: function (p) {
                const first = picks[0];
                const hit = editor.geometryAt(p, first ? function (v) {
                    return v.id === first.view;
                } : null);
                hovered = pickOf(hit);
                draft = makeDraft(p);
            },
            down: function (p) {
                tool.move(p);
                const pick = hovered;
                if (!picks.length) {
                    if (!accepts(pick)) {
                        ctx.setStatus(mode === 'auto' ? 'Click a straight edge, a circle or a snap point of a view' : firstPrompt);
                        return;
                    }
                    if (mode === 'center') {
                        commit({ type: 'center', view: pick.view, c: pick.edge.c.slice(), r: pick.edge.r });
                        return;
                    }
                    picks = [pick];
                    draft = makeDraft(p);
                    prompt();
                    return;
                }
                const first = picks[0];
                const same = pick && pick.view === first.view;
                if (picks.length === 1 && first.kind === 'line') {
                    if (same && pick.kind === 'line' && pick.edge !== first.edge) {
                        picks.push(pick);
                        draft = makeDraft(p);
                        prompt();
                        return;
                    }
                    if (same && pick.kind === 'point' && mode === 'auto') {
                        picks.push(pick);
                        draft = makeDraft(p);
                        prompt();
                        return;
                    }
                    if (mode === 'angle') {
                        ctx.setStatus('Click a second straight edge of the same view');
                        return;
                    }
                }
                if (picks.length === 1 && first.kind === 'point') {
                    if (same && pick.kind === 'point' && G2.dist(pick.p, first.p) > 1e-9) {
                        picks.push(pick);
                    } else if (same && pick.kind === 'circle') {
                        picks.push({ kind: 'point', view: pick.view, p: pick.edge.c, snap: 'center' });
                    } else if (same && pick.kind === 'line') {
                        picks.push(pick);
                    } else {
                        ctx.setStatus('Click a second point, a straight edge or a circle of the same view');
                        return;
                    }
                    draft = makeDraft(p);
                    prompt();
                    return;
                }
                commit(draft);
            },
            key: function (event) {
                const k = event.key.toLowerCase();
                if (k === 'escape' && picks.length) {
                    reset();
                    return true;
                }
                if (k === ' ' && draft && draft.type === 'linear') {
                    const order = [null, 'h', 'v', 'a'];
                    forced = order[(order.indexOf(forced) + 1) % order.length];
                    ctx.setStatus(forced ? 'Dimension: ' + { h: 'horizontal', v: 'vertical', a: 'aligned' }[forced] : 'Dimension: by the pointer');
                    const pointer = editor.pointer();
                    if (pointer) {
                        draft = makeDraft(pointer);
                    }
                    return true;
                }
                if ((k === 'r' || k === 'd') && mode === 'auto' && picks.length && picks[0].kind === 'circle') {
                    circleKind = k === 'r' ? 'radius' : 'diameter';
                    const pointer = editor.pointer();
                    if (pointer) {
                        draft = makeDraft(pointer);
                    }
                    return true;
                }
                return false;
            },
            overlay: function () {
                const data = ctx.data();
                const out = hoverMarks(hovered);
                picks.forEach(function (pick) {
                    const m = hoverMarks(pick);
                    out.marks = out.marks.concat(m.marks);
                    out.edges = out.edges.concat(m.edges);
                });
                out.items = draft ? annotationItems(draft, data) : [];
                // A rubber band from a first point while nothing can be measured yet
                if (!draft && picks.length === 1 && picks[0].kind === 'point' && editor.pointer()) {
                    out.items.push({ t: 'line', a: sheetPoint(data, picks[0].view, picks[0].p), b: editor.pointer(), layer: 'thin' });
                }
                return out;
            },
            cancel: function () {
                if (picks.length) {
                    reset();
                } else {
                    ctx.done();
                }
            },
            start: prompt
        };
        return tool;
    }

    /* ================= leader notes and text ================= */
    function note() {
        let target = null;
        let hovered = null;
        let draft = null;
        const tool = {
            name: 'note',
            move: function (p) {
                const data = ctx.data();
                if (!target) {
                    hovered = pickOf(editor.geometryAt(p));
                    draft = null;
                    return;
                }
                const v = target.view ? viewById(data, target.view) : null;
                draft = { type: 'note', view: target.view, p: target.p, at: v ? toLocal(v, scaleOf(data, v), p) : p, text: 'Note', end: target.end };
            },
            down: function (p) {
                if (!target) {
                    const pick = pickOf(editor.geometryAt(p));
                    if (pick && pick.kind === 'point') {
                        target = { view: pick.view, p: pick.p.slice(), end: 'arrow' };
                    } else if (pick && pick.edge) {
                        target = { view: pick.view, p: nearestOnEdge(pick.edge, pick.local), end: 'arrow' };
                    } else if (pick) {
                        // Inside a view but on no edge: a face; ISO marks surfaces with a dot
                        target = { view: pick.view, p: pick.p.slice(), end: 'dot' };
                    } else {
                        target = { view: null, p: p, end: 'arrow' };
                    }
                    ctx.setPrompt('Leader Note: click where the text goes');
                    return;
                }
                tool.move(p);
                const made = draft;
                target = null;
                draft = null;
                ctx.setPrompt('Leader Note: click what the note points at (an edge, a point, or a face inside a view)');
                ctx.editText(made);
            },
            key: function (event) {
                if (event.key === 'Escape' && target) {
                    target = null;
                    draft = null;
                    ctx.setPrompt('Leader Note: click what the note points at (an edge, a point, or a face inside a view)');
                    return true;
                }
                return false;
            },
            overlay: function () {
                const out = target ? { marks: [], edges: [] } : hoverMarks(hovered);
                out.items = draft ? annotationItems(draft, ctx.data()) : [];
                return out;
            },
            cancel: function () {
                if (target) {
                    target = null;
                    draft = null;
                } else {
                    ctx.done();
                }
            },
            start: function () {
                ctx.setPrompt('Leader Note: click what the note points at (an edge, a point, or a face inside a view)');
            }
        };
        return tool;
    }

    function freeText() {
        return {
            name: 'text',
            move: function () {},
            down: function (p) {
                ctx.editText({ type: 'text', view: null, at: p, text: '' });
            },
            key: function () {
                return false;
            },
            overlay: function () {
                const p = editor.pointer();
                return p ? { marks: [{ p: p, kind: 'end' }] } : null;
            },
            cancel: function () {
                ctx.done();
            },
            start: function () {
                ctx.setPrompt('Text: click where the text starts');
            }
        };
    }

    /* ================= projected views ================= */
    // Where a projected view would go for a pointer at p: { rel, x, y, box, label }
    function projectedGhost(parentId, p) {
        const data = ctx.data();
        const parent = viewById(data, parentId);
        const pbox = parent && editor.viewBox(parentId);
        if (!pbox) {
            return null;
        }
        const s = scaleOf(data, parent);
        const rel = sideFor(p[0] - (pbox[0] + pbox[2]) / 2, p[1] - (pbox[1] + pbox[3]) / 2);
        if (!rel) {
            return null;
        }
        const frame = projectedFrame(frameOf(data, parent), rel, data.sheet.projection);
        const local = ctx.estimate({ source: parent.source, dir: frame.dir, xdir: frame.xdir });
        if (!local) {
            return null;
        }
        const mx = (local[0] + local[2]) / 2;
        const my = (local[1] + local[3]) / 2;
        let x = p[0] - s * mx;
        let y = p[1] - s * my;
        if (rel === 'right' || rel === 'left') {
            y = parent.y;
        } else if (rel === 'top' || rel === 'bottom') {
            x = parent.x;
        }
        const key = orientationKey(frame);
        const label = rel.length === 2 ? 'Isometric view' : key ? ORIENTATIONS[key].label + ' view' : 'Projected view';
        return { rel: rel, x: x, y: y, box: [x + s * local[0], y + s * local[1], x + s * local[2], y + s * local[3]], label: label };
    }

    function projected(parentId) {
        let parent = parentId || null;
        let ghost = null;
        let hoverView = null;
        let made = 0;
        const tool = {
            name: 'projected',
            move: function (p) {
                if (!parent) {
                    hoverView = editor.viewAt(p);
                    return;
                }
                ghost = projectedGhost(parent, p);
            },
            down: function (p) {
                if (!parent) {
                    parent = editor.viewAt(p);
                    if (parent) {
                        tool.start();
                    } else {
                        ctx.setStatus('Click a view to project from');
                    }
                    return;
                }
                ghost = projectedGhost(parent, p);
                if (!ghost) {
                    return;
                }
                const data = ctx.data();
                const pv = viewById(data, parent);
                const id = ctx.newId('v');
                const iso = ghost.rel.length === 2;
                const record = {
                    id: id, name: ctx.newViewName(), source: pv.source, parent: parent, rel: ghost.rel,
                    x: ghost.x, y: ghost.y, scale: null, hidden: iso ? false : !!pv.hidden, smooth: pv.smooth !== false,
                    centers: pv.centers !== false, label: false, faces: pv.faces || null
                };
                ctx.commit('Add projected view', function (d) {
                    d.views.push(record);
                });
                made++;
                ctx.setStatus(ghost.label + ' added. Move round the view for more; right click or Esc when done.');
            },
            key: function () {
                return false;
            },
            overlay: function () {
                if (!parent) {
                    const box = hoverView && editor.viewBox(hoverView);
                    return box ? { frames: [{ box: box, cls: 'ov-hot' }] } : null;
                }
                return ghost ? { frames: [{ box: ghost.box, cls: 'ov-ghost', label: ghost.label }] } : null;
            },
            cancel: function () {
                ctx.done();
            },
            start: function () {
                ctx.setPrompt(parent ? 'Projected View: move beside the view and click to place (right click or Esc when done)' : 'Projected View: click the view to project from');
            },
            count: function () {
                return made;
            }
        };
        return tool;
    }

    /* ================= placing a new view ================= */
    // spec: the view record without x, y; local: its estimated local box
    function place(spec, local, onPlaced, onCancel) {
        let ghost = null;
        const tool = {
            name: 'place',
            move: function (p) {
                const s = scaleOf(ctx.data(), spec);
                const mx = (local[0] + local[2]) / 2;
                const my = (local[1] + local[3]) / 2;
                const x = p[0] - s * mx;
                const y = p[1] - s * my;
                ghost = { x: x, y: y, box: [x + s * local[0], y + s * local[1], x + s * local[2], y + s * local[3]] };
            },
            down: function (p) {
                tool.move(p);
                onPlaced(ghost.x, ghost.y);
            },
            key: function () {
                return false;
            },
            overlay: function () {
                return ghost ? { frames: [{ box: ghost.box, cls: 'ov-ghost', label: spec.name }] } : null;
            },
            cancel: function () {
                if (onCancel) {
                    onCancel();
                }
                ctx.done();
            },
            start: function () {
                ctx.setPrompt('Click on the sheet to place ' + spec.name + ' (Esc to cancel)');
            }
        };
        return tool;
    }

    return {
        dimension: dimension,
        note: note,
        text: freeText,
        projected: projected,
        place: place
    };
}
