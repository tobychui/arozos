/*
    3D Modeler - Revolve

    Turns a sketch profile about an axis: a line of the same sketch (usually
    a construction or centre line) or an axis of the origin that lies in
    the sketch plane. Full turn, or an angle with the same four directions
    as Extrude, and Join / Cut / Intersect / New Solid.

    Profiles are picked as in Extrude (profiles.js). Once a profile is
    picked, the straight lines of its sketch and the origin axes in its
    plane are drawn as candidates; a click picks the axis. A sketch with
    exactly one construction line has it picked for you, as Inventor does
    with a centre line.

    The kernel side is revolveTool / revolve in kernel/occt.js.

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';
import { createProfiles } from './profiles.js';
import { planeFrame, toWorld, withResolvedPlane } from '../kernel/profile.js';
import { curves as sketchCurves } from '../sketch/model.js';

const DIRECTIONS = [
    { id: 'positive', label: 'Default', title: 'Turn right handed about the axis' },
    { id: 'negative', label: 'Flipped', title: 'Turn the other way' },
    { id: 'symmetric', label: 'Symmetric', title: 'Half the angle to each side' },
    { id: 'asymmetric', label: 'Asymmetric', title: 'Angle A one way, angle B the other' }
];
const OPERATIONS = [
    { id: 'join', label: 'Join', title: 'Add to the solid' },
    { id: 'cut', label: 'Cut', title: 'Remove from the solid' },
    { id: 'intersect', label: 'Intersect', title: 'Keep only what the solid and the revolution share' },
    { id: 'new', label: 'New Solid', title: 'Make a separate solid body' }
];
const ORIGIN_AXES = [
    { origin: 'x', d: [1, 0, 0], label: 'X Axis' },
    { origin: 'y', d: [0, 1, 0], label: 'Y Axis' },
    { origin: 'z', d: [0, 0, 1], label: 'Z Axis' }
];

export function createRevolve(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let axis = null;        // { curve } or { origin }
    let candidates = [];    // [{ axis, label, a, b }]
    let candidatesOf = null; // the sketch the candidates were made for
    let valid = false;
    let token = 0;
    let timer = null;

    const profiles = createProfiles({ viewport: viewport, kernel: options.kernel, doc: doc, onPick: refresh });

    const panel = createPanel(options.stage, {
        title: 'Revolve',
        rows: [
            { type: 'section', label: 'Input Geometry' },
            { type: 'pick', key: 'profiles', label: 'Profiles', title: 'Click to clear the selection' },
            { type: 'pick', key: 'axis', label: 'Axis', title: 'Click to pick the axis again' },
            { type: 'section', label: 'Behavior' },
            { type: 'seg', key: 'extent', label: 'Extents', items: [
                { id: 'full', label: 'Full', title: 'A whole turn' },
                { id: 'angle', label: 'Angle', title: 'Part of a turn' }
            ] },
            { type: 'seg', key: 'direction', label: 'Direction', items: DIRECTIONS },
            { type: 'number', key: 'angle', label: 'Angle A', unit: 'deg', max: 360, step: 5 },
            { type: 'number', key: 'angle2', label: 'Angle B', unit: 'deg', max: 360, step: 5 },
            { type: 'section', label: 'Output' },
            { type: 'seg', key: 'operation', label: 'Boolean', items: OPERATIONS, illustrate: 'operation' }
        ],
        onChange: refresh,
        onAction: function (key) {
            if (key === 'profiles') {
                profiles.clear();
            } else {
                axis = null;
            }
            refresh();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function sameAxis(x, y) {
        return !!x && !!y && (x.curve ? x.curve === y.curve : x.origin === y.origin);
    }

    // The lines of the profile's sketch and the origin axes in its plane
    function makeCandidates(sketchId) {
        candidates = [];
        candidatesOf = sketchId;
        const sketch = sketchId ? doc.feature(sketchId) : null;
        if (!sketch) {
            return;
        }
        const frame = planeFrame(sketch.plane, doc.features());
        if (!frame) {
            return;
        }
        const lines = sketchCurves({ geometry: sketch.geometry || [], constraints: [] }).filter(function (c) {
            return c.type === 'line' && !c.ref;
        });
        lines.forEach(function (line) {
            candidates.push({ axis: { curve: line.id }, label: 'Sketch line', construction: !!line.construction,
                a: toWorld(frame, line.a[0], line.a[1]), b: toWorld(frame, line.b[0], line.b[1]) });
        });
        // An origin axis qualifies when it lies in the sketch plane
        const dot = function (u, v) {
            return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        };
        const reach = 60;
        ORIGIN_AXES.forEach(function (o) {
            if (Math.abs(dot(o.d, frame.n)) < 1e-9 && Math.abs(dot(frame.o, frame.n)) < 1e-9) {
                candidates.push({ axis: { origin: o.origin }, label: o.label,
                    a: o.d.map(function (c) {
                        return -c * reach;
                    }), b: o.d.map(function (c) {
                        return c * reach;
                    }) });
            }
        });
        // One construction line: that is the centre line, take it
        const centre = candidates.filter(function (c) {
            return c.construction;
        });
        if (!axis && centre.length === 1) {
            axis = centre[0].axis;
        }
    }

    function draft() {
        const kind = panel.get('extent');
        const direction = panel.get('direction');
        return {
            type: 'revolve',
            sketch: profiles.chosenSketch(),
            regions: profiles.samples(),
            axis: axis,
            operation: panel.get('operation'),
            extent: kind === 'full' ? { type: 'full' }
                : direction === 'asymmetric' ? { type: 'angle', value: panel.get('angle'), value2: panel.get('angle2'), direction: 'asymmetric' }
                    : { type: 'angle', value: panel.get('angle'), direction: direction }
        };
    }

    function refresh() {
        if (!open) {
            return;
        }
        const sketch = profiles.chosenSketch();
        if (sketch !== candidatesOf) {
            if (axis && axis.curve && candidatesOf) {
                axis = null; // a line of the sketch picked before
            }
            makeCandidates(sketch);
        }
        profiles.paint();
        viewport.setAxes(candidates.map(function (c) {
            return { a: c.a, b: c.b, selected: sameAxis(c.axis, axis) };
        }), function (index) {
            axis = candidates[index].axis;
            refresh();
        });
        const count = profiles.count();
        panel.title(editId ? doc.feature(editId).name : 'Revolve', sketch ? doc.feature(sketch).name : '');
        panel.text('profiles', count ? count + (count === 1 ? ' profile' : ' profiles') : 'Pick a profile in the model', !count);
        const picked = candidates.filter(function (c) {
            return sameAxis(c.axis, axis);
        })[0];
        panel.text('axis', picked ? picked.label : 'Pick a line in the model', !picked);
        const angled = panel.get('extent') === 'angle';
        panel.visible('direction', angled);
        panel.visible('angle', angled);
        panel.visible('angle2', angled && panel.get('direction') === 'asymmetric');

        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (!count) {
            viewport.setPreview(null);
            panel.note('Click a closed area of a sketch to use it as the profile.');
            return;
        }
        if (!picked) {
            viewport.setPreview(null);
            panel.note('Click the line to turn the profile about: a line of the sketch (a construction line is best) or an origin axis drawn in blue.');
            return;
        }
        if (angled && (!(panel.get('angle') > 0) || (panel.get('direction') === 'asymmetric' && !(panel.get('angle2') > 0)))) {
            viewport.setPreview(null);
            panel.note('Enter an angle larger than zero.', true);
            return;
        }
        timer = setTimeout(function () {
            const f = draft();
            options.kernel.call('preview', { feature: f, sketch: withResolvedPlane(doc.feature(f.sketch), doc.features()) }).then(function (mesh) {
                if (mine === token && open) {
                    viewport.setPreview(mesh, f.operation);
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
        }, 40);
    }

    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        token++;
        clearTimeout(timer);
        panel.hide();
        profiles.stop();
        viewport.setAxes(null);
        viewport.setPreview(null);
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
                old.sketch = made.sketch;
                old.regions = made.regions;
                old.axis = made.axis;
                old.operation = made.operation;
                old.extent = made.extent;
            });
        } else {
            const id = doc.newId();
            const name = doc.newName('revolve');
            doc.change(name, function (d) {
                d.features.push({ id: id, type: 'revolve', name: name, sketch: made.sketch, regions: made.regions,
                    axis: made.axis, operation: made.operation, extent: made.extent });
            });
        }
    }

    // Start a new revolution (featureId null) or edit one. Resolves to false,
    // with a status message, when there is nothing to revolve.
    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        return profiles.load(editing, 'Revolve').then(function (loaded) {
            if (!loaded.ok) {
                options.onStatus(loaded.message);
                return false;
            }
            editId = editing ? editing.id : null;
            axis = editing ? editing.axis || null : null;
            candidatesOf = undefined;
            const extent = editing ? editing.extent || { type: 'full' } : { type: 'full' };
            panel.set('extent', extent.type === 'angle' ? 'angle' : 'full');
            panel.set('direction', extent.direction || 'positive');
            panel.set('angle', extent.value > 0 ? extent.value : 90);
            panel.set('angle2', extent.value2 > 0 ? extent.value2 : 45);
            panel.set('operation', editing ? editing.operation || 'join' : 'join');
            open = true;
            panel.show();
            refresh();
            return true;
        });
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
