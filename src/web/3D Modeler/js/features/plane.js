/*
    3D Modeler - Work Plane

    A plane parallel to an origin plane, a planar face or another work plane,
    at a distance from it. It is a feature in the history: sketches can be
    put on it, and changing its offset moves them.

    The app asks the user to pick the base first and hands it over with
    prepare(base); start() then opens the panel. The plane is drawn while the
    offset is typed or dragged with the arrow.

    options: stage, viewport, doc, onStatus(text), onClose(committed),
             onDraft(frame | null, editedId)   show the plane being set up
                                     (editedId: the feature it replaces)
*/

import { createPanel } from './panel.js';
import { planeFrame } from '../kernel/profile.js';

export function createWorkPlane(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let base = null;        // plane reference the new plane is offset from
    let pending = null;     // base handed over by prepare()
    let draft = null;       // { offset, flip }

    const panel = createPanel(options.stage, {
        title: 'Work Plane',
        rows: [
            { type: 'section', label: 'Input Geometry' },
            { type: 'static', key: 'base', label: 'Offset from' },
            { type: 'section', label: 'Behavior' },
            { type: 'number', key: 'offset', label: 'Distance' },
            { type: 'check', key: 'flip', label: 'Flip side' }
        ],
        onChange: function (key, value) {
            draft[key] = value;
            refresh();
        },
        onAction: function () { },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function others() {
        return doc.features().filter(function (f) {
            return f.id !== editId;
        });
    }

    function baseLabel(ref) {
        if (ref.ref === 'plane') {
            const f = doc.feature(ref.id);
            return f ? f.name : 'a deleted work plane';
        }
        return { 'origin:xy': 'XY Plane', 'origin:xz': 'XZ Plane', 'origin:yz': 'YZ Plane', face: 'a face of the model' }[ref.ref] || 'a plane';
    }

    function signed() {
        return (draft.flip ? -1 : 1) * draft.offset;
    }

    function refresh() {
        const from = planeFrame(base, others());
        const valid = !!from && draft.offset > 0;
        panel.ok(valid);
        panel.note(from ? (draft.offset > 0 ? '' : 'Enter a distance larger than zero.') : 'The plane this one was offset from no longer exists.', !valid);
        if (!from) {
            options.onDraft(null);
            viewport.setArrow(null);
            return;
        }
        const d = draft.offset > 0 ? signed() : 0;
        options.onDraft({
            o: [from.o[0] + from.n[0] * d, from.o[1] + from.n[1] * d, from.o[2] + from.n[2] * d],
            x: from.x, y: from.y, n: from.n
        }, editId);
        const sign = draft.flip ? -1 : 1;
        viewport.setArrow({
            origin: from.o,
            dir: from.n.map(function (c) {
                return c * sign;
            }),
            length: Math.max(draft.offset, 0)
        }, function (distance) {
            if (distance < 0) {
                draft.flip = !draft.flip;
                panel.set('flip', draft.flip);
            }
            draft.offset = Math.max(Math.round(Math.abs(distance) * 4) / 4, 0.25);
            panel.set('offset', draft.offset);
            refresh();
        });
    }

    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        panel.hide();
        viewport.setArrow(null);
        options.onDraft(null);
        options.onClose(committed);
    }

    function commit() {
        if (!open || !(draft.offset > 0) || !planeFrame(base, others())) {
            return;
        }
        const offset = signed();
        const editing = editId;
        const from = base;
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                old.offset = offset;
            });
        } else {
            const name = doc.newName('plane');
            const made = { id: doc.newId(), type: 'plane', name: name, base: from, offset: offset };
            doc.change(name, function (d) {
                d.features.push(made);
            });
        }
    }

    return {
        // The base of the next new plane (picked in the model by the app)
        prepare: function (ref) {
            pending = ref;
        },
        start: function (featureId) {
            close(false);
            const editing = featureId ? doc.feature(featureId) : null;
            if (!editing && !pending) {
                options.onStatus('Pick the plane or face to offset from first');
                return Promise.resolve(false);
            }
            editId = editing ? editing.id : null;
            base = editing ? editing.base : pending;
            pending = null;
            const offset = editing ? Number(editing.offset) || 0 : 10;
            draft = { offset: Math.abs(offset) || 10, flip: offset < 0 };
            panel.title(editing ? editing.name : 'Work Plane');
            panel.text('base', baseLabel(base));
            panel.set('offset', draft.offset);
            panel.set('flip', draft.flip);
            open = true;
            panel.show();
            refresh();
            panel.focus('offset');
            return Promise.resolve(true);
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
