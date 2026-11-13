/*
    3D Modeler - sketcher

    The 2D sketch environment: owns the pointer while a sketch is open, does
    the snapping, runs the constraint solver after every change, and stores
    each finished action in the document as one undo step.

    It edits a working copy of the sketch. commit() solves that copy and, if
    the constraints can be met, writes it to the sketch feature; if not, the
    copy is rolled back to the last stored state. Tools (tools.js) only change
    the working copy and call commit().

    createSketcher(options)
        stage       element the overlay is added to (the viewport's parent)
        canvas      the viewport canvas; pointer events are read from it
        viewport    project(), pointOnPlane(), worldPerPixel(), setSketching()
        doc         the document
        onPrompt(text)   what the active tool wants next ('' for nothing)
        onStatus(text)   state of the sketch, for the status bar
        onState({ tool, construction })   for the ribbon buttons
*/

import * as M from './model.js';
import { createSolver } from './solver.js';
import { draw, dimensionLabel } from './render.js';
import { TOOLS } from './tools.js';
import { nearest, midpoint, dist } from './geom.js';
import { planeFrame } from '../kernel/profile.js';
import { projectInto } from './project.js';
import { evaluate, isFormula } from '../expr.js';
import { wheelStep } from '../ui.js';

const POINT_PIXELS = 9;
const CURVE_PIXELS = 7;
const INFER_PIXELS = 6;
// A stroke this close to level or upright (degrees) snaps to it
const ANGLE_SNAP = 3;
const DRAG_PIXELS = 4;

export function createSketcher(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    const canvas = options.canvas;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'sketch-overlay';
    svg.style.display = 'none';
    canvas.after(svg);
    const hud = document.createElement('div');
    hud.id = 'sketch-hud';
    hud.hidden = true;
    options.stage.appendChild(hud);
    // The rectangle of a window selection (a drag that starts on nothing)
    const windowBox = document.createElement('div');
    windowBox.id = 'sketch-window';
    windowBox.hidden = true;
    options.stage.appendChild(windowBox);
    const editor = document.createElement('input');
    editor.id = 'sketch-edit';
    editor.hidden = true;
    editor.autocomplete = 'off';
    options.stage.appendChild(editor);
    // The wheel steps the value in the box; Enter applies it
    wheelStep(editor, { min: 0, above: true });

    let solver = null;
    const solverReady = createSolver().then(function (s) {
        solver = s;
    });

    let fid = null;         // id of the open sketch feature
    let sk = null;          // working copy { geometry, constraints }
    let saved = null;       // JSON of the last stored state
    let frame = null;
    let result = { dof: -1, conflicting: [], redundant: [] };
    let fixed = new Set();  // geometry the constraints leave no freedom to
    let tool = null;
    let toolId = 'select';
    let picks = [];         // entities picked for a constraint tool
    let construction = false;
    let hover = null;       // id under the cursor
    let selection = [];     // ids of geometry and constraints
    let preview = null;
    let cache = { points: [], curves: [], dims: [], badges: [] };
    let lastSnap = null;
    let cursor = [0, 0];    // canvas pixels
    let drag = null;
    let fieldLabels = [];   // [{ label, unit }]
    let fieldTexts = [];
    let fieldActive = 0;
    let fieldLive = [];     // [{ value, at: [u, v] on the plane, hide }] from the tool
    let editing = null;     // dimension id in the value editor
    let glyphs = true;      // constraint glyphs shown (F8) or hidden (F9)

    /* ================= drawing ================= */
    function redraw() {
        if (!sk) {
            return;
        }
        cache = draw(svg, {
            sk: sk, frame: frame, project: viewport.project, hover: hover, width: canvas.clientWidth, height: canvas.clientHeight,
            selected: new Set(selection.concat(picks)), dof: result.dof, fixed: fixed, glyphs: glyphs,
            bad: new Set(result.conflicting.concat(result.redundant)), preview: preview
        });
    }

    // Which geometry is pinned down. The solver only gives a total, so each
    // point is nudged in a copy of the sketch: if the constraints pull it
    // straight back it is fixed. A curve is fixed when all its points are (and,
    // for a circle, when its radius snaps back too). Run after a change is
    // stored, never during a drag.
    function findFixed() {
        fixed = new Set();
        if (result.dof < 0) {
            return;
        }
        const points = sk.geometry.filter(function (g) {
            return g.type === 'point';
        });
        const all = result.dof === 0;
        if (!all && points.length > 200) {
            return; // too many probes for a big, loose sketch; show it all as free
        }
        const text = JSON.stringify(sk);
        const stays = function (id) {
            if (all || id === M.ORIGIN) {
                return true;
            }
            const copy = JSON.parse(text);
            const p = M.point(copy, id);
            const r = solver.solve(copy, [{ p: id, x: p[0] + 1, y: p[1] + 0.7 }]);
            const q = M.point(copy, id);
            return !r.ok || Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-4;
        };
        points.forEach(function (g) {
            if (stays(g.id)) {
                fixed.add(g.id);
            }
        });
        fixed.add(M.ORIGIN);
        sk.geometry.forEach(function (g) {
            if (g.type === 'point') {
                return;
            }
            const ends = g.type === 'line' ? [g.p1, g.p2] : g.type === 'arc' ? [g.c, g.start, g.end] : [g.c];
            let pinned = ends.every(function (id) {
                return fixed.has(id);
            });
            if (pinned && g.type === 'circle' && !all) {
                const copy = JSON.parse(text);
                const twin = M.find(copy, g.id);
                twin.r = g.r * 1.25 + 1;
                pinned = solver.solve(copy).ok && Math.abs(twin.r - g.r) < 1e-4;
            }
            if (pinned) {
                fixed.add(g.id);
            }
        });
    }

    function report() {
        findFixed();
        const feature = doc.feature(fid);
        const name = feature ? feature.name : 'Sketch';
        const curves = sk.geometry.filter(function (g) {
            return g.type !== 'point';
        }).length;
        if (!curves) {
            options.onStatus(name + ': empty. Pick a tool from the Sketch tab.');
        } else if (result.dof === 0) {
            options.onStatus(name + ': fully constrained');
        } else {
            options.onStatus(name + ': ' + result.dof + ' degree' + (result.dof === 1 ? '' : 's') + ' of freedom left');
        }
    }

    // A point of the sketch plane in canvas pixels
    function screenOf(p) {
        return viewport.project([
            frame.o[0] + frame.x[0] * p[0] + frame.y[0] * p[1],
            frame.o[1] + frame.x[1] * p[0] + frame.y[1] * p[1],
            frame.o[2] + frame.x[2] * p[0] + frame.y[2] * p[1]
        ]);
    }

    function liveText(value, unit) {
        if (!isFinite(value)) {
            return '';
        }
        return (unit === 'deg' ? +value.toFixed(2) : unit === 'mm' ? +value.toFixed(3) : Math.round(value)) + (unit ? ' ' + unit : '');
    }

    // The size boxes of a tool, as Inventor shows them: each sits on the
    // shape being drawn (where the tool says, else beside the pointer) and
    // shows the size as it is now until something is typed into it; the
    // active one (Tab moves on) takes the keys. A typed formula shows its
    // result: "35/2 = 17.5".
    function showFields() {
        hud.hidden = !fieldLabels.length;
        hud.innerHTML = '';
        let loose = 0;
        fieldLabels.forEach(function (spec, i) {
            const live = fieldLive[i] || null;
            const text = fieldTexts[i];
            if (live && live.hide && !text && i !== fieldActive) {
                return;
            }
            const box = document.createElement('span');
            box.className = 'hud-field' + (i === fieldActive ? ' active' : '') + (text ? ' typed' : '');
            let shown;
            if (text) {
                const value = evaluate(text);
                shown = text + (isFormula(text) ? ' = ' + (isNaN(value) ? '?' : +value.toFixed(4)) : '') + (spec.unit ? ' ' + spec.unit : '');
            } else {
                shown = live ? liveText(live.value, spec.unit) : '';
            }
            // A box without a unit (a count) or without a value says what it is
            box.textContent = (!spec.unit || !shown ? spec.label + ' ' : '') + (shown || '-');
            if (live && live.at && frame) {
                const p = screenOf(live.at);
                box.style.left = p[0] + 'px';
                box.style.top = p[1] + 'px';
                box.classList.add('placed');
            } else {
                box.style.left = cursor[0] + 18 + 'px';
                box.style.top = cursor[1] + 18 + loose * 24 + 'px';
                loose++;
            }
            hud.appendChild(box);
        });
    }

    /* ================= storing ================= */
    function restore() {
        sk = M.clone(JSON.parse(saved));
        const r = solver.solve(sk);
        result = r.ok ? r : { dof: -1, conflicting: r.conflicting, redundant: r.redundant };
    }

    // Solve the working copy and store it as one undo step. Constraints added
    // since the last store that turn out redundant are dropped quietly, unless
    // `strict` is set: then the whole edit is refused, as it is for a conflict.
    function commit(label, strict) {
        const before = new Set(JSON.parse(saved).constraints.map(function (c) {
            return c.id;
        }));
        const added = function (id) {
            return !before.has(id);
        };
        let r = solver.solve(sk);
        let dropped = 0;
        if (!r.ok && !strict) {
            // A snap left a constraint behind that cannot hold with the rest:
            // leave the automatic constraints out (the conflicting ones, else
            // all of them) rather than refuse the whole stroke. Dimensions
            // that were typed are never dropped.
            const automatic = sk.constraints.filter(function (c) {
                return added(c.id) && !M.isDimension(c);
            }).map(function (c) {
                return c.id;
            });
            const culprits = automatic.filter(function (id) {
                return r.conflicting.indexOf(id) >= 0;
            });
            const drop = culprits.length ? culprits : automatic;
            if (drop.length) {
                M.remove(sk, drop);
                const again = solver.solve(sk);
                if (again.ok) {
                    r = again;
                    dropped = drop.length;
                }
            }
        }
        const extra = r.redundant.filter(added);
        if (r.ok && extra.length && !strict) {
            M.remove(sk, extra);
            r = solver.solve(sk);
        }
        if (!r.ok || (strict && extra.length)) {
            restore();
            redraw();
            options.onStatus(!r.ok ? label + ' was not applied: it conflicts with the constraints already in the sketch'
                : label + ' was not applied: the sketch is already constrained that way');
            return false;
        }
        result = r;
        saved = JSON.stringify(sk);
        const stored = M.clone(sk);
        doc.change(label, function () {
            const feature = doc.feature(fid);
            feature.geometry = stored.geometry;
            feature.constraints = stored.constraints;
        });
        report();
        if (dropped) {
            options.onStatus(label + ' was drawn without ' + (dropped === 1 ? 'one automatic constraint' : dropped + ' automatic constraints') +
                ' (a snap that conflicted with the sketch)');
        }
        redraw();
        return true;
    }

    /* ================= picking and snapping ================= */
    function pixelOf(event) {
        const rect = canvas.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    }

    function segmentDistance(p, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    }

    function inBox(p, box) {
        return p[0] >= box.x && p[0] <= box.x + box.w && p[1] >= box.y && p[1] <= box.y + box.h;
    }

    /* ================= window selection ================= */
    // Dragged left to right it selects what lies wholly inside the window;
    // right to left (drawn dashed), what it touches as well
    function windowRect(from, to) {
        return { x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]), w: Math.abs(to[0] - from[0]), h: Math.abs(to[1] - from[1]) };
    }

    function showWindow(from, to) {
        const r = windowRect(from, to);
        windowBox.hidden = false;
        windowBox.classList.toggle('crossing', to[0] < from[0]);
        windowBox.style.left = r.x + 'px';
        windowBox.style.top = r.y + 'px';
        windowBox.style.width = r.w + 'px';
        windowBox.style.height = r.h + 'px';
    }

    // Does the segment a-b touch the box? (Liang-Barsky clipping)
    function segmentTouches(a, b, box) {
        let t0 = 0;
        let t1 = 1;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const edges = [[-dx, a[0] - box.x], [dx, box.x + box.w - a[0]], [-dy, a[1] - box.y], [dy, box.y + box.h - a[1]]];
        for (let i = 0; i < 4; i++) {
            const p = edges[i][0];
            const q = edges[i][1];
            if (Math.abs(p) < 1e-12) {
                if (q < 0) {
                    return false;
                }
            } else {
                const t = q / p;
                if (p < 0) {
                    t0 = Math.max(t0, t);
                } else {
                    t1 = Math.min(t1, t);
                }
                if (t0 > t1) {
                    return false;
                }
            }
        }
        return true;
    }

    function boxesMeet(a, b) {
        return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
    }

    function boxInside(inner, outer) {
        return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
    }

    function windowPick(from, to) {
        const box = windowRect(from, to);
        const crossing = to[0] < from[0];
        const ids = [];
        cache.points.forEach(function (p) {
            if (p.id && p.id !== M.ORIGIN && inBox([p.x, p.y], box)) {
                ids.push(p.id);
            }
        });
        cache.curves.forEach(function (c) {
            if (!c.id) {
                return;
            }
            const inside = c.pts.every(function (p) {
                return inBox(p, box);
            });
            let touched = inside;
            for (let i = 1; !touched && crossing && i < c.pts.length; i++) {
                touched = segmentTouches(c.pts[i - 1], c.pts[i], box);
            }
            if (inside || touched) {
                ids.push(c.id);
            }
        });
        cache.dims.concat(cache.badges).forEach(function (d) {
            if (crossing ? boxesMeet(d, box) : boxInside(d, box)) {
                ids.push(d.id);
            }
        });
        return ids.filter(function (id, i) {
            return ids.indexOf(id) === i;
        });
    }

    function nearestPoint(px) {
        let best = null;
        let bestD = POINT_PIXELS;
        cache.points.forEach(function (p) {
            const d = Math.hypot(p.x - px[0], p.y - px[1]);
            if (d < bestD) {
                bestD = d;
                best = p.id;
            }
        });
        return best;
    }

    function nearestCurve(px) {
        let best = null;
        let bestD = CURVE_PIXELS;
        cache.curves.forEach(function (c) {
            for (let i = 1; i < c.pts.length; i++) {
                const d = segmentDistance(px, c.pts[i - 1], c.pts[i]);
                if (d < bestD) {
                    bestD = d;
                    best = c.id;
                }
            }
        });
        return best;
    }

    // The entity under a canvas pixel: { kind: "point" | "dim" | "constraint" | "curve", id }
    function entityAt(px) {
        const p = nearestPoint(px);
        if (p) {
            return { kind: 'point', id: p };
        }
        const d = cache.dims.filter(function (box) {
            return inBox(px, box);
        })[0];
        if (d) {
            return { kind: 'dim', id: d.id };
        }
        const b = cache.badges.filter(function (box) {
            return inBox(px, box);
        })[0];
        if (b) {
            return { kind: 'constraint', id: b.id };
        }
        const c = nearestCurve(px);
        return c ? { kind: 'curve', id: c } : null;
    }

    // Where a click here would land: on a point, a midpoint, a curve, or level
    // with / straight above the tool's anchor point.
    function snapAt(event) {
        const px = pixelOf(event);
        const raw = viewport.pointOnPlane(event.clientX, event.clientY, frame) || [0, 0];
        const s = { pt: raw, raw: raw, point: null, curve: null, mid: null, h: false, v: false, hit: entityAt(px) };
        if (tool && tool.wantsModel) {
            s.model = viewport.modelItemAt(event.clientX, event.clientY);
        }
        if (tool && tool.noSnap) {
            return s;
        }
        const p = nearestPoint(px);
        if (p) {
            s.point = p;
            s.pt = M.point(sk, p);
            return s;
        }
        const c = nearestCurve(px);
        if (c) {
            const curve = M.curve(sk, c);
            if (curve.type === 'line') {
                const mid = midpoint(curve);
                if (dist(mid, raw) < POINT_PIXELS * viewport.worldPerPixel()) {
                    s.mid = c;
                    s.pt = mid;
                    return s;
                }
            }
            s.curve = c;
            s.pt = nearest(curve, raw);
            return s;
        }
        const anchor = tool && tool.anchor ? tool.anchor() : null;
        if (anchor) {
            // Level or upright with the anchor: within a few pixels, or a
            // stroke within ANGLE_SNAP degrees of the sketch axes (a long
            // line drawn nearly level becomes level)
            const tolerance = INFER_PIXELS * viewport.worldPerPixel();
            const slope = Math.tan(ANGLE_SNAP * Math.PI / 180);
            const dx = Math.abs(raw[0] - anchor[0]);
            const dy = Math.abs(raw[1] - anchor[1]);
            if (dy < Math.max(tolerance, dx * slope) && dx >= dy) {
                s.pt = [raw[0], anchor[1]];
                s.h = true;
            } else if (dx < Math.max(tolerance, dy * slope)) {
                s.pt = [anchor[0], raw[1]];
                s.v = true;
            }
        }
        return s;
    }

    function snapFor(event) {
        const s = snapAt(event);
        return tool && tool.constrain ? tool.constrain(s) : s;
    }

    // Constraint and Dimension tools can pick an edge of the model that is
    // not in the sketch yet, as Inventor does: it is projected on the spot.
    function picksModel() {
        return toolId === 'dimension' || toolId.indexOf('con:') === 0;
    }

    function modelEdgeAt(event) {
        const item = viewport.modelItemAt(event.clientX, event.clientY);
        return item && item.type === 'edge' ? item : null;
    }

    // Project the model edge under the pointer and return it as a pick:
    // its end point when the pointer is on one, otherwise the curve.
    function pickModelEdge(event) {
        const item = modelEdgeAt(event);
        if (!item) {
            return null;
        }
        const made = projectInto(sk, frame, viewport.curvesOf(item)[0]);
        if (!made) {
            options.onStatus('This edge cannot be used here: only straight edges and circles seen face-on can be projected');
            return null;
        }
        if (made.added && !commit('Project geometry')) {
            return null;
        }
        viewport.hoverModel(null);
        const g = M.find(sk, made.id);
        const raw = viewport.pointOnPlane(event.clientX, event.clientY, frame) || [0, 0];
        const reach = POINT_PIXELS * viewport.worldPerPixel();
        const ends = g.type === 'line' ? [g.p1, g.p2] : g.type === 'arc' ? [g.start, g.end] : [];
        const end = ends.filter(function (id) {
            return dist(M.point(sk, id), raw) < reach;
        })[0];
        return end ? { kind: 'point', id: end } : { kind: 'curve', id: made.id };
    }

    /* ================= tools ================= */
    const ctx = {
        sk: function () {
            return sk;
        },
        resolve: function (s, lone) {
            if (s.point) {
                return s.point;
            }
            const id = M.addPoint(sk, s.pt[0], s.pt[1], lone);
            if (s.mid) {
                M.addConstraint(sk, { type: 'midpoint', p: id, line: s.mid });
            } else if (s.curve) {
                M.addConstraint(sk, { type: 'pointon', p: id, curve: s.curve });
            }
            return id;
        },
        commit: commit,
        preview: function (p) {
            preview = p;
            redraw();
        },
        prompt: function (text) {
            options.onPrompt(text);
        },
        // The size boxes: labels, or { label, unit: "mm" | "deg" | "" }
        fields: function (labels) {
            fieldLabels = labels.map(function (l) {
                return typeof l === 'string' ? { label: l, unit: '' } : l;
            });
            fieldTexts = labels.map(function () {
                return '';
            });
            fieldLive = [];
            fieldActive = 0;
            showFields();
        },
        // What each box shows until something is typed, and where:
        // [{ value, at: [u, v], hide }] (hide: only when not active or typed)
        live: function (list) {
            fieldLive = list || [];
            showFields();
        },
        typed: function (i) {
            const v = evaluate(fieldTexts[i]);
            return v > 0 ? v : 0;
        },
        // The number typed into box i, of any sign, or NaN when it is empty
        typedValue: function (i) {
            return fieldTexts[i] ? evaluate(fieldTexts[i]) : NaN;
        },
        frame: function () {
            return frame;
        },
        hoverModel: function (item) {
            viewport.hoverModel(item);
        },
        modelCurves: function (item) {
            return viewport.curvesOf(item);
        },
        construction: function () {
            return construction;
        },
        pixel: function () {
            return viewport.worldPerPixel();
        },
        editDimension: function (id) {
            editDimension(id);
        },
        // What was selected when the tool was started
        preselected: function () {
            return preselected;
        },
        // Show the entities a tool has picked as selected
        setPicks: function (ids) {
            picks = ids.slice();
            redraw();
        }
    };
    let preselected = [];

    function announce() {
        options.onState({ tool: toolId, construction: construction });
    }

    function setTool(id) {
        closeEditor(false);
        if (sk && tool && tool.cancel) {
            tool.cancel();
        }
        viewport.hoverModel(null);
        toolId = id;
        picks = [];
        preview = null;
        tool = null;
        ctx.fields([]);
        if (TOOLS[id]) {
            preselected = selection.slice();
            selection = [];
            tool = TOOLS[id](ctx);
            canvas.style.cursor = 'crosshair';
        } else if (id.indexOf('con:') === 0) {
            selection = [];
            canvas.style.cursor = 'crosshair';
            constraintStep();
        } else {
            toolId = 'select';
            canvas.style.cursor = '';
            options.onPrompt('');
        }
        announce();
        redraw();
    }

    // Constraint tool: collect picks until model.build() has enough
    function constraintStep() {
        const type = toolId.slice(4);
        const built = M.build(sk, type, picks);
        if (built.error) {
            picks = [];
            options.onPrompt(built.error);
        } else if (built.more) {
            options.onPrompt(built.more);
        } else {
            built.add.forEach(function (c) {
                M.addConstraint(sk, c);
            });
            picks = [];
            if (built.add.length && commit(type.charAt(0).toUpperCase() + type.slice(1) + ' constraint', true)) {
                options.onPrompt(M.build(sk, type, []).more || '');
            }
        }
        redraw();
    }

    // Ribbon constraint button: apply to the selection when it fits,
    // otherwise become the active tool and ask for picks
    function constrain(type) {
        if (!sk) {
            return;
        }
        const usable = selection.filter(function (id) {
            return id === M.ORIGIN || M.find(sk, id);
        });
        if (toolId === 'select' && usable.length) {
            const built = M.build(sk, type, usable);
            if (built.add && built.add.length) {
                built.add.forEach(function (c) {
                    M.addConstraint(sk, c);
                });
                selection = [];
                commit(type.charAt(0).toUpperCase() + type.slice(1) + ' constraint', true);
                redraw();
                return;
            }
        }
        setTool('con:' + type);
    }

    function toggleConstruction() {
        const curves = selection.filter(function (id) {
            const g = M.find(sk, id);
            return g && g.type !== 'point';
        });
        if (toolId === 'select' && curves.length) {
            // Turn the selected curves into construction geometry, or back
            const all = curves.every(function (id) {
                return M.find(sk, id).construction;
            });
            curves.forEach(function (id) {
                const g = M.find(sk, id);
                if (all) {
                    delete g.construction;
                } else {
                    g.construction = true;
                }
            });
            commit(all ? 'Normal geometry' : 'Construction geometry');
            return;
        }
        construction = !construction;
        announce();
    }

    function deleteSelection() {
        if (!selection.length) {
            return false;
        }
        M.remove(sk, selection.filter(function (id) {
            return id !== M.ORIGIN;
        }));
        selection = [];
        hover = null;
        commit('Delete');
        return true;
    }

    /* ================= dimension value editor ================= */
    function editDimension(id) {
        const d = sk.constraints.filter(function (c) {
            return c.id === id;
        })[0];
        if (d && d.driven) {
            options.onStatus('A driven dimension shows a size the sketch already sets; change the dimensions that drive it, or delete it');
            return;
        }
        const box = cache.dims.filter(function (b) {
            return b.id === id;
        })[0];
        if (!d || !box) {
            return;
        }
        editing = id;
        editor.value = (d.type === 'axisangle' && d.value < 0 ? '-' : '') + dimensionLabel(d).replace(/[^0-9.]/g, '');
        editor.hidden = false;
        editor.style.left = box.x + box.w / 2 - 36 + 'px';
        editor.style.top = box.y - 3 + 'px';
        editor.focus();
        editor.select();
    }

    function closeEditor(apply) {
        if (!editing) {
            return;
        }
        const id = editing;
        editing = null;
        editor.hidden = true;
        const d = sk && sk.constraints.filter(function (c) {
            return c.id === id;
        })[0];
        const typed = evaluate(editor.value); // a formula such as 35/2 is fine
        // The angle of a line to the X axis may be zero or below; sizes not
        const axis = !!d && d.type === 'axisangle';
        if (!apply || !d || !isFinite(typed) || (!axis && !(typed > 0))) {
            return;
        }
        // Angles are typed in degrees; the stored sign (which side) is kept,
        // except for an axis angle, which is typed with its sign
        const magnitude = d.type === 'angle' || axis ? typed * Math.PI / 180 : typed;
        const value = !axis && d.value < 0 ? -magnitude : magnitude;
        if (Math.abs(value - d.value) > 1e-9) {
            d.value = value;
            commit('Edit dimension', true);
        }
    }

    editor.addEventListener('keydown', function (event) {
        event.stopPropagation();
        if (event.key === 'Enter') {
            closeEditor(true);
        } else if (event.key === 'Escape') {
            closeEditor(false);
        }
    });
    editor.addEventListener('blur', function () {
        closeEditor(true);
    });

    /* ================= pointer ================= */
    function active() {
        return !!sk && !viewport.isPicking() && !viewport.isNavigating();
    }

    function pointsOf(id) {
        const g = M.find(sk, id);
        if (!g) {
            return [];
        }
        if (g.type === 'point') {
            return [id];
        }
        return (g.type === 'line' ? [g.p1, g.p2] : g.type === 'arc' ? [g.c, g.start, g.end] : []).filter(function (p) {
            return p !== M.ORIGIN;
        });
    }

    canvas.addEventListener('pointerdown', function (event) {
        if (!active() || event.button !== 0) {
            return;
        }
        closeEditor(true);
        const px = pixelOf(event);
        if (toolId !== 'select') {
            return; // tools act on release, so a click is never mistaken for a drag
        }
        const hit = entityAt(px);
        drag = { hit: hit, from: px, moved: false, origin: viewport.pointOnPlane(event.clientX, event.clientY, frame) };
        if (hit && (hit.kind === 'point' || hit.kind === 'curve')) {
            const g = M.find(sk, hit.id);
            drag.points = pointsOf(hit.id).map(function (id) {
                return { id: id, at: M.point(sk, id) };
            });
            drag.circle = g && g.type === 'circle' ? hit.id : null;
        }
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (e) {
            // A pointer that is already gone cannot be captured; dragging still works inside the canvas
        }
    });

    canvas.addEventListener('pointermove', function (event) {
        if (!active()) {
            return;
        }
        cursor = pixelOf(event);
        if (fieldLabels.length) {
            showFields();
        }
        if (drag) {
            dragMove(event);
            return;
        }
        if (event.buttons) {
            return; // panning with the middle or right button
        }
        if (picksModel()) {
            // Nothing of the sketch here: offer the model edge underneath
            viewport.hoverModel(entityAt(cursor) ? null : modelEdgeAt(event));
        }
        if (tool) {
            lastSnap = snapFor(event);
            const overCurve = tool.noSnap && lastSnap.hit ? lastSnap.hit.id : null;
            hover = overCurve;
            tool.move(lastSnap);
            if (tool.noSnap) {
                redraw(); // these tools show what they would act on through the hover highlight
            }
            return;
        }
        const hit = entityAt(cursor);
        const id = hit ? hit.id : null;
        if (id !== hover) {
            hover = id;
            redraw();
        }
    });

    function dragMove(event) {
        const px = pixelOf(event);
        if (!drag.moved && Math.hypot(px[0] - drag.from[0], px[1] - drag.from[1]) < DRAG_PIXELS) {
            return;
        }
        drag.moved = true;
        if (!drag.hit) {
            showWindow(drag.from, px);
            return;
        }
        const at = viewport.pointOnPlane(event.clientX, event.clientY, frame);
        if (!at) {
            return;
        }
        if (drag.hit.kind === 'dim') {
            const d = sk.constraints.filter(function (c) {
                return c.id === drag.hit.id;
            })[0];
            if (d) {
                d.pos = at;
            }
        } else if (drag.circle) {
            const g = M.find(sk, drag.circle);
            const old = g.r;
            g.r = Math.max(dist(M.point(sk, g.c), at), 1e-3);
            if (!solver.solve(sk).ok) {
                g.r = old;
            }
        } else if (drag.points && drag.points.length) {
            const dx = at[0] - drag.origin[0];
            const dy = at[1] - drag.origin[1];
            solver.solve(sk, drag.points.map(function (p) {
                return { p: p.id, x: p.at[0] + dx, y: p.at[1] + dy };
            }));
        }
        redraw();
    }

    canvas.addEventListener('pointerup', function (event) {
        if (!active() || event.button !== 0) {
            return;
        }
        if (toolId !== 'select') {
            const s = snapFor(event);
            if (picksModel() && !s.hit) {
                s.hit = pickModelEdge(event);
            }
            lastSnap = s;
            if (tool) {
                tool.click(s);
                if (tool) {
                    tool.move(snapFor(event));
                }
            } else if (s.hit && (s.hit.kind === 'point' || s.hit.kind === 'curve') && picks.indexOf(s.hit.id) < 0) {
                picks.push(s.hit.id);
                constraintStep();
            }
            return;
        }
        const d = drag;
        drag = null;
        if (!d) {
            return;
        }
        const additive = event.ctrlKey || event.shiftKey || event.metaKey;
        if (d.moved) {
            if (d.hit) {
                commit(d.hit.kind === 'dim' ? 'Move dimension' : 'Drag');
            } else {
                windowBox.hidden = true;
                const picked = windowPick(d.from, pixelOf(event));
                selection = additive ? selection.concat(picked.filter(function (id) {
                    return selection.indexOf(id) < 0;
                })) : picked;
                redraw();
            }
            return;
        }
        if (!d.hit) {
            if (!additive) {
                selection = [];
            }
        } else if (additive) {
            selection = selection.indexOf(d.hit.id) >= 0 ? selection.filter(function (id) {
                return id !== d.hit.id;
            }) : selection.concat([d.hit.id]);
        } else {
            selection = [d.hit.id];
        }
        redraw();
    });

    canvas.addEventListener('dblclick', function (event) {
        if (!active()) {
            return;
        }
        if (tool && tool.finish) {
            tool.finish();
            return;
        }
        const hit = entityAt(pixelOf(event));
        if (toolId === 'select' && hit && hit.kind === 'dim') {
            editDimension(hit.id);
        }
    });

    /* ================= keyboard ================= */
    // Returns true when the key was used by the sketcher
    function handleKey(event) {
        if (!sk || event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }
        const key = event.key;
        if (fieldLabels.length && tool) {
            let used = true;
            if (/^[0-9.+\-*/()^]$/.test(key)) {
                fieldTexts[fieldActive] += key;
            } else if (key === 'Backspace') {
                fieldTexts[fieldActive] = fieldTexts[fieldActive].slice(0, -1);
            } else if (key === 'Tab') {
                fieldActive = (fieldActive + 1) % fieldLabels.length;
            } else if (key === 'Enter' && lastSnap) {
                const s = tool.constrain ? tool.constrain(Object.assign({}, lastSnap)) : lastSnap;
                tool.click(s);
            } else {
                used = false;
            }
            if (used) {
                showFields();
                if (tool && lastSnap) {
                    tool.move(tool.constrain ? tool.constrain(Object.assign({}, lastSnap)) : lastSnap);
                }
                return true;
            }
        }
        if (key === 'Enter' && tool && tool.finish) {
            tool.finish(); // a step done (Mirror: the curves are picked)
            return true;
        }
        if (key === 'F8' || key === 'F9') {
            // As in Inventor: F8 shows every constraint glyph, F9 hides them
            glyphs = key === 'F8';
            options.onStatus(glyphs ? 'Constraints shown (F9 hides them)' : 'Constraints hidden (F8 shows them)');
            redraw();
            return true;
        }
        if (key === 'Escape') {
            if (toolId === 'select') {
                if (!selection.length) {
                    return false;
                }
                selection = [];
                redraw();
            } else if (picks.length) {
                picks = [];
                constraintStep();
            } else if (!(tool && tool.cancel())) {
                setTool('select');
            }
            return true;
        }
        if (key === 'Delete' || key === 'Backspace') {
            return toolId === 'select' && deleteSelection();
        }
        return false;
    }

    /* ================= open / close ================= */
    function load() {
        const feature = doc.feature(fid);
        if (!feature || feature.type !== 'sketch') {
            return false;
        }
        frame = planeFrame(feature.plane, doc.features());
        if (!frame) {
            return false;
        }
        sk = M.clone(feature);
        saved = JSON.stringify(sk);
        const r = solver.solve(sk);
        result = r.ok ? r : { dof: -1, conflicting: r.conflicting, redundant: r.redundant };
        selection = selection.filter(function (id) {
            return M.find(sk, id) || sk.constraints.some(function (c) {
                return c.id === id;
            });
        });
        hover = null;
        report();
        redraw();
        return true;
    }

    viewport.onRender = function () {
        if (sk) {
            redraw();
        }
    };

    return {
        // Open a sketch feature for editing. Resolves to false if it cannot be opened.
        open: function (id) {
            return solverReady.then(function () {
                fid = id;
                selection = [];
                if (!load()) {
                    fid = null;
                    sk = null;
                    return false;
                }
                svg.style.display = '';
                viewport.setSketching(true);
                setTool('select');
                return true;
            });
        },
        close: function () {
            if (!sk) {
                return;
            }
            setTool('select');
            sk = null;
            fid = null;
            svg.style.display = 'none';
            svg.innerHTML = '';
            hud.hidden = true;
            windowBox.hidden = true;
            canvas.style.cursor = '';
            viewport.setSketching(false);
            options.onPrompt('');
        },
        isOpen: function () {
            return !!sk;
        },
        featureId: function () {
            return fid;
        },
        frame: function () {
            return frame;
        },
        // The document changed under the sketcher (undo, redo): take the
        // stored sketch again. False when the sketch no longer exists.
        reload: function () {
            if (!sk) {
                return true;
            }
            if (tool && tool.cancel) {
                tool.cancel();
            }
            picks = [];
            return load();
        },
        setTool: setTool,
        constrain: constrain,
        toggleConstruction: toggleConstruction,
        handleKey: handleKey
    };
}
