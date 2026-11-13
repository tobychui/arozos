/*
    3D Modeler - Rectangular Pattern, Circular Pattern, Mirror

    One panel for the three ways of repeating features (createPattern({
    kind: "rect" | "circ" | "mirror", ... })). The features to repeat are
    picked in the model browser while the panel is open (click toggles;
    a sketch stands for the feature built from it). Extrusions, revolutions
    and holes can be repeated: the kernel makes each one's tool again and
    copies it (patternTools in kernel/occt.js). A mirror with no feature
    picked mirrors the whole solid.

    Directions, axes and mirror planes come from the origin (X, Y, Z axes;
    XY, XZ, YZ planes) or are picked in the model: a straight edge for a
    direction, a circular edge or a cylindrical face (a hole, a boss) for
    an axis, a planar face for a mirror plane. A picked one is stored as
    numbers; it does not follow later edits.

    options: kind, stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const PLANES = { xy: [0, 0, 1], xz: [0, 1, 0], yz: [1, 0, 0] };
const REPEATABLE = { extrude: true, revolve: true, hole: true };
const TITLES = { rect: 'Rectangular Pattern', circ: 'Circular Pattern', mirror: 'Mirror' };

function axisItems(withNone) {
    const items = withNone ? [{ id: 'none', label: 'None', title: 'One direction only' }] : [];
    return items.concat([
        { id: 'x', label: 'X', title: 'Along the X axis of the origin' },
        { id: 'y', label: 'Y', title: 'Along the Y axis of the origin' },
        { id: 'z', label: 'Z', title: 'Along the Z axis of the origin' },
        { id: 'pick', label: 'Edge', title: 'Along a straight edge picked in the model' }
    ]);
}

export function createPattern(options) {
    const kind = options.kind;
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let features = [];      // ids of the features to repeat
    let picked = {};        // key -> what was picked in the model for it
    let pickFor = null;     // the row the next model pick is for
    let valid = false;
    let token = 0;
    let timer = null;

    const rows = [
        { type: 'section', label: 'Input' },
        { type: 'pick', key: 'features', label: 'Features', title: 'Click to clear the list' }
    ];
    if (kind === 'rect') {
        rows.push(
            { type: 'section', label: 'Direction 1' },
            { type: 'seg', key: 'dir1', label: 'Along', items: axisItems(false) },
            { type: 'check', key: 'flip1', label: 'Flip' },
            { type: 'number', key: 'count1', label: 'Count', unit: ' ', step: 1 },
            { type: 'number', key: 'spacing1', label: 'Spacing' },
            { type: 'section', label: 'Direction 2' },
            { type: 'seg', key: 'dir2', label: 'Along', items: axisItems(true) },
            { type: 'check', key: 'flip2', label: 'Flip' },
            { type: 'number', key: 'count2', label: 'Count', unit: ' ', step: 1 },
            { type: 'number', key: 'spacing2', label: 'Spacing' }
        );
    } else if (kind === 'circ') {
        rows.push(
            { type: 'section', label: 'Placement' },
            { type: 'seg', key: 'axis', label: 'Axis', items: [
                { id: 'x', label: 'X', title: 'The X axis of the origin' },
                { id: 'y', label: 'Y', title: 'The Y axis of the origin' },
                { id: 'z', label: 'Z', title: 'The Z axis of the origin' },
                { id: 'pick', label: 'Picked', title: 'The axis of a hole, a boss or a circular edge picked in the model' }
            ] },
            { type: 'check', key: 'flip', label: 'Flip' },
            { type: 'number', key: 'count', label: 'Count', unit: ' ', step: 1 },
            { type: 'number', key: 'angle', label: 'Angle', unit: 'deg', max: 360, step: 5 }
        );
    } else {
        rows.push(
            { type: 'section', label: 'Mirror Plane' },
            { type: 'seg', key: 'plane', label: 'Plane', items: [
                { id: 'xy', label: 'XY', title: 'The XY plane of the origin' },
                { id: 'xz', label: 'XZ', title: 'The XZ plane of the origin' },
                { id: 'yz', label: 'YZ', title: 'The YZ plane of the origin' },
                { id: 'pick', label: 'Face', title: 'A planar face picked in the model' }
            ] }
        );
    }

    const panel = createPanel(options.stage, {
        title: TITLES[kind],
        rows: rows,
        onChange: function (key) {
            if (panel.get(key) === 'pick') {
                pickFor = key;
            }
            refresh();
        },
        onAction: function () {
            features = [];
            refresh();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    // A model pick for a direction, axis or plane: the last item picked
    function modelPicked(items) {
        const item = items[items.length - 1];
        if (!item || !pickFor) {
            return;
        }
        let value = null;
        if (pickFor === 'axis') {
            if (item.kind === 'edge' && item.curve && item.curve.type === 'circle') {
                value = { o: item.curve.c, d: item.curve.n };
            } else if (item.kind === 'face' && item.axis) {
                value = { o: item.axis.o, d: item.axis.d };
            }
        } else if (pickFor === 'plane') {
            if (item.kind === 'face' && item.type === 'plane') {
                value = { o: item.origin, n: item.normal };
            }
        } else if (item.kind === 'edge' && item.curve && item.curve.type === 'line') {
            value = [0, 1, 2].map(function (i) {
                return item.curve.b[i] - item.curve.a[i];
            });
        }
        if (value) {
            picked[pickFor] = value;
        } else {
            options.onStatus(pickFor === 'axis' ? 'Pick a circular edge or the face of a hole or a boss'
                : pickFor === 'plane' ? 'Pick a flat face' : 'Pick a straight edge');
        }
        refresh();
    }

    function direction(key, flipKey) {
        const choice = panel.get(key);
        const d = choice === 'pick' ? picked[key] : AXES[choice];
        if (!d) {
            return null;
        }
        return panel.get(flipKey) ? d.map(function (c) {
            return -c;
        }) : d;
    }

    function draft() {
        if (kind === 'mirror') {
            const choice = panel.get('plane');
            const plane = choice === 'pick' ? picked.plane : PLANES[choice] ? { o: [0, 0, 0], n: PLANES[choice] } : null;
            return { type: 'mirror', features: features.slice(), plane: plane };
        }
        if (kind === 'circ') {
            const choice = panel.get('axis');
            let axis = choice === 'pick' ? picked.axis : AXES[choice] ? { o: [0, 0, 0], d: AXES[choice] } : null;
            if (axis && panel.get('flip')) {
                axis = { o: axis.o, d: axis.d.map(function (c) {
                    return -c;
                }) };
            }
            return { type: 'pattern', kind: 'circ', features: features.slice(), axis: axis, count: Math.round(panel.get('count')), angle: panel.get('angle') };
        }
        const two = panel.get('dir2') !== 'none';
        return {
            type: 'pattern', kind: 'rect', features: features.slice(),
            dir1: direction('dir1', 'flip1'), count1: Math.round(panel.get('count1')), spacing1: panel.get('spacing1'),
            dir2: two ? direction('dir2', 'flip2') : null, count2: two ? Math.round(panel.get('count2')) : 1, spacing2: two ? panel.get('spacing2') : 0
        };
    }

    function missing(f) {
        if (kind === 'mirror') {
            return f.plane ? null : 'Pick a flat face for the mirror plane.';
        }
        if (!features.length) {
            return 'Click the features to repeat in the model browser.';
        }
        if (kind === 'circ') {
            return f.axis ? null : 'Pick a circular edge, or the face of a hole or a boss, for the axis.';
        }
        if (!f.dir1) {
            return 'Pick a straight edge for direction 1.';
        }
        if (f.dir2 === null && panel.get('dir2') !== 'none') {
            return 'Pick a straight edge for direction 2.';
        }
        return null;
    }

    function refresh() {
        if (!open) {
            return;
        }
        const names = features.map(function (id) {
            return doc.feature(id) ? doc.feature(id).name : id;
        });
        panel.text('features', names.length ? names.join(', ') : kind === 'mirror' ? 'Whole solid (or click features)' : 'Click features in the browser', !names.length && kind !== 'mirror');
        if (kind === 'rect') {
            const two = panel.get('dir2') !== 'none';
            ['flip2', 'count2', 'spacing2'].forEach(function (key) {
                panel.visible(key, two);
            });
        }
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        const f = draft();
        const why = missing(f);
        if (why) {
            viewport.setPreview(null);
            panel.note(why, false);
            return;
        }
        timer = setTimeout(function () {
            options.kernel.call('tryFeature', { document: doc.data(), feature: f, at: editId }).then(function (out) {
                if (mine === token && open) {
                    const cuts = out.meshes.every(function (m) {
                        return m.operation === 'cut';
                    });
                    viewport.setPreview(out.meshes, cuts ? 'cut' : 'join');
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

    // A feature clicked in the browser: add it to the list, or drop it
    function pickFeature(id) {
        if (!open || !id) {
            return;
        }
        let feature = doc.feature(id);
        if (feature && feature.type === 'sketch') {
            // A sketch stands for the feature built from it
            feature = doc.features().filter(function (f) {
                return f.sketch === id && REPEATABLE[f.type];
            })[0] || feature;
        }
        if (!feature || !REPEATABLE[feature.type]) {
            options.onStatus((feature ? feature.name : 'That') + ' cannot be repeated: pick an extrusion, a revolution or a hole');
            return;
        }
        const order = doc.features().map(function (f) {
            return f.id;
        });
        if (editId && order.indexOf(feature.id) > order.indexOf(editId)) {
            options.onStatus(feature.name + ' comes after this feature: only earlier features can be repeated');
            return;
        }
        const at = features.indexOf(feature.id);
        if (at >= 0) {
            features.splice(at, 1);
        } else {
            features.push(feature.id);
        }
        refresh();
    }

    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        token++;
        clearTimeout(timer);
        panel.hide();
        viewport.setPreview(null);
        viewport.onSelection = null;
        viewport.setPickFilter(null);
        viewport.clearSelection();
        options.onClose(committed);
    }

    function commit() {
        if (!open || !valid) {
            return;
        }
        const made = draft();
        const editing = editId;
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                Object.keys(made).forEach(function (key) {
                    old[key] = made[key];
                });
            });
        } else {
            const id = doc.newId();
            const name = doc.newName(made.type);
            doc.change(name, function (d) {
                d.features.push(Object.assign({ id: id, name: name }, made));
            });
        }
    }

    // Start a new pattern or mirror (features selected in the browser are
    // taken over) or edit one
    function start(featureId, preselected, browserPick) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        if (!viewport.bodyCount() && !editing) {
            options.onStatus(TITLES[kind] + ' needs a solid: extrude a sketch first');
            return Promise.resolve(false);
        }
        editId = editing ? editing.id : null;
        open = true;
        features = editing ? (editing.features || []).slice() : [];
        picked = {};
        pickFor = null;
        panel.title(editing ? editing.name : TITLES[kind]);
        if (kind === 'rect') {
            const keyOf = function (d) {
                return Object.keys(AXES).filter(function (k) {
                    return d && Math.abs(Math.abs(d[0]) - AXES[k][0]) + Math.abs(Math.abs(d[1]) - AXES[k][1]) + Math.abs(Math.abs(d[2]) - AXES[k][2]) < 1e-9;
                })[0];
            };
            const flipped = function (d) {
                return !!d && d[0] + d[1] + d[2] < 0;
            };
            const d1 = editing ? editing.dir1 : null;
            const d2 = editing ? editing.dir2 : null;
            panel.set('dir1', d1 ? keyOf(d1) || 'pick' : 'x');
            panel.set('flip1', flipped(d1) && !!keyOf(d1));
            if (d1 && !keyOf(d1)) {
                picked.dir1 = d1;
            }
            panel.set('count1', editing ? editing.count1 : 3);
            panel.set('spacing1', editing ? editing.spacing1 : 20);
            panel.set('dir2', d2 ? keyOf(d2) || 'pick' : 'none');
            panel.set('flip2', flipped(d2) && !!keyOf(d2));
            if (d2 && !keyOf(d2)) {
                picked.dir2 = d2;
            }
            panel.set('count2', editing && editing.dir2 ? editing.count2 : 2);
            panel.set('spacing2', editing && editing.dir2 ? editing.spacing2 : 20);
        } else if (kind === 'circ') {
            const axis = editing ? editing.axis : null;
            const key = axis && axis.o.every(function (c) {
                return Math.abs(c) < 1e-9;
            }) ? Object.keys(AXES).filter(function (k) {
                    return Math.abs(Math.abs(axis.d[0]) - AXES[k][0]) + Math.abs(Math.abs(axis.d[1]) - AXES[k][1]) + Math.abs(Math.abs(axis.d[2]) - AXES[k][2]) < 1e-9;
                })[0] : null;
            panel.set('axis', axis ? key || 'pick' : 'z');
            panel.set('flip', !!(key && axis.d[0] + axis.d[1] + axis.d[2] < 0));
            if (axis && !key) {
                picked.axis = axis;
            }
            panel.set('count', editing ? editing.count : 6);
            panel.set('angle', editing ? editing.angle : 360);
        } else {
            const plane = editing ? editing.plane : null;
            const key = plane && plane.o.every(function (c) {
                return Math.abs(c) < 1e-9;
            }) ? Object.keys(PLANES).filter(function (k) {
                    return Math.abs(Math.abs(plane.n[0]) - PLANES[k][0]) + Math.abs(Math.abs(plane.n[1]) - PLANES[k][1]) + Math.abs(Math.abs(plane.n[2]) - PLANES[k][2]) < 1e-9;
                })[0] : null;
            panel.set('plane', plane ? key || 'pick' : 'yz');
            if (plane && !key) {
                picked.plane = plane;
            }
        }
        // Model picks feed the "picked" choices (edges and faces)
        viewport.setPickFilter({ edges: kind !== 'mirror', faces: kind !== 'rect', toggle: false });
        viewport.onSelection = modelPicked;
        if (!editing && browserPick) {
            pickFeature(browserPick);
        }
        panel.show();
        refresh();
        return Promise.resolve(true);
    }

    return {
        start: start,
        pickFeature: pickFeature,
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
