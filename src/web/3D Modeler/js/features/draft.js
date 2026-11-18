/*
    3D Modeler - Draft

    3D Model > Draft, as the Face Draft of desktop CAD with a fixed plane: the
    picked faces tilt by the draft angle about where they meet a plane (an
    origin plane, a work plane or a flat face of the part), so a moulded or
    cast part comes out of its mould. The pull direction is the plane's
    normal; Flip turns it round, which leans the faces the other way.

    Faces are picked in the model (click toggles) and remembered like the
    faces of Shell; the plane is picked with the Plane button. Live preview
    of the solid as it becomes.

    Document: { type: "draft", faces: [faceRef], plane: <plane reference>,
    angle, flip } (kernel/occt.js draft).

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed),
             referenceOf(target) (a picked plane as a plane reference)
*/

import { createPanel } from './panel.js';

const PLANE_NAMES = { 'origin:xy': 'XY Plane', 'origin:xz': 'XZ Plane', 'origin:yz': 'YZ Plane', face: 'a face of the part' };

export function createDraft(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let plane = null;       // plane reference
    let waiting = false;    // waiting for the plane to be picked
    let valid = false;
    let token = 0;
    let session = 0;
    let timer = null;

    const panel = createPanel(options.stage, {
        title: 'Draft',
        rows: [
            { type: 'section', label: 'Input Geometry' },
            { type: 'pick', key: 'faces', label: 'Faces', title: 'Click to clear the selection' },
            { type: 'pick', key: 'plane', label: 'Fixed Plane', title: 'Click, then pick the plane the faces turn about' },
            { type: 'check', key: 'flip', label: 'Flip pull direction' },
            { type: 'section', label: 'Behavior' },
            { type: 'number', key: 'angle', label: 'Draft Angle', unit: 'deg', max: 88, step: 0.5 }
        ],
        onChange: refresh,
        onAction: function (key) {
            if (key === 'faces') {
                viewport.clearSelection();
            } else {
                pickPlane(!waiting);
            }
            refresh();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function planeLabel(ref) {
        if (!ref) {
            return '';
        }
        if (ref.ref === 'plane') {
            const f = doc.feature(ref.id);
            return f ? f.name : 'a deleted work plane';
        }
        return PLANE_NAMES[ref.ref] || 'a plane';
    }

    function pickPlane(on) {
        waiting = on;
        if (!on) {
            viewport.stopRefPick();
            return;
        }
        viewport.startRefPick({ planes: true }, function (pick) {
            if (pick.kind !== 'plane') {
                return;
            }
            plane = options.referenceOf(pick.target);
            pickPlane(false);
            refresh();
        });
    }

    function refs() {
        return viewport.selection().filter(function (item) {
            return item.kind === 'face';
        }).map(function (item) {
            return { body: item.body, centre: item.centre, area: item.area };
        });
    }

    function draft() {
        return { type: 'draft', faces: refs(), plane: plane, angle: panel.get('angle'), flip: !!panel.get('flip') };
    }

    function refresh() {
        if (!open) {
            return;
        }
        const faces = refs();
        panel.text('faces', faces.length ? faces.length + (faces.length === 1 ? ' face' : ' faces') : 'Pick faces in the model', !faces.length);
        panel.text('plane', waiting ? 'Pick a plane in the model...' : plane ? planeLabel(plane) : 'Click to pick the plane', !plane);
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (waiting) {
            viewport.setPreview(null);
            panel.note('Click an origin plane, a work plane or a flat face: the faces turn about where they meet it, and are pulled along its normal.');
            return;
        }
        if (!faces.length) {
            viewport.setPreview(null);
            panel.note('Click the faces to draft, such as the sides of a block. Click one again to drop it.');
            return;
        }
        if (!plane) {
            viewport.setPreview(null);
            panel.note('Click Fixed Plane, then the plane the faces turn about (often the bottom of the part).');
            return;
        }
        if (!(Math.abs(panel.get('angle')) > 0)) {
            viewport.setPreview(null);
            panel.note('Enter a draft angle.', true);
            return;
        }
        timer = setTimeout(function () {
            options.kernel.call('tryFeature', { document: doc.data(), feature: draft(), at: editId }).then(function (out) {
                if (mine === token && open) {
                    viewport.setPreview(out.meshes, 'result');
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
        session++;
        clearTimeout(timer);
        pickPlane(false);
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
        // Each face also gets the key of its surface, so it is found again
        // when an earlier feature moves it
        options.kernel.call('faceRefs', { document: doc.data(), at: editing, faces: made.faces }).then(function (out) {
            made.faces = out.refs;
        }).catch(function () {
            // stored by position only
        }).then(function () {
            if (editing) {
                const old = doc.feature(editing);
                doc.change('Edit ' + old.name, function () {
                    old.faces = made.faces;
                    old.plane = made.plane;
                    old.angle = made.angle;
                    old.flip = made.flip;
                });
            } else {
                const id = doc.newId();
                const name = doc.newName('draft');
                doc.change(name, function (d) {
                    d.features.push({ id: id, type: 'draft', name: name, faces: made.faces, plane: made.plane, angle: made.angle, flip: made.flip });
                });
            }
        });
    }

    function start(featureId, preselected) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        if (!viewport.bodyCount()) {
            options.onStatus('Draft needs a solid: extrude a sketch first');
            return Promise.resolve(false);
        }
        editId = editing ? editing.id : null;
        plane = editing ? editing.plane || null : null;
        open = true;
        const mine = ++session;
        panel.title(editing ? editing.name : 'Draft');
        panel.set('angle', editing ? Number(editing.angle) || 3 : 3);
        panel.set('flip', !!(editing && editing.flip));
        viewport.setPickFilter({ faces: true, toggle: true });
        viewport.onSelection = refresh;
        if (editing) {
            options.kernel.call('faceRefs', { document: doc.data(), at: editId, faces: editing.faces || [], resolve: true }).then(function (out) {
                if (!open || mine !== session) {
                    return;
                }
                const missing = (editing.faces || []).length - viewport.selectFaces(out.refs.filter(Boolean));
                refresh();
                if (missing > 0) {
                    panel.note(missing + (missing === 1 ? ' face' : ' faces') + ' of this draft no longer exist' + (missing === 1 ? 's' : '') + '. Pick again, then OK.', true);
                }
            }).catch(function () {
                viewport.selectFaces(editing.faces || []);
                refresh();
            });
        } else {
            viewport.selectFaces((preselected || []).filter(function (item) {
                return item.kind === 'face';
            }));
        }
        panel.show();
        refresh();
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
                if (waiting) {
                    pickPlane(false);
                    refresh();
                    return true;
                }
                close(false);
                return true;
            }
            return false;
        }
    };
}
