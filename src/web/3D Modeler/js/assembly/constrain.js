/*
    3D Modeler - Constrain panel (assemblies)

    Assemble > Constrain, as Inventor's Place Constraint: choose the type,
    click a face or an edge on one component and one on another, set the
    offset or the angle. As soon as both are picked the components move
    into place (a preview the solver works out); OK keeps it, Apply keeps
    it and stays open for the next one, Cancel puts everything back.

        Mate      two faces against each other (offset = the gap); an edge,
                  a hole or a pin with a face: its axis lies in the face;
                  two holes, pins or round edges: on one axis
        Flush     two faces side by side, pointing the same way
        Angle     between two faces or two axes
        Tangent   a round face against a flat one, or two round faces
        Insert    two round edges: on one axis, their faces together, as a
                  bolt goes into a hole

    The faces of the assembly origin can be picked too: click a plane in the
    Origin folder of the browser, or in the view while Origin Planes is on.

    options: stage, viewport, onStatus(text), onClose(),
        pickOf(item) -> { comp, entity, pick, label } or null   (assembly.js)
        originPick(key) -> the same for an origin plane or axis
        preview(record | null) -> { ok, errors }   solve with it, show it
        commit(record, editId) -> true when stored
        constraint(id) -> a stored constraint, for editing
        newName(type, solution)
*/

import { createPanel } from '../features/panel.js';
import { accepts } from './solver.js';

const TYPES = [
    { id: 'mate', label: 'Mate', title: 'Faces against each other, or axes on one line' },
    { id: 'flush', label: 'Flush', title: 'Faces side by side, pointing the same way' },
    { id: 'angle', label: 'Angle', title: 'A set angle between two faces or axes' },
    { id: 'tangent', label: 'Tangent', title: 'A round face touching a flat or a round face' },
    { id: 'insert', label: 'Insert', title: 'Two round edges on one axis, faces together (a bolt in a hole)' }
];

const HINTS = {
    mate: 'Click a face, an edge or a hole on one component, then one on another.',
    flush: 'Click a flat face on one component, then one on another; they end up side by side.',
    angle: 'Click two flat faces or two axes (holes, pins, straight edges).',
    tangent: 'Click a round face, then a flat or round face on another component.',
    insert: 'Click a round edge on one component (the rim of a pin or of a bolt head), then a round edge of a hole.'
};

export function createConstrain(options) {
    const viewport = options.viewport;
    let open = false;
    let editId = null;
    let picks = [null, null];
    let next = 0;            // which pick the next click fills
    let valid = false;

    const panel = createPanel(options.stage, {
        title: 'Place Constraint',
        rows: [
            { type: 'seg', key: 'type', label: 'Type', columns: 3, items: TYPES, illustrate: 'constraint' },
            { type: 'section', label: 'Selections' },
            { type: 'pick', key: 'p1', label: 'First', title: 'Click to pick this one again' },
            { type: 'pick', key: 'p2', label: 'Second', title: 'Click to pick this one again' },
            { type: 'section', label: 'Values' },
            { type: 'seg', key: 'solution', label: 'Solution', items: [
                { id: 'a', label: 'Outside' },
                { id: 'b', label: 'Inside' }
            ] },
            { type: 'number', key: 'offset', label: 'Offset', signed: true },
            { type: 'number', key: 'angle', label: 'Angle', signed: true, unit: 'deg', min: -360, max: 360, step: 5 }
        ],
        onChange: function (key) {
            if (key === 'type') {
                layout();
            }
            refresh();
        },
        onAction: function (key) {
            next = key === 'p1' ? 0 : 1;
            picks[next] = null;
            refresh();
        },
        onApply: function () {
            commit(true);
        },
        onOk: function () {
            commit(false);
        },
        onCancel: function () {
            close();
        }
    });

    // The solution row means something else for each type
    function layout() {
        const type = panel.get('type');
        const labels = { tangent: ['Outside', 'Inside'], insert: ['Opposed', 'Aligned'] };
        const pair = labels[type];
        panel.visible('solution', !!pair);
        if (pair) {
            // The solution row is the only one with the ids "a" and "b"
            const seg = panel.element().querySelector('.seg-btn[data-id="a"]').parentElement;
            seg.querySelector('[data-id="a"]').textContent = pair[0];
            seg.querySelector('[data-id="b"]').textContent = pair[1];
        }
        panel.visible('offset', type !== 'angle');
        panel.visible('angle', type === 'angle');
        panel.note(HINTS[type]);
    }

    function record() {
        const type = panel.get('type');
        const sol = panel.get('solution');
        const r = {
            type: type === 'flush' ? 'mate' : type,
            a: picks[0].entity,
            b: picks[1].entity
        };
        if (type === 'flush') {
            r.solution = 'flush';
        } else if (type === 'tangent') {
            r.solution = sol === 'b' ? 'inside' : 'outside';
        } else if (type === 'insert') {
            r.solution = sol === 'b' ? 'aligned' : 'opposed';
        }
        if (type === 'angle') {
            r.angle = panel.get('angle') || 0;
        } else {
            r.offset = panel.get('offset') || 0;
        }
        return r;
    }

    function showPicks() {
        panel.text('p1', picks[0] ? picks[0].label : 'Click on the model', !picks[0] && next === 0);
        panel.text('p2', picks[1] ? picks[1].label : picks[0] ? 'Click on another component' : '-', !picks[1] && next === 1);
        viewport.selectItems(picks.filter(function (p) {
            return p && p.item;
        }).map(function (p) {
            return { type: p.item.kind, body: p.item.body, index: p.item.index };
        }), true);
    }

    function refresh() {
        if (!open) {
            return;
        }
        showPicks();
        valid = false;
        panel.ok(false);
        const type = panel.get('type');
        if (!picks[0] || !picks[1]) {
            options.preview(null);
            panel.note(HINTS[type]);
            return;
        }
        if (picks[0].comp && picks[0].comp === picks[1].comp) {
            options.preview(null);
            panel.note('Both picks are on the same component. Pick the second one on another component.', true);
            return;
        }
        const a = picks[0].entity;
        const b = picks[1].entity;
        const kindType = type === 'flush' ? 'mate' : type;
        if (type === 'flush' && (a.kind !== 'plane' || b.kind !== 'plane')) {
            options.preview(null);
            panel.note('Flush needs two flat faces.', true);
            return;
        }
        if (!accepts(kindType, a, b)) {
            options.preview(null);
            panel.note({
                angle: 'Angle needs two faces or two axes, not a point.',
                tangent: 'Tangent needs a round face (or round edge) and a flat or round face.',
                insert: 'Insert needs two round edges: the rim of a pin or bolt head and the rim of a hole.'
            }[type] || 'These cannot be constrained this way.', true);
            return;
        }
        if (type === 'angle' && !isFinite(panel.get('angle'))) {
            panel.note('Enter an angle.', true);
            return;
        }
        const r = record();
        r.id = editId || '__draft';
        const out = options.preview(r);
        if (out && out.errors && out.errors[r.id] !== undefined) {
            panel.note('This constraint cannot hold together with the others (or with grounded components). Change the offset or the picks, or suppress a constraint that is in the way.', true);
            return;
        }
        valid = true;
        panel.ok(true);
        panel.note('The components show where the constraint puts them. OK keeps it; Apply keeps it and starts the next one.');
    }

    function onPick(items) {
        if (!items.length) {
            showPicks();
            return;
        }
        const item = items[items.length - 1];
        const pick = options.pickOf(item);
        if (!pick) {
            showPicks();
            panel.note('That face or edge cannot be used: pick a flat or round face, a straight or round edge.', true);
            return;
        }
        take(pick);
    }

    function take(pick) {
        picks[next] = pick;
        if (next === 0) {
            picks[1] = null;
            next = 1;
        } else {
            next = 0;
        }
        refresh();
    }

    // An origin plane or axis, picked in the browser or in the view
    function pickOrigin(key) {
        if (!open) {
            return false;
        }
        const pick = options.originPick(key);
        if (pick) {
            take(pick);
        }
        return !!pick;
    }

    function start(type, id) {
        editId = id || null;
        open = true;
        picks = [null, null];
        next = 0;
        panel.title(editId ? 'Edit Constraint' : 'Place Constraint');
        const c = editId ? options.constraint(editId) : null;
        if (c) {
            const shown = c.type === 'mate' && c.solution === 'flush' ? 'flush' : c.type;
            panel.set('type', shown);
            panel.set('solution', c.solution === 'inside' || c.solution === 'aligned' ? 'b' : 'a');
            panel.set('offset', c.offset || 0);
            panel.set('angle', c.angle || 0);
            picks = [options.restorePick(c.a), options.restorePick(c.b)];
            next = 0;
        } else {
            panel.set('type', type || 'mate');
            panel.set('solution', 'a');
            panel.set('offset', 0);
            panel.set('angle', 90);
        }
        viewport.onSelection = onPick;
        viewport.setComponentMode(false);
        viewport.setPickFilter({ faces: true, edges: true });
        layout();
        panel.show();
        refresh();
        return true;
    }

    function commit(keepOpen) {
        if (!valid) {
            return;
        }
        const r = record();
        if (!options.commit(r, editId)) {
            return;
        }
        if (keepOpen) {
            editId = null;
            panel.title('Place Constraint');
            picks = [null, null];
            next = 0;
            refresh();
        } else {
            close(true);
        }
    }

    function close(kept) {
        if (!open) {
            return;
        }
        open = false;
        panel.hide();
        viewport.onSelection = null;
        viewport.setPickFilter(null);
        viewport.selectItems([], true);
        if (!kept) {
            options.preview(null);
        }
        options.onClose();
    }

    return {
        start: start,
        isOpen: function () {
            return open;
        },
        cancel: function () {
            close(false);
        },
        setType: function (type) {
            panel.set('type', type);
            layout();
            refresh();
        },
        pickOrigin: pickOrigin,
        handleKey: function (event) {
            if (event.key === 'Escape') {
                close(false);
                return true;
            }
            if (event.key === 'Enter') {
                commit(false);
                return true;
            }
            return false;
        }
    };
}
