/*
    3D Modeler - Hole

    Drills a hole at every point of a sketch that was placed with the Point
    tool, the way Inventor's Hole uses the centre points of a sketch: put a
    sketch on the face, place and dimension the points, finish the sketch,
    click Hole. The holes go into the material (against the sketch plane
    normal); Flip turns them round.

    Simple, counterbore and countersink holes, to a depth or through all, with
    an optional drill point. Threads are not modelled.

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';
import { holePoints } from '../sketch/model.js';
import { withResolvedPlane } from '../kernel/profile.js';

const DEFAULTS = {
    kind: 'simple', diameter: 5, through: false, depth: 10, drillPoint: false, flip: false,
    cbDiameter: 9, cbDepth: 5, csDiameter: 10, csAngle: 90
};

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

    const panel = createPanel(options.stage, {
        title: 'Hole',
        rows: [
            { type: 'section', label: 'Input Geometry' },
            { type: 'static', key: 'positions', label: 'Positions' },
            { type: 'section', label: 'Type' },
            { type: 'seg', key: 'kind', label: 'Hole', items: [
                { id: 'simple', label: 'Simple', title: 'A plain drilled hole' },
                { id: 'counterbore', label: 'Counterbore', title: 'A wider flat-bottomed recess for a screw head' },
                { id: 'countersink', label: 'Countersink', title: 'A conical recess for a countersunk screw' }
            ] },
            { type: 'number', key: 'cbDiameter', label: 'C\'bore dia' },
            { type: 'number', key: 'cbDepth', label: 'C\'bore depth' },
            { type: 'number', key: 'csDiameter', label: 'C\'sink dia' },
            { type: 'number', key: 'csAngle', label: 'C\'sink angle', unit: 'deg', max: 179.5 },
            { type: 'section', label: 'Behavior' },
            { type: 'number', key: 'diameter', label: 'Diameter' },
            { type: 'seg', key: 'termination', label: 'Termination', items: [
                { id: 'distance', label: 'Distance', title: 'Drill to a depth' },
                { id: 'all', label: 'Through All', title: 'Drill through the whole part' }
            ] },
            { type: 'number', key: 'depth', label: 'Depth' },
            { type: 'check', key: 'drillPoint', label: 'Drill point (118 deg)' },
            { type: 'check', key: 'flip', label: 'Flip direction' }
        ],
        onChange: function (key, value) {
            if (key === 'termination') {
                draft.through = value === 'all';
            } else {
                draft[key] = value;
            }
            refresh();
        },
        onAction: function () { },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

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
        return f;
    }

    function refresh() {
        panel.visible('cbDiameter', draft.kind === 'counterbore');
        panel.visible('cbDepth', draft.kind === 'counterbore');
        panel.visible('csDiameter', draft.kind === 'countersink');
        panel.visible('csAngle', draft.kind === 'countersink');
        panel.visible('depth', !draft.through);
        panel.visible('drillPoint', !draft.through);
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        timer = setTimeout(function () {
            options.kernel.call('tryFeature', { document: doc.data(), feature: feature(), sketch: withResolvedPlane(doc.feature(sketchId), doc.features()), at: editId }).then(function (out) {
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
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                ['cbDiameter', 'cbDepth', 'csDiameter', 'csAngle', 'depth', 'drillPoint'].forEach(function (key) {
                    delete old[key];
                });
                Object.keys(made).forEach(function (key) {
                    if (key !== 'type') {
                        old[key] = made[key];
                    }
                });
            });
        } else {
            const name = doc.newName('hole');
            const ordered = Object.assign({ id: doc.newId(), type: 'hole', name: name }, made);
            doc.change(name, function (d) {
                d.features.push(ordered);
            });
        }
    }

    // Start a new hole feature (featureId null) or edit an existing one.
    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        const used = new Set(doc.features().map(function (f) {
            return f.sketch;
        }));
        // A new hole uses the newest free sketch that has points in it
        const sketch = editing ? doc.feature(editing.sketch) : doc.features().filter(function (f) {
            return f.type === 'sketch' && !f.suppressed && !used.has(f.id) && holePoints(f).length;
        }).pop();
        if (!sketch) {
            options.onStatus(editing ? 'The sketch of this hole no longer exists'
                : 'Hole needs a sketch with points: start a sketch on the face, place points with the Point tool, finish it, then click Hole');
            return Promise.resolve(false);
        }
        if (!viewport.bodyCount()) {
            options.onStatus('Hole needs a solid to drill into');
            return Promise.resolve(false);
        }
        sketchId = sketch.id;
        editId = editing ? editing.id : null;
        draft = Object.assign({}, DEFAULTS);
        if (editing) {
            Object.keys(DEFAULTS).forEach(function (key) {
                if (editing[key] !== undefined) {
                    draft[key] = editing[key];
                }
            });
        }
        const count = holePoints(sketch).length;
        panel.title(editing ? editing.name : 'Hole', sketch.name);
        panel.text('positions', count + (count === 1 ? ' point of ' : ' points of ') + sketch.name);
        ['diameter', 'depth', 'cbDiameter', 'cbDepth', 'csDiameter', 'csAngle', 'kind', 'drillPoint', 'flip'].forEach(function (key) {
            panel.set(key, draft[key]);
        });
        panel.set('termination', draft.through ? 'all' : 'distance');
        open = true;
        panel.show();
        refresh();
        panel.focus('diameter');
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
