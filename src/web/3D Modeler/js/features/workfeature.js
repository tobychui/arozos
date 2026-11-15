/*
    3D Modeler - Work Plane, Work Axis and Work Point

    One panel for the three work features (PROPOSAL.md 14.13, 14.25):
    choose how the feature is defined, click what defines it in the model
    (the viewport's reference pick: planes and flat faces, axes, straight
    edges, round faces, points, corners), set the values. The feature is
    drawn as it would be while the panel is open (options.onDraft).

        Work Plane  Offset from a plane; Midplane of two parallel planes;
                    at an Angle to a plane about an axis in it; through
                    3 Points; Tangent to a round face, parallel to a plane;
                    Normal to an axis through a point
        Work Axis   along a straight edge or the axis of a round face; where
                    2 Planes meet; through 2 Points
        Work Point  at a corner (Vertex); typed Coordinates; where an Axis
                    meets a Plane

    The stored shapes are in kernel/profile.js (workPlaneFrame, workAxisLine,
    workPoint). An edge or a round face picked for a Work Axis (or a
    Tangent plane) is kept with its description, so the feature follows it
    when an earlier feature moves it (kernel edgeLine / cylinderLine); an
    edge used only as the axis of an Angle or Normal plane is kept as the
    line it was when picked (make a Work Axis on it to have it follow).

    createWorkFeature(type, options)    type "plane" | "axis" | "point"
        options: stage, viewport, kernel, doc, onStatus(text), onClose(committed),
            onDraft(draft | null, editedId)  draft { frame } | { line } | { at }
            referenceOf(target)   the plane reference of a picked plane (app.js)
    returns { start(featureId), prepare(planeRef), prepareKind(kind),
              isOpen(), cancel(), handleKey(event) }
*/

import { createPanel } from './panel.js';
import { workPlaneFrame, workAxisLine, workPoint, planeFrame } from '../kernel/profile.js';

const PLANES = { planes: true };
const AXES = { axes: true, edges: true, cylinders: true };
const POINTS = { points: true, vertices: true };

export const SPECS = {
    plane: {
        title: 'Work Plane',
        kinds: [
            { id: 'offset', label: 'Offset', slots: [['base', 'Plane', PLANES]], numbers: ['offset'], flip: true,
                hint: 'Pick the plane or face to offset from, then set the distance (type it or drag the arrow).' },
            { id: 'midplane', label: 'Midplane', slots: [['a', 'First plane', PLANES], ['b', 'Second plane', PLANES]],
                hint: 'Pick two parallel planes or faces: the new plane lies halfway between them.' },
            { id: 'angle', label: 'Angle', slots: [['base', 'Plane', PLANES], ['axis', 'Around', AXES]], numbers: ['angle'],
                hint: 'Pick a plane, then an edge or axis lying in it: the new plane turns about it by the angle.' },
            { id: 'points', label: '3 Points', slots: [['a', 'First point', POINTS], ['b', 'Second point', POINTS], ['c', 'Third point', POINTS]],
                hint: 'Pick three corners or points that are not in a line.' },
            { id: 'tangent', label: 'Tangent', slots: [['face', 'Round face', { cylinders: true }], ['base', 'Parallel to', PLANES]],
                hint: 'Pick a round face, then a plane its axis runs along: the new plane touches the face on the side you clicked.' },
            { id: 'normal', label: 'Normal', slots: [['axis', 'Square to', AXES], ['point', 'Through', POINTS]],
                hint: 'Pick an axis or a straight edge, then a point: the new plane is square to the axis through the point.' }
        ]
    },
    axis: {
        title: 'Work Axis',
        kinds: [
            { id: 'model', label: 'Edge or Face', slots: [['source', 'Edge or face', { edges: true, cylinders: true }]],
                hint: 'Click a straight edge, or the face of a hole or a boss for its axis.' },
            { id: 'planes', label: '2 Planes', slots: [['a', 'First plane', PLANES], ['b', 'Second plane', PLANES]],
                hint: 'Pick two planes or faces that are not parallel: the axis is where they meet.' },
            { id: 'points', label: '2 Points', slots: [['a', 'First point', POINTS], ['b', 'Second point', POINTS]],
                hint: 'Pick two corners or points.' }
        ]
    },
    point: {
        title: 'Work Point',
        kinds: [
            { id: 'vertex', label: 'Vertex', slots: [['at', 'Corner', { vertices: true }]], hint: 'Click a corner of the model.' },
            { id: 'coords', label: 'Coordinates', numbers: ['x', 'y', 'z'], hint: 'Type where the point is, in mm from the centre point.' },
            { id: 'axisplane', label: 'Axis + Plane', slots: [['axis', 'Axis', AXES], ['plane', 'Plane', PLANES]],
                hint: 'Pick an axis or a straight edge, then a plane it crosses.' }
        ]
    }
};

const SLOT_KEYS = ['base', 'a', 'b', 'c', 'axis', 'point', 'face', 'source', 'at', 'plane'];
const NUMBERS = {
    offset: { label: 'Distance' },
    angle: { label: 'Angle', unit: 'deg', signed: true, min: -360, max: 360, step: 15 },
    x: { label: 'X', signed: true },
    y: { label: 'Y', signed: true },
    z: { label: 'Z', signed: true }
};

const NAMES = {
    'origin:xy': 'XY Plane', 'origin:xz': 'XZ Plane', 'origin:yz': 'YZ Plane',
    'origin:x': 'X Axis', 'origin:y': 'Y Axis', 'origin:z': 'Z Axis', origin: 'Center Point',
    face: 'a face of the model', line: 'a line of the model', vertex: 'a corner of the model'
};

export function createWorkFeature(type, options) {
    const spec = SPECS[type];
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let pending = null;     // what the app handed over before start()
    let kind = null;        // the kind of definition chosen
    let slots = {};         // slot key -> { ref, label, model? }
    let active = null;      // the slot the next pick fills
    let values = null;      // { offset, angle, x, y, z, flip }
    let valid = false;

    const rows = [
        { type: 'seg', key: 'kind', label: 'Type', columns: spec.kinds.length > 3 ? 3 : 2, items: spec.kinds.map(function (k) {
            return { id: k.id, label: k.label };
        }) },
        { type: 'section', key: 'inputs', label: 'Input Geometry' }
    ];
    SLOT_KEYS.forEach(function (key) {
        rows.push({ type: 'pick', key: key, label: key, title: 'Click, then pick it in the model' });
    });
    rows.push({ type: 'section', key: 'values', label: 'Values' });
    Object.keys(NUMBERS).forEach(function (key) {
        rows.push(Object.assign({ type: 'number', key: key }, NUMBERS[key]));
    });
    if (type === 'plane') {
        rows.push({ type: 'check', key: 'flip', label: 'Flip side' });
    }

    const panel = createPanel(options.stage, {
        title: spec.title,
        rows: rows,
        onChange: function (key, value) {
            if (key === 'kind') {
                kind = value;
                layout();
                activate(firstEmpty());
            } else {
                values[key] = value;
            }
            refresh();
        },
        onAction: function (key) {
            activate(key); // pick this one again
            refresh();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function kindSpec() {
        return spec.kinds.filter(function (k) {
            return k.id === kind;
        })[0] || spec.kinds[0];
    }

    function slotDefs() {
        return kindSpec().slots || [];
    }

    function others() {
        return doc.features().filter(function (f) {
            return f.id !== editId;
        });
    }

    function labelOf(ref) {
        if (!ref) {
            return '';
        }
        if ((ref.ref === 'plane' || ref.ref === 'axis' || ref.ref === 'point') && ref.id) {
            const f = doc.feature(ref.id);
            return f ? f.name : 'a deleted work feature';
        }
        return NAMES[ref.ref] || 'a reference';
    }

    // What a pick in the model becomes in a slot
    function slotFromPick(pick) {
        if (pick.kind === 'plane') {
            const ref = options.referenceOf(pick.target);
            return { ref: ref, label: labelOf(ref) };
        }
        if (pick.kind === 'axis' || pick.kind === 'point') {
            return { ref: pick.ref, label: labelOf(pick.ref) };
        }
        if (pick.kind === 'vertex') {
            return { ref: { ref: 'vertex', at: pick.at.slice() }, label: NAMES.vertex };
        }
        if (pick.kind === 'edge') {
            return {
                ref: { ref: 'line', line: pick.line }, label: 'an edge of the model',
                model: { edge: { body: pick.item.body, mid: pick.info.mid, length: pick.info.length }, line: pick.line }
            };
        }
        if (pick.kind === 'cylinder') {
            return {
                ref: { ref: 'line', line: pick.line }, label: 'a round face of the model',
                model: { face: { body: pick.item.body, centre: pick.info.centre, area: pick.info.area }, line: pick.line, radius: pick.radius, point: pick.point }
            };
        }
        return null;
    }

    function firstEmpty() {
        const free = slotDefs().filter(function (s) {
            return !slots[s[0]];
        })[0];
        return free ? free[0] : null;
    }

    // Wait for the slot `key` to be picked in the model
    function activate(key) {
        const def = slotDefs().filter(function (s) {
            return s[0] === key;
        })[0];
        active = def ? key : null;
        if (!def || !open) {
            viewport.stopRefPick();
            return;
        }
        viewport.startRefPick(def[2], function (pick) {
            const slot = slotFromPick(pick);
            if (!slot || !active) {
                return;
            }
            slots[active] = slot;
            activate(firstEmpty());
            refresh();
        });
    }

    function layout() {
        const k = kindSpec();
        const used = {};
        (k.slots || []).forEach(function (s) {
            used[s[0]] = s[1];
        });
        SLOT_KEYS.forEach(function (key) {
            panel.visible(key, !!used[key]);
            if (used[key]) {
                panel.label(key, used[key]);
            }
        });
        panel.visible('inputs', !!(k.slots && k.slots.length));
        const numbers = k.numbers || [];
        Object.keys(NUMBERS).forEach(function (key) {
            panel.visible(key, numbers.indexOf(key) >= 0);
        });
        panel.visible('values', numbers.length > 0 || !!k.flip);
        if (type === 'plane') {
            panel.visible('flip', !!k.flip);
        }
    }

    // The feature as the panel describes it: { def } or, for an offset
    // plane, { base, offset }; null while something is missing
    function shape() {
        const s = function (key) {
            return slots[key] ? slots[key].ref : null;
        };
        const missing = slotDefs().some(function (d) {
            return !slots[d[0]];
        });
        if (missing) {
            return null;
        }
        if (type === 'plane') {
            if (kind === 'offset') {
                return { base: s('base'), offset: (values.flip ? -1 : 1) * values.offset };
            }
            if (kind === 'tangent') {
                const m = slots.face.model;
                return { def: { kind: 'tangent', face: m.face, line: m.line, radius: m.radius, base: s('base'), side: m.point } };
            }
            const def = { kind: kind };
            slotDefs().forEach(function (d) {
                def[d[0]] = s(d[0]);
            });
            if (kind === 'angle') {
                def.angle = values.angle;
            }
            return { def: def };
        }
        if (type === 'axis') {
            if (kind === 'model') {
                const m = slots.source.model;
                return { def: m.edge ? { kind: 'edge', edge: m.edge, line: m.line } : { kind: 'cylinder', face: m.face, line: m.line } };
            }
            return { def: { kind: kind, a: s('a'), b: s('b') } };
        }
        if (kind === 'vertex') {
            return { def: { kind: 'vertex', at: slots.at.ref.at.slice() } };
        }
        if (kind === 'coords') {
            return { def: { kind: 'coords', at: [values.x, values.y, values.z] } };
        }
        return { def: { kind: 'axisplane', axis: s('axis'), plane: s('plane') } };
    }

    // Where the feature would be: { frame } | { line } | { at }, or null
    function geometryOf(made) {
        if (!made) {
            return null;
        }
        const temp = Object.assign({ id: '__draft', type: type }, made);
        if (type === 'plane') {
            const frame = workPlaneFrame(temp, others());
            return frame ? { frame: frame } : null;
        }
        if (type === 'axis') {
            const line = workAxisLine(temp, others());
            return line ? { line: line } : null;
        }
        const at = workPoint(temp, others());
        return at ? { at: at } : null;
    }

    // Why a complete definition gives nothing
    function problem() {
        return {
            midplane: 'The two planes are not parallel.',
            angle: 'The axis must lie in the plane.',
            points: type === 'plane' ? 'The three points are in a line.' : 'The two points are the same.',
            tangent: 'The axis of the round face must run along the plane.',
            normal: 'Pick an axis and a point.',
            planes: 'The two planes are parallel: they do not meet.',
            axisplane: 'The axis runs along the plane: they do not meet.'
        }[kind] || 'These do not define a ' + spec.title.toLowerCase() + '.';
    }

    function refresh() {
        if (!open) {
            return;
        }
        slotDefs().forEach(function (d) {
            const slot = slots[d[0]];
            panel.text(d[0], slot ? slot.label : active === d[0] ? 'Pick it in the model' : 'Click to pick', !slot);
        });
        const made = shape();
        const geometry = geometryOf(made);
        const offsetBad = type === 'plane' && kind === 'offset' && !(values.offset > 0);
        valid = !!geometry && !offsetBad;
        panel.ok(valid);
        if (!made) {
            panel.note(kindSpec().hint);
        } else if (offsetBad) {
            panel.note('Enter a distance larger than zero.', true);
        } else {
            panel.note(geometry ? '' : problem(), !geometry);
        }
        options.onDraft(geometry, editId);
        // The offset of a plane can be dragged with the arrow
        if (type === 'plane' && kind === 'offset' && slots.base) {
            const from = planeFrame(slots.base.ref, others());
            if (from) {
                const sign = values.flip ? -1 : 1;
                viewport.setArrow({
                    origin: from.o,
                    dir: from.n.map(function (c) {
                        return c * sign;
                    }),
                    length: Math.max(values.offset, 0)
                }, function (distance) {
                    if (distance < 0) {
                        values.flip = !values.flip;
                        panel.set('flip', values.flip);
                    }
                    values.offset = Math.max(Math.round(Math.abs(distance) * 4) / 4, 0.25);
                    panel.set('offset', values.offset);
                    refresh();
                });
                return;
            }
        }
        viewport.setArrow(null);
    }

    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        active = null;
        viewport.stopRefPick();
        viewport.setArrow(null);
        options.onDraft(null);
        panel.hide();
        options.onClose(committed);
    }

    // Edges and faces get their description (to be found again after an
    // edit upstream) from the kernel before the feature is stored
    function describe(made) {
        const def = made.def;
        if (def && def.edge) {
            return options.kernel.call('edgeRefs', { document: doc.data(), at: editId, edges: [def.edge] }).then(function (out) {
                def.edge = out.refs[0] || def.edge;
            }).catch(function () {
                // Stored by position only
            });
        }
        if (def && def.face) {
            return options.kernel.call('faceRefs', { document: doc.data(), at: editId, faces: [def.face] }).then(function (out) {
                def.face = out.refs[0] || def.face;
            }).catch(function () {
                // Stored by position only
            });
        }
        return Promise.resolve();
    }

    function commit() {
        if (!open || !valid) {
            return;
        }
        const made = shape();
        const editing = editId;
        close(true);
        describe(made).then(function () {
            if (editing) {
                const old = doc.feature(editing);
                doc.change('Edit ' + old.name, function () {
                    delete old.def;
                    delete old.base;
                    delete old.offset;
                    Object.assign(old, made);
                });
            } else {
                const name = doc.newName(type);
                const feature = Object.assign({ id: doc.newId(), type: type, name: name }, made);
                doc.change(name, function (d) {
                    d.features.push(feature);
                });
                options.onStatus(name + ' made');
            }
        });
    }

    // The slots of a stored feature, to edit it
    function load(feature) {
        const def = feature.def;
        if (type === 'plane' && !def) {
            kind = 'offset';
            slots.base = { ref: feature.base, label: labelOf(feature.base) };
            const offset = Number(feature.offset) || 0;
            values.offset = Math.abs(offset) || 10;
            values.flip = offset < 0;
            return;
        }
        if (!def) {
            return;
        }
        if (type === 'axis' && (def.kind === 'edge' || def.kind === 'cylinder')) {
            kind = 'model';
            slots.source = def.kind === 'edge' ? { ref: { ref: 'line', line: def.line }, label: 'an edge of the model', model: { edge: def.edge, line: def.line } }
                : { ref: { ref: 'line', line: def.line }, label: 'a round face of the model', model: { face: def.face, line: def.line } };
            return;
        }
        kind = def.kind;
        if (def.kind === 'tangent') {
            slots.face = { ref: { ref: 'line', line: def.line }, label: 'a round face of the model', model: { face: def.face, line: def.line, radius: def.radius, point: def.side } };
            slots.base = { ref: def.base, label: labelOf(def.base) };
            return;
        }
        if (def.kind === 'vertex') {
            slots.at = { ref: { ref: 'vertex', at: def.at }, label: NAMES.vertex };
            return;
        }
        if (def.kind === 'coords') {
            values.x = def.at[0];
            values.y = def.at[1];
            values.z = def.at[2];
            return;
        }
        if (def.kind === 'angle') {
            values.angle = Number(def.angle) || 0;
        }
        SLOT_KEYS.forEach(function (key) {
            if (def[key] && typeof def[key] === 'object' && def[key].ref) {
                slots[key] = { ref: def[key], label: labelOf(def[key]) };
            }
        });
    }

    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        editId = editing ? editing.id : null;
        slots = {};
        values = { offset: 10, angle: 90, x: 0, y: 0, z: 0, flip: false };
        kind = pending && pending.kind ? pending.kind : spec.kinds[0].id;
        if (editing) {
            load(editing);
        } else if (pending && pending.base) {
            slots.base = { ref: pending.base, label: labelOf(pending.base) };
        }
        pending = null;
        panel.title(editing ? editing.name : spec.title);
        panel.set('kind', kind);
        Object.keys(NUMBERS).forEach(function (key) {
            panel.set(key, values[key]);
        });
        if (type === 'plane') {
            panel.set('flip', values.flip);
        }
        open = true;
        panel.show();
        layout();
        activate(firstEmpty());
        refresh();
        const numbers = kindSpec().numbers || [];
        if (numbers.length && !firstEmpty()) {
            panel.focus(numbers[0]);
        }
        options.onStatus(spec.title + ': ' + kindSpec().hint);
        return Promise.resolve(true);
    }

    return {
        start: start,
        // An offset plane's base, picked in the model by the app
        prepare: function (ref) {
            pending = { kind: 'offset', base: ref };
        },
        // The kind of the next new feature (a ribbon menu entry)
        prepareKind: function (k) {
            pending = { kind: k };
        },
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
