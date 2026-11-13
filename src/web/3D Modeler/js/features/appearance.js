/*
    3D Modeler - the Appearance panel

    View > Appearance: the colour and the finish (plastic, metal, wood,
    carbon fibre, rubber, glass, ...) of the part, shown live while the
    panel is open and stored in the part document as one undo step on OK
    (appearance.js has the finishes; viewport.setAppearance shows them).

    Choosing a finish that suggests a colour (wood, carbon fibre, ...)
    takes that colour; the colour can be changed after it. Patterned
    finishes have a pattern size: how many mm one tile of the pattern
    covers on the model.

    options: { stage, viewport, doc, onStatus, onClose }
    returns: { start(), cancel(), isOpen() }
*/

import { createPanel } from './panel.js';
import { FINISHES, finishById, normalizeAppearance, DEFAULT_COLOR, DEFAULT_SCALE } from '../appearance.js';

export function createAppearancePanel(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let draft = null;

    const panel = createPanel(options.stage, {
        title: 'Appearance',
        rows: [
            { type: 'color', key: 'color', label: 'Colour' },
            { type: 'seg', key: 'texture', label: 'Finish', columns: 2, items: FINISHES.map(function (f) {
                return { id: f.id, label: f.label };
            }) },
            { type: 'number', key: 'scale', label: 'Pattern size', unit: 'mm', max: 5000 }
        ],
        onChange: function (key, value) {
            if (!draft) {
                return;
            }
            if (key === 'texture') {
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
            } else if (key === 'color') {
                draft.color = value;
            }
            refresh();
        },
        onAction: function () {},
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

    function refresh() {
        const patterned = !!finishById(draft.texture).pattern;
        panel.visible('scale', patterned);
        panel.note(patterned ? 'One tile of the pattern covers ' + (+draft.scale.toFixed(2)) + ' mm of the part.' : 'Saved with the part; assemblies and drawings show its finish.');
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
            draft = { color: now.color || DEFAULT_COLOR, texture: finishById(now.texture).id, scale: now.scale || DEFAULT_SCALE };
            panel.set('color', draft.color);
            panel.set('texture', draft.texture);
            panel.set('scale', draft.scale);
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
