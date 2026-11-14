/*
    3D Modeler - the Paint Faces panel

    Appearance > Paint Faces: give some faces of the part a colour and a
    finish of their own (a red button face, a rubber grip). Click faces in
    the model (again to leave one out), choose the colour and the finish:
    the faces show it at once. Apply paints them and keeps the panel open
    for the next faces; OK paints them and closes, as one undo step for
    everything painted while the panel was open. Remove takes the paint off
    the selected faces, or off every face when none is selected.

    Each painted face is kept with where it is and the kind of surface it
    lies on (appearance.js faceRef), so it is found again after the part is
    rebuilt, and after an edit moved it (matchFaces). The faces take the
    tile size and rotation of the part's own look.

    options: { stage, viewport, doc, onStatus, onClose }
    returns: { start(), cancel(), isOpen() }
*/

import { createPanel } from './panel.js';
import { FINISHES, finishById, normalizeAppearance, paintFaces, clearFaces, faceRef } from '../appearance.js';

export function createPaintPanel(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let draft = null;       // the look with what was applied so far
    let open = false;
    let color = '#d64545';
    let texture = 'plain';

    const panel = createPanel(options.stage, {
        title: 'Paint Faces',
        rows: [
            { type: 'pick', key: 'faces', label: 'Faces', title: 'Click faces in the model; click one again to leave it out' },
            { type: 'color', key: 'color', label: 'Colour' },
            { type: 'seg', key: 'texture', label: 'Finish', columns: 2, items: FINISHES.filter(function (f) {
                return !f.image;
            }).map(function (f) {
                return { id: f.id, label: f.label };
            }) },
            { type: 'pick', key: 'clear', label: 'Remove', title: 'Take the paint off the selected faces, or off every painted face when none is selected' }
        ],
        onChange: function (key, value) {
            if (!open) {
                return;
            }
            if (key === 'color') {
                color = value;
            } else if (key === 'texture') {
                texture = value;
                const suggested = finishById(value).color;
                if (suggested) {
                    color = suggested;
                    panel.set('color', color);
                }
            }
            show();
        },
        onAction: function (key) {
            if (key === 'clear') {
                remove();
            } else if (key === 'faces') {
                options.onStatus('Paint Faces: click faces in the model');
            }
        },
        onApply: function () {
            const n = apply();
            options.onStatus(n ? 'Painted ' + n + (n === 1 ? ' face' : ' faces') + '; pick the next ones or OK' : 'Pick the faces to paint first');
        },
        onOk: function () {
            apply();
            const look = normalizeAppearance(draft);
            const before = JSON.stringify(normalizeAppearance(doc.data().appearance));
            close();
            if (JSON.stringify(look) === before) {
                return;
            }
            doc.change('Paint Faces', function (d) {
                if (look) {
                    d.appearance = look;
                } else {
                    delete d.appearance;
                }
            });
            const n = look && look.faces ? look.faces.length : 0;
            options.onStatus(n ? n + (n === 1 ? ' face has' : ' faces have') + ' a look of their own' : 'No face has a look of its own');
        },
        onCancel: function () {
            close();
        }
    });

    // The faces selected now, as references
    function selectedRefs() {
        return viewport.selection().filter(function (item) {
            return item.kind === 'face';
        }).map(function (item) {
            const info = viewport.faceInfo(item);
            return info && info.centre ? faceRef(info, item.body) : null;
        }).filter(Boolean);
    }

    // Show the part as it would be: what was applied, and the selected
    // faces in the colour and finish chosen now
    function show() {
        const refs = selectedRefs();
        const n = refs.length;
        panel.text('faces', n ? n + (n === 1 ? ' face' : ' faces') : 'Click faces', !n);
        panel.text('clear', n ? 'Remove from ' + (n === 1 ? 'the face' : n + ' faces') : 'Remove from all faces', false);
        const painted = draft && draft.faces ? draft.faces.length : 0;
        panel.note(painted ? painted + (painted === 1 ? ' face is' : ' faces are') + ' painted. Apply paints the selected faces and keeps this open.'
            : 'Apply paints the selected faces and keeps this open for the next ones.');
        viewport.setAppearance(n ? paintFaces(draft, refs, color, texture) : draft);
    }

    function apply() {
        const refs = selectedRefs();
        if (!refs.length) {
            return 0;
        }
        draft = paintFaces(draft, refs, color, texture);
        viewport.clearSelection();
        show();
        return refs.length;
    }

    function remove() {
        const refs = selectedRefs();
        const had = draft && draft.faces ? draft.faces.length : 0;
        draft = clearFaces(draft, refs.length ? refs : null);
        const left = draft && draft.faces ? draft.faces.length : 0;
        viewport.clearSelection();
        show();
        options.onStatus(had === left ? 'Those faces had no paint of their own' : 'Paint removed from ' + (had - left) + (had - left === 1 ? ' face' : ' faces'));
    }

    function close() {
        if (!open) {
            return;
        }
        open = false;
        draft = null;
        panel.hide();
        viewport.onSelection = null;
        viewport.setPickFilter(null);
        viewport.clearSelection();
        viewport.setAppearance(normalizeAppearance(doc.data().appearance));
        if (options.onClose) {
            options.onClose();
        }
    }

    return {
        start: function () {
            if (!viewport.bodyCount()) {
                options.onStatus('Paint Faces needs a solid: extrude a sketch first');
                return false;
            }
            const preselected = viewport.selection();
            draft = normalizeAppearance(doc.data().appearance);
            open = true;
            panel.set('color', color);
            panel.set('texture', texture);
            panel.ok(true);
            viewport.setPickFilter({ faces: true, toggle: true });
            viewport.onSelection = show;
            // Faces picked before the command are taken over
            const faces = preselected.filter(function (item) {
                return item.kind === 'face';
            }).map(function (item) {
                return viewport.faceInfo(item) ? Object.assign({ body: item.body }, viewport.faceInfo(item)) : null;
            }).filter(Boolean);
            if (faces.length) {
                viewport.selectFaces(faces);
            } else {
                viewport.clearSelection();
            }
            panel.show();
            show();
            options.onStatus('Paint Faces: click the faces, choose a colour and a finish, then Apply or OK');
            return true;
        },
        cancel: close,
        isOpen: function () {
            return open;
        }
    };
}
