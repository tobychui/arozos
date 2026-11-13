/*
    3D Modeler - sketch tools

    One small state machine per tool. The sketcher (sketcher.js) owns the
    pointer, the snapping and the document; a tool only says what a click
    means. Every tool is made by a function taking the context `ctx`:

        ctx.sk()                    the sketch being edited (edit it in place)
        ctx.resolve(snap, lone)     the point id for a snapped position: the
                                    existing point, or a new one tied to the
                                    curve or midpoint it snapped to
        ctx.commit(label, strict)   solve and store as one undo step; false
                                    (and the edit is rolled back) if it fails
        ctx.preview(p)              rubber band: { curves, dims, snap } or null
        ctx.prompt(text)            what to do next
        ctx.fields(labels)          typed size boxes to show ([] for none):
                                    labels, or { label, unit: "mm" | "deg" }
        ctx.live(list)              what the boxes show until a size is
                                    typed, and where: [{ value, at, hide }]
        ctx.typed(i)                the number typed into box i, or 0
        ctx.typedValue(i)           the same, of any sign, or NaN if empty
        ctx.construction()          is construction mode on
        ctx.pixel()                 millimetres per screen pixel
        ctx.editDimension(id)       open the value editor of a dimension
        ctx.frame()                 the sketch plane { o, x, y, n }
        ctx.hoverModel(item)        highlight a face or edge of the model
        ctx.modelCurves(item)       the exact edges of a model face or edge

    and returns { move(s), click(s), cancel(), anchor?(), constrain?(s),
    finish?(), noSnap?, wantsModel? }. `s` is the snap under the cursor:
        { pt: [u, v], raw: [u, v], point, curve, mid, h, v, hit, model }
    where hit is the existing entity under the cursor ({ kind, id }) and,
    for a tool with wantsModel, model is the face or edge of the solid there.
    cancel() returns true if it had something to abandon; false lets the
    sketcher fall back to the Select tool.
*/

import * as M from './model.js';
import { dist, arcFrom, angleOf, arcThrough, tangentArc, cornerCut } from './geom.js';
import { trim, extend } from './trim.js';
import { addProjected } from './project.js';

const TINY = 1e-6;

function offsetPos(a, b, gap) {
    const len = dist(a, b) || 1;
    return [(a[0] + b[0]) / 2 - (b[1] - a[1]) / len * gap, (a[1] + b[1]) / 2 + (b[0] - a[0]) / len * gap];
}

// The size boxes of a stroke (a line, the centre line of a slot)
const STROKE_FIELDS = [{ label: 'Length', unit: 'mm' }, { label: 'Angle', unit: 'deg' }];

function normalAngle(radians) {
    let a = radians;
    while (a > Math.PI) {
        a -= 2 * Math.PI;
    }
    while (a <= -Math.PI) {
        a += 2 * Math.PI;
    }
    return a;
}

// Where the angle box of a stroke sits: beside its start, inside the angle
function anglePos(ctx, from, radians) {
    const half = normalAngle(radians) / 2;
    const r = 46 * ctx.pixel();
    return [from[0] + Math.cos(half) * r, from[1] + Math.sin(half) * r];
}

// A stroke from `from` held to the typed length (box `lb`) and angle (box
// `ab`, degrees from the sketch X axis): either one fixes it, the pointer
// gives the rest. A typed level or upright angle counts as snapped.
function aimStroke(ctx, from, s, lb, ab) {
    const length = ctx.typed(lb);
    const angle = ctx.typedValue(ab);
    if (isFinite(angle)) {
        const t = angle * Math.PI / 180;
        const dir = [Math.cos(t), Math.sin(t)];
        const along = (s.pt[0] - from[0]) * dir[0] + (s.pt[1] - from[1]) * dir[1];
        const len = length > 0 ? length : Math.max(along, ctx.pixel());
        s.pt = [from[0] + dir[0] * len, from[1] + dir[1] * len];
        s.point = s.curve = s.mid = null;
        const m = ((angle % 360) + 360) % 360;
        s.h = m < 1e-9 || Math.abs(m - 180) < 1e-9 || Math.abs(m - 360) < 1e-9;
        s.v = Math.abs(m - 90) < 1e-9 || Math.abs(m - 270) < 1e-9;
    } else if (length > 0) {
        const d = dist(from, s.pt);
        const ux = d < TINY ? 1 : (s.pt[0] - from[0]) / d;
        const uy = d < TINY ? 0 : (s.pt[1] - from[1]) / d;
        s.pt = [from[0] + ux * length, from[1] + uy * length];
        s.point = s.curve = s.mid = null;
    }
    return s;
}

// The side of a stroke its length goes on: away from the angle (which lies
// between the stroke and the X axis), below a level one
function lengthGap(ctx, angle, snapped) {
    return (snapped ? -22 : angle >= 0 ? 22 : -22) * ctx.pixel();
}

// What the boxes of a stroke show as it is drawn: the length beside it, the
// angle beside its start (not while it is level or upright)
function strokeLive(ctx, from, to, snapped) {
    const len = dist(from, to);
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    return [
        { value: len, at: offsetPos(from, to, lengthGap(ctx, angle, snapped)) },
        { value: angle * 180 / Math.PI, at: anglePos(ctx, from, angle), hide: snapped || len < 4 * ctx.pixel() }
    ];
}

// The dimensions a stroke from point a to point b keeps of what was typed
function strokeDimensions(ctx, sk, a, b, from, to, s, lb, ab) {
    const length = ctx.typed(lb);
    if (length > 0) {
        const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
        M.addConstraint(sk, { type: 'distance', a: a, b: b, value: length, pos: offsetPos(from, to, lengthGap(ctx, angle, s.h || s.v)) });
    }
    const angle = ctx.typedValue(ab);
    if (isFinite(angle) && !s.h && !s.v) {
        const t = normalAngle(angle * Math.PI / 180);
        M.addConstraint(sk, { type: 'axisangle', a: a, b: b, value: t, pos: anglePos(ctx, from, t) });
    }
}

function lineTool(ctx) {
    let start = null;   // { pt, snap, id } - id once the point exists
    let first = null;   // first point of the chain, to notice a closed loop

    function reset() {
        start = null;
        first = null;
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Line: click the start point');
    }
    reset();
    return {
        anchor: function () {
            return start ? start.pt : null;
        },
        // A typed length pins the end at that distance, in the cursor's
        // direction; a typed angle (from the sketch X axis) the direction
        constrain: function (s) {
            return start ? aimStroke(ctx, start.pt, s, 0, 1) : s;
        },
        move: function (s) {
            ctx.preview(start ? { curves: [{ type: 'line', a: start.pt, b: s.pt }], snap: s } : { snap: s });
            if (start) {
                ctx.live(strokeLive(ctx, start.pt, s.pt, s.h || s.v));
            }
        },
        click: function (s) {
            if (!start) {
                start = { pt: s.pt, snap: s, id: null };
                ctx.fields(STROKE_FIELDS);
                ctx.prompt('Line: click the end point, or type a length. Double click or Esc ends the chain');
                return;
            }
            if (dist(start.pt, s.pt) < TINY) {
                return;
            }
            const sk = ctx.sk();
            const a = start.id || ctx.resolve(start.snap);
            const b = ctx.resolve(s);
            if (a === b) {
                return;
            }
            const line = M.addLine(sk, a, b, ctx.construction());
            if (s.h) {
                M.addConstraint(sk, { type: 'horizontal', line: line });
            } else if (s.v) {
                M.addConstraint(sk, { type: 'vertical', line: line });
            }
            strokeDimensions(ctx, sk, a, b, start.pt, s.pt, s, 0, 1);
            if (!ctx.commit('Line')) {
                reset();
                return;
            }
            if (first === null) {
                first = a;
            }
            // Landing on an existing point ends the chain (closing a loop does)
            if (b === first || s.point) {
                reset();
                return;
            }
            start = { pt: M.point(ctx.sk(), b), snap: null, id: b };
            ctx.fields(STROKE_FIELDS);
        },
        finish: reset,
        cancel: function () {
            const had = !!start;
            reset();
            return had;
        }
    };
}

function rectTool(ctx) {
    let start = null;

    function reset() {
        start = null;
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Rectangle: click the first corner');
    }

    function corners(s) {
        const a = start.pt;
        const b = s.pt;
        return [a, [b[0], a[1]], b, [a[0], b[1]]];
    }
    reset();
    return {
        constrain: function (s) {
            if (!start) {
                return s;
            }
            const w = ctx.typed(0);
            const h = ctx.typed(1);
            if (w > 0 || h > 0) {
                const sx = s.pt[0] < start.pt[0] ? -1 : 1;
                const sy = s.pt[1] < start.pt[1] ? -1 : 1;
                s.pt = [w > 0 ? start.pt[0] + sx * w : s.pt[0], h > 0 ? start.pt[1] + sy * h : s.pt[1]];
                s.point = s.curve = s.mid = null;
            }
            return s;
        },
        move: function (s) {
            if (!start) {
                ctx.preview({ snap: s });
                return;
            }
            const c = corners(s);
            ctx.preview({ curves: c.map(function (p, i) {
                return { type: 'line', a: p, b: c[(i + 1) % 4] };
            }), snap: s });
            // Width and height boxes outside the first two sides
            const gap = (c[2][1] > c[0][1] === c[1][0] > c[0][0] ? -22 : 22) * ctx.pixel();
            ctx.live([
                { value: Math.abs(c[1][0] - c[0][0]), at: offsetPos(c[0], c[1], gap) },
                { value: Math.abs(c[2][1] - c[1][1]), at: offsetPos(c[1], c[2], gap) }
            ]);
        },
        click: function (s) {
            if (!start) {
                start = { pt: s.pt, snap: s };
                ctx.fields([{ label: 'Width', unit: 'mm' }, { label: 'Height', unit: 'mm' }]);
                ctx.prompt('Rectangle: click the opposite corner, or type width, Tab, height');
                return;
            }
            const c = corners(s);
            if (Math.abs(c[0][0] - c[2][0]) < TINY || Math.abs(c[0][1] - c[2][1]) < TINY) {
                return;
            }
            const sk = ctx.sk();
            const p = [ctx.resolve(start.snap), M.addPoint(sk, c[1][0], c[1][1]), ctx.resolve(s), M.addPoint(sk, c[3][0], c[3][1])];
            const lines = p.map(function (id, i) {
                return M.addLine(sk, id, p[(i + 1) % 4], ctx.construction());
            });
            ['horizontal', 'vertical', 'horizontal', 'vertical'].forEach(function (type, i) {
                M.addConstraint(sk, { type: type, line: lines[i] });
            });
            const gap = 22 * ctx.pixel();
            if (ctx.typed(0) > 0) {
                M.addConstraint(sk, { type: 'distance', a: p[0], b: p[1], value: ctx.typed(0), pos: offsetPos(c[0], c[1], c[2][1] > c[0][1] === c[1][0] > c[0][0] ? -gap : gap) });
            }
            if (ctx.typed(1) > 0) {
                M.addConstraint(sk, { type: 'distance', a: p[1], b: p[2], value: ctx.typed(1), pos: offsetPos(c[1], c[2], c[2][1] > c[0][1] === c[1][0] > c[0][0] ? -gap : gap) });
            }
            ctx.commit('Rectangle');
            reset();
        },
        cancel: function () {
            const had = !!start;
            reset();
            return had;
        }
    };
}

function circleTool(ctx) {
    let centre = null;

    function reset() {
        centre = null;
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Circle: click the centre');
    }
    reset();
    return {
        constrain: function (s) {
            const diameter = ctx.typed(0);
            if (centre && diameter > 0) {
                s.pt = [centre.pt[0] + diameter / 2, centre.pt[1]];
                s.point = s.curve = s.mid = null;
            }
            return s;
        },
        move: function (s) {
            const r = centre ? dist(centre.pt, s.pt) : 0;
            ctx.preview(r > TINY ? { curves: [{ type: 'circle', c: centre.pt, r: r }], snap: s } : { snap: s });
            if (centre) {
                // The diameter box just outside the circle, towards the pointer
                const u = r > TINY ? [(s.pt[0] - centre.pt[0]) / r, (s.pt[1] - centre.pt[1]) / r] : [1, 0];
                const out = r + 26 * ctx.pixel();
                ctx.live([{ value: 2 * r, at: [centre.pt[0] + u[0] * out, centre.pt[1] + u[1] * out] }]);
            }
        },
        click: function (s) {
            if (!centre) {
                centre = { pt: s.pt, snap: s };
                ctx.fields([{ label: 'Diameter', unit: 'mm' }]);
                ctx.prompt('Circle: click a point on the circle, or type a diameter');
                return;
            }
            const r = dist(centre.pt, s.pt);
            if (r < TINY) {
                return;
            }
            const sk = ctx.sk();
            const c = ctx.resolve(centre.snap);
            const circle = M.addCircle(sk, c, r, ctx.construction());
            if (ctx.typed(0) > 0) {
                M.addConstraint(sk, { type: 'diameter', curve: circle, value: ctx.typed(0), pos: [centre.pt[0] + r * 1.1 + 12 * ctx.pixel(), centre.pt[1] + r * 1.1 + 12 * ctx.pixel()] });
            } else if (s.point && s.point !== c) {
                // Drawn through an existing point: keep it on the circle
                M.addConstraint(sk, { type: 'pointon', p: s.point, curve: circle });
            }
            ctx.commit('Circle');
            reset();
        },
        cancel: function () {
            const had = !!centre;
            reset();
            return had;
        }
    };
}

// Centre point arc: centre, start, end. The side the cursor travels round
// after the second click decides which way the arc runs.
function arcTool(ctx) {
    let centre = null;
    let start = null;
    let turned = 0;
    let last = 0;

    function reset() {
        centre = null;
        start = null;
        turned = 0;
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Arc: click the centre');
    }

    function endOn(s) {
        const r = dist(centre.pt, start.pt);
        const t = angleOf(centre.pt, s.pt);
        return [centre.pt[0] + r * Math.cos(t), centre.pt[1] + r * Math.sin(t)];
    }
    reset();
    return {
        move: function (s) {
            if (!centre) {
                ctx.preview({ snap: s });
            } else if (!start) {
                ctx.preview({ curves: [{ type: 'line', a: centre.pt, b: s.pt }], snap: s });
            } else {
                const now = angleOf(centre.pt, s.pt);
                let step = now - last;
                if (step > Math.PI) {
                    step -= Math.PI * 2;
                } else if (step < -Math.PI) {
                    step += Math.PI * 2;
                }
                turned += step;
                last = now;
                const end = endOn(s);
                const arc = turned >= 0 ? arcFrom('', centre.pt, start.pt, end) : arcFrom('', centre.pt, end, start.pt);
                ctx.preview({ curves: [arc], snap: s });
            }
        },
        click: function (s) {
            if (!centre) {
                centre = { pt: s.pt, snap: s };
                ctx.prompt('Arc: click the start point');
                return;
            }
            if (!start) {
                if (dist(centre.pt, s.pt) < TINY) {
                    return;
                }
                start = { pt: s.pt, snap: s };
                last = angleOf(centre.pt, s.pt);
                turned = 0;
                ctx.prompt('Arc: move round the centre and click the end point');
                return;
            }
            const end = endOn(s);
            if (dist(end, start.pt) < TINY) {
                return;
            }
            const sk = ctx.sk();
            const c = ctx.resolve(centre.snap);
            const a = ctx.resolve(start.snap);
            // Use the point snapped to only if it really lies on the arc's circle
            const onCircle = s.point && dist(M.point(sk, s.point), end) < TINY * 100;
            const b = onCircle ? s.point : M.addPoint(sk, end[0], end[1]);
            if (turned >= 0) {
                M.addArc(sk, c, a, b, ctx.construction());
            } else {
                M.addArc(sk, c, b, a, ctx.construction());
            }
            ctx.commit('Arc');
            reset();
        },
        cancel: function () {
            const had = !!centre;
            reset();
            return had;
        }
    };
}

// The arc of a { c, forward } construction between p and q, as the preview draws it
function arcBetween(c, p, q, forward) {
    return forward ? arcFrom('', c, p, q) : arcFrom('', c, q, p);
}

// Three point arc, Inventor's default: start, end, then a point the arc
// passes through (which also says which way it bends)
function arc3Tool(ctx) {
    let start = null;
    let end = null;

    function reset() {
        start = null;
        end = null;
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Three Point Arc: click the start point');
    }
    reset();
    return {
        move: function (s) {
            if (!start) {
                ctx.preview({ snap: s });
            } else if (!end) {
                ctx.preview({ curves: [{ type: 'line', a: start.pt, b: s.pt }], snap: s });
            } else {
                const arc = arcThrough(start.pt, end.pt, s.pt);
                ctx.preview(arc ? { curves: [arcBetween(arc.c, start.pt, end.pt, arc.forward)], snap: s } : { snap: s });
            }
        },
        click: function (s) {
            if (!start) {
                start = { pt: s.pt, snap: s };
                ctx.prompt('Three Point Arc: click the end point');
                return;
            }
            if (!end) {
                if (dist(start.pt, s.pt) < TINY) {
                    return;
                }
                end = { pt: s.pt, snap: s };
                ctx.prompt('Three Point Arc: click a point the arc passes through');
                return;
            }
            const arc = arcThrough(start.pt, end.pt, s.pt);
            if (!arc) {
                ctx.prompt('Three Point Arc: the three points are in line. Click a point off the line');
                return;
            }
            const sk = ctx.sk();
            const a = ctx.resolve(start.snap);
            const b = ctx.resolve(end.snap);
            if (a === b) {
                reset();
                return;
            }
            const c = M.addPoint(sk, arc.c[0], arc.c[1]);
            M.addArc(sk, c, arc.forward ? a : b, arc.forward ? b : a, ctx.construction());
            ctx.commit('Arc');
            reset();
        },
        cancel: function () {
            const had = !!start;
            reset();
            return had;
        }
    };
}

// Which way a curve leaves point id when it is continued from there: the
// unit heading at that end and the curve, or null if the point is not the
// end of a line or an arc. Lines come before arcs, construction last.
function headingAt(sk, id) {
    const p = M.point(sk, id);
    const rank = function (g) {
        return (g.construction ? 2 : 0) + (g.type === 'arc' ? 1 : 0);
    };
    const ends = sk.geometry.filter(function (g) {
        return (g.type === 'line' && (g.p1 === id || g.p2 === id)) || (g.type === 'arc' && (g.start === id || g.end === id));
    }).sort(function (x, y) {
        return rank(x) - rank(y);
    });
    const g = ends[0];
    if (!g || !p) {
        return null;
    }
    let t;
    if (g.type === 'line') {
        const other = M.point(sk, g.p1 === id ? g.p2 : g.p1);
        t = [p[0] - other[0], p[1] - other[1]];
    } else {
        const c = M.point(sk, g.c);
        // Counter clockwise travel at the end of the arc; backwards at its start
        const sign = g.end === id ? 1 : -1;
        t = [-(p[1] - c[1]) * sign, (p[0] - c[0]) * sign];
    }
    const len = Math.hypot(t[0], t[1]);
    return len < TINY ? null : { curve: g.id, t: [t[0] / len, t[1] / len] };
}

// Tangent arc: starts at the end of a line or an arc and carries on
// smoothly from it to the point clicked
function tangentArcTool(ctx) {
    let from = null; // { id, pt, curve, t }

    function reset() {
        from = null;
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Tangent Arc: click the end point of a line or an arc');
    }
    reset();
    return {
        move: function (s) {
            if (!from) {
                ctx.preview({ snap: s });
                return;
            }
            const arc = tangentArc(from.pt, from.t, s.pt);
            ctx.preview(arc ? { curves: [arcBetween(arc.c, from.pt, s.pt, arc.forward)], snap: s } : { snap: s });
        },
        click: function (s) {
            const sk = ctx.sk();
            if (!from) {
                const heading = s.point ? headingAt(sk, s.point) : null;
                if (!heading) {
                    ctx.prompt('Tangent Arc: start on the end point of a line or an arc');
                    return;
                }
                from = { id: s.point, pt: M.point(sk, s.point), curve: heading.curve, t: heading.t };
                ctx.prompt('Tangent Arc: click the end point');
                return;
            }
            const arc = tangentArc(from.pt, from.t, s.pt);
            if (!arc) {
                ctx.prompt('Tangent Arc: that point lies straight ahead, which makes a line. Click to one side');
                return;
            }
            const e = ctx.resolve(s);
            if (e === from.id) {
                return;
            }
            const c = M.addPoint(sk, arc.c[0], arc.c[1]);
            const id = M.addArc(sk, c, arc.forward ? from.id : e, arc.forward ? e : from.id, ctx.construction());
            M.addConstraint(sk, { type: 'tangent', a: from.curve, b: id });
            ctx.commit('Tangent arc');
            reset();
        },
        cancel: function () {
            const had = !!from;
            reset();
            return had;
        }
    };
}

// Sketch Fillet and Chamfer: type the size, then click the corner point
// where two lines meet, or the two lines. Further corners of the same size
// share the first one's dimension (they are made equal to it), as Inventor
// does.
function cornerTool(ctx, kind) {
    const title = kind === 'fillet' ? 'Fillet' : 'Chamfer';
    let first = null;   // the first line picked
    let made = null;    // { id, size } of the first corner this tool made
    let last = kind === 'fillet' ? 2 : 1;

    function size() {
        return ctx.typed(0) || last;
    }

    function ask() {
        ctx.prompt(title + ' ' + (+size().toFixed(4)) + ' mm (type to change): click the corner where two lines meet, or the two lines');
    }

    // The pair of lines a pick stands for, or null
    function pair(s) {
        const sk = ctx.sk();
        if (!s.hit) {
            return null;
        }
        if (s.hit.kind === 'point') {
            return M.cornerLines(sk, s.hit.id);
        }
        const g = s.hit.kind === 'curve' ? M.find(sk, s.hit.id) : null;
        if (!g || g.type !== 'line') {
            return null;
        }
        return first && first !== g.id ? [first, g.id] : null;
    }

    // What the corner would become, for the preview
    function shape(lines) {
        const sk = ctx.sk();
        const g1 = M.find(sk, lines[0]);
        const g2 = M.find(sk, lines[1]);
        const shared = [g1.p1, g1.p2].filter(function (id) {
            return id === g2.p1 || id === g2.p2;
        })[0];
        if (!shared) {
            return null;
        }
        const cut = cornerCut(M.point(sk, shared), M.point(sk, g1.p1 === shared ? g1.p2 : g1.p1),
            M.point(sk, g2.p1 === shared ? g2.p2 : g2.p1), size(), kind);
        if (cut.error) {
            return null;
        }
        return kind === 'fillet' ? arcBetween(cut.c, cut.t1, cut.t2, cut.forward) : { type: 'line', a: cut.t1, b: cut.t2 };
    }

    ctx.fields([kind === 'fillet' ? 'Radius' : 'Distance']);
    ctx.preview(null);
    ask();
    return {
        noSnap: true,
        move: function (s) {
            const lines = pair(s);
            const curve = lines ? shape(lines) : null;
            ctx.preview(curve ? { curves: [curve] } : null);
        },
        click: function (s) {
            const sk = ctx.sk();
            const lines = pair(s);
            if (!lines) {
                const g = s.hit && s.hit.kind === 'curve' ? M.find(sk, s.hit.id) : null;
                if (g && g.type === 'line' && !first) {
                    first = g.id;
                    ctx.prompt(title + ': click the second line');
                } else if (s.hit) {
                    ctx.prompt(title + ': pick a point where exactly two lines meet, or two lines');
                }
                return;
            }
            first = null;
            const r = size();
            const same = made && Math.abs(made.size - r) < 1e-9 && M.find(sk, made.id);
            const out = M.roundCorner(sk, lines[0], lines[1], r, kind, same ? made.id : null);
            if (out.error) {
                ctx.prompt(title + ': ' + out.error);
                return;
            }
            if (ctx.commit(title)) {
                last = r;
                if (!same) {
                    made = { id: out.id, size: r };
                }
            }
            ctx.preview(null);
            ask();
        },
        cancel: function () {
            if (first) {
                first = null;
                ask();
                return true;
            }
            return false;
        }
    };
}

// Mirror: pick the curves (or have them selected before), press Enter,
// then click the mirror line. The copy stays tied to the original.
function mirrorTool(ctx) {
    let picks = (ctx.preselected() || []).filter(function (id) {
        const g = M.find(ctx.sk(), id);
        return g && g.type !== 'point';
    });
    let pickLine = false;

    function ask() {
        ctx.setPicks(picks);
        if (pickLine) {
            ctx.prompt('Mirror: click the mirror line (' + picks.length + (picks.length === 1 ? ' curve' : ' curves') + ' to mirror)');
        } else {
            ctx.prompt(picks.length ? 'Mirror: ' + picks.length + (picks.length === 1 ? ' curve' : ' curves') + ' picked. Click more, or press Enter and click the mirror line'
                : 'Mirror: click the curves to mirror (or select them first), then press Enter');
        }
    }
    ctx.fields([]);
    ctx.preview(null);
    ask();
    return {
        noSnap: true,
        move: function () { },
        click: function (s) {
            if (!s.hit || s.hit.kind !== 'curve') {
                return;
            }
            const sk = ctx.sk();
            if (!pickLine) {
                const at = picks.indexOf(s.hit.id);
                if (at >= 0) {
                    picks.splice(at, 1);
                } else {
                    picks.push(s.hit.id);
                }
                ask();
                return;
            }
            if (picks.indexOf(s.hit.id) >= 0) {
                ctx.prompt('Mirror: that curve is one of those to mirror. Click another line to mirror them about');
                return;
            }
            const out = M.mirrorGeometry(sk, picks, s.hit.id);
            if (out.error) {
                ctx.prompt('Mirror: ' + out.error);
                return;
            }
            ctx.commit('Mirror');
            picks = [];
            pickLine = false;
            ask();
        },
        // Enter: the curves are picked, now the line
        finish: function () {
            if (picks.length && !pickLine) {
                pickLine = true;
                ask();
            }
        },
        cancel: function () {
            const had = picks.length > 0;
            picks = [];
            pickLine = false;
            ask();
            return had;
        }
    };
}

// Polygon: type the number of sides (6 if none), click the centre, then a corner
function polygonTool(ctx) {
    let centre = null;

    function sides() {
        return Math.max(3, Math.min(64, Math.round(ctx.typed(0)) || 6));
    }

    function shape(s) {
        const c = centre.pt;
        const r = dist(c, s.pt);
        const start = angleOf(c, s.pt);
        const n = sides();
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const t = start + Math.PI * 2 * i / n;
            pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
        }
        return pts.slice(1).map(function (p, i) {
            return { type: 'line', a: pts[i], b: p };
        });
    }

    function reset() {
        centre = null;
        ctx.fields(['Sides']);
        ctx.preview(null);
        ctx.prompt('Polygon (' + sides() + ' sides, type to change): click the centre');
    }
    reset();
    return {
        move: function (s) {
            ctx.preview(centre && dist(centre.pt, s.pt) > TINY ? { curves: shape(s), snap: s } : { snap: s });
        },
        click: function (s) {
            if (!centre) {
                centre = { pt: s.pt, snap: s };
                ctx.prompt('Polygon (' + sides() + ' sides): click a corner');
                return;
            }
            if (dist(centre.pt, s.pt) < TINY) {
                return;
            }
            const sk = ctx.sk();
            const c = ctx.resolve(centre.snap);
            M.addPolygon(sk, c, s.pt, sides(), ctx.construction());
            ctx.commit('Polygon');
            reset();
        },
        cancel: function () {
            const had = !!centre;
            reset();
            return had;
        }
    };
}

// Slot: click one centre, the other centre, then how wide
function slotTool(ctx) {
    let c1 = null;
    let c2 = null;

    function width(s) {
        // Distance of the pointer from the centre line
        const d = [c2.pt[0] - c1.pt[0], c2.pt[1] - c1.pt[1]];
        const len = Math.hypot(d[0], d[1]) || 1;
        return Math.abs((s.pt[0] - c1.pt[0]) * d[1] - (s.pt[1] - c1.pt[1]) * d[0]) / len;
    }

    function shape(r) {
        const d = [c2.pt[0] - c1.pt[0], c2.pt[1] - c1.pt[1]];
        const len = Math.hypot(d[0], d[1]) || 1;
        const n = [-d[1] / len * r, d[0] / len * r];
        const a1 = [c1.pt[0] + n[0], c1.pt[1] + n[1]];
        const b1 = [c1.pt[0] - n[0], c1.pt[1] - n[1]];
        const a2 = [c2.pt[0] + n[0], c2.pt[1] + n[1]];
        const b2 = [c2.pt[0] - n[0], c2.pt[1] - n[1]];
        return [arcFrom('', c1.pt, a1, b1), arcFrom('', c2.pt, b2, a2), { type: 'line', a: a1, b: a2 }, { type: 'line', a: b2, b: b1 }];
    }

    function reset() {
        c1 = null;
        c2 = null;
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Slot: click the centre of one end');
    }

    // The direction of the centre line and its square
    function axes() {
        const d = [c2.pt[0] - c1.pt[0], c2.pt[1] - c1.pt[1]];
        const len = Math.hypot(d[0], d[1]) || 1;
        return { u: [d[0] / len, d[1] / len], n: [-d[1] / len, d[0] / len] };
    }

    // Where the diameter box sits: past the far end of the slot
    function diameterPos(r) {
        const u = axes().u;
        const out = r + 30 * ctx.pixel();
        return [c2.pt[0] + u[0] * out, c2.pt[1] + u[1] * out];
    }
    reset();
    return {
        // The centre line snaps level or upright like a line
        anchor: function () {
            return c1 && !c2 ? c1.pt : null;
        },
        // Typed sizes: length and angle of the centre line, then the diameter of the ends
        constrain: function (s) {
            if (c1 && !c2) {
                return aimStroke(ctx, c1.pt, s, 0, 1);
            }
            const diameter = ctx.typed(0);
            if (c2 && diameter > 0) {
                const n = axes().n;
                const side = (s.pt[0] - c1.pt[0]) * n[0] + (s.pt[1] - c1.pt[1]) * n[1] < 0 ? -1 : 1;
                s.pt = [c2.pt[0] + n[0] * side * diameter / 2, c2.pt[1] + n[1] * side * diameter / 2];
                s.point = s.curve = s.mid = null;
            }
            return s;
        },
        move: function (s) {
            if (!c1) {
                ctx.preview({ snap: s });
            } else if (!c2) {
                ctx.preview({ curves: [{ type: 'line', a: c1.pt, b: s.pt, construction: true }], snap: s });
                ctx.live(strokeLive(ctx, c1.pt, s.pt, s.h || s.v));
            } else {
                const r = width(s);
                ctx.preview(r > TINY ? { curves: shape(r), snap: s } : { snap: s });
                ctx.live([{ value: 2 * r, at: diameterPos(r) }]);
            }
        },
        click: function (s) {
            if (!c1) {
                c1 = { pt: s.pt, snap: s };
                ctx.fields(STROKE_FIELDS);
                ctx.prompt('Slot: click the centre of the other end, or type the length (Tab: angle)');
                return;
            }
            if (!c2) {
                if (dist(c1.pt, s.pt) < TINY) {
                    return;
                }
                // What was typed for the centre line is kept for the dimensions
                c2 = { pt: s.pt, snap: s, length: ctx.typed(0), angle: ctx.typedValue(1), h: s.h, v: s.v };
                ctx.fields([{ label: 'Diameter', unit: 'mm' }]);
                ctx.prompt('Slot: move out to set the width, or type its diameter, then click');
                return;
            }
            const r = width(s);
            if (r < TINY) {
                return;
            }
            const sk = ctx.sk();
            const i1 = ctx.resolve(c1.snap);
            const i2 = ctx.resolve(c2.snap);
            const made = M.addSlot(sk, i1, i2, r, ctx.construction());
            if (c2.h) {
                M.addConstraint(sk, { type: 'horizontal', a: i1, b: i2 });
            } else if (c2.v) {
                M.addConstraint(sk, { type: 'vertical', a: i1, b: i2 });
            }
            const gap = -(r + 22 * ctx.pixel());
            if (c2.length > 0) {
                M.addConstraint(sk, { type: 'distance', a: i1, b: i2, value: c2.length, pos: offsetPos(c1.pt, c2.pt, gap) });
            }
            if (isFinite(c2.angle) && !c2.h && !c2.v) {
                const t = normalAngle(c2.angle * Math.PI / 180);
                M.addConstraint(sk, { type: 'axisangle', a: i1, b: i2, value: t, pos: anglePos(ctx, c1.pt, t) });
            }
            if (ctx.typed(0) > 0) {
                M.addConstraint(sk, { type: 'diameter', curve: made.arcs[1], value: ctx.typed(0), pos: diameterPos(r) });
            }
            ctx.commit('Slot');
            reset();
        },
        cancel: function () {
            const had = !!c1;
            reset();
            return had;
        }
    };
}

function pointTool(ctx) {
    ctx.fields([]);
    ctx.prompt('Point: click to place a point');
    return {
        move: function (s) {
            ctx.preview({ snap: s });
        },
        click: function (s) {
            if (s.point) {
                const sk = ctx.sk();
                const g = M.find(sk, s.point);
                if (g && g.standalone && !g.ref) {
                    return; // a point of its own is here already
                }
                // On a projected point (a hole of the model, the centre of a
                // rounded corner), the origin or the end of a curve: a point
                // of its own, held on that one. Holes are drilled at these.
                const id = M.addPoint(sk, s.pt[0], s.pt[1], true);
                M.addConstraint(sk, { type: 'coincident', a: id, b: s.point });
                ctx.commit('Point');
                return;
            }
            ctx.resolve(s, true);
            ctx.commit('Point');
        },
        cancel: function () {
            return false;
        }
    };
}

function editTool(ctx, label, prompt, operation) {
    ctx.fields([]);
    ctx.preview(null);
    ctx.prompt(prompt);
    return {
        noSnap: true,
        move: function () { },
        click: function (s) {
            if (!s.hit || s.hit.kind !== 'curve') {
                return;
            }
            if (M.find(ctx.sk(), s.hit.id).ref) {
                ctx.prompt(label + ': projected geometry belongs to the model and cannot be changed. ' + prompt);
                return;
            }
            if (operation(ctx.sk(), s.hit.id, s.raw)) {
                ctx.commit(label);
            } else {
                ctx.prompt(label + ': nothing to ' + label.toLowerCase() + ' to here. ' + prompt);
            }
        },
        cancel: function () {
            return false;
        }
    };
}

// Project Geometry: click an edge of the model, or a face for all its edges
function projectTool(ctx) {
    const prompt = 'Project Geometry: click an edge or a face of the model';
    ctx.fields([]);
    ctx.preview(null);
    ctx.prompt(prompt);
    return {
        noSnap: true,
        wantsModel: true,
        move: function (s) {
            ctx.hoverModel(s.model || null);
        },
        click: function (s) {
            if (!s.model) {
                return;
            }
            let added = 0;
            ctx.modelCurves(s.model).forEach(function (curve) {
                if (addProjected(ctx.sk(), ctx.frame(), curve)) {
                    added++;
                }
            });
            if (added) {
                ctx.commit('Project geometry');
            } else {
                ctx.prompt('Nothing new to project here: only straight edges and circles seen face-on can be projected. ' + prompt);
            }
        },
        cancel: function () {
            ctx.hoverModel(null);
            return false;
        }
    };
}

// Which way a dimension between two points measures, from where its text is
// put: beside the pair gives the vertical size, above or below the
// horizontal one, anywhere else the straight distance.
function linearType(a, b, pos) {
    if (Math.abs(a[0] - b[0]) < TINY || Math.abs(a[1] - b[1]) < TINY) {
        return 'distance';
    }
    const inX = pos[0] > Math.min(a[0], b[0]) && pos[0] < Math.max(a[0], b[0]);
    const inY = pos[1] > Math.min(a[1], b[1]) && pos[1] < Math.max(a[1], b[1]);
    return inX && !inY ? 'hdistance' : inY && !inX ? 'vdistance' : 'distance';
}

// General dimension: pick what to measure, then click where the text goes.
function dimensionTool(ctx) {
    let picks = [];

    function reset() {
        picks = [];
        ctx.fields([]);
        ctx.preview(null);
        ctx.prompt('Dimension: pick a line, a circle, an arc or a point');
    }

    // The dimension the picks stand for with its text at `pos`, or null if more is needed
    function candidate(pos) {
        const sk = ctx.sk();
        const kinds = picks.map(function (id) {
            return id === M.ORIGIN ? 'point' : M.find(sk, id).type;
        });
        let d = null;
        if (picks.length === 1) {
            if (kinds[0] === 'line') {
                const g = M.find(sk, picks[0]);
                d = { type: linearType(M.point(sk, g.p1), M.point(sk, g.p2), pos), a: g.p1, b: g.p2 };
            } else if (kinds[0] === 'circle') {
                d = { type: 'diameter', curve: picks[0] };
            } else if (kinds[0] === 'arc') {
                d = { type: 'radius', curve: picks[0] };
            }
        } else if (picks.length === 2) {
            const points = picks.filter(function (id, i) {
                return kinds[i] === 'point';
            });
            const lines = picks.filter(function (id, i) {
                return kinds[i] === 'line';
            });
            if (points.length === 2) {
                d = { type: linearType(M.point(sk, points[0]), M.point(sk, points[1]), pos), a: points[0], b: points[1] };
            } else if (points.length === 1 && lines.length === 1) {
                d = { type: 'pldistance', p: points[0], line: lines[0] };
            } else if (lines.length === 2) {
                const c1 = M.curve(sk, lines[0]);
                const c2 = M.curve(sk, lines[1]);
                const cross = (c1.b[0] - c1.a[0]) * (c2.b[1] - c2.a[1]) - (c1.b[1] - c1.a[1]) * (c2.b[0] - c2.a[0]);
                const parallel = Math.abs(cross) < 1e-6 * dist(c1.a, c1.b) * dist(c2.a, c2.b);
                d = parallel ? { type: 'pldistance', p: M.find(sk, lines[1]).p1, line: lines[0] }
                    : { type: 'angle', l1: lines[0], l2: lines[1] };
            }
        }
        if (d) {
            d.pos = pos;
            d.value = M.measure(sk, d);
        }
        return d;
    }
    reset();
    return {
        noSnap: true,
        move: function (s) {
            const d = picks.length ? candidate(s.raw) : null;
            ctx.preview(d ? { dims: [d] } : null);
        },
        click: function (s) {
            const sk = ctx.sk();
            // A click on a dimension's value edits it, as in Inventor
            if (s.hit && s.hit.kind === 'dim') {
                reset();
                ctx.editDimension(s.hit.id);
                return;
            }
            const hit = s.hit && (s.hit.kind === 'point' || s.hit.kind === 'curve') ? s.hit.id : null;
            const first = picks.length === 1 ? (picks[0] === M.ORIGIN ? 'point' : M.find(sk, picks[0]).type) : null;
            // A second entity can still be added to a single line or point
            if (hit && picks.indexOf(hit) < 0 && (picks.length === 0 || (picks.length === 1 && (first === 'line' || first === 'point')))) {
                const kind = hit === M.ORIGIN ? 'point' : M.find(sk, hit).type;
                if (picks.length === 1 && kind !== 'point' && kind !== 'line') {
                    return;
                }
                picks.push(hit);
                ctx.prompt(candidate(s.raw) ? 'Dimension: click where the value should sit' + (picks.length === 1 && first === null && kind === 'line' ? ', or pick a second line or a point' : '')
                    : 'Dimension: pick a second point or a line');
                return;
            }
            const d = candidate(s.raw);
            if (!d) {
                return;
            }
            if (Math.abs(d.value) < TINY) {
                ctx.prompt('Dimension: there is nothing to measure between these');
                picks = [];
                return;
            }
            const id = M.addConstraint(sk, d);
            if (ctx.commit('Dimension', true)) {
                ctx.editDimension(id);
            } else {
                // The sketch is already held that way: keep the size as a
                // driven dimension instead, as Inventor offers
                d.driven = true;
                M.addConstraint(ctx.sk(), d); // the sketch was restored: take it again
                if (ctx.commit('Driven dimension')) {
                    ctx.prompt('That size is already set by the sketch: added as a driven dimension, shown in brackets. Pick the next one');
                    picks = [];
                    return;
                }
            }
            reset();
        },
        cancel: function () {
            const had = picks.length > 0;
            reset();
            return had;
        }
    };
}

export const TOOLS = {
    line: lineTool,
    rect: rectTool,
    circle: circleTool,
    arc: arcTool,
    arc3: arc3Tool,
    mirror: mirrorTool,
    polygon: polygonTool,
    slot: slotTool,
    arctan: tangentArcTool,
    fillet: function (ctx) {
        return cornerTool(ctx, 'fillet');
    },
    chamfer: function (ctx) {
        return cornerTool(ctx, 'chamfer');
    },
    point: pointTool,
    dimension: dimensionTool,
    project: projectTool,
    trim: function (ctx) {
        return editTool(ctx, 'Trim', 'Click the part of a curve to remove', trim);
    },
    extend: function (ctx) {
        return editTool(ctx, 'Extend', 'Click a line or arc near the end to extend', extend);
    }
};
