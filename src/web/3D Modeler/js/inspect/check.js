/*
    3D Modeler - Check Geometry panel

    Inspect > Check Geometry: is the part a proper solid, and will its mesh
    go through a slicer? For every solid of the part it shows whether the
    faces close up, the open edges (a face missing or a crack), the edges
    with zero thickness (the solid touching itself: non-manifold), the faces
    the mesher could not fill by itself, and what a slicer would say of the
    exported mesh. Where something is wrong a dot marks it in the view: red
    for open edges, amber for zero thickness, purple for a patched face.

    Repair... opens the Repair feature (features/repair.js), which fixes
    what can be fixed; zero thickness needs a change of the model itself.

    options: stage, viewport, kernel, onStatus(text), onRepair(), onClose()
*/

import { createPanel } from '../features/panel.js';
import { healthTable, healthy, bodyCheck, meshVerdict } from './health.js';

export function createCheckPanel(options) {
    const viewport = options.viewport;
    let open = false;
    let token = 0;

    const panel = createPanel(options.stage, {
        title: 'Check Geometry',
        okLabel: 'Repair...',
        cancelLabel: 'Close',
        rows: [
            { type: 'figure', key: 'report' }
        ],
        onOk: function () {
            close();
            options.onRepair();
        },
        onCancel: close
    });

    function run() {
        const mine = ++token;
        panel.html('report', '');
        panel.note('Checking...');
        panel.ok(false);
        options.kernel.call('check', {}).then(function (out) {
            if (mine !== token || !open) {
                return;
            }
            const bodies = out.bodies || [];
            if (!bodies.length) {
                panel.note('There is no solid to check yet.');
                return;
            }
            const columns = bodies.map(function (b, i) {
                return { title: bodies.length > 1 ? 'Solid' + (i + 1) : 'Solid', check: bodyCheck(b) };
            });
            panel.html('report', healthTable(columns));
            const markers = [];
            bodies.forEach(function (b) {
                b.open.forEach(function (at) {
                    markers.push({ at: at, kind: 'open' });
                });
                b.multiple.forEach(function (at) {
                    markers.push({ at: at, kind: 'multiple' });
                });
                (b.patched || []).forEach(function (at) {
                    if (at) {
                        markers.push({ at: at, kind: 'face' });
                    }
                });
            });
            viewport.setMarkers(markers);
            const sound = bodies.every(function (b) {
                return healthy(bodyCheck(b));
            });
            const watertight = bodies.every(function (b) {
                return b.mesh && b.mesh.watertight;
            });
            const verdicts = bodies.map(function (b, i) {
                return (bodies.length > 1 ? 'Solid' + (i + 1) + ': ' : '') + meshVerdict(b.mesh);
            }).join(' ');
            const thin = bodies.some(function (b) {
                return b.multipleCount > 0;
            });
            panel.ok(!sound);
            if (sound && watertight) {
                panel.note('No problems found. ' + verdicts);
            } else {
                panel.note((sound ? '' : 'Problems are marked in the view. ') + verdicts +
                    (thin ? ' Zero thickness (amber) needs a change of the model: make the shapes overlap or leave a gap.' : '') +
                    (sound ? '' : ' Repair... fixes what can be fixed.'), true);
            }
            options.onStatus(sound && watertight ? 'Check Geometry: no problems found' : 'Check Geometry: problems found, see the panel');
        }).catch(function (err) {
            if (mine === token && open) {
                panel.note(err.message, true);
            }
        });
    }

    function close() {
        if (!open) {
            return;
        }
        open = false;
        token++;
        panel.hide();
        viewport.setMarkers(null);
        options.onClose();
    }

    function start() {
        open = true;
        panel.show();
        run();
        return true;
    }

    return {
        start: start,
        // The model changed while the panel is open: check again
        refresh: function () {
            if (open) {
                run();
            }
        },
        isOpen: function () {
            return open;
        },
        cancel: close,
        accept: close,
        handleKey: function (event) {
            if (event.key === 'Escape') {
                close();
                return true;
            }
            return false;
        }
    };
}
