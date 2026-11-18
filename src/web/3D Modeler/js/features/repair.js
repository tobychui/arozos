/*
    3D Modeler - Repair

    3D Model > Repair: a feature in the history that puts the solid through
    the kernel's healing (heal.js): faces fixed one by one, slivers thinner
    than the tolerance dropped, the faces sewn back into closed shells and
    solids, oriented, coplanar faces merged. The result is only taken when it
    is better than what went in and holds the same volume, so a Repair on a
    sound solid changes nothing.

    Being a feature, it runs again on every rebuild: an edit upstream that
    breaks the solid again is repaired again. The panel shows a live check
    of the solid before and after, and the repaired solid as a preview.

    options: stage, viewport, kernel, doc, onStatus(text), onClose(committed)
*/

import { createPanel } from './panel.js';
import { healthTable, healthy } from '../inspect/health.js';

const DEFAULT_TOLERANCE = 0.001;

export function createRepair(options) {
    const viewport = options.viewport;
    const doc = options.doc;
    let open = false;
    let editId = null;
    let valid = false;
    let token = 0;
    let timer = null;

    const panel = createPanel(options.stage, {
        title: 'Repair',
        rows: [
            { type: 'section', label: 'Check' },
            { type: 'figure', key: 'report' },
            { type: 'section', label: 'Options' },
            { type: 'number', key: 'tolerance', label: 'Tolerance', unit: 'mm', step: 0.001 }
        ],
        onChange: refresh,
        onOk: commit,
        onCancel: function () {
            close(false);
        }
    });

    function tolerance() {
        return Number(panel.get('tolerance'));
    }

    function refresh() {
        if (!open) {
            return;
        }
        clearTimeout(timer);
        const mine = ++token;
        valid = false;
        panel.ok(false);
        if (!(tolerance() > 0) || tolerance() > 1) {
            viewport.setPreview(null);
            panel.note('The tolerance must be larger than zero and at most 1 mm.', true);
            return;
        }
        panel.note('Checking the solid...');
        timer = setTimeout(function () {
            options.kernel.call('tryFeature', { document: doc.data(), feature: { type: 'repair', tolerance: tolerance() }, at: editId }).then(function (out) {
                if (mine !== token || !open) {
                    return;
                }
                const reports = out.reports || [];
                const columns = [];
                reports.forEach(function (r, i) {
                    const name = reports.length > 1 ? 'Solid' + (i + 1) + ' ' : '';
                    columns.push({ title: name + 'now', check: r.before }, { title: name + 'repaired', check: r.after });
                });
                panel.html('report', healthTable(columns));
                const changed = reports.some(function (r) {
                    return r.changed;
                });
                viewport.setPreview(changed ? out.meshes : null, 'result');
                valid = true;
                panel.ok(true);
                const left = reports.filter(function (r) {
                    return !healthy(r.after);
                });
                const done = reports.map(function (r) {
                    return r.notes.join(', ');
                }).filter(Boolean).join('; ');
                if (!changed && !left.length) {
                    panel.note('Nothing to repair: the solid is closed and meshes cleanly. OK still adds Repair, which then fixes the solid if a later edit breaks it.');
                } else if (!changed) {
                    panel.note('This could not be repaired here' + (done ? ': ' + done : '') + '. Try a larger tolerance, or change the features that made it.', true);
                } else {
                    panel.note('Repaired: ' + (done || 'rebuilt') + (left.length ? '. Some problems are left (see the table).' : '.'), !!left.length);
                }
            }).catch(function (err) {
                if (mine === token && open) {
                    viewport.setPreview(null);
                    panel.html('report', '');
                    panel.note(err.message, true);
                }
            });
        }, 80);
    }

    function close(committed) {
        if (!open) {
            return;
        }
        open = false;
        token++;
        clearTimeout(timer);
        panel.hide();
        viewport.setPreview(null);
        options.onClose(committed);
    }

    function commit() {
        if (!open || !valid) {
            return;
        }
        const value = tolerance();
        const editing = editId;
        close(true);
        if (editing) {
            const old = doc.feature(editing);
            doc.change('Edit ' + old.name, function () {
                old.tolerance = value;
            });
        } else {
            const id = doc.newId();
            const name = doc.newName('repair');
            doc.change(name, function (d) {
                d.features.push({ id: id, type: 'repair', name: name, tolerance: value });
            });
        }
    }

    // A new Repair (featureId null) or editing one
    function start(featureId) {
        close(false);
        const editing = featureId ? doc.feature(featureId) : null;
        if (!viewport.bodyCount()) {
            options.onStatus('Repair needs a solid: there is nothing to repair yet');
            return Promise.resolve(false);
        }
        editId = editing ? editing.id : null;
        open = true;
        panel.title(editing ? editing.name : 'Repair');
        panel.set('tolerance', editing && Number(editing.tolerance) > 0 ? Number(editing.tolerance) : DEFAULT_TOLERANCE);
        panel.html('report', '');
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
                close(false);
                return true;
            }
            return false;
        }
    };
}
