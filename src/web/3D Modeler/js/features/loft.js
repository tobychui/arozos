/*
    3D Modeler - Loft

    3D Model > Loft, as in desktop CAD: a solid through two or more sections,
    each a closed area of its own sketch, in the order they are clicked
    (one area per sketch; another area of a sketch replaces its first, a
    click on a picked one drops it). Smooth or Ruled (straight from section
    to section). Holes in a section are left out: the loft follows each
    area's outline. Live preview.

    Document: { type: "loft", sketch (the first section's, for the model
    browser), sections: [{ sketch, region: [u, v] }], ruled, operation }
    (kernel/occt.js loftTool).

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';
import { createProfiles } from './profiles.js';

const OPERATIONS = [
    { id: 'join', label: 'Join', title: 'Add to the solid' },
    { id: 'cut', label: 'Cut', title: 'Remove from the solid' },
    { id: 'intersect', label: 'Intersect', title: 'Keep only what the solid and the loft share' },
    { id: 'new', label: 'New Solid', title: 'Make a separate solid body' }
];

export function createLoft(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let valid = false;
    let token = 0;
    let timer = null;

    const profiles = createProfiles({ viewport: viewport, kernel: options.kernel, doc: doc, onPick: refresh, multi: true });

    const panel = createPanel(options.stage, {
        title: 'Loft',
        rows: [
            { type: 'section', label: 'Sections' },
            { type: 'pick', key: 'sections', label: 'Sections', title: 'Click to start the sections over' },
            { type: 'static', key: 'order', label: 'Order' },
            { type: 'section', label: 'Behavior' },
            { type: 'seg', key: 'shape', label: 'Sides', items: [
                { id: 'smooth', label: 'Smooth', title: 'Curved sides that pass smoothly through every section' },
                { id: 'ruled', label: 'Ruled', title: 'Straight sides from one section to the next' }
            ] },
            { type: 'section', label: 'Output' },
            { type: 'seg', key: 'operation', label: 'Boolean', items: OPERATIONS, illustrate: 'operation' }
        ],
        onChange: refresh,
        onAction: function () {
            profiles.clear();
            refresh();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function draft() {
        const sections = profiles.picks();
        return {
            type: 'loft',
            sketch: sections.length ? sections[0].sketch : null,
            sections: sections,
            ruled: panel.get('shape') === 'ruled',
            operation: panel.get('operation')
        };
    }

    function refresh() {
        if (!open) {
            return;
        }
        profiles.paint();
        const sections = profiles.picks();
        panel.title(editId ? doc.feature(editId).name : 'Loft');
        panel.text('sections', sections.length ? sections.length + (sections.length === 1 ? ' section' : ' sections') : 'Pick the sections in the model', sections.length < 2);
        panel.text('order', sections.length ? sections.map(function (s) {
            const f = doc.feature(s.sketch);
            return f ? f.name : '?';
        }).join(', ') : '');
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (sections.length < 2) {
            viewport.setPreview(null);
            panel.note(sections.length ? 'Click the next section: a closed area of another sketch.'
                : 'Click a closed area of a sketch for the first section, then one of each next sketch in order.');
            return;
        }
        timer = setTimeout(function () {
            const f = draft();
            options.kernel.call('tryFeature', { document: doc.data(), feature: f, at: editId }).then(function (out) {
                if (mine === token && open) {
                    viewport.setPreview(out.mesh, f.operation);
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
        profiles.stop();
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
                old.sections = made.sections;
                old.ruled = made.ruled;
                old.operation = made.operation;
            });
        } else {
            const id = doc.newId();
            const name = doc.newName('loft');
            doc.change(name, function (d) {
                d.features.push({ id: id, type: 'loft', name: name, sketch: made.sketch, sections: made.sections, ruled: made.ruled, operation: made.operation });
            });
        }
    }

    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        return profiles.load(editing, 'Loft').then(function (loaded) {
            if (!loaded.ok) {
                options.onStatus(loaded.message);
                return false;
            }
            editId = editing ? editing.id : null;
            if (!editing) {
                profiles.clear(); // a single area is not a loft: nothing is picked for the user
            }
            panel.set('shape', editing && editing.ruled ? 'ruled' : 'smooth');
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
