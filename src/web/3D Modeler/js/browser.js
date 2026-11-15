/*
    3D Modeler - model browser

    The tree at the left: the part, its solid bodies, the origin, then the
    feature history in build order and End of Part. A sketch that a feature
    was built from sits under that feature (collapsed by default), unless it
    is shared (then it keeps its own row, so more features can use it); a
    sketch nothing uses yet stands on its own.

    PROPOSAL.md 14.8, 14.26: End of Part can be dragged up the tree (the
    features below it are not built, and new features go where it is), and
    feature rows can be dragged to another place in the history: the line
    where the row would land turns red, with the reason in the status bar,
    when a feature would come before something it is built from. Sketches,
    work features and solid bodies carry an eye that hides them in the view
    without rebuilding anything.

    The tree is redrawn from the document and the last rebuild report; it
    keeps no model state of its own beyond what is expanded, which feature is
    selected and which sketch is being edited.

    handlers:
        onPlaneHover(key | null), onPlaneClick(key)
        onOriginClick({ axis } | { point: true })   an origin axis or the centre point
        onFeatureSelect(id | null)
        onFeatureAction(action, id)     "rename" (with a third argument, the
                                        new name), "suppress", "unsuppress",
                                        "delete", "edit", "editsketch", "hide",
                                        "show", "share", "unshare", "endhere"
        onMoveFeature(id, beforeId | null, built)  a row dropped somewhere
                                        else; built: just above End of Part
        onMoveEnd(afterId | "" | null)  End of Part dropped ("" above every
                                        feature, null at the bottom)
        onBodyVisibility(index, hidden) the eye of a solid body
        onHint(text)                    what a drag will do, for the status bar
*/

import { icon, openMenu } from './ui.js';

const FEATURE_ICONS = { sketch: 'sketch', extrude: 'extrude', revolve: 'revolve', shell: 'shell', pattern: 'rectpattern', mirror: 'mirror', hole: 'hole', fillet: 'fillet', chamfer: 'chamfer', plane: 'plane', axis: 'axis', point: 'point', import: 'import' };
const WORK_TYPES = ['plane', 'axis', 'point'];
const ORIGIN_ITEMS = [
    { plane: 'yz', label: 'YZ Plane', icon: 'plane' },
    { plane: 'xz', label: 'XZ Plane', icon: 'plane' },
    { plane: 'xy', label: 'XY Plane', icon: 'plane' },
    { axis: 'x', label: 'X Axis', icon: 'axis' },
    { axis: 'y', label: 'Y Axis', icon: 'axis' },
    { axis: 'z', label: 'Z Axis', icon: 'axis' },
    { point: true, label: 'Center Point', icon: 'point' }
];

export function createBrowser(el, doc, handlers) {
    const expanded = { root: true, bodies: false, origin: true };
    let selected = null;
    let renaming = null;
    let editing = null;     // id of the sketch open in the sketcher
    let rollback = null;    // features after this one are rolled back (not shown)
    let report = {};
    let bodyCount = 0;
    let consumed = new Set();   // sketches some feature is built from
    let slots = [];             // the history rows in tree order, for drops
    let dragging = null;        // { kind: "feature", id } | { kind: "end" }
    let dropped = false;        // the drag ended in a drop (its message stays)

    function hint(text) {
        if (handlers.onHint) {
            handlers.onHint(text);
        }
    }

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

    // Drawn in the view (so it can be hidden): work features, and sketches
    // no feature has taken (or that are shared)
    function showable(feature) {
        return WORK_TYPES.indexOf(feature.type) >= 0 || (feature.type === 'sketch' && (!consumed.has(feature.id) || !!feature.shared));
    }

    function menuFor(feature, topLevel) {
        const entries = [];
        if (feature.type === 'sketch') {
            entries.push({ id: 'edit', label: 'Edit Sketch' });
        } else {
            entries.push({ id: 'edit', label: 'Edit Feature' });
            if (doc.feature(feature.sketch)) {
                entries.push({ id: 'editsketch', label: 'Edit Sketch' });
            }
        }
        if (showable(feature)) {
            // A work plane in front of the model would catch the clicks
            entries.push(feature.hidden ? { id: 'show', label: 'Show' } : { id: 'hide', label: 'Hide' });
        }
        if (feature.type === 'sketch' && consumed.has(feature.id)) {
            // Shared: offered as a profile again for more features
            entries.push(feature.shared ? { id: 'unshare', label: 'Stop Sharing' } : { id: 'share', label: 'Share Sketch' });
        }
        if (topLevel && doc.features().indexOf(feature) !== doc.endIndex()) {
            entries.push({ id: 'endhere', label: 'Move End of Part Here' });
        }
        entries.push({ id: 'rename', label: 'Rename', hint: 'F2' });
        entries.push(feature.suppressed ? { id: 'unsuppress', label: 'Unsuppress' } : { id: 'suppress', label: 'Suppress' });
        entries.push({ id: 'delete', label: 'Delete', hint: 'Del' });
        return entries;
    }

    // Not built now: below End of Part, or after the sketch being edited
    function rolledBack(feature) {
        const list = doc.features();
        const i = list.indexOf(feature);
        if (i > doc.endIndex()) {
            return true;
        }
        if (!rollback) {
            return false;
        }
        const at = list.findIndex(function (f) {
            return f.id === rollback;
        });
        return at >= 0 && i > at;
    }

    // The eye at the end of a row: hide it in the view or show it again
    function eye(node, hidden, what, onToggle) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'node-eye' + (hidden ? ' off' : '');
        button.title = (hidden ? 'Show ' : 'Hide ') + what + ' in the view';
        button.innerHTML = icon(hidden ? 'hide' : 'show');
        button.addEventListener('click', function (event) {
            event.stopPropagation();
            onToggle(!hidden);
        });
        button.addEventListener('dblclick', function (event) {
            event.stopPropagation();
        });
        button.addEventListener('mousedown', function (event) {
            event.stopPropagation();
        });
        node.appendChild(button);
    }

    /* ---- dragging rows: reorder the history, move End of Part ---- */

    function clearDrop() {
        el.querySelectorAll('.drop-before, .drop-after, .drop-no').forEach(function (n) {
            n.classList.remove('drop-before', 'drop-after', 'drop-no');
        });
    }

    // What a drop in the gap before slot `g` does (g = slots.length: at
    // the bottom). For a feature: { beforeId, built }, built when the gap
    // is just above End of Part (the feature lands among the built ones).
    // For End of Part: { afterId }.
    function dropAt(g) {
        let next = null;
        for (let k = g; k < slots.length; k++) {
            if (slots[k].kind === 'row') {
                next = slots[k];
                break;
            }
        }
        if (dragging.kind === 'end') {
            if (!next) {
                return { afterId: null };
            }
            const list = doc.features();
            const i = list.findIndex(function (f) {
                return f.id === next.first;
            });
            return { afterId: i > 0 ? list[i - 1].id : '' };
        }
        const aboveEnd = slots[g] && slots[g].kind === 'end';
        return { beforeId: next ? next.first : null, built: aboveEnd };
    }

    // Where over a row the pointer is: the gap before or after its slot
    function gapOf(node, slot, event) {
        const r = node.getBoundingClientRect();
        return event.clientY < r.top + r.height / 2 ? slot : slot + 1;
    }

    function dropTarget(node, slot) {
        node.addEventListener('dragover', function (event) {
            if (!dragging) {
                return;
            }
            event.preventDefault();
            const g = gapOf(node, slot, event);
            clearDrop();
            node.classList.add(g === slot ? 'drop-before' : 'drop-after');
            if (dragging.kind === 'feature') {
                const to = dropAt(g);
                const reason = doc.canMove(dragging.id, to.beforeId);
                node.classList.toggle('drop-no', !!reason);
                event.dataTransfer.dropEffect = reason ? 'none' : 'move';
                hint(reason ? 'Cannot go here: ' + reason : (to.built || !isAfterEnd(to.beforeId) ? 'Drop to build it here' : 'Drop here; below End of Part it is not built'));
            } else {
                event.dataTransfer.dropEffect = 'move';
                hint('Drop End of Part here: the features below it are not built, and new features are added here');
            }
        });
        node.addEventListener('dragleave', function (event) {
            if (!node.contains(event.relatedTarget)) {
                node.classList.remove('drop-before', 'drop-after', 'drop-no');
            }
        });
        node.addEventListener('drop', function (event) {
            event.preventDefault();
            const what = dragging;
            clearDrop();
            if (!what) {
                return;
            }
            const to = dropAt(gapOf(node, slot, event));
            dragging = null;
            dropped = true;
            if (what.kind === 'end') {
                handlers.onMoveEnd(to.afterId);
            } else {
                handlers.onMoveFeature(what.id, to.beforeId, to.built);
            }
        });
    }

    // Would a feature placed before `beforeId` be below End of Part?
    function isAfterEnd(beforeId) {
        const end = doc.endIndex();
        const list = doc.features();
        if (beforeId === null) {
            return end < list.length - 1;
        }
        const i = list.findIndex(function (f) {
            return f.id === beforeId;
        });
        return i > end;
    }

    function draggable(node, what) {
        node.draggable = true;
        node.addEventListener('dragstart', function (event) {
            if (renaming) {
                event.preventDefault();
                return;
            }
            dragging = what;
            dropped = false;
            node.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            try {
                event.dataTransfer.setData('text/plain', what.id || 'end-of-part');
            } catch (e) {
                // the drag still works without the data
            }
            hint(what.kind === 'end' ? 'Drag End of Part up to see the part as it was at that step'
                : 'Drop the feature where it should be built; it must stay below what it is built from');
        });
        node.addEventListener('dragend', function () {
            dragging = null;
            node.classList.remove('dragging');
            clearDrop();
            if (!dropped) {
                hint('');
            }
        });
    }

    function featureRow(parent, depth, feature, child, slot) {
        const status = report[feature.id] || {};
        const cls = (feature.id === selected ? 'selected ' : '') + (feature.suppressed ? 'suppressed ' : '') +
            (status.status === 'error' ? 'failed ' : '') + (feature.id === editing ? 'editing ' : '') +
            (rolledBack(feature) ? 'rolled ' : '') + (showable(feature) && feature.hidden ? 'hiddenitem' : '');
        const group = child ? 'f:' + feature.id : null;
        // A threaded hole shows its thread (a note: threads are not modelled)
        const label = feature.type === 'hole' && feature.thread && feature.thread.designation ? feature.name + '  ' + feature.thread.designation : feature.name;
        const made = row(parent, depth, FEATURE_ICONS[feature.type] || 'part', label, { cls: cls, group: group });
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
        if (feature.type === 'sketch' && feature.shared) {
            const tail = document.createElement('span');
            tail.className = 'node-tail';
            tail.textContent = 'shared';
            tail.title = 'A shared sketch: it can be used by more features';
            node.appendChild(tail);
        }
        if (showable(feature)) {
            eye(node, !!feature.hidden, feature.name, function (hide) {
                handlers.onFeatureAction(hide ? 'hide' : 'show', feature.id);
            });
        }
        if (slot !== undefined) {
            // A history row: it can be dragged to another place
            draggable(node, { kind: 'feature', id: feature.id });
            dropTarget(node, slot);
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
            openMenu({ x: event.clientX, y: event.clientY }, menuFor(feature, slot !== undefined), function (action) {
                if (action === 'rename') {
                    startRename(feature.id);
                } else {
                    handlers.onFeatureAction(action, feature.id);
                }
            });
        });
        if (renaming === feature.id) {
            node.draggable = false;
            renameField(node, feature);
        }
        if (child) {
            featureRow(made, depth + 1, child, null);
        }
    }

    function endRow(parent, slot) {
        const list = doc.features();
        const at = doc.endIndex();
        const moved = at < list.length - 1;
        const node = row(parent, 1, 'end', 'End of Part', { iconClass: 'ic-bad', cls: 'end-row' + (moved ? ' moved' : '') });
        node.title = moved ? 'The features below are not built. Drag End of Part down (or right-click > Move to End) to build them again.'
            : 'Drag up the tree to see the part as it was; new features are added where End of Part is';
        draggable(node, { kind: 'end' });
        dropTarget(node, slot);
        node.addEventListener('contextmenu', function (event) {
            event.preventDefault();
            const entries = [];
            if (moved) {
                entries.push({ id: 'bottom', label: 'Move to End' });
            }
            if (at >= 0) {
                entries.push({ id: 'top', label: 'Move to Top' });
            }
            if (entries.length) {
                openMenu({ x: event.clientX, y: event.clientY }, entries, function (action) {
                    handlers.onMoveEnd(action === 'top' ? '' : null);
                });
            }
        });
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
        const hiddenBodies = doc.data().hiddenBodies || [];
        for (let i = 0; i < bodyCount; i++) {
            const off = hiddenBodies.indexOf(i) >= 0;
            const node = row(bodies, 2, 'part', 'Solid' + (i + 1), { cls: off ? 'hiddenitem' : '' });
            eye(node, off, 'Solid' + (i + 1), function (hide) {
                if (handlers.onBodyVisibility) {
                    handlers.onBodyVisibility(i, hide);
                }
            });
        }
        const origin = row(root, 1, 'folder', 'Origin', { group: 'origin' });
        ORIGIN_ITEMS.forEach(function (item) {
            const node = row(origin, 2, item.icon, item.label, { iconClass: item.plane ? 'ic-plane-sw' : '' });
            if (!item.plane) {
                // An axis or the centre point: a work feature panel may want it
                node.addEventListener('click', function () {
                    if (handlers.onOriginClick) {
                        handlers.onOriginClick(item.axis ? { axis: item.axis } : { point: true });
                    }
                });
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

        // A sketch belongs under the first feature built from it, unless it
        // is shared
        const features = doc.features();
        const consumedBy = {};
        consumed = new Set();
        features.forEach(function (feature) {
            const sketch = feature.sketch ? doc.feature(feature.sketch) : null;
            if (sketch) {
                consumed.add(sketch.id);
                if (!consumedBy[sketch.id] && !sketch.shared) {
                    consumedBy[sketch.id] = feature.id;
                }
            }
        });
        // The sketch being edited is shown opened up, so it can be seen in the tree
        if (editing && consumedBy[editing]) {
            expanded['f:' + consumedBy[editing]] = true;
        }
        if (selected && consumedBy[selected]) {
            expanded['f:' + consumedBy[selected]] = true;
        }

        // The history rows in tree order, and End of Part before the first
        // row that is not built. A row's group starts with its sketch when
        // that sits right before it, so nothing is dropped between them.
        const endAt = doc.endIndex();
        slots = [];
        let endPlaced = false;
        features.forEach(function (feature, i) {
            if (consumedBy[feature.id]) {
                return;
            }
            const child = feature.sketch && consumedBy[feature.sketch] === feature.id ? doc.feature(feature.sketch) : null;
            const first = child && features[i - 1] === child ? child.id : feature.id;
            if (!endPlaced && features.findIndex(function (f) {
                return f.id === first;
            }) > endAt) {
                endPlaced = true;
                slots.push({ kind: 'end' });
                endRow(root, slots.length - 1);
            }
            slots.push({ kind: 'row', first: first, last: feature.id });
            featureRow(root, 1, feature, child, slots.length - 1);
        });
        if (!endPlaced) {
            slots.push({ kind: 'end' });
            endRow(root, slots.length - 1);
        }
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
