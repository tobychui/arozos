/*
    3D Modeler - the part's material

    Appearance > Material: what the part is made of, for its mass. The
    document keeps { id, density } (g/cm3) under `material`; Inspect > Mass
    Properties states the mass from it. A list of common printing and
    machining materials, or Custom with a density typed in.

    The list and the pure helpers are in ../materials.js (the document
    module uses them too); this is the panel.

    options: { stage, doc, onStatus, onClose }
*/

import { createPanel } from './panel.js';
import { MATERIALS, materialById, normalizeMaterial, massOf } from '../materials.js';

export { massOf };

export function createMaterialPanel(options) {
    const doc = options.doc;
    let open = false;

    const panel = createPanel(options.stage, {
        title: 'Material',
        rows: [
            { type: 'select', key: 'material', label: 'Material', items: [{ id: 'none', label: 'Not set' }].concat(MATERIALS.map(function (m) {
                return { id: m.id, label: m.id === 'custom' ? 'Custom...' : m.label + ' (' + m.density + ')' };
            })) },
            { type: 'number', key: 'density', label: 'Density', unit: 'g/cm3', step: 0.01, max: 30 }
        ],
        onChange: refresh,
        onOk: function () {
            const chosen = draft();
            close();
            doc.change('Material', function (d) {
                if (chosen) {
                    d.material = chosen;
                } else {
                    delete d.material;
                }
            }, { visual: true });
            options.onStatus(chosen ? 'Material: ' + massOf(1000, chosen).material + '. Inspect > Mass Properties shows the mass' : 'No material set');
        },
        onCancel: close
    });

    function draft() {
        const id = panel.get('material');
        if (id === 'none') {
            return null;
        }
        return normalizeMaterial({ id: id, density: panel.get('density') });
    }

    function refresh() {
        const id = panel.get('material');
        const known = materialById(id);
        panel.visible('density', id === 'custom');
        if (known && id !== 'custom') {
            panel.set('density', known.density);
        }
        const chosen = draft();
        panel.ok(id === 'none' || !!chosen);
        panel.note(id === 'none' ? 'Mass Properties then gives the mass in PLA as an example.'
            : chosen ? 'Mass Properties gives the mass of the part in ' + massOf(1000, chosen).material + '.' : 'Enter a density above 0 and at most 30 g/cm3.', id !== 'none' && !chosen);
    }

    function close() {
        if (!open) {
            return;
        }
        open = false;
        panel.hide();
        if (options.onClose) {
            options.onClose();
        }
    }

    return {
        start: function () {
            const now = normalizeMaterial(doc.data().material);
            panel.set('material', now ? now.id : 'none');
            panel.set('density', now ? now.density : 1);
            open = true;
            panel.show();
            refresh();
            options.onStatus('Material: choose what the part is made of, for its mass');
        },
        cancel: close,
        isOpen: function () {
            return open;
        }
    };
}
