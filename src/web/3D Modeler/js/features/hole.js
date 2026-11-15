/*
    3D Modeler - Hole

    Two ways to place holes (Placement):
      From Sketch  a hole at every point of a sketch that was placed with
                   the Point tool, the way a desktop CAD Hole uses the centre
                   points of a sketch
      Linear       (the usual Linear placement) click a flat face, then two
                   straight edges and the distances of the hole from them;
                   on OK a sketch is made on the face with the point and the
                   two distances as dimensions, so it can be edited later
                   like any sketch (PROPOSAL.md 14.7, 14.26)
    The holes go into the material (against the sketch plane normal);
    Flipped turns them round.

    Simple, counterbore and countersink holes, to a depth or through all,
    with an optional drill point. A thread is a note only (`thread:
    { designation, depth }`, shown in the browser, the section and Mass
    Properties); choosing one sets the diameter to its tap drill.

    As in desktop CAD, the panel shows a section of the hole (holefigure.js)
    that follows the seat, termination, direction, drill point and thread,
    with each size written where it applies; clicking a size puts the caret
    in its box, and the box with the caret colours its size in the picture.

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed),
             referenceOf(planeTarget)   the plane reference of a picked face
*/

import { createPanel } from './panel.js';
import { holePoints, addConstraint, point as sketchPoint } from '../sketch/model.js';
import { projectInto } from '../sketch/project.js';
import { withResolvedPlane, planeFrame, toPlane } from '../kernel/profile.js';
import { holeFigure } from './holefigure.js';

// A new hole starts as the owner asked: a 3 mm countersunk hole 10 deep
// with a drill point, countersunk to 6 mm
const DEFAULTS = {
    kind: 'countersink', diameter: 3, through: false, depth: 10, drillPoint: true, flip: false,
    cbDiameter: 6, cbDepth: 3, csDiameter: 6, csAngle: 90, thread: '', threadDepth: 8
};

// ISO metric coarse threads: designation, pitch. The tap drill is the
// major diameter less the pitch.
export const THREADS = [['M2', 0.4], ['M2.5', 0.45], ['M3', 0.5], ['M4', 0.7], ['M5', 0.8], ['M6', 1], ['M8', 1.25], ['M10', 1.5], ['M12', 1.75], ['M16', 2], ['M20', 2.5]].map(function (t) {
    const major = Number(t[0].slice(1));
    return { id: t[0] + 'x' + t[1], major: major, pitch: t[1], tap: +(major - t[1]).toFixed(2) };
});

export function threadById(id) {
    return THREADS.filter(function (t) {
        return t.id === id;
    })[0] || null;
}

// The values of the last hole made or edited, for the next new one while
// the app stays open (not the direction: that depends on the face)
let lastUsed = null;

/* ---- linear placement: pure geometry ---- */
// Where a hole lies `d1` from line l1 and `d2` from line l2 (plane
// coordinates, lines { a, b }), on the side of `near` (the point clicked
// on the face): [u, v], or null when the lines are parallel
export function linearPoint(l1, l2, d1, d2, near) {
    const offset = function (l, d) {
        const dx = l.b[0] - l.a[0];
        const dy = l.b[1] - l.a[1];
        const len = Math.hypot(dx, dy) || 1;
        const n = [-dy / len, dx / len];
        const s = ((near[0] - l.a[0]) * n[0] + (near[1] - l.a[1]) * n[1]) < 0 ? -1 : 1;
        return { a: [l.a[0] + n[0] * s * d, l.a[1] + n[1] * s * d], d: [dx / len, dy / len] };
    };
    const p = offset(l1, d1);
    const q = offset(l2, d2);
    const cross = p.d[0] * q.d[1] - p.d[1] * q.d[0];
    if (Math.abs(cross) < 1e-9) {
        return null;
    }
    const t = ((q.a[0] - p.a[0]) * q.d[1] - (q.a[1] - p.a[1]) * q.d[0]) / cross;
    return [p.a[0] + p.d[0] * t, p.a[1] + p.d[1] * t];
}

export function createHole(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let sketchId = null;
    let draft = null;
    let valid = false;
    let token = 0;
    let timer = null;
    let focused = null;     // the size box with the caret, coloured in the picture
    let placement = 'sketch';
    // Linear placement: { face: { ref, frame, near }, edges: [{ curve, line }], d1, d2 }
    let linear = null;
    let active = null;      // the slot the next model pick fills

    const threadItems = [{ id: '', label: 'None' }].concat(THREADS.map(function (t) {
        return { id: t.id, label: t.id.replace('x', ' x ') + '  (tap drill ' + t.tap + ')' };
    }));

    const panel = createPanel(options.stage, {
        title: 'Hole',
        rows: [
            { type: 'section', label: 'Placement' },
            { type: 'seg', key: 'placement', label: 'Placement', illustrate: 'placement', items: [
                { id: 'sketch', label: 'From Sketch', title: 'A hole at every point of a sketch' },
                { id: 'linear', label: 'Linear', title: 'Click a face and two edges, then type the distances from them' }
            ] },
            { type: 'static', key: 'positions', label: 'Positions' },
            { type: 'pick', key: 'face', label: 'Face', title: 'Click, then pick the flat face to drill into' },
            { type: 'pick', key: 'edge1', label: 'Edge 1', title: 'Click, then pick a straight edge to measure from' },
            { type: 'number', key: 'dist1', label: 'Distance 1' },
            { type: 'pick', key: 'edge2', label: 'Edge 2', title: 'Click, then pick a second straight edge' },
            { type: 'number', key: 'dist2', label: 'Distance 2' },
            { type: 'section', label: 'Type' },
            { type: 'seg', key: 'kind', label: 'Seat', items: [
                { id: 'simple', label: 'None', title: 'A plain drilled hole' },
                { id: 'counterbore', label: 'Counterbore', title: 'A wider flat-bottomed recess for a screw head' },
                { id: 'countersink', label: 'Countersink', title: 'A conical recess for a countersunk screw' }
            ] },
            { type: 'select', key: 'thread', label: 'Thread', items: threadItems },
            { type: 'section', label: 'Behavior' },
            { type: 'seg', key: 'termination', label: 'Termination', items: [
                { id: 'distance', label: 'Distance', title: 'Drill to a depth' },
                { id: 'all', label: 'Through All', title: 'Drill through the whole part' }
            ] },
            { type: 'seg', key: 'direction', label: 'Direction', items: [
                { id: 'default', label: 'Default', title: 'Into the material, against the sketch plane\'s normal' },
                { id: 'flipped', label: 'Flipped', title: 'The other way from the sketch plane' }
            ] },
            { type: 'seg', key: 'drill', label: 'Drill Point', items: [
                { id: 'flat', label: 'Flat', title: 'A flat bottom' },
                { id: 'angle', label: '118°', title: 'The cone a twist drill leaves, 118 degrees' }
            ] },
            { type: 'figure', key: 'figure' },
            { type: 'number', key: 'csDiameter', label: 'C\'sink dia' },
            { type: 'number', key: 'csAngle', label: 'C\'sink angle', unit: 'deg', max: 179.5 },
            { type: 'number', key: 'cbDiameter', label: 'C\'bore dia' },
            { type: 'number', key: 'cbDepth', label: 'C\'bore depth' },
            { type: 'number', key: 'diameter', label: 'Diameter' },
            { type: 'number', key: 'depth', label: 'Depth' },
            { type: 'number', key: 'threadDepth', label: 'Thread depth' }
        ],
        onChange: function (key, value) {
            if (key === 'placement') {
                setPlacement(value);
            } else if (key === 'termination') {
                draft.through = value === 'all';
            } else if (key === 'direction') {
                draft.flip = value === 'flipped';
            } else if (key === 'drill') {
                draft.drillPoint = value === 'angle';
            } else if (key === 'thread') {
                draft.thread = value;
                const t = threadById(value);
                if (t) {
                    // A tapped hole is drilled at the tap drill size
                    draft.diameter = t.tap;
                    panel.set('diameter', t.tap);
                    if (!(draft.threadDepth > 0) || draft.threadDepth > draft.depth) {
                        draft.threadDepth = Math.max(1, +(draft.depth * 0.8).toFixed(1));
                        panel.set('threadDepth', draft.threadDepth);
                    }
                    options.onStatus('Thread ' + t.id + ': the hole is drilled ' + t.tap + ' mm, the tap drill size (the thread itself is a note, not modelled)');
                }
            } else if (key === 'dist1' || key === 'dist2') {
                linear[key === 'dist1' ? 'd1' : 'd2'] = value;
            } else {
                draft[key] = value;
            }
            refresh();
        },
        onFocus: function (key) {
            focused = key;
            if (draft) {
                drawFigure();
            }
        },
        onAction: function (key) {
            if (key === 'face' || key === 'edge1' || key === 'edge2') {
                activate(key);
                refresh();
            }
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    // Wider than other panels, so the picture's sizes can be read
    panel.element().classList.add('props-wide');

    function freeSketch() {
        const used = new Set(doc.features().map(function (f) {
            return f.sketch;
        }));
        const end = doc.endIndex ? doc.endIndex() : Infinity;
        return doc.features().filter(function (f, i) {
            return f.type === 'sketch' && !f.suppressed && !f.hidden && i <= end && (!used.has(f.id) || f.shared) && holePoints(f).length;
        }).pop() || null;
    }

    /* ---- linear placement ---- */
    function setPlacement(value) {
        placement = value;
        if (placement === 'linear') {
            linear = linear || { face: null, edges: [null, null], d1: 10, d2: 10 };
            panel.set('dist1', linear.d1);
            panel.set('dist2', linear.d2);
            activate(!linear.face ? 'face' : !linear.edges[0] ? 'edge1' : !linear.edges[1] ? 'edge2' : null);
        } else {
            activate(null);
        }
    }

    function activate(key) {
        active = key;
        if (!key || !open || editId) {
            viewport.stopRefPick();
            return;
        }
        viewport.startRefPick(key === 'face' ? { planes: true } : { edges: true }, picked);
    }

    function picked(pick) {
        if (active === 'face') {
            if (pick.kind !== 'plane' || pick.target.kind !== 'face') {
                options.onStatus('Pick a flat face of the model to drill into');
                return;
            }
            const ref = options.referenceOf(pick.target);
            const frame = planeFrame(ref, doc.features());
            const near = pick.target.point ? toPlane(frame, pick.target.point) : { u: 0, v: 0 };
            linear.face = { ref: ref, frame: frame, near: [near.u, near.v] };
            // Its edges are what the hole is usually measured from
            linear.edges = [null, null];
        } else if (pick.kind === 'edge') {
            const curve = pick.info.curve;
            const f = linear.face.frame;
            const a = toPlane(f, curve.a);
            const b = toPlane(f, curve.b);
            if (Math.hypot(b.u - a.u, b.v - a.v) < 1e-6) {
                options.onStatus('That edge is square to the face: pick an edge lying along it');
                return;
            }
            linear.edges[active === 'edge1' ? 0 : 1] = { curve: curve, line: { a: [a.u, a.v], b: [b.u, b.v] } };
        } else {
            return;
        }
        activate(!linear.face ? 'face' : !linear.edges[0] ? 'edge1' : !linear.edges[1] ? 'edge2' : null);
        refresh();
    }

    // The sketch the linear placement makes: the two edges projected, the
    // point, and the two distances as dimensions
    function linearSketch() {
        if (!linear || !linear.face || !linear.edges[0] || !linear.edges[1]) {
            return null;
        }
        const at = linearPoint(linear.edges[0].line, linear.edges[1].line, linear.d1, linear.d2, linear.face.near);
        if (!at || !(linear.d1 > 0) || !(linear.d2 > 0)) {
            return null;
        }
        const sk = { id: '__linear', type: 'sketch', name: 'Hole sketch', plane: linear.face.ref, geometry: [], constraints: [] };
        const r1 = projectInto(sk, linear.face.frame, linear.edges[0].curve);
        const r2 = projectInto(sk, linear.face.frame, linear.edges[1].curve);
        if (!r1 || !r2) {
            return null;
        }
        sk.geometry.push({ id: 'h1', type: 'point', x: at[0], y: at[1], standalone: true });
        [[r1.id, linear.d1], [r2.id, linear.d2]].forEach(function (pair) {
            const line = sk.geometry.filter(function (g) {
                return g.id === pair[0];
            })[0];
            const a = sketchPoint(sk, line.p1);
            const b = sketchPoint(sk, line.p2);
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const t = ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (dx * dx + dy * dy);
            const foot = [a[0] + dx * t, a[1] + dy * t];
            addConstraint(sk, { type: 'pldistance', p: 'h1', line: pair[0], value: pair[1], pos: [(at[0] + foot[0]) / 2 + 2, (at[1] + foot[1]) / 2 + 2] });
        });
        return sk;
    }

    // Editing a linear hole: its sketch's two distances
    function linearDims(sketch) {
        return (sketch.constraints || []).filter(function (c) {
            return c.type === 'pldistance' && c.p === 'h1';
        });
    }

    // The sketch the hole is drilled from now: a sketch of the document, or
    // the one a linear placement would make
    function currentSketch() {
        if (placement === 'linear' && !editId) {
            return linearSketch();
        }
        const sketch = sketchId ? doc.feature(sketchId) : null;
        if (sketch && editId && placement === 'linear') {
            // The distances being edited, applied to a copy of its sketch
            const copy = JSON.parse(JSON.stringify(sketch));
            const dims = linearDims(copy);
            if (dims.length === 2) {
                dims[0].value = linear.d1;
                dims[1].value = linear.d2;
                const lineOf = function (c) {
                    const l = copy.geometry.filter(function (g) {
                        return g.id === c.line;
                    })[0];
                    return { a: sketchPoint(copy, l.p1), b: sketchPoint(copy, l.p2) };
                };
                const h = copy.geometry.filter(function (g) {
                    return g.id === 'h1';
                })[0];
                const at = linearPoint(lineOf(dims[0]), lineOf(dims[1]), linear.d1, linear.d2, [h.x, h.y]);
                if (at) {
                    h.x = at[0];
                    h.y = at[1];
                }
            }
            return copy;
        }
        return sketch;
    }

    function feature() {
        const f = { type: 'hole', sketch: sketchId, kind: draft.kind, diameter: draft.diameter, through: draft.through, flip: draft.flip };
        if (!draft.through) {
            f.depth = draft.depth;
            f.drillPoint = draft.drillPoint;
        }
        if (draft.kind === 'counterbore') {
            f.cbDiameter = draft.cbDiameter;
            f.cbDepth = draft.cbDepth;
        } else if (draft.kind === 'countersink') {
            f.csDiameter = draft.csDiameter;
            f.csAngle = draft.csAngle;
        }
        if (draft.thread) {
            f.thread = draft.through ? { designation: draft.thread } : { designation: draft.thread, depth: draft.threadDepth };
        }
        if (placement === 'linear') {
            f.placement = 'linear';
        }
        return f;
    }

    function drawFigure() {
        panel.html('figure', holeFigure(draft, focused));
    }

    function slotText(key, filled, label) {
        panel.text(key, filled ? label : active === key ? 'Pick it in the model' : 'Click to pick', !filled);
    }

    function refresh() {
        const lin = placement === 'linear';
        panel.visible('positions', !lin);
        ['face', 'edge1', 'dist1', 'edge2', 'dist2'].forEach(function (key) {
            panel.visible(key, lin);
        });
        if (lin) {
            slotText('face', !!(linear.face), editId ? 'the face of its sketch' : 'a face of the model');
            slotText('edge1', !!(linear.edges[0] || editId), 'an edge of the model');
            slotText('edge2', !!(linear.edges[1] || editId), 'an edge of the model');
        }
        panel.visible('cbDiameter', draft.kind === 'counterbore');
        panel.visible('cbDepth', draft.kind === 'counterbore');
        panel.visible('csDiameter', draft.kind === 'countersink');
        panel.visible('csAngle', draft.kind === 'countersink');
        panel.visible('depth', !draft.through);
        panel.visible('drill', !draft.through);
        panel.visible('threadDepth', !!draft.thread && !draft.through);
        drawFigure();
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        const sketch = currentSketch();
        if (!sketch) {
            viewport.setPreview(null);
            panel.note(lin ? (!linear.face ? 'Click the flat face to drill into.' : !linear.edges[0] ? 'Click a straight edge to measure the first distance from.'
                : !linear.edges[1] ? 'Click a second straight edge (not parallel to the first).' : 'The two edges are parallel, or a distance is not larger than zero.')
                : 'Hole needs a sketch with points: choose Linear to place one on a face, or sketch points with the Point tool.', !!(lin && linear.edges[1]));
            return;
        }
        timer = setTimeout(function () {
            options.kernel.call('tryFeature', { document: doc.data(), feature: feature(), sketch: withResolvedPlane(sketch, doc.features()), at: editId }).then(function (out) {
                if (mine === token && open) {
                    viewport.setPreview(out.mesh, 'cut');
                    valid = true;
                    panel.ok(true);
                    panel.note('');
                }
            }).catch(function (err) {
                if (mine === token && open) {
                    viewport.setPreview(null);
                    panel.note(err.message, true);
                }
            });
        }, 60);
    }

    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        token++;
        clearTimeout(timer);
        active = null;
        viewport.stopRefPick();
        panel.hide();
        viewport.setPreview(null);
        options.onClose(committed);
    }

    function commit() {
        if (!open || !valid) {
            return;
        }
        const made = feature();
        const editing = editId;
        const linearNew = placement === 'linear' && !editing ? linearSketch() : null;
        const linearEdit = placement === 'linear' && editing ? currentSketch() : null;
        lastUsed = Object.assign({}, draft, { flip: false });
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                ['cbDiameter', 'cbDepth', 'csDiameter', 'csAngle', 'depth', 'drillPoint', 'thread', 'placement'].forEach(function (key) {
                    delete old[key];
                });
                Object.keys(made).forEach(function (key) {
                    if (key !== 'type') {
                        old[key] = made[key];
                    }
                });
                if (linearEdit) {
                    const sketch = doc.feature(old.sketch);
                    sketch.geometry = linearEdit.geometry;
                    sketch.constraints = linearEdit.constraints;
                }
            });
            return;
        }
        const name = doc.newName('hole');
        const id = doc.newId();
        if (linearNew) {
            // The sketch first, then the hole on it: one undo step
            let k = Number(id.slice(1)) + 1;
            while (doc.feature('f' + k)) {
                k++;
            }
            const holeId = 'f' + k;
            const sketchName = doc.newName('sketch');
            doc.change(name, function (d) {
                d.features.push(Object.assign({}, linearNew, { id: id, name: sketchName }));
                d.features.push(Object.assign({ id: holeId, type: 'hole', name: name }, made, { sketch: id }));
            });
            return;
        }
        const ordered = Object.assign({ id: id, type: 'hole', name: name }, made);
        doc.change(name, function (d) {
            d.features.push(ordered);
        });
    }

    // Start a new hole feature (featureId null) or edit an existing one.
    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        if (!viewport.bodyCount()) {
            options.onStatus('Hole needs a solid to drill into');
            return Promise.resolve(false);
        }
        // A new hole uses the newest free sketch that has points in it;
        // without one it is placed on a face (Linear)
        const sketch = editing ? doc.feature(editing.sketch) : freeSketch();
        if (editing && !sketch) {
            options.onStatus('The sketch of this hole no longer exists');
            return Promise.resolve(false);
        }
        sketchId = sketch ? sketch.id : null;
        editId = editing ? editing.id : null;
        draft = Object.assign({}, DEFAULTS, editing ? {} : lastUsed || {});
        if (editing) {
            Object.keys(DEFAULTS).forEach(function (key) {
                if (editing[key] !== undefined) {
                    draft[key] = editing[key];
                }
            });
            draft.thread = editing.thread ? editing.thread.designation : '';
            draft.threadDepth = editing.thread && editing.thread.depth ? editing.thread.depth : DEFAULTS.threadDepth;
        }
        placement = editing ? (editing.placement === 'linear' ? 'linear' : 'sketch') : sketch ? 'sketch' : 'linear';
        linear = null;
        if (editing && placement === 'linear') {
            const dims = linearDims(sketch);
            linear = { face: { ref: sketch.plane }, edges: [null, null], d1: dims[0] ? dims[0].value : 10, d2: dims[1] ? dims[1].value : 10 };
        }
        open = true;
        const count = sketch ? holePoints(sketch).length : 0;
        panel.title(editing ? editing.name : 'Hole', sketch ? sketch.name : '');
        panel.text('positions', sketch ? count + (count === 1 ? ' point of ' : ' points of ') + sketch.name : 'No sketch with points');
        ['diameter', 'depth', 'cbDiameter', 'cbDepth', 'csDiameter', 'csAngle', 'kind', 'thread', 'threadDepth'].forEach(function (key) {
            panel.set(key, draft[key]);
        });
        panel.set('termination', draft.through ? 'all' : 'distance');
        panel.set('direction', draft.flip ? 'flipped' : 'default');
        panel.set('drill', draft.drillPoint ? 'angle' : 'flat');
        panel.set('placement', placement);
        // Editing: the placement stays what it was made with
        panel.segEnabled('placement', 'sketch', !editing || placement === 'sketch');
        panel.segEnabled('placement', 'linear', !editing || placement === 'linear');
        panel.segEnabled('placement', 'sketch', !!sketch && (!editing || placement === 'sketch'));
        focused = null;
        panel.show();
        setPlacement(placement);
        refresh();
        if (placement === 'sketch' || editing) {
            panel.focus(placement === 'linear' ? 'dist1' : 'diameter');
        }
        options.onStatus(placement === 'linear' && !editing ? 'Hole: click the flat face to drill into, then two edges to measure from' : 'Hole: set the type and size, then OK');
        return Promise.resolve(true);
    }

    return {
        start: start,
        isOpen: function () {
            return open;
        },
        cancel: function () {
            close(false);
        },
        handleKey: function (event) {
            if (!open) {
                return false;
            }
            if (event.key === 'Enter') {
                commit();
                return true;
            }
            if (event.key === 'Escape') {
                close(false);
                return true;
            }
            return false;
        }
    };
}
