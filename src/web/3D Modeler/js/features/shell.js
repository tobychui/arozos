/*
    3D Modeler - Shell

    Hollows the solid, leaving walls of one thickness, open at the faces
    picked in the model (click toggles), as Inventor's Shell: Inside keeps
    the outside of the part where it is, Outside grows the walls outwards.

    Faces are remembered by their centre and area plus the key of their
    surface (findFaces in kernel/occt.js), so a face moved by an edit
    upstream is found again. Every change is built by the kernel on a copy
    and shown as a live preview, the new inner walls in green.

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';

export function createShell(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let valid = false;
    let token = 0;
    let session = 0;
    let timer = null;

    const panel = createPanel(options.stage, {
        title: 'Shell',
        rows: [
            { type: 'section', label: 'Input Geometry' },
            { type: 'pick', key: 'faces', label: 'Remove Faces', title: 'Click to clear the selection' },
            { type: 'section', label: 'Behavior' },
            { type: 'seg', key: 'direction', label: 'Direction', items: [
                { id: 'inside', label: 'Inside', title: 'The walls grow inwards; the outside of the part stays' },
                { id: 'outside', label: 'Outside', title: 'The walls grow outwards; the inside becomes the old outside' }
            ] },
            { type: 'number', key: 'thickness', label: 'Thickness' }
        ],
        onChange: refresh,
        onAction: function () {
            viewport.clearSelection();
        },
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function refs() {
        return viewport.selection().filter(function (item) {
            return item.kind === 'face';
        }).map(function (item) {
            return { body: item.body, centre: item.centre, area: item.area };
        });
    }

    function draft() {
        return { type: 'shell', faces: refs(), thickness: panel.get('thickness'), direction: panel.get('direction') };
    }

    function refresh() {
        if (!open) {
            return;
        }
        const faces = refs();
        panel.text('faces', faces.length ? faces.length + (faces.length === 1 ? ' face' : ' faces') : 'Pick faces in the model', !faces.length);
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (!faces.length) {
            viewport.setPreview(null);
            panel.note('Click the faces to leave open, such as the top of a box. Click one again to drop it.');
            return;
        }
        if (!(panel.get('thickness') > 0)) {
            viewport.setPreview(null);
            panel.note('Enter a wall thickness larger than zero.', true);
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
            // Stored by position only
        }).then(function () {
            if (editing) {
                const old = doc.feature(editing);
                doc.change('Edit ' + old.name, function () {
                    old.faces = made.faces;
                    old.thickness = made.thickness;
                    old.direction = made.direction;
                });
            } else {
                const id = doc.newId();
                const name = doc.newName('shell');
                doc.change(name, function (d) {
                    d.features.push({ id: id, type: 'shell', name: name, faces: made.faces, thickness: made.thickness, direction: made.direction });
                });
            }
        });
    }

    // Start a new shell (featureId null; faces selected beforehand are taken
    // over) or edit one
    function start(featureId, preselected) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        if (!viewport.bodyCount()) {
            options.onStatus('Shell needs a solid: extrude a sketch first');
            return Promise.resolve(false);
        }
        editId = editing ? editing.id : null;
        open = true;
        const mine = ++session;
        panel.title(editing ? editing.name : 'Shell');
        panel.set('thickness', editing ? Number(editing.thickness) || 2 : 2);
        panel.set('direction', editing ? editing.direction || 'inside' : 'inside');
        viewport.setPickFilter({ faces: true, toggle: true });
        viewport.onSelection = refresh;
        if (editing) {
            // Where the faces are now: an edit upstream may have moved them
            options.kernel.call('faceRefs', { document: doc.data(), at: editId, faces: editing.faces || [], resolve: true }).then(function (out) {
                if (!open || mine !== session) {
                    return;
                }
                const missing = (editing.faces || []).length - viewport.selectFaces(out.refs.filter(Boolean));
                refresh();
                if (missing > 0) {
                    panel.note(missing + (missing === 1 ? ' face' : ' faces') + ' of this shell no longer exist' + (missing === 1 ? 's' : '') + '. Pick again, then OK.', true);
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
        panel.focus('thickness');
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
