/*
    3D Modeler - model browser

    The tree at the left: the part, its solid bodies, the origin, then the
    feature history in build order and End of Part. A sketch that a feature
    was built from sits under that feature (collapsed by default); a sketch
    nothing uses yet stands on its own.

    The tree is redrawn from the document and the last rebuild report; it
    keeps no model state of its own beyond what is expanded, which feature is
    selected and which sketch is being edited.

    handlers:
        onPlaneHover(key | null), onPlaneClick(key)
        onFeatureSelect(id | null)
        onFeatureAction(action, id)     "rename" (with a third argument, the
                                        new name), "suppress", "unsuppress",
                                        "delete", "edit", "editsketch"
*/

import { icon, openMenu } from './ui.js';

const FEATURE_ICONS = { sketch: 'sketch', extrude: 'extrude', revolve: 'revolve', shell: 'shell', pattern: 'rectpattern', mirror: 'mirror', hole: 'hole', fillet: 'fillet', chamfer: 'chamfer', plane: 'plane', import: 'import' };
const ORIGIN_ITEMS = [
    { plane: 'yz', label: 'YZ Plane', icon: 'plane' },
    { plane: 'xz', label: 'XZ Plane', icon: 'plane' },
    { plane: 'xy', label: 'XY Plane', icon: 'plane' },
    { label: 'X Axis', icon: 'axis' },
    { label: 'Y Axis', icon: 'axis' },
    { label: 'Z Axis', icon: 'axis' },
    { label: 'Center Point', icon: 'point' }
];

export function createBrowser(el, doc, handlers) {
    const expanded = { root: true, bodies: false, origin: true };
    let selected = null;
    let renaming = null;
    let editing = null;     // id of the sketch open in the sketcher
    let rollback = null;    // features after this one are rolled back (not shown)
    let report = {};
    let bodyCount = 0;

    // A row; with opts.group it can be expanded and the element that takes
    // its children is returned, otherwise the row itself.
    function row(parent, depth, iconName, label, opts) {
        opts = opts || {};
        const node = document.createElement('div');
        node.className = 'node' + (opts.cls ? ' ' + opts.cls : '');
        node.style.paddingLeft = 6 + depth * 14 + 'px';
        node.innerHTML = icon('caret', 'twist' + (opts.group ? '' : ' leaf')) + icon(iconName, opts.iconClass || '');
        const text = document.createElement('span');
        text.className = 'node-label';
        text.textContent = label;
        node.appendChild(text);
        parent.appendChild(node);
        if (!opts.group) {
            return node;
        }
        const twist = node.querySelector('.twist');
        twist.classList.toggle('open', !!expanded[opts.group]);
        twist.addEventListener('click', function (event) {
            event.stopPropagation();
            expanded[opts.group] = !expanded[opts.group];
            render();
        });
        const children = document.createElement('div');
        children.className = 'children' + (expanded[opts.group] ? ' open' : '');
        parent.appendChild(children);
        children.row = node;
        return children;
    }

    function menuFor(feature) {
        const entries = [];
        if (feature.type === 'sketch') {
            entries.push({ id: 'edit', label: 'Edit Sketch' });
        } else {
            entries.push({ id: 'edit', label: 'Edit Feature' });
            if (doc.feature(feature.sketch)) {
                entries.push({ id: 'editsketch', label: 'Edit Sketch' });
            }
        }
        if (feature.type === 'plane') {
            // A work plane in front of the model would catch the clicks
            entries.push(feature.hidden ? { id: 'show', label: 'Show' } : { id: 'hide', label: 'Hide' });
        }
        entries.push({ id: 'rename', label: 'Rename', hint: 'F2' });
        entries.push(feature.suppressed ? { id: 'unsuppress', label: 'Unsuppress' } : { id: 'suppress', label: 'Suppress' });
        entries.push({ id: 'delete', label: 'Delete', hint: 'Del' });
        return entries;
    }

    function rolledBack(feature) {
        if (!rollback) {
            return false;
        }
        const list = doc.features();
        const at = list.findIndex(function (f) {
            return f.id === rollback;
        });
        return at >= 0 && list.indexOf(feature) > at;
    }

    function featureRow(parent, depth, feature, child) {
        const status = report[feature.id] || {};
        const cls = (feature.id === selected ? 'selected ' : '') + (feature.suppressed ? 'suppressed ' : '') +
            (status.status === 'error' ? 'failed ' : '') + (feature.id === editing ? 'editing ' : '') +
            (rolledBack(feature) ? 'rolled ' : '') + (feature.type === 'plane' && feature.hidden ? 'hiddenitem' : '');
        const group = child ? 'f:' + feature.id : null;
        const made = row(parent, depth, FEATURE_ICONS[feature.type] || 'part', feature.name, { cls: cls, group: group });
        const node = group ? made.row : made;
        node.dataset.feature = feature.id;
        if (status.status === 'error') {
            const mark = document.createElement('span');
            mark.className = 'node-mark';
            mark.innerHTML = icon('warn');
            mark.title = status.message || 'This feature could not be built';
            node.appendChild(mark);
            node.title = mark.title;
        }
        node.addEventListener('click', function () {
            select(feature.id);
        });
        node.addEventListener('dblclick', function () {
            handlers.onFeatureAction('edit', feature.id);
        });
        node.addEventListener('contextmenu', function (event) {
            event.preventDefault();
            select(feature.id);
            openMenu({ x: event.clientX, y: event.clientY }, menuFor(feature), function (action) {
                if (action === 'rename') {
                    startRename(feature.id);
                } else {
                    handlers.onFeatureAction(action, feature.id);
                }
            });
        });
        if (renaming === feature.id) {
            renameField(node, feature);
        }
        if (child) {
            featureRow(made, depth + 1, child, null);
        }
    }

    function renameField(node, feature) {
        const label = node.querySelector('.node-label');
        const input = document.createElement('input');
        input.className = 'node-rename';
        input.value = feature.name;
        input.maxLength = 80;
        label.replaceWith(input);
        let finished = false;
        const finish = function (commit) {
            if (finished) {
                return;
            }
            finished = true;
            renaming = null;
            const value = input.value.trim();
            if (commit && value && value !== feature.name) {
                handlers.onFeatureAction('rename', feature.id, value);
            }
            render();
        };
        input.addEventListener('keydown', function (event) {
            event.stopPropagation();
            if (event.key === 'Enter') {
                finish(true);
            } else if (event.key === 'Escape') {
                finish(false);
            }
        });
        input.addEventListener('blur', function () {
            finish(true);
        });
        input.addEventListener('click', function (event) {
            event.stopPropagation();
        });
        input.addEventListener('dblclick', function (event) {
            event.stopPropagation();
        });
        setTimeout(function () {
            input.focus();
            input.select();
        }, 0);
    }

    function render() {
        el.innerHTML = '';
        const root = row(el, 0, 'part', doc.name, { group: 'root' });
        const bodies = row(root, 1, 'folder', 'Solid Bodies (' + bodyCount + ')', { group: 'bodies' });
        for (let i = 0; i < bodyCount; i++) {
            row(bodies, 2, 'part', 'Solid' + (i + 1));
        }
        const origin = row(root, 1, 'folder', 'Origin', { group: 'origin' });
        ORIGIN_ITEMS.forEach(function (item) {
            const node = row(origin, 2, item.icon, item.label, { iconClass: item.plane ? 'ic-plane-sw' : '' });
            if (!item.plane) {
                return;
            }
            node.dataset.plane = item.plane;
            node.addEventListener('mouseenter', function () {
                handlers.onPlaneHover(item.plane);
            });
            node.addEventListener('mouseleave', function () {
                handlers.onPlaneHover(null);
            });
            node.addEventListener('click', function () {
                handlers.onPlaneClick(item.plane);
            });
        });

        // A sketch belongs under the first feature built from it
        const features = doc.features();
        const consumedBy = {};
        features.forEach(function (feature) {
            if (feature.sketch && !consumedBy[feature.sketch] && doc.feature(feature.sketch)) {
                consumedBy[feature.sketch] = feature.id;
            }
        });
        // The sketch being edited is shown opened up, so it can be seen in the tree
        if (editing && consumedBy[editing]) {
            expanded['f:' + consumedBy[editing]] = true;
        }
        if (selected && consumedBy[selected]) {
            expanded['f:' + consumedBy[selected]] = true;
        }
        features.forEach(function (feature) {
            if (consumedBy[feature.id]) {
                return;
            }
            const child = feature.sketch && consumedBy[feature.sketch] === feature.id ? doc.feature(feature.sketch) : null;
            featureRow(root, 1, feature, child);
        });
        row(root, 1, 'end', 'End of Part', { iconClass: 'ic-bad' });
    }

    function select(id) {
        if (id !== null && !doc.feature(id)) {
            id = null;
        }
        if (selected === id) {
            return;
        }
        selected = id;
        render();
        handlers.onFeatureSelect(id);
    }

    function startRename(id) {
        if (doc.feature(id)) {
            renaming = id;
            render();
        }
    }

    el.addEventListener('click', function (event) {
        if (event.target === el) {
            select(null);
        }
    });

    return {
        // Redraw; pass the rebuild report and body count when they changed
        render: function (newReport, newBodyCount) {
            if (newReport) {
                report = newReport;
            }
            if (typeof newBodyCount === 'number') {
                bodyCount = newBodyCount;
            }
            if (selected && !doc.feature(selected)) {
                selected = null;
            }
            render();
        },
        selected: function () {
            return selected;
        },
        select: select,
        startRename: startRename,
        // Mark the sketch that is open in the sketcher (null for none)
        setEditing: function (id) {
            editing = id;
            render();
        },
        // Grey out the features after this one while the model is rolled back
        setRollback: function (id) {
            rollback = id;
            render();
        },
        setHotPlane: function (key) {
            el.querySelectorAll('.node[data-plane]').forEach(function (n) {
                n.classList.toggle('hot', n.dataset.plane === key);
            });
        }
    };
}
