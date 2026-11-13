/*
    3D Modeler - Section View panel

    View > Section View opens this panel, for a part and for an assembly:
    Half, Quarter or Three Quarter, which origin plane cuts (XY, XZ, YZ),
    where along its axis (a slider over the model's extent, or a typed
    value) and which side stays. Quarter and Three Quarter use a second
    plane with the same settings. Everything shows at once; OK keeps the
    section on (View > End Section View takes it off), Cancel puts back what
    was there before.

    The cutting itself is the viewport's (setSection): clipping on the
    graphics card, so the model is untouched and can be orbited and picked.

    options: stage, viewport, onStatus(text), onClose(kept)
*/

import { createPanel } from '../features/panel.js';

const AXIS = { xz: 1, yz: 0, xy: 2 };
const AXIS_NAME = { xz: 'Y', yz: 'X', xy: 'Z' };

export function createSectionPanel(options) {
    const viewport = options.viewport;
    let open = false;
    let before = null;

    const planeItems = [
        { id: 'xy', label: 'XY', title: 'Cut level, across Z' },
        { id: 'xz', label: 'XZ', title: 'Cut front to back, across Y' },
        { id: 'yz', label: 'YZ', title: 'Cut side to side, across X' }
    ];
    const panel = createPanel(options.stage, {
        title: 'Section View',
        rows: [
            { type: 'seg', key: 'mode', label: 'Type', columns: 3, items: [
                { id: 'half', label: 'Half', title: 'One plane: what lies in front of it is removed' },
                { id: 'quarter', label: 'Quarter', title: 'Two planes: one quarter is left standing' },
                { id: 'threequarter', label: '3/4', title: 'Two planes: one quarter is removed' }
            ] },
            { type: 'section', label: 'Plane' },
            { type: 'seg', key: 'plane', label: 'Plane', columns: 3, items: planeItems },
            { type: 'range', key: 'offset', label: 'Position' },
            { type: 'check', key: 'flip', label: 'Keep the other side' },
            { type: 'section', label: 'Second plane' },
            { type: 'seg', key: 'plane2', label: 'Plane', columns: 3, items: planeItems },
            { type: 'range', key: 'offset2', label: 'Position' },
            { type: 'check', key: 'flip2', label: 'Keep the other side' }
        ],
        onChange: function (key) {
            if (key === 'plane' && panel.get('plane2') === panel.get('plane')) {
                panel.set('plane2', panel.get('plane') === 'yz' ? 'xz' : 'yz');
                limits('2');
            }
            if (key === 'plane2' && panel.get('plane2') === panel.get('plane')) {
                panel.set('plane2', before && before.plane2 !== panel.get('plane') ? before.plane2 : (panel.get('plane') === 'yz' ? 'xz' : 'yz'));
            }
            if (key === 'plane' || key === 'plane2') {
                limits(key === 'plane' ? '' : '2', true);
            }
            apply();
        },
        onAction: function () {},
        onOk: function () {
            close(true);
        },
        onCancel: function () {
            close(false);
        }
    });

    // The slider of a plane spans the model along that plane's axis; with
    // `centre` the position moves to the middle
    function limits(suffix, centre) {
        const key = panel.get('plane' + suffix);
        const bounds = viewport.modelBounds();
        const axis = AXIS[key];
        const lo = bounds ? bounds[0][axis] : -50;
        const hi = bounds ? bounds[1][axis] : 50;
        const pad = Math.max((hi - lo) * 0.02, 0.5);
        if (centre || !isFinite(panel.get('offset' + suffix))) {
            panel.set('offset' + suffix, +((lo + hi) / 2).toFixed(2));
        }
        panel.range('offset' + suffix, +(lo - pad).toFixed(2), +(hi + pad).toFixed(2));
    }

    function apply() {
        const mode = panel.get('mode');
        const two = mode !== 'half';
        ['plane2', 'offset2', 'flip2'].forEach(function (key) {
            panel.enable(key, two);
        });
        viewport.setSection({
            mode: mode,
            plane: panel.get('plane'),
            offset: panel.get('offset'),
            flip: !!panel.get('flip'),
            plane2: panel.get('plane2'),
            offset2: panel.get('offset2'),
            flip2: !!panel.get('flip2')
        });
        panel.note('Cut across ' + AXIS_NAME[panel.get('plane')] + ' at ' + (+panel.get('offset')).toFixed(2) + ' mm' +
            (two ? ' and across ' + AXIS_NAME[panel.get('plane2')] + ' at ' + (+panel.get('offset2')).toFixed(2) + ' mm' : '') +
            '. Drag the slider or type a position.');
    }

    // Open with a section type ("half", "quarter", "threequarter")
    function start(mode) {
        if (!viewport.modelBounds()) {
            options.onStatus('There is nothing to cut yet');
            return false;
        }
        before = viewport.sectionSpec();
        open = true;
        panel.set('mode', mode || (before.mode !== 'none' ? before.mode : 'half'));
        panel.set('plane', before.plane);
        panel.set('plane2', before.plane2);
        panel.set('flip', !!before.flip);
        panel.set('flip2', !!before.flip2);
        // Keep a position set before; otherwise start in the middle
        panel.set('offset', before.offset === null || before.offset === undefined ? NaN : before.offset);
        panel.set('offset2', before.offset2 === null || before.offset2 === undefined ? NaN : before.offset2);
        limits('', false);
        limits('2', false);
        apply();
        panel.ok(true);
        panel.show();
        return true;
    }

    function close(keep) {
        if (!open) {
            return;
        }
        open = false;
        panel.hide();
        if (!keep && before) {
            viewport.setSection(before);
        }
        options.onClose(keep);
    }

    return {
        start: start,
        isOpen: function () {
            return open;
        },
        cancel: function () {
            close(false);
        },
        // Close and keep the section as it is set
        accept: function () {
            close(true);
        },
        handleKey: function (event) {
            if (event.key === 'Escape') {
                close(false);
                return true;
            }
            if (event.key === 'Enter') {
                close(true);
                return true;
            }
            return false;
        }
    };
}
