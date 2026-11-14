/*
    3D Modeler - the Appearance panel

    Appearance > Appearance: the colour and the finish (plastic, metal,
    wood, carbon fibre, rubber, glass, a picture, ...) of the part, shown
    live while the panel is open and stored in the part document as one
    undo step on OK (appearance.js has the finishes; viewport.setAppearance
    shows them). Painted faces (Paint Faces) are kept as they are.

    Choosing a finish that suggests a colour (wood, carbon fibre, ...)
    takes that colour; the colour can be changed after it. Patterned
    finishes and pictures have a tile size (how many mm one tile covers on
    the model) and a rotation. The Image finish asks for a picture
    (options.pickImage, made smaller and kept inside the part).

    options: { stage, viewport, doc, onStatus, onClose, pickImage }
        pickImage() -> Promise of { url, name } (a data URL) or null
    returns: { start(), cancel(), isOpen() }
*/

import { createPanel } from './panel.js';
import { FINISHES, finishById, normalizeAppearance, DEFAULT_COLOR, DEFAULT_SCALE } from '../appearance.js';

export function createAppearancePanel(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let draft = null;
    let picking = false;

    const panel = createPanel(options.stage, {
        title: 'Appearance',
        rows: [
            { type: 'color', key: 'color', label: 'Colour' },
            { type: 'seg', key: 'texture', label: 'Finish', columns: 2, items: FINISHES.map(function (f) {
                return { id: f.id, label: f.label };
            }) },
            { type: 'pick', key: 'image', label: 'Picture', title: 'Choose the picture laid on the part' },
            { type: 'number', key: 'scale', label: 'Tile size', unit: 'mm', max: 5000 },
            { type: 'number', key: 'rotation', label: 'Rotation', unit: 'deg', signed: true, min: -360, max: 360, step: 15 }
        ],
        onChange: function (key, value) {
            if (!draft) {
                return;
            }
            if (key === 'texture') {
                if (value === 'image' && !draft.image) {
                    chooseImage(draft.texture); // the finish is a picture: which one
                    return;
                }
                draft.texture = value;
                const suggested = finishById(value).color;
                if (suggested) {
                    draft.color = suggested;
                    panel.set('color', suggested);
                }
            } else if (key === 'scale') {
                if (!(value >= 0.5)) {
                    return;
                }
                draft.scale = value;
            } else if (key === 'rotation') {
                if (!isFinite(value)) {
                    return;
                }
                draft.rotation = value;
            } else if (key === 'color') {
                draft.color = value;
            }
            refresh();
        },
        onAction: function (key) {
            if (key === 'image' && draft) {
                chooseImage(draft.texture);
            }
        },
        onOk: function () {
            const look = normalizeAppearance(draft);
            close();
            doc.change('Appearance', function (d) {
                if (look) {
                    d.appearance = look;
                } else {
                    delete d.appearance;
                }
            });
            options.onStatus(look ? 'Appearance: ' + finishById(look.texture).label.toLowerCase() + ', ' + look.color : 'Appearance: the default grey');
        },
        onCancel: function () {
            close();
            viewport.setAppearance(normalizeAppearance(doc.data().appearance));
        }
    });

    // Ask for a picture; `was` is the finish to go back to when none is chosen
    function chooseImage(was) {
        if (picking || !options.pickImage) {
            panel.set('texture', was);
            return;
        }
        picking = true;
        options.pickImage().then(function (img) {
            picking = false;
            if (!draft) {
                return;
            }
            if (!img) {
                panel.set('texture', draft.texture);
                return;
            }
            draft.image = img.url;
            draft.imageName = img.name;
            if (draft.texture !== 'image') {
                draft.color = '#ffffff'; // the picture in its own colours
                panel.set('color', draft.color);
                if (draft.scale === DEFAULT_SCALE) {
                    draft.scale = 100;   // a picture is usually seen larger than a pattern
                    panel.set('scale', draft.scale);
                }
            }
            draft.texture = 'image';
            panel.set('texture', 'image');
            refresh();
        }).catch(function (err) {
            picking = false;
            if (draft) {
                panel.set('texture', draft.texture);
                options.onStatus('The picture could not be used: ' + err.message);
            }
        });
    }

    function refresh() {
        const finish = finishById(draft.texture);
        const tiled = !!finish.pattern || !!finish.image;
        panel.visible('image', !!finish.image);
        panel.text('image', draft.imageName || (draft.image ? 'Picture in the part' : 'Choose Image...'), !draft.image);
        panel.visible('scale', tiled);
        panel.visible('rotation', tiled);
        panel.note(finish.image ? 'The picture is ' + (+draft.scale.toFixed(2)) + ' mm wide on the part and is saved inside it.'
            : tiled ? 'One tile of the pattern covers ' + (+draft.scale.toFixed(2)) + ' mm of the part.'
                : 'Saved with the part; assemblies and drawings show its finish.');
        viewport.setAppearance(normalizeAppearance(draft));
    }

    function close() {
        draft = null;
        panel.hide();
        if (options.onClose) {
            options.onClose();
        }
    }

    return {
        start: function () {
            const now = doc.data().appearance || {};
            draft = {
                color: now.color || DEFAULT_COLOR, texture: finishById(now.texture).id, scale: now.scale || DEFAULT_SCALE,
                rotation: now.rotation || 0, image: now.image || null, imageName: '', faces: now.faces || []
            };
            panel.set('color', draft.color);
            panel.set('texture', draft.texture);
            panel.set('scale', draft.scale);
            panel.set('rotation', draft.rotation);
            panel.ok(true);
            panel.show();
            refresh();
            options.onStatus('Appearance: pick a colour and a finish; the part shows them as you go');
        },
        cancel: function () {
            if (draft) {
                panel.hide();
                draft = null;
                viewport.setAppearance(normalizeAppearance(doc.data().appearance));
                if (options.onClose) {
                    options.onClose();
                }
            }
        },
        isOpen: function () {
            return !!draft;
        }
    };
}
